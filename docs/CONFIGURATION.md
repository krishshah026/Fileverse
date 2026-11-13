# Configuration

All settings are environment variables (see `server/src/config.js`). Defaults are production-safe.

## Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `ROLE` | `all` | `all` = API + workers in one process. `api` = HTTP only. `worker` = conversions only (same host, shares `DATA_DIR`). |
| `TRUST_PROXY` | `loopback, linklocal, uniquelocal` | Which reverse proxies may set `X-Forwarded-For` (used for per-IP fair use). Use `true` behind Cloudflare Tunnel. |
| `CORS_ORIGINS` | *(empty)* | Comma-separated origins allowed to call the API when the web app is hosted elsewhere, e.g. `https://fileverse.pages.dev`. |
| `DATA_DIR` | `server/data` (`/data` in Docker) | Uploads, results, temp files and the SQLite database. Put it on the biggest disk. |
| `WEB_DIST` | `web/dist` | Built web app served at `/`. If missing, only the API is served. |

## Uploads and storage

| Variable | Default | Description |
|---|---|---|
| `MAX_UPLOAD_MB` | `20480` (20 GB) | Largest single file accepted. |
| `UPLOAD_CHUNK_MB` | `50` | Chunk size the browser uses. Must stay **below 100** behind Cloudflare's free proxy. |
| `DISK_RESERVE_MB` | `2048` | Uploads are refused (HTTP 507, with a clear message) if accepting them would leave less free space than this. Results need room too: for video, reserve at least the size of your largest expected file. |
| `FILE_TTL_MINUTES` | `120` | Uploads and results are deleted this long after their last use. |
| `PARTIAL_UPLOAD_TTL_MINUTES` | `1440` | Unfinished uploads are kept this long so they can be resumed. |

## Processing

| Variable | Default | Description |
|---|---|---|
| `HEAVY_CONCURRENCY` | CPU cores ÷ 2 | Parallel heavy jobs (video/audio encoding, LibreOffice, OCR, ebooks, archives). |
| `LIGHT_CONCURRENCY` | CPU cores | Parallel light jobs (images, data, PDF page operations, fonts, subtitles). |
| `FFMPEG_THREADS` | `0` (auto) | Threads per FFmpeg process. |
| `JOB_TIMEOUT_MINUTES` | `720` | Hard limit per job. |
| `MAX_IMAGE_MEGAPIXELS` | `1000` | Largest image accepted (decompression-bomb protection). |
| `MAX_EXTRACT_MB` | `51200` | Largest total uncompressed size of an archive being extracted (zip-bomb protection). |
| `MAX_EXTRACT_ENTRIES` | `20000` | Most files in an archive being extracted. |
| `MAX_BATCH_INPUTS` | `200` | Most files in one multi-file operation (merge, create archive). |

## Fair use (no daily limits)

| Variable | Default | Description |
|---|---|---|
| `MAX_ACTIVE_JOBS_PER_SESSION` | `25` | Queued + running jobs per browser. Extra files wait in the browser and start automatically. |
| `MAX_ACTIVE_JOBS_PER_IP` | `60` | Same, per IP address (protects against scripted abuse). |

## Engine paths (optional)

Engines are found on `PATH`. Override any of them: `FFMPEG_PATH`, `FFPROBE_PATH`, `IMAGEMAGICK_PATH`,
`SOFFICE_PATH`, `PANDOC_PATH`, `QPDF_PATH`, `GHOSTSCRIPT_PATH`, `PDFTOPPM_PATH`, `PDFTOTEXT_PATH`,
`PDFTOHTML_PATH`, `SEVENZIP_PATH`, `TAR_PATH`, `EBOOK_CONVERT_PATH`, `FONTFORGE_PATH`, `PYTHON_PATH`,
`OCRMYPDF_PATH`, `TESSERACT_PATH`, `HEIF_CONVERT_PATH`.

`GET /api/health` lists which engines were found. Conversions that need a missing engine are hidden.

## Web app (build time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | *(empty = same origin)* | Set only when the web app is hosted on a different domain than the API, e.g. `https://api.example.com`. Also set `CORS_ORIGINS` on the server. |
