# Fileverse — one image with the web app, the API and every conversion engine.
# Build:  docker build -t fileverse .
# Lighter image without ebooks (Calibre adds ~600 MB):  docker build --build-arg WITH_CALIBRE=0 -t fileverse .

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- Node.js runtime (binary only) ----------
FROM ${NODE_IMAGE} AS node

# ---------- web app ----------
FROM node AS web
WORKDIR /app/web
COPY deploy/extra-ca/ /extra-ca/
COPY web/package.json web/package-lock.json ./
RUN if ls /extra-ca/*.crt >/dev/null 2>&1; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem && cat /extra-ca/*.crt > $NODE_EXTRA_CA_CERTS; fi \
 && npm ci --no-audit --no-fund
COPY web/ ./
# Set VITE_API_URL only when the web app is hosted on a different origin than the API.
ARG VITE_API_URL=
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# ---------- server dependencies ----------
FROM node AS server-deps
WORKDIR /app/server
COPY deploy/extra-ca/ /extra-ca/
COPY server/package.json server/package-lock.json ./
RUN if ls /extra-ca/*.crt >/dev/null 2>&1; then export NODE_EXTRA_CA_CERTS=/tmp/extra-ca.pem && cat /extra-ca/*.crt > $NODE_EXTRA_CA_CERTS; fi \
 && npm ci --omit=dev --no-audit --no-fund

# ---------- runtime ----------
FROM ubuntu:24.04
ARG WITH_CALIBRE=1
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_ENV=production \
    DATA_DIR=/data \
    PATH=/opt/venv/bin:$PATH \
    PYTHON_PATH=/opt/venv/bin/python3 \
    OMP_THREAD_LIMIT=1

# Conversion engines + fonts (metric-compatible replacements for Calibri, Cambria, Arial, Times …)
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates tini \
      ffmpeg \
      imagemagick libheif-examples libheif-plugin-libde265 \
      libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw libreoffice-core \
      pandoc qpdf ghostscript poppler-utils \
      7zip 7zip-rar bzip2 xz-utils \
      ocrmypdf tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa \
      tesseract-ocr-ita tesseract-ocr-por tesseract-ocr-nld tesseract-ocr-ara tesseract-ocr-chi-sim tesseract-ocr-chi-tra \
      tesseract-ocr-jpn tesseract-ocr-kor tesseract-ocr-rus \
      fontforge-nox \
      fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea fonts-dejavu-core fonts-noto-core fonts-noto-cjk \
      python3 python3-venv \
 && if [ "$WITH_CALIBRE" = "1" ]; then apt-get install -y --no-install-recommends calibre; fi \
 && rm -rf /var/lib/apt/lists/*

# Optional extra root certificates (see deploy/extra-ca/README.md).
COPY deploy/extra-ca/ /usr/local/share/ca-certificates/extra/
RUN update-ca-certificates >/dev/null 2>&1 || true

# Python helpers: layout-aware PDF→Word, PDF tables, PowerPoint, lossless images→PDF, fonts.
RUN python3 -m venv /opt/venv \
 && PIP_CERT=/etc/ssl/certs/ca-certificates.crt /opt/venv/bin/pip install --no-cache-dir \
      pdf2docx==0.5.13 pdfplumber openpyxl python-pptx img2pdf fonttools brotli python-docx

# ImageMagick's distro policy caps images at 16K pixels and 256 MB; raise it for real-world photos/scans.
COPY deploy/imagemagick-policy.xml /etc/ImageMagick-6/policy.xml

COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY --from=server-deps /app/server/node_modules ./server/node_modules
COPY server/package.json ./server/
COPY server/src ./server/src
COPY server/scripts ./server/scripts
COPY --from=web /app/web/dist ./web/dist

RUN useradd --system --uid 10001 --home /data fileverse \
 && mkdir -p /data/tmp && chown -R fileverse:fileverse /data
# Engines write temporary files here (on the data volume, not the small container layer).
ENV TMPDIR=/data/tmp
USER fileverse
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/server
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
