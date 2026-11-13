# Deployment

Fileverse is one Docker image (web app + API + every engine). It needs a **real server with a
persistent disk**, because it stores multi-GB uploads and runs long FFmpeg/LibreOffice jobs.

> Facts about third-party services below were checked in November 2026. Providers change their free
> tiers — confirm the current limits before relying on them.

## 1. Choosing where to host

| Option | Cost | Works for Fileverse? |
|---|---|---|
| **Oracle Cloud Always Free – Ampere A1 VM** | Free | **Yes — best free option.** Currently 2 Arm OCPUs + 12 GB RAM in total and 200 GB of block storage (boot + data). Oracle halved the A1 allowance in 2026 (it was 4 OCPU / 24 GB); older guides are out of date. |
| Any VPS / dedicated server (Hetzner, DigitalOcean, OVH, AWS Lightsail, …) | Paid | **Yes.** Aim for ≥ 4 vCPU, ≥ 8 GB RAM and a disk at least 3× your largest expected file. |
| Your own computer + Cloudflare Tunnel | Free | Yes, for testing or small audiences. |
| Serverless / static hosts (Vercel, Netlify, Cloudflare Pages/Workers, free PaaS tiers) | Free | **Not for the API.** They cap request sizes and execution time, have no persistent disk and cannot run FFmpeg/LibreOffice. They can host the *web app* only (see §5). |

### What 5–6 GB files need

- **Disk:** an upload, its result, and temporary space. Remuxing a 6 GB MKV needs ≈ 12 GB free; a full
  re-encode needs about the same. Set `DISK_RESERVE_MB` so new uploads are refused (with a clear
  message) before the disk fills up. On Oracle Always Free, give the VM a 150–200 GB boot volume.
- **Bandwidth:** uploads/downloads stream directly; there is no file-size limit in Fileverse itself
  beyond `MAX_UPLOAD_MB` (default 20 GB).
- **CPU:** remuxes (MKV→MP4, MOV→MP4, extracting audio from MP4…) are disk-bound and take seconds to
  minutes even for 6 GB. Full re-encodes of long HD videos are CPU-bound; on a 2-core VM expect them to
  take roughly as long as the video plays or longer. Fileverse always prefers the remux path when the
  formats allow it.
- **Disk speed on Oracle:** the default "Balanced" block volume scales throughput with size, so a larger
  boot volume is also a faster one.

## 2. Free domain + HTTPS

1. Get a free subdomain at **[duckdns.org](https://www.duckdns.org)** (sign in, pick `yourname`, enter
   your server's public IP). EU.org also offers free domains, but approval can take a very long time.
   (Freenom's free .tk/.ml domains no longer exist.)
2. The included `docker-compose.yml` runs **Caddy**, which obtains and renews a Let's Encrypt
   certificate for that domain automatically.

## 3. Oracle Cloud Always Free — step by step

> **Prefer clicking to typing?** [FREE-HOSTING-GUIDE.md](FREE-HOSTING-GUIDE.md) does all of this from the browser with a
> paste-in setup script (`deploy/oracle-setup.sh`) — no terminal on your laptop.

1. Create an Oracle Cloud account (choose your **home region** carefully; Always Free storage must be
   in it).
2. **Compute → Instances → Create instance**
   - Image: **Canonical Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex**, **2 OCPUs, 12 GB** (the whole current allowance)
   - Boot volume: **150–200 GB** (Always Free includes 200 GB total)
   - Add your SSH key.
3. **Networking → your VCN → Security List → Ingress rules:** allow TCP **80** and **443** from
   `0.0.0.0/0`.
4. SSH in. Oracle's Ubuntu images also block ports with iptables — open them:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```
5. Install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER && newgrp docker
   ```
6. Get Fileverse onto the server (git clone, or upload the zip and unzip), then:
   ```bash
   cd fileverse
   cp deploy/fileverse.env.example .env
   nano .env                       # set DOMAIN=yourname.duckdns.org; 2-core VM: HEAVY_CONCURRENCY=1, LIGHT_CONCURRENCY=2
   docker compose up -d --build    # first build takes 10–20 minutes (it installs every engine)
   ```
7. Open `https://yourname.duckdns.org`. Check `https://yourname.duckdns.org/api/health`.

The image builds natively on Arm64 (all engines and the prebuilt libvips/sharp binaries support it).

## 4. Putting Cloudflare in front (optional)

Cloudflare's proxy (orange cloud) or **Cloudflare Tunnel** (no open ports at all) work with Fileverse:

- The free plan limits each **request body to 100 MB**. Fileverse uploads in 50 MB chunks
  (`UPLOAD_CHUNK_MB=50`), so multi-GB uploads pass through. Keep the chunk size below 100.
- Cloudflare does not limit response sizes, so large downloads stream through.
- With Cloudflare Tunnel, set `TRUST_PROXY=true` so per-IP fair use sees real client addresses.
- Live progress uses Server-Sent Events; Fileverse sends a heartbeat every 15 s so idle connections stay open.

Tunnel quick start (on the server, after `docker compose up` without the caddy service):
```bash
cloudflared tunnel login
cloudflared tunnel create fileverse
cloudflared tunnel route dns fileverse convert.example.com
cloudflared tunnel run --url http://localhost:8080 fileverse
```

## 5. Hosting the web app separately (optional)

The API serves the web app itself, which is simplest. To put the web app on a static host instead:

```bash
cd web
VITE_API_URL=https://api.example.com npm run build     # upload web/dist to the static host (SPA fallback to index.html)
```
and on the server set `CORS_ORIGINS=https://your-static-site.example`.

## 6. Running without Docker

Ubuntu 24.04:

```bash
sudo apt install ffmpeg imagemagick libheif-examples libheif-plugin-libde265 \
  libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw pandoc qpdf ghostscript \
  poppler-utils 7zip 7zip-rar ocrmypdf tesseract-ocr tesseract-ocr-eng fontforge-nox calibre \
  fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-noto-core fonts-noto-cjk python3-venv
python3 -m venv /opt/venv && /opt/venv/bin/pip install pdf2docx pdfplumber openpyxl python-pptx img2pdf fonttools brotli python-docx
# Node.js ≥ 22.13 (e.g. from nodejs.org), then:
cd web && npm ci && npm run build
cd ../server && npm ci --omit=dev
PATH=/opt/venv/bin:$PATH DATA_DIR=/var/lib/fileverse node src/index.js
```

Run it with systemd or pm2, behind Caddy or nginx. For nginx, disable request buffering and size
limits on `/api/uploads` (`client_max_body_size 0; proxy_request_buffering off;`) and response
buffering on `/api/events` (`proxy_buffering off;`).

## 7. Operating it

- **Health:** `GET /api/health` → engines found, queue length.
- **Logs:** `docker compose logs -f fileverse` — each job logs its duration; failures log the engine's last lines.
- **Disk:** watch free space on the data volume. Everything older than `FILE_TTL_MINUTES` is deleted
  automatically every minute; nothing needs backing up (only transient files are stored).
- **Updates:** `git pull && docker compose up -d --build`. Running jobs are recovered after restart
  (retried once).

## 8. Scaling up

1. **Bigger box first.** Raise `HEAVY_CONCURRENCY` / `LIGHT_CONCURRENCY` with the core count.
2. **Split roles on one host:** run one container with `ROLE=api` and one or more with
   `ROLE=worker`, all sharing the same `/data` volume. The SQLite queue coordinates them safely.
3. **Several hosts:** put `DATA_DIR` on shared storage (NFS/EFS) or replace the storage layer with
   S3-compatible object storage, and replace the SQLite queue with Redis/Postgres. The queue
   (`server/src/jobs/store.js`) and storage paths (`config.paths`) are isolated modules for this reason.
