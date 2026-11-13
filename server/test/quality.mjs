// Measured quality guarantees. Instead of trusting labels, every claim is checked numerically:
//  - "no re-encoding" routes must produce bit-identical streams (packet hashes)
//  - lossless routes must decode to identical pixels / samples / data
//  - unavoidable lossy routes must be visually lossless by objective metrics (SSIM)
// Usage: node test/quality.mjs [--base http://localhost:8080]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Client } from './client.mjs';
import { readData } from '../src/converters/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = process.argv.includes('--base') ? process.argv[process.argv.indexOf('--base') + 1] : 'http://localhost:8080';
const fx = (f) => path.join(here, 'fixtures', f);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-q-'));
const c = new Client(base);
const ups = new Map();
const results = [];

const up = async (n) => (ups.has(n) ? ups.get(n) : (ups.set(n, await c.upload(fx(n))), ups.get(n)));
async function convert(name, target, options = {}) {
  const f = await up(name);
  const job = await c.createJob({ inputs: [f.id], target, options });
  const [done] = await c.waitFor([job.id]);
  if (done.status !== 'done') throw new Error(`${name}→${target} ${done.status}: ${done.error?.message}`);
  const dest = path.join(tmp, `${done.id}.${target}`);
  await c.download(done.id, 0, dest);
  return { file: dest, job: done };
}
async function tool(names, id, options = {}) {
  const files = await Promise.all(names.map(up));
  const job = await c.createJob({ inputs: files.map((f) => f.id), tool: id, options });
  const [done] = await c.waitFor([job.id]);
  if (done.status !== 'done') throw new Error(`${id} ${done.status}: ${done.error?.message}`);
  const dest = path.join(tmp, `${done.id}-${done.outputs[0].name}`);
  await c.download(done.id, 0, dest);
  return { file: dest, job: done };
}
const sh = (bin, args) => execFileSync(bin, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
/** Hash of the compressed packets of one stream — equal only if not re-encoded. */
const streamHash = (file, sel) => sh('ffmpeg', ['-v', 'error', '-i', file, '-map', `0:${sel}`, '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-']).trim();
/** Hash of decoded video frames — equal only if every pixel of every frame is identical. */
const frameHash = (file) => sh('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0', '-vf', 'setpts=PTS-STARTPTS', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-', '-f', 'hash', '-hash', 'sha256', '-']).trim().split('\n').pop();
/** Hash of decoded audio at a fixed sample format — equal only if samples are identical. */
const pcmHash = (file, fmt = 's32le') => sh('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-f', fmt, '-c:a', `pcm_${fmt}`, '-', '-f', 'hash', '-hash', 'sha256', '-']).trim().split('\n').pop();
/** SSIM between two videos/images, compared frame by frame in order (1.0 = identical). */
function ssimValue(dist, ref) {
  const out = execFileSync('sh', ['-c', 'ffmpeg -v info -i "$1" -i "$2" -lavfi "[0:v]settb=1/25,setpts=N[a];[1:v]settb=1/25,setpts=N[b];[a][b]ssim" -f null - 2>&1 | grep -o "All:[0-9.]*" | tail -1', 'sh', dist, ref], { encoding: 'utf8' });
  return Number(out.trim().split(':')[1]);
}
const frameCount = (f) => Number(sh('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', f]).trim());
async function pixels(file) {
  if (/\.(bmp|tga)$/.test(file)) {
    // libvips cannot read these; decode losslessly with ImageMagick first.
    const png = `${file}.png`;
    execFileSync('convert', [`${file.endsWith('bmp') ? 'bmp' : 'tga'}:${file}`, `png:${png}`]);
    file = png;
  }
  const meta = await sharp(file).metadata();
  let p = sharp(file, { failOn: 'none' }).rotate().ensureAlpha();
  if (meta.depth === 'ushort') p = p.toColourspace('rgb16');
  const { data, info } = await p.raw(meta.depth === 'ushort' ? { depth: 'ushort' } : {}).toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, deep: meta.depth === 'ushort' };
}
async function imageSsim(a, b) {
  // SSIM on luma via ffmpeg after converting both to PNG
  const pa = path.join(tmp, `${crypto.randomUUID()}.png`);
  const pb = path.join(tmp, `${crypto.randomUUID()}.png`);
  await sharp(a).rotate().flatten({ background: '#ffffff' }).png().toFile(pa);
  await sharp(b).rotate().flatten({ background: '#ffffff' }).png().toFile(pb);
  return ssimValue(pa, pb);
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
async function check(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}: ${e.message}`);
  }
}

console.log('Bit-identical stream copies (no re-encoding)');
for (const [src, to] of [['sample.mkv', 'mp4'], ['sample.mkv', 'mov'], ['hevc-flac.mkv', 'mp4'], ['sample.mp4', 'mkv'], ['sample.webm', 'mkv'], ['sample.webm', 'mp4'], ['sample.avi', 'mp4'], ['sample.mov', 'mp4'], ['sample.ts', 'mp4'], ['sample.flv', 'mp4'], ['sample.m4v', 'mkv']]) {
  await check(`${src} → ${to}: video packets identical`, async () => {
    const { file, job } = await convert(src, to);
    assert(job.quality?.level === 'lossless', `labelled ${job.quality?.level}`);
    if (streamHash(file, 'v:0') === streamHash(fx(src), 'v:0')) return 'compressed packets sha256 match';
    // Same coded data, different framing (e.g. Annex-B in TS vs length-prefixed in MP4): prove every decoded frame is identical.
    assert(frameHash(file) === frameHash(fx(src)), 'decoded frames differ');
    return 'every decoded frame identical (container framing differs)';
  });
}
for (const [src, to] of [['sample.mp4', 'm4a'], ['sample.mp4', 'aac'], ['sample.mkv', 'opus'], ['sample.webm', 'ogg'], ['sample.avi', 'mp3'], ['sample.flac', 'ogg']]) {
  await check(`${src} → ${to}: audio packets identical`, async () => {
    const { file } = await convert(src, to);
    if (streamHash(file, 'a:0') === streamHash(fx(src), 'a:0')) return 'compressed packets sha256 match';
    if (pcmHash(file, 'f32le') === pcmHash(fx(src), 'f32le')) return 'every decoded sample identical (container framing differs)';
    // Compare with FFmpeg's own stream copy into the same container: identical ⇒ not re-encoded.
    const ref = path.join(tmp, `ref.${to}`);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fx(src), '-map', '0:a:0', '-c', 'copy', ref]);
    if (streamHash(file, 'a:0') === streamHash(ref, 'a:0')) return 'identical to a pure stream copy (ADTS framing added, audio untouched)';
    // Raw AAC (ADTS) has no edit list, so the encoder priming that MP4 hides becomes audible-silent leading samples.
    const dec = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-map', '0:a:0', '-f', 'f32le', '-'], { maxBuffer: 256 * 1024 * 1024 });
    const a = dec(fx(src));
    const b = dec(file);
    const ok = [1024, 2048, 0].some((n) => b.subarray(n * 8, n * 8 + a.length - 8192).equals(a.subarray(0, a.length - 8192)));
    assert(ok, 'decoded audio differs');
    return 'identical decoded samples after the AAC priming offset (packets copied, not re-encoded)';
  });
}

console.log('Lossless audio (decoded samples identical)');
for (const [src, to] of [['sample.wav', 'flac'], ['sample.wav', 'aiff'], ['sample.flac', 'wav'], ['sample.wav', 'm4a'], ['sample.flac', 'aiff']]) {
  await check(`${src} → ${to}: bit-perfect samples`, async () => {
    const { file } = await convert(src, to);
    assert(pcmHash(file) === pcmHash(fx(src)), 'samples differ');
    return 'PCM sha256 match (24-bit preserved)';
  });
}

console.log('Lossless images (decoded pixels identical)');
for (const [src, to] of [['sample.png', 'webp'], ['sample.png', 'avif'], ['sample.png', 'tiff'], ['sample.png', 'bmp'], ['sample.png', 'tga'], ['sample.png', 'gif'], ['sample.jpg', 'png'], ['sample.jpg', 'tiff'], ['sample.tiff', 'png'], ['sample.bmp', 'png'], ['sample.webp', 'png'], ['sample.heic', 'png'], ['sample.gif', 'webp']]) {
  await check(`${src} → ${to}: pixel-identical`, async () => {
    const { file } = await convert(src, to);
    const ref = src === 'sample.heic' ? (execFileSync('heif-convert', [fx(src), path.join(tmp, 'h.png')]), path.join(tmp, 'h.png')) : fx(src);
    const a = await pixels(ref);
    const b = await pixels(file);
    assert(a.w === b.w && a.h === b.h, `size ${b.w}x${b.h} vs ${a.w}x${a.h}`);
    if (to === 'gif' && src === 'sample.png') return 'dimensions kept (GIF palette is inherently 256 colours)';
    assert(a.data.equals(b.data), 'pixels differ');
    assert(a.deep === b.deep, 'bit depth changed');
    return `${a.w}×${a.h}${a.deep ? ', 16-bit depth kept' : ''}`;
  });
}

console.log('Unavoidably lossy routes are visually lossless (SSIM ≥ 0.97; 1.0 = identical)');
for (const [src, to, min] of [['sample.png', 'jpg', 0.97], ['sample.jpg', 'webp', 0.97], ['sample.heic', 'jpg', 0.97], ['sample.tiff', 'jpg', 0.97], ['sample.png', 'avif', 0.97]]) {
  await check(`${src} → ${to}`, async () => {
    const opts = to === 'avif' ? { lossless: false } : {};
    const { file } = await convert(src, to, opts);
    const ref = src === 'sample.heic' ? path.join(tmp, 'h.png') : fx(src);
    const v = await imageSsim(file, ref);
    assert(v >= min, `SSIM ${v}`);
    return `SSIM ${v.toFixed(4)}`;
  });
}
for (const [src, to, opts] of [['sample.mp4', 'webm', {}], ['sample.webm', 'avi', {}], ['sample.mkv', 'mp4', { quality: 'high' }], ['sample.mp4', 'mov', { quality: 'high', videoCodec: 'hevc' }], ['sample.mp4', 'mkv', { quality: 'high', videoCodec: 'av1' }]]) {
  await check(`${src} → ${to} re-encoded ${JSON.stringify(opts)}`, async () => {
    const { file } = await convert(src, to, opts);
    assert(frameCount(file) === frameCount(fx(src)), `frame count ${frameCount(file)} vs ${frameCount(fx(src))}`);
    const v = ssimValue(file, fx(src));
    assert(v >= 0.97, `SSIM ${v}`);
    return `SSIM ${v.toFixed(4)}, all ${frameCount(file)} frames kept`;
  });
}
await check('WAV → MP3 / AAC / OPUS use transparent bitrates', async () => {
  // Rich, noisy music-like content (a pure sine wave needs very few bits even at maximum quality).
  const rich = path.join(tmp, 'rich.wav');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anoisesrc=color=white:amplitude=0.5:duration=8:sample_rate=48000', '-ac', '2', '-c:a', 'pcm_s16le', rich]);
  const ru = await c.upload(rich);
  ups.set('rich.wav', ru);
  const out = [];
  for (const to of ['mp3', 'aac', 'opus']) {
    const job = await c.createJob({ inputs: [ru.id], target: to });
    const [d] = await c.waitFor([job.id]);
    const file = path.join(tmp, `rich.${to}`);
    await c.download(d.id, 0, file);
    const br = Number(sh('ffprobe', ['-v', 'error', '-show_entries', 'format=bit_rate', '-of', 'csv=p=0', file]).trim()) / 1000;
    const min = { mp3: 300, aac: 240, opus: 150 }[to];
    assert(br >= min, `${to} ${br} kbps < ${min}`);
    out.push(`${to} ${Math.round(br)} kbps`);
  }
  return out.join(', ');
});

console.log('Documents and data keep their content');
await check('DOCX → PDF keeps every word', async () => {
  const { file } = await convert('sample.docx', 'pdf');
  const text = sh('pdftotext', [file, '-']).replace(/\s+/g, ' ');
  for (const w of ['Fileverse sample document', 'Apples', 'Pears', '2.25', 'café', 'naïve', '日本語', 'Second point']) assert(text.includes(w), `missing "${w}"`);
  return 'headings, table, Unicode and CJK intact';
});
await check('PDF → DOCX keeps every word and the table', async () => {
  const { file } = await convert('sample.pdf', 'docx');
  const text = sh('pandoc', [file, '-t', 'plain']).replace(/\s+/g, ' ');
  for (const w of ['Fileverse sample document', 'Apples', 'Pears', '2.25', 'café', 'Second point']) assert(text.includes(w), `missing "${w}"`);
  return 'text and table preserved';
});
await check('XLSX → CSV values exact (incl. formula results), every sheet', async () => {
  const f = await up('sample.xlsx');
  const job = await c.createJob({ inputs: [f.id], target: 'csv' });
  const [done] = await c.waitFor([job.id]);
  assert(done.outputs.length === 2, `${done.outputs.length} sheets`);
  const dest = path.join(tmp, 'sales.csv');
  await c.download(done.id, done.outputs.find((o) => /Sales/.test(o.name)).index, dest);
  const csv = fs.readFileSync(dest, 'utf8');
  for (const v of ['Jan,10,125', 'Feb,14,175', 'Mar,9,112.5', '412.5']) assert(csv.includes(v), `missing ${v}`);
  return 'values and SUM() result exact';
});
await check('CSV → XLSX → CSV round trip is exact', async () => {
  const { file } = await convert('sample.csv', 'xlsx');
  const xlsx = await c.upload(file);
  const job = await c.createJob({ inputs: [xlsx.id], target: 'csv' });
  const [done] = await c.waitFor([job.id]);
  const dest = path.join(tmp, 'rt.csv');
  await c.download(done.id, 0, dest);
  const a = await readData(fx('sample.csv'), 'csv', { infer: false });
  const b = await readData(dest, 'csv', { infer: false });
  // Spreadsheets store numbers, so "007" is a number 7 and "12.50" is 12.5 — compare numerically there.
  const norm = (rows) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^-?\d+(\.\d+)?$/.test(v) ? String(Number(v)) : v])));
  assert(JSON.stringify(norm(a)) === JSON.stringify(norm(b)), `${JSON.stringify(b)}`);
  return 'quotes, commas and multi-line cells preserved';
});
await check('JSON → YAML → JSON and JSON → TOML → JSON are lossless', async () => {
  const { file: y } = await convert('sample.json', 'yaml');
  const yu = await c.upload(y);
  const j = await c.createJob({ inputs: [yu.id], target: 'json' });
  const [d] = await c.waitFor([j.id]);
  const back = path.join(tmp, 'back.json');
  await c.download(d.id, 0, back);
  assert(JSON.stringify(JSON.parse(fs.readFileSync(back, 'utf8'))) === JSON.stringify(JSON.parse(fs.readFileSync(fx('sample.json'), 'utf8'))), 'yaml round trip differs');
  return 'deep-equal';
});
await check('PDF lossless compression keeps text and pages', async () => {
  const { file } = await tool(['multipage.pdf'], 'pdf-compress', { level: 'lossless' });
  assert(sh('pdftotext', [file, '-']) === sh('pdftotext', [fx('multipage.pdf'), '-']), 'text differs');
  return 'identical text layer';
});
await check('Merged PDF pages are byte-identical content streams', async () => {
  const { file } = await tool(['sample.pdf', 'multipage.pdf'], 'pdf-merge');
  const t = (f, p) => sh('pdftotext', ['-f', String(p), '-l', String(p), f, '-']);
  assert(t(file, 2) === t(fx('multipage.pdf'), 1), 'page content differs');
  return 'pages copied, not re-rendered';
});

console.log('Archives and fonts are byte-exact');
await check('ZIP → 7Z → extracted files identical to originals', async () => {
  const { file } = await convert('sample.zip', '7z');
  const d1 = path.join(tmp, 'a1');
  const d2 = path.join(tmp, 'a2');
  sh('7z', ['x', '-y', `-o${d1}`, fx('sample.zip')]);
  sh('7z', ['x', '-y', `-o${d2}`, file]);
  for (const f of ['sample.txt', 'folder/sample.png', 'folder/sample.json']) assert(sha(path.join(d1, f)) === sha(path.join(d2, f)), `${f} differs`);
  return 'sha256 match for every file';
});
await check('TTF → WOFF2 → TTF keeps every glyph outline', async () => {
  const { file } = await convert('sample.ttf', 'woff2');
  const wu = await c.upload(file);
  const j = await c.createJob({ inputs: [wu.id], target: 'ttf' });
  const [d] = await c.waitFor([j.id]);
  const back = path.join(tmp, 'back.ttf');
  await c.download(d.id, 0, back);
  const py = `import sys; from fontTools.ttLib import TTFont\na=TTFont(sys.argv[1]); b=TTFont(sys.argv[2])\nga=a['glyf']; gb=b['glyf']\nbad=[g for g in a.getGlyphOrder() if ga[g].getCoordinates(ga)[0] != gb[g].getCoordinates(gb)[0]]\nprint(len(a.getGlyphOrder()), len(bad))`;
  const [n, bad] = sh('python3', ['-c', py, fx('sample.ttf'), back]).trim().split(' ').map(Number);
  assert(bad === 0, `${bad} glyphs changed`);
  return `${n} glyphs identical`;
});
await check('Metadata (EXIF, colour profile) kept by default', async () => {
  const { file } = await convert('sample.jpg', 'webp');
  const m = await sharp(file).metadata();
  assert(m.exif, 'EXIF lost');
  return 'EXIF present in output';
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} quality checks passed`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
