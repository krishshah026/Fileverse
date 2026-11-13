# Architecture

## Overview

```
 Browser (React SPA)                         Fileverse server (Node.js, one process or split roles)
 ─────────────────────                       ──────────────────────────────────────────────────────────
 drop file ──► tus upload, 50 MB chunks ───► /api/uploads (tus) ──► disk: data/uploads/<id>
               resumable, never in RAM                │ on finish: magic-byte detection + ffprobe/
                                                      │ libvips/qpdf inspection → files table
 picks target ◄── targets + quality notes ◄── /api/files/:id   (routes filtered by the file itself)
 Convert ─────────────────────────────────► POST /api/jobs ──► SQLite queue (WAL, durable)
                                                                   │ atomic claim, fair per session
 progress bar ◄── Server-Sent Events ◄──── /api/events ◄─── workers: heavy pool / light pool
                                                                   │ engines run as child processes
 Download ◄── streamed, HTTP Range ◄────── /api/jobs/:id/outputs/:n   data/jobs/<id>/out/
 Download all ◄── streamed ZIP64 ◄──────── /api/archive?jobs=…
                                            cleanup sweeper: deletes everything after FILE_TTL_MINUTES
```

## Key decisions

**Server-side conversion.** Conversions run on the server with the reference engines (FFmpeg,
libvips, LibreOffice, Ghostscript…). Browser-side conversion (WebAssembly or canvas) was rejected for
the conversions themselves because it cannot handle multi-GB files, loses colour profiles and metadata
with canvas, and produces different quality on every device. The browser does what it is genuinely good
at: instant format detection from the file name (so targets appear before the upload finishes), local
image previews, and streaming the file in chunks without reading it into memory.

**Resumable chunked uploads (tus).** Multi-GB uploads must survive flaky connections and proxies with
body limits. The browser sends 50 MB chunks; the server appends them to disk. If the connection drops,
the client asks for the current offset and continues — even after a page reload (same file, same
browser). A 6.06 GB file was uploaded, converted and downloaded in tests with a peak server memory of
151 MB.

**Durable SQLite queue.** Jobs live in SQLite (built into Node ≥ 22.13) in WAL mode. A job is claimed
with a single `UPDATE … RETURNING` statement, so several worker processes can never take the same job.
Running jobs send a heartbeat; if a worker dies, its job is retried once, then failed with a clear
message. The scheduler orders queued jobs by *how many jobs that session already has running*, so a
200-file batch from one person does not starve everyone else.

**Two worker pools.** Heavy jobs (video/audio encoding, LibreOffice, OCR, Calibre, archives) and light
jobs (images, data, small PDF operations) have separate concurrency limits, so a long video never blocks
a quick PNG→JPG.

**Fair use instead of quotas.** There are no daily or monthly limits. The only limit is the number of
*concurrent* jobs per browser session (25) and per IP (60); the web app keeps extra files in a local
queue and submits them automatically as slots free up, so users never see a refusal.

**Live progress.** FFmpeg reports progress through `-progress pipe:1`; LibreOffice, Calibre, OCR and
Python helpers report pages/percentages. The runner converts this into a 0–1 fraction plus a smoothed
ETA and stores it in SQLite; one shared poller pushes changes to browsers over Server-Sent Events (with
polling fallback), which works identically when API and workers are separate processes.

## Quality policy

Every route declares how it affects quality, and the UI shows it before converting:

| Level | Meaning | Examples |
|---|---|---|
| `lossless` | output decodes to exactly the input data | MKV→MP4 remux, WAV→FLAC, PNG→WEBP (lossless), TTF→WOFF2, ZIP→7Z |
| `high` | re-encoded/re-rendered at visually lossless settings | H.264 CRF 18, JPG 92 % 4:4:4, DOCX→PDF |
| `lossy` | the target format itself discards data | anything → GIF, compression tools, → TXT |

Rules the converters follow:

- **Video:** each stream is decided separately — copy if the target container supports the codec,
  re-encode otherwise. MKV(H.264/HEVC + AAC/Opus) → MP4 copies everything; incompatible audio (e.g. DTS)
  is re-encoded alone while the video is still copied. Subtitles are converted to the container's text
  format (SRT → mov_text for MP4); image-based subtitles that MP4 cannot hold are reported, not silently
  dropped. Metadata, chapters, rotation and HDR-capable bit depth are kept. If a copy unexpectedly fails
  (odd timestamps), the job falls back to a visually lossless re-encode instead of failing.
- **Audio:** copy when the codec fits the target (MP4→M4A/AAC, MKV→OPUS…). Lossless targets keep bit
  depth (24-bit WAV → 24-bit FLAC). "Automatic" bitrates use each format's maximum (MP3 320 kbps CBR,
  AAC ≥ 256 kbps, Opus ≥ 160 kbps). Lossy → lossless conversions explain that they cannot restore detail.
  Cover art and tags are carried over.
- **Images:** decoded and encoded by libvips; pixels are auto-oriented, EXIF/ICC are kept by default,
  16-bit depth is preserved for PNG/TIFF, lossless WEBP/AVIF is the default for lossless sources,
  animated GIF→WEBP keeps every frame, transparency is never silently lost (BMP v5 with alpha; JPG
  explains the background fill). Image → PDF embeds JPGs without recompression (img2pdf).
- **Documents:** LibreOffice with metric-compatible fonts (Carlito = Calibri, Caladea = Cambria,
  Liberation = Arial/Times/Courier, Noto incl. CJK). PDF export keeps full-resolution images.
  PDF → Word uses pdf2docx (paragraphs, tables, images, columns); scanned PDFs are detected and OCR is
  offered automatically.

These claims are enforced by `server/test/quality.mjs`, which checks stream hashes, decoded pixels and
samples, and SSIM — not just labels.

## Route planning

`server/src/registry/index.js` builds a graph of direct conversions from every converter's
`routes`. When no direct route exists, a two-step route through a *pivot* format is offered only where
the extra step costs nothing (e.g. `PPTX → PDF → PNG`, `MD → DOCX → PDF`, `XLSX → CSV → JSON`,
`HEIC → PNG → ICO`). Routes whose engines are not installed are never shown. Each route is also checked
against the uploaded file (`accepts`): a video without audio is not offered MP3, a video without text
subtitles is not offered SRT.

## Adding a converter

Create `server/src/converters/myformat.js` and add it to `CONVERTERS` in `registry/index.js`:

```js
export default {
  id: 'myformat',
  label: 'My converter',
  engines: ['ffmpeg'],               // hidden automatically if missing (see engines/available.js)
  weight: 'light',                   // 'heavy' for long CPU-bound work
  routes: [{ from: ['abc'], to: ['xyz'] }],
  options: (from, to, info) => [     // rendered by the web app, validated by the server
    { key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, default: 90 },
  ],
  quality: (from, to) => ({ level: 'high', message: 'What the user should know.' }),
  async run(ctx) {                   // ctx.input.path, ctx.options, ctx.progress(f), ctx.note(msg), ctx.signal
    const out = ctx.outFile(ctx.to);
    /* … produce out … */
    return [out];
  },
};
```

New formats go into `server/src/registry/formats.js` (one line). Tools follow the same pattern in
`server/src/tools/`. Then run `npm run test:matrix` — the new routes are tested automatically.

## Security

- Engines run as child processes with argument arrays (no shell), with timeouts and kill-on-cancel of
  the whole process group.
- Each LibreOffice run uses a private, disposable profile; ImageMagick runs with a restrictive policy
  (no PDF/PS/URL coders, resource limits); archive extraction refuses zip bombs (size and entry limits
  checked before extracting), strips symlinks and keeps paths inside the job folder.
- Files and jobs are scoped to an anonymous 128-bit browser session; IDs are 128-bit random. Other
  sessions get 404 for everything.
- HTML/SVG/XML results are always served as downloads, never inline (no stored XSS); strict CSP,
  `nosniff`, `X-Frame-Options`, referrer policy.
- Password options (PDF/ZIP) are wiped from the database when the job finishes.
- Everything is deleted automatically after `FILE_TTL_MINUTES`; partial uploads after
  `PARTIAL_UPLOAD_TTL_MINUTES`.
