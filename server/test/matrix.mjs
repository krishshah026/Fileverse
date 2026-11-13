// End-to-end conversion matrix: uploads every fixture through the real API, runs EVERY offered
// conversion with default settings, downloads each result and validates it independently.
// Usage: node test/matrix.mjs [--base http://localhost:8080] [--only video,image] [--file sample.mkv]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Client } from './client.mjs';
import { detectFormat } from '../src/detect/detect.js';
import { probeMedia, probeImage, probePdf } from '../src/detect/inspect.js';
import { getFormat } from '../src/registry/formats.js';
import { readData } from '../src/converters/data.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean));
const base = args.base || 'http://localhost:8080';
const only = args.only ? new Set(args.only.split(',')) : null;
const onlyFile = args.file ? new Set(args.file.split(',')) : null;
const fixtures = path.join(here, 'fixtures');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fv-matrix-'));
const client = new Client(base);

const SKIP_INPUTS = new Set(['encrypted.pdf', 'encrypted.zip', 'scanned.pdf', 'multipage.pdf', 'multipage.odt', 'sample.markdown.md']);

async function validate(target, file, job, input) {
  const out = job.outputs[0];
  const dest = path.join(tmp, `${job.id}-${out.name}`);
  await client.download(job.id, out.index, dest);
  const size = fs.statSync(dest).size;
  if (!size) return 'empty output';
  if (size !== out.size) return `size mismatch ${size} vs ${out.size}`;
  const det = await detectFormat(dest, out.name);
  const expected = out.format === 'zip' && target !== 'zip' ? 'zip' : target;
  if (det.format !== expected) return `detected ${det.format} (content ${det.byContent}), expected ${expected}`;
  const cat = getFormat(target).category;
  if (cat === 'video' || cat === 'audio' || target === 'gif') {
    const m = await probeMedia(dest);
    if (!m) return 'ffprobe could not read output';
    const want = cat === 'video' ? 'video' : cat === 'audio' ? 'audio' : 'video';
    if (!m.streams.some((s) => s.type === want)) return `no ${want} stream in output`;
    const inDur = input.info?.duration;
    if (inDur && m.duration && target !== 'gif' && Math.abs(m.duration - inDur) > Math.max(0.6, inDur * 0.12)) return `duration ${m.duration.toFixed(2)}s vs input ${inDur.toFixed(2)}s`;
  }
  if (cat === 'image' && target !== 'svg') {
    const im = await probeImage(dest, target);
    if (!im?.width) return 'image unreadable';
    const src = input.info;
    if (src?.width && !['ico'].includes(target) && input.category === 'image' && input.format !== 'svg' && input.format !== 'ico') {
      if (im.width !== src.width || im.height !== src.height) return `dimensions ${im.width}x${im.height} vs ${src.width}x${src.height}`;
    }
  }
  if (target === 'pdf') {
    const p = await probePdf(dest);
    if (!p?.pages) return 'pdf unreadable';
  }
  if (getFormat(target).category === 'data' || target === 'csv' || target === 'tsv') {
    try {
      await readData(dest, target);
    } catch (e) {
      return `output does not parse: ${e.message}`;
    }
  }
  if (cat === 'archive' || expected === 'zip') {
    try {
      if (target.startsWith('tar')) execFileSync('tar', ['-tf', dest], { stdio: 'ignore' });
      else if (['gz', 'bz2', 'xz'].includes(target)) execFileSync({ gz: 'gzip', bz2: 'bzip2', xz: 'xz' }[target], ['-t', dest], { stdio: 'ignore' });
      else execFileSync('7z', ['t', dest], { stdio: 'ignore' });
    } catch {
      return 'archive integrity test failed';
    }
  }
  if (cat === 'font') {
    try {
      execFileSync('python3', ['-c', 'import sys; from fontTools.ttLib import TTFont; f=TTFont(sys.argv[1]); assert len(f.getGlyphOrder())>10', dest], { stdio: 'ignore' });
    } catch {
      return 'font does not load in fontTools';
    }
  }
  fs.rmSync(dest, { force: true });
  return null;
}

const files = fs.readdirSync(fixtures).filter((f) => !SKIP_INPUTS.has(f) && (!onlyFile || onlyFile.has(f))).sort();
const results = [];
const t0 = Date.now();
console.log(`uploading ${files.length} fixtures to ${base} …`);
const uploaded = [];
for (const f of files) {
  const info = await client.upload(path.join(fixtures, f));
  if (only && !only.has(info.category)) continue;
  uploaded.push({ fixture: f, info });
}
const jobs = [];
for (const { fixture, info } of uploaded) {
  for (const t of info.targets) {
    if (t.unavailable) {
      results.push({ fixture, from: info.format, to: t.to, status: 'n/a', reason: t.unavailable });
      continue;
    }
    try {
      const job = await client.createJob({ inputs: [info.id], target: t.to, options: {} });
      jobs.push({ fixture, info, target: t.to, id: job.id, quality: t.quality?.level });
    } catch (err) {
      results.push({ fixture, from: info.format, to: t.to, status: 'fail', reason: `create: ${err.message}` });
    }
  }
}
console.log(`${jobs.length} conversions queued; waiting …`);
let lastPrint = 0;
const finished = await client.waitFor(
  jobs.map((j) => j.id),
  {
    onUpdate: () => {
      if (Date.now() - lastPrint > 15000) {
        lastPrint = Date.now();
        process.stdout.write('.');
      }
    },
  },
);
console.log('');
for (const [i, job] of finished.entries()) {
  const meta = jobs[i];
  const row = { fixture: meta.fixture, from: meta.info.format, to: meta.target, quality: meta.quality, seconds: job.finishedAt && job.startedAt ? (job.finishedAt - job.startedAt) / 1000 : null, outputs: job.outputs.length };
  if (job.status !== 'done') {
    results.push({ ...row, status: 'fail', reason: job.error?.message + (job.error?.detail ? ` | ${job.error.detail.split('\n').slice(-2).join(' ')}` : '') });
    continue;
  }
  const problem = await validate(meta.target, meta.fixture, job, { ...meta.info, info: meta.info.info });
  results.push({ ...row, status: problem ? 'fail' : 'ok', reason: problem || undefined, notes: job.notes });
}

const ok = results.filter((r) => r.status === 'ok').length;
const failed = results.filter((r) => r.status === 'fail');
const na = results.filter((r) => r.status === 'n/a').length;
console.log(`\n${ok} passed, ${failed.length} failed, ${na} not applicable to these samples — ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const f of failed) console.log(`  FAIL ${f.fixture} → ${f.to}: ${f.reason}`);
fs.writeFileSync(path.join(here, 'matrix-report.json'), JSON.stringify(results, null, 2));
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed.length ? 1 : 0);
