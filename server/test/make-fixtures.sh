#!/usr/bin/env bash
# Generates one real sample file per supported input format into $1 (default ./fixtures).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/fixtures}"
mkdir -p "$OUT" && cd "$OUT"
FF="ffmpeg -hide_banner -loglevel error -y"
SRC="-f lavfi -i testsrc2=size=640x360:rate=25:duration=3 -f lavfi -i sine=frequency=440:sample_rate=48000:duration=3"

# ---------- subtitles ----------
cat > sample.srt <<'S'
1
00:00:00,500 --> 00:00:01,500
Hello from Fileverse

2
00:00:01,800 --> 00:00:02,800
Ünïcödé subtitles ✓
S
$FF -i sample.srt sample.vtt; $FF -i sample.srt sample.ass; $FF -i sample.srt -f ass sample.ssa; $FF -i sample.srt -c:s text -f lrc sample.lrc

# ---------- video ----------
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart sample.mp4
$FF $SRC -i sample.srt -map 0 -map 1 -map 2 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a libopus -c:s srt -metadata:s:s:0 language=eng sample.mkv
$FF $SRC -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 500k -c:a libopus sample.webm
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac sample.mov
$FF $SRC -c:v mpeg4 -q:v 4 -c:a libmp3lame sample.avi
$FF $SRC -c:v wmv2 -q:v 4 -c:a wmav2 sample.wmv
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac sample.flv
$FF $SRC -c:v mpeg2video -q:v 4 -c:a mp2 -f mpeg sample.mpeg
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f mp4 sample.m4v
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -ac 1 -ar 16000 -f 3gp sample.3gp
$FF $SRC -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -f mpegts sample.ts
$FF $SRC -c:v libtheora -q:v 6 -c:a libvorbis sample.ogv
# HEVC + FLAC in MKV (tests stream copy to MP4 with hvc1 tag) and odd dimensions (tests even-size fix)
$FF $SRC -c:v libx265 -preset ultrafast -x265-params log-level=error -c:a flac hevc-flac.mkv
$FF -f lavfi -i testsrc2=size=641x361:rate=25:duration=2 -c:v libx264 -preset veryfast -pix_fmt yuv444p odd-size.mkv

# ---------- audio ----------
$FF -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" -f lavfi -i "sine=frequency=660:sample_rate=48000:duration=3" -filter_complex amerge=inputs=2 -c:a pcm_s24le sample.wav
$FF -i sample.wav -c:a flac sample.flac
$FF -f lavfi -i "color=c=#3355ff:s=300x300:d=1" -frames:v 1 cover.png
$FF -i sample.wav -i cover.png -map 0:a -map 1:v -c:a libmp3lame -q:a 2 -c:v png -disposition:v attached_pic -id3v2_version 3 -metadata title="Fileverse Test" -metadata artist="Fileverse" sample.mp3
$FF -i sample.wav -c:a aac -b:a 192k -f adts sample.aac
$FF -i sample.wav -c:a aac -b:a 192k sample.m4a
$FF -i sample.wav -c:a libvorbis sample.ogg
$FF -i sample.wav -c:a libopus sample.opus
$FF -i sample.wav -c:a wmav2 sample.wma
$FF -i sample.wav -c:a pcm_s16be sample.aiff
$FF -i sample.wav -c:a ac3 sample.ac3
rm -f cover.png

# ---------- images ----------
node "$HERE/make-images.mjs" "$OUT"
convert sample.png bmp3:sample.bmp
convert sample.png -define icon:auto-resize=64,32,16 sample.ico
convert sample.png -compress RLE sample.tga
convert sample.png sample.psd
python3 -c "import pillow_heif; from PIL import Image; pillow_heif.register_heif_opener(); Image.open('sample.png').convert('RGB').save('sample.heic', quality=90)" 2>/dev/null || echo "note: pillow-heif missing, no HEIC fixture"

# ---------- documents ----------
cat > sample.md <<'M'
# Fileverse sample document

This is **bold**, *italic* and `code`. Ünïcödé: café, naïve, 日本語.

| Item | Qty | Price |
|------|----:|------:|
| Apples | 3 | 1.50 |
| Pears | 5 | 2.25 |

- First point
- Second point

![Logo](sample.png)
M
cp sample.md sample.markdown.md
pandoc sample.md -o sample.docx --resource-path=.
pandoc sample.md -s -o sample.html --embed-resources --resource-path=. --metadata title=Sample
pandoc sample.md -o sample.epub --resource-path=. --metadata title="Sample Book" --metadata author="Fileverse"
printf 'Plain text file\nSecond line — with Unicode ✓\n' > sample.txt
LOPROF="-env:UserInstallation=file:///tmp/fixture-lo"
soffice --headless $LOPROF --convert-to odt sample.docx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to doc sample.docx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to rtf sample.docx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to pdf sample.docx >/dev/null 2>&1
python3 "$HERE/make-office.py" "$OUT"
soffice --headless $LOPROF --convert-to xls sample.xlsx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to ods sample.xlsx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to ppt sample.pptx >/dev/null 2>&1
soffice --headless $LOPROF --convert-to odp sample.pptx >/dev/null 2>&1
# multi-page PDF, scanned (image-only) PDF and encrypted PDF
soffice --headless $LOPROF --convert-to pdf multipage.odt >/dev/null 2>&1 || true
pdftoppm -r 100 -png -f 1 -l 1 sample.pdf scan >/dev/null && img2pdf scan-1.png -o scanned.pdf && rm -f scan-1.png
qpdf --encrypt secret owner 256 -- sample.pdf encrypted.pdf

# ---------- ebooks ----------
export QT_QPA_PLATFORM=offscreen
ebook-convert sample.epub sample.mobi >/dev/null 2>&1
ebook-convert sample.epub sample.azw3 >/dev/null 2>&1
ebook-convert sample.epub sample.fb2 >/dev/null 2>&1
mkdir -p comic && cp sample.png comic/001.png && cp sample.jpg comic/002.jpg && (cd comic && 7z a -tzip ../sample.cbz . >/dev/null) && rm -rf comic

# ---------- archives ----------
mkdir -p pack/folder && cp sample.txt pack/ && cp sample.png pack/folder/ && cp sample.json pack/folder/ 2>/dev/null || true
(cd pack && 7z a -tzip ../sample.zip . >/dev/null && 7z a -t7z ../sample.7z . >/dev/null)
tar -cf sample.tar -C pack . && tar -czf sample.tar.gz -C pack . && tar -cjf sample.tar.bz2 -C pack . && tar -cJf sample.tar.xz -C pack .
gzip -c sample.txt > sample.txt.gz && bzip2 -c sample.txt > sample.txt.bz2 && xz -c sample.txt > sample.txt.xz
(cd pack && 7z a -tzip -psecret -mem=AES256 ../encrypted.zip . >/dev/null)
rm -rf pack

# ---------- fonts ----------
cp /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf sample.ttf
cp "$(fc-list : file | grep -m1 -E 'urw-base35/.*\.otf' | cut -d: -f1)" sample.otf
python3 -c "
from fontTools.ttLib import TTFont
f=TTFont('sample.ttf'); f.flavor='woff'; f.save('sample.woff')
f=TTFont('sample.ttf'); f.flavor='woff2'; f.save('sample.woff2')"
echo "fixtures ready in $OUT: $(ls | wc -l) files"
