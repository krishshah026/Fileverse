// End-to-end tests for every tool, edge case and platform guarantee, against a running server.
// Usage: node test/e2e.mjs [--base http://localhost:8080]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as tus from 'tus-js-client';
import { Client } from './client.mjs';
import { probeMedia, probeImage, probePdf } from '../src/detect/inspect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8080';
const fx = (f) => path.join(here, 'fixtures', f);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-e2e-'));
const c = new Client(base);
const uploads = new Map();
const results = [];

async function up(name) {
  if (!uploads.has(name)) uploads.set(name, await c.upload(fx(name)));
  return uploads.get(name);
}
async function run(body) {
  const job = await c.createJob(body);
  const [done] = await c.waitFor([job.id], { timeoutMs: 15 * 60 * 1000 });
  return done;
}
async function out(job, i = 0) {
  const o = job.outputs[i];
  const dest = path.join(tmp, `${job.id}-${i}-${o.name}`);
  await c.download(job.id, o.index, dest);
  return dest;
}
const pdfText = (f) => execFileSync('pdftotext', [f, '-'], { encoding: 'utf8' });
const pyPdf = (f, expr) => execFileSync('python3', ['-c', `import sys,pypdf; r=pypdf.PdfReader(sys.argv[1]); print(${expr})`, f], { encoding: 'utf8' }).trim();
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}
const ok = (job) => assert(job.status === 'done', `job ${job.status}: ${job.error?.message} ${job.error?.detail?.split('\n').slice(-2).join(' ') || ''}`);

console.log('PDF tools');
await test('merge PDF + DOCX + PNG into one PDF (any-format merge)', async () => {
  const files = await Promise.all(['sample.pdf', 'multipage.pdf', 'sample.docx', 'sample.png'].map(up));
  const job = await run({ tool: 'pdf-merge', inputs: files.map((f) => f.id) });
  ok(job);
  const p = await probePdf(await out(job));
  const expected = (await probePdf(fx('sample.pdf'))).pages + (await probePdf(fx('multipage.pdf'))).pages + 1 + 1;
  assert(p.pages >= expected, `pages ${p.pages} < ${expected}`);
});
await test('split every page', async () => {
  const f = await up('multipage.pdf');
  const n = (await probePdf(fx('multipage.pdf'))).pages;
  const job = await run({ tool: 'pdf-split', inputs: [f.id], options: { mode: 'every' } });
  ok(job);
  assert(job.outputs.length === n, `outputs ${job.outputs.length} != ${n}`);
  assert((await probePdf(await out(job, 1))).pages === 1, 'not single page');
});
await test('split by ranges', async () => {
  const f = await up('multipage.pdf');
  const job = await run({ tool: 'pdf-split', inputs: [f.id], options: { mode: 'ranges', ranges: '1-2; 3-end' } });
  ok(job);
  assert(job.outputs.length === 2, `outputs ${job.outputs.length}`);
  assert((await probePdf(await out(job, 0))).pages === 2, 'first range not 2 pages');
});
await test('extract pages 2,4', async () => {
  const f = await up('multipage.pdf');
  const job = await run({ tool: 'pdf-extract', inputs: [f.id], options: { pages: '2,4' } });
  ok(job);
  const file = await out(job);
  assert((await probePdf(file)).pages === 2, 'not 2 pages');
  const page = (f, n) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), f, '-'], { encoding: 'utf8' }).trim();
  assert(page(file, 1) === page(fx('multipage.pdf'), 2) && page(file, 2) === page(fx('multipage.pdf'), 4), 'wrong pages extracted');
});
await test('remove page 1', async () => {
  const f = await up('multipage.pdf');
  const n = (await probePdf(fx('multipage.pdf'))).pages;
  const job = await run({ tool: 'pdf-remove-pages', inputs: [f.id], options: { pages: '1' } });
  ok(job);
  assert((await probePdf(await out(job))).pages === n - 1, 'page count wrong');
});
await test('rotate all pages 90°', async () => {
  const f = await up('sample.pdf');
  const job = await run({ tool: 'pdf-rotate', inputs: [f.id], options: { angle: '90' } });
  ok(job);
  assert(pyPdf(await out(job), 'r.pages[0].rotation') === '90', 'rotation not applied');
});
await test('compress PDF (never larger than original)', async () => {
  for (const level of ['lossless', 'recommended', 'strong']) {
    const f = await up('sample.pdf');
    const job = await run({ tool: 'pdf-compress', inputs: [f.id], options: { level } });
    ok(job);
    assert(job.outputs[0].size <= f.size, `${level}: ${job.outputs[0].size} > ${f.size}`);
    assert((await probePdf(await out(job))).pages >= 1, 'unreadable');
  }
});
await test('protect → requires password; unlock → open', async () => {
  const f = await up('sample.pdf');
  const job = await run({ tool: 'pdf-protect', inputs: [f.id], options: { password: 'p4ss' } });
  ok(job);
  const p = await probePdf(await out(job));
  assert(p.encrypted && p.requiresPassword, 'not encrypted');
  const enc = await up('encrypted.pdf');
  const un = await run({ tool: 'pdf-unlock', inputs: [enc.id], options: { password: 'secret' } });
  ok(un);
  const q = await probePdf(await out(un));
  assert(!q.encrypted && q.pages >= 1, 'still encrypted');
  const bad = await run({ tool: 'pdf-unlock', inputs: [enc.id], options: { password: 'wrong' } });
  assert(bad.status === 'failed' && /password/i.test(bad.error.message), `wrong password not reported: ${bad.error?.message}`);
});
await test('OCR a scanned PDF → searchable text', async () => {
  const f = await up('scanned.pdf');
  assert(f.info.hasText === false, 'scanned PDF not detected as image-only');
  const job = await run({ tool: 'pdf-ocr', inputs: [f.id], options: { lang: 'eng' } });
  ok(job);
  assert(/Fileverse/i.test(pdfText(await out(job))), 'OCR text missing');
});
await test('PDF → PDF/A-2b', async () => {
  const f = await up('sample.pdf');
  const job = await run({ tool: 'pdf-to-pdfa', inputs: [f.id] });
  ok(job);
  const xmp = fs.readFileSync(await out(job)).toString('latin1');
  assert(/pdfaid:part(>|=")2/.test(xmp), 'no PDF/A identification');
});
await test('scanned PDF → DOCX with OCR', async () => {
  const f = await up('scanned.pdf');
  const target = f.targets.find((t) => t.to === 'docx');
  assert(target.options.find((o) => o.key === 'ocr')?.default === true, 'OCR not suggested for scanned PDF');
  const job = await run({ inputs: [f.id], target: 'docx', options: { ocr: true } });
  ok(job);
  const text = execFileSync('pandoc', [await out(job), '-t', 'plain'], { encoding: 'utf8' });
  assert(/Fileverse/i.test(text), 'text not recognised');
});
await test('encrypted PDF → DOCX with password', async () => {
  const f = await up('encrypted.pdf');
  assert(f.targets.find((t) => t.to === 'docx').options.some((o) => o.key === 'password'), 'password option missing');
  const job = await run({ inputs: [f.id], target: 'docx', options: { password: 'secret' } });
  ok(job);
});
await test('PDF → PPTX (exact mode) and PDF → XLSX', async () => {
  const f = await up('multipage.pdf');
  const a = await run({ inputs: [f.id], target: 'pptx', options: { mode: 'exact' } });
  ok(a);
  const slides = execFileSync('python3', ['-c', 'import sys; from pptx import Presentation; print(len(Presentation(sys.argv[1]).slides))', await out(a)], { encoding: 'utf8' }).trim();
  assert(Number(slides) === (await probePdf(fx('multipage.pdf'))).pages, `slides ${slides}`);
  const s = await up('sample.pdf');
  const b = await run({ inputs: [s.id], target: 'xlsx' });
  ok(b);
});
await test('PDF → PNG pages at 300 DPI', async () => {
  const f = await up('multipage.pdf');
  const job = await run({ inputs: [f.id], target: 'png', options: { dpi: '300', pages: '1-2' } });
  ok(job);
  assert(job.outputs.length === 2, `outputs ${job.outputs.length}`);
  const im = await probeImage(await out(job), 'png');
  assert(im.width > 2000, `width ${im.width} too small for 300 DPI`);
});
await test('images (JPG, PNG with alpha, HEIC, WEBP) → one PDF', async () => {
  const files = await Promise.all(['sample.jpg', 'sample.png', 'sample.heic', 'sample.webp'].map(up));
  const job = await run({ tool: 'images-to-pdf', inputs: files.map((f) => f.id), options: { pageSize: 'a4', margin: '10' } });
  ok(job);
  assert((await probePdf(await out(job))).pages === 4, 'page count');
});

console.log('Image tools');
await test('compress JPG/PNG (smaller or original kept)', async () => {
  for (const name of ['sample.jpg', 'sample.png']) {
    const f = await up(name);
    const job = await run({ tool: 'image-compress', inputs: [f.id], options: { level: 'balanced' } });
    ok(job);
    assert(job.outputs[0].size <= f.size, `${name} grew`);
  }
});
await test('resize 50% respects EXIF orientation', async () => {
  const f = await up('sample.jpg');
  const job = await run({ tool: 'image-resize', inputs: [f.id], options: { by: 'percent', percent: 50 } });
  ok(job);
  const im = await probeImage(await out(job), 'jpg');
  assert(Math.abs(im.width - f.info.width / 2) <= 1 && Math.abs(im.height - f.info.height / 2) <= 1, `${im.width}x${im.height} vs ${f.info.width}x${f.info.height}`);
});
await test('HEIC → JPG keeps dimensions', async () => {
  const f = await up('sample.heic');
  const job = await run({ inputs: [f.id], target: 'jpg' });
  ok(job);
  const im = await probeImage(await out(job), 'jpg');
  assert(im.width === f.info.width, 'dimension mismatch');
});
await test('animated GIF → animated WEBP keeps all frames', async () => {
  const f = await up('sample.gif');
  const job = await run({ inputs: [f.id], target: 'webp' });
  ok(job);
  assert(job.outputs[0].info.frames === 3, `frames ${job.outputs[0].info.frames}`);
});
await test('PNG → WEBP is lossless by default (pixel identical)', async () => {
  const f = await up('sample.png');
  const job = await run({ inputs: [f.id], target: 'webp' });
  ok(job);
  const sharp = (await import('sharp')).default;
  const a = await sharp(fx('sample.png')).ensureAlpha().raw().toBuffer();
  const b = await sharp(await out(job)).ensureAlpha().raw().toBuffer();
  assert(a.equals(b), 'pixels differ');
});

console.log('Video & audio tools');
await test('MKV (H.264+Opus+SRT) → MP4 copies streams, keeps subtitles', async () => {
  const f = await up('sample.mkv');
  const job = await run({ inputs: [f.id], target: 'mp4' });
  ok(job);
  const m = await probeMedia(await out(job));
  assert(m.streams.find((s) => s.type === 'video').codec === 'h264', 'video changed');
  assert(m.streams.find((s) => s.type === 'audio').codec === 'opus', 'audio changed');
  assert(m.streams.some((s) => s.type === 'subtitle' && s.codec === 'mov_text'), 'subtitle lost');
  assert(job.quality.level === 'lossless', 'not marked lossless');
});
await test('HEVC MKV → MP4 is a remux tagged hvc1', async () => {
  const f = await up('hevc-flac.mkv');
  const job = await run({ inputs: [f.id], target: 'mp4' });
  ok(job);
  const file = await out(job);
  assert((await probeMedia(file)).streams[0].codec === 'hevc', 'not hevc');
  assert(fs.readFileSync(file).includes(Buffer.from('hvc1')), 'missing hvc1 tag');
});
await test('compress video by quality and to a target size', async () => {
  const f = await up('sample.mp4');
  const a = await run({ tool: 'video-compress', inputs: [f.id], options: { method: 'quality', level: 'strong', resolution: '240' } });
  ok(a);
  assert(a.outputs[0].info.height === 240, `height ${a.outputs[0].info.height}`);
  const b = await run({ tool: 'video-compress', inputs: [f.id], options: { method: 'size', targetMb: 1, codec: 'hevc' } });
  ok(b);
  assert(b.outputs[0].size < 1.15 * 1024 * 1024, `size ${b.outputs[0].size}`);
});
await test('trim video (instant and frame-accurate)', async () => {
  const f = await up('sample.mp4');
  const p = await run({ tool: 'video-trim', inputs: [f.id], options: { start: '1', end: '2' } });
  ok(p);
  assert(p.outputs[0].info.duration <= 2.2, `fast trim duration ${p.outputs[0].info.duration}`);
  const q = await run({ tool: 'video-trim', inputs: [f.id], options: { start: '00:00:01', end: '2', mode: 'precise' } });
  ok(q);
  assert(Math.abs(q.outputs[0].info.duration - 1) < 0.15, `precise duration ${q.outputs[0].info.duration}`);
});
await test('video → GIF with options', async () => {
  const f = await up('sample.mp4');
  const job = await run({ inputs: [f.id], target: 'gif', options: { fps: '10', width: '320', start: '0.5', duration: '1.5' } });
  ok(job);
  const im = await probeImage(await out(job), 'gif');
  assert(im.width === 320, `gif width ${im.width}`);
});
await test('MP4 → MP3 extracts audio; MP3 keeps cover art and tags', async () => {
  const f = await up('sample.mp4');
  const job = await run({ inputs: [f.id], target: 'mp3' });
  ok(job);
  const m = await probeMedia(await out(job));
  assert(m.streams.length === 1 && m.streams[0].codec === 'mp3', 'unexpected streams');
  const mp3 = await up('sample.mp3');
  const j2 = await run({ inputs: [mp3.id], target: 'flac' });
  ok(j2);
  const m2 = await probeMedia(await out(j2));
  assert(m2.streams.some((s) => s.attachedPic), 'cover art lost');
  assert(/Fileverse Test/.test(JSON.stringify(m2.tags)), 'tags lost');
});
await test('WAV 24-bit → FLAC stays 24-bit; → MP3 320k', async () => {
  const f = await up('sample.wav');
  const a = await run({ inputs: [f.id], target: 'flac' });
  ok(a);
  const s = (await probeMedia(await out(a))).streams[0];
  assert(s.bitsPerSample === 24, `bits ${s.bitsPerSample}`);
  const b = await run({ inputs: [f.id], target: 'mp3', options: { bitrate: '320' } });
  ok(b);
});
await test('trim audio with fades; compress audio', async () => {
  const f = await up('sample.mp3');
  const a = await run({ tool: 'audio-trim', inputs: [f.id], options: { start: '0.5', end: '2', fadeIn: 0.5, fadeOut: 0.5 } });
  ok(a);
  assert(Math.abs(a.outputs[0].info.duration - 1.5) < 0.1, `duration ${a.outputs[0].info.duration}`);
  const w = await up('sample.wav');
  const b = await run({ tool: 'audio-compress', inputs: [w.id], options: { bitrate: '96', format: 'opus' } });
  ok(b);
  assert(b.outputs[0].format === 'opus' && b.outputs[0].size < w.size / 5, 'not compressed');
});
await test('extract subtitles from MKV → SRT', async () => {
  const f = await up('sample.mkv');
  const job = await run({ inputs: [f.id], target: 'srt' });
  ok(job);
  assert(/Hello from Fileverse/.test(fs.readFileSync(await out(job), 'utf8')), 'text missing');
});

console.log('Archives');
await test('extract ZIP keeps folder structure', async () => {
  const f = await up('sample.zip');
  const job = await run({ tool: 'archive-extract', inputs: [f.id] });
  ok(job);
  const rels = job.outputs.map((o) => o.relPath).sort();
  assert(rels.includes('folder/sample.png') && rels.includes('sample.txt'), `relPaths ${rels}`);
});
await test('extract encrypted ZIP with password; wrong password reported', async () => {
  const f = await up('encrypted.zip');
  const bad = await run({ tool: 'archive-extract', inputs: [f.id] });
  assert(bad.status === 'failed' && /password/i.test(bad.error.message), `no password error: ${bad.error?.message}`);
  const good = await run({ tool: 'archive-extract', inputs: [f.id], options: { password: 'secret' } });
  ok(good);
  assert(good.outputs.length >= 2, 'files missing');
});
await test('extract TAR.XZ, 7Z and single GZ', async () => {
  for (const n of ['sample.tar.xz', 'sample.7z', 'sample.txt.gz']) {
    const f = await up(n);
    const job = await run({ tool: 'archive-extract', inputs: [f.id] });
    ok(job);
    if (n.endsWith('.gz')) assert(job.outputs[0].name === 'sample.txt', `name ${job.outputs[0].name}`);
  }
});
await test('create password-protected ZIP and a 7Z', async () => {
  const files = await Promise.all(['sample.png', 'sample.txt', 'sample.json'].map(up));
  const job = await run({ tool: 'archive-create', inputs: files.map((f) => f.id), options: { format: 'zip', newPassword: 'zipsecret', name: 'bundle' } });
  ok(job);
  const file = await out(job);
  assert(job.outputs[0].name === 'bundle.zip', job.outputs[0].name);
  execFileSync('7z', ['t', '-pzipsecret', file], { stdio: 'ignore' });
  let opened = true;
  try {
    execFileSync('7z', ['t', '-pwrong', file], { stdio: 'ignore' });
  } catch {
    opened = false;
  }
  assert(!opened, 'zip not encrypted');
  const j7 = await run({ tool: 'archive-create', inputs: files.map((f) => f.id), options: { format: '7z' } });
  ok(j7);
});

console.log('Platform');
await test('download-all ZIP (streamed) contains every output', async () => {
  const f = await up('multipage.pdf');
  const job = await run({ tool: 'pdf-split', inputs: [f.id], options: { mode: 'every' } });
  const res = await fetch(`${base}/api/archive?jobs=${job.id}`, { headers: c.headers() });
  assert(res.ok, `status ${res.status}`);
  const dest = path.join(tmp, 'all.zip');
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  const list = execFileSync('7z', ['l', '-ba', dest], { encoding: 'utf8' }).trim().split('\n');
  assert(list.length === job.outputs.length, `${list.length} vs ${job.outputs.length}`);
});
await test('downloads support HTTP range requests (resumable)', async () => {
  const f = await up('sample.mp4');
  const job = await run({ inputs: [f.id], target: 'mkv' });
  const res = await fetch(`${base}/api/jobs/${job.id}/outputs/0`, { headers: { ...c.headers(), Range: 'bytes=100-199' } });
  assert(res.status === 206 && (await res.arrayBuffer()).byteLength === 100, `status ${res.status}`);
});
await test('interrupted upload resumes from the last chunk', async () => {
  const src = path.join(tmp, 'resume.bin');
  const big = path.join(tmp, 'resume.mkv');
  // 12 MB file in 2 MB chunks; stop after the first chunks, then resume with a fresh client.
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=6', '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', big]);
  fs.copyFileSync(big, src);
  const size = fs.statSync(src).size;
  let url;
  await new Promise((resolve) => {
    const u = new tus.Upload(fs.createReadStream(src), {
      endpoint: `${base}/api/uploads`, chunkSize: 2 * 1024 * 1024, uploadSize: size, metadata: { filename: 'resume.mkv' }, headers: c.headers(),
      onProgress: (sent) => {
        if (sent > 4 * 1024 * 1024 && !url) {
          url = u.url;
          u.abort();
          setTimeout(resolve, 300);
        }
      },
      onError: resolve,
    });
    u.start();
  });
  const head = await fetch(url, { method: 'HEAD', headers: { ...c.headers(), 'Tus-Resumable': '1.0.0' } });
  const offset = Number(head.headers.get('upload-offset'));
  assert(offset > 0 && offset < size, `offset ${offset}`);
  const file = await new Promise((resolve, reject) => {
    const u = new tus.Upload(fs.createReadStream(src), {
      uploadUrl: url, chunkSize: 2 * 1024 * 1024, uploadSize: size, headers: c.headers(),
      onSuccess: ({ lastResponse }) => resolve(JSON.parse(lastResponse.getBody())), onError: reject,
    });
    u.start();
  });
  assert(file.size === size && file.format === 'mkv', 'resumed upload incomplete');
});
await test('cancelling a running job stops it', async () => {
  const f = await up('sample.mp4');
  const job = await c.createJob({ inputs: [f.id], target: 'webm', options: { quality: 'high', speed: 'slow' } });
  await new Promise((r) => setTimeout(r, 800));
  await c.json('DELETE', `/api/jobs/${job.id}`);
  const [j] = await c.waitFor([job.id]);
  assert(j.status === 'canceled' || j.status === 'done', `status ${j.status}`);
});
await test('content-based detection: PNG named .jpg', async () => {
  const fake = path.join(tmp, 'photo.jpg');
  fs.copyFileSync(fx('sample.png'), fake);
  const f = await c.upload(fake);
  assert(f.format === 'png' && f.detection.mismatch, `format ${f.format}`);
});
await test('unknown binary file → no targets, clear message', async () => {
  const junk = path.join(tmp, 'mystery.xyz');
  fs.writeFileSync(junk, crypto.randomBytes(4096));
  const f = await c.upload(junk);
  assert(f.format === null && f.targets.length === 0, 'unexpected targets');
});
await test('other sessions cannot see or download your files', async () => {
  const f = await up('sample.png');
  const job = await run({ inputs: [f.id], target: 'jpg' });
  const intruder = new Client(base);
  for (const url of [`/api/files/${f.id}`, `/api/jobs/${job.id}`]) {
    let status = 200;
    try {
      await intruder.json('GET', url);
    } catch (e) {
      status = e.status;
    }
    assert(status === 404, `${url} → ${status}`);
  }
  const res = await fetch(`${base}/api/jobs/${job.id}/outputs/0`, { headers: intruder.headers() });
  assert(res.status === 404, `download → ${res.status}`);
});
await test('SVG/HTML results are never served inline (XSS safe)', async () => {
  const f = await up('sample.md');
  const job = await run({ inputs: [f.id], target: 'html' });
  const res = await fetch(`${base}/api/jobs/${job.id}/outputs/0?inline=1`, { headers: c.headers() });
  assert(/attachment/.test(res.headers.get('content-disposition') || ''), 'served inline');
});
await test('invalid options are rejected with a clear message', async () => {
  const f = await up('multipage.pdf');
  let msg = '';
  try {
    await c.createJob({ tool: 'pdf-extract', inputs: [f.id], options: { pages: 'abc' } });
  } catch (e) {
    msg = e.message;
  }
  assert(/page/i.test(msg), `message: ${msg}`);
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
