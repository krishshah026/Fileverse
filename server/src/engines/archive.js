import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { config } from '../config.js';
import { detectEngines } from './available.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';

export const TAR_FAMILY = new Set(['tar', 'tar.gz', 'tar.bz2', 'tar.xz']);
export const SEVEN_ZIP_READS = new Set(['zip', '7z', 'rar', 'iso', 'cbz', 'cbr']);
export const SINGLE = { gz: 'gzip', bz2: 'bzip2', xz: 'xz' };

function tooBig() {
  return new ConversionError(`This archive expands to more than ${Math.round(config.maxExtractBytes / 1024 ** 3)} GB, which exceeds the server limit.`, { suggestion: 'Split the archive into smaller parts.' });
}

/** Lists entries → { files, bytes, encrypted }. Used to refuse zip bombs *before* extracting. */
export async function inspectArchive(file, format, { password, signal } = {}) {
  const e = detectEngines();
  if (TAR_FAMILY.has(format)) {
    const { stdout } = await run(e.tar, ['-tvf', file], { signal, maxCapture: 64 * 1024 * 1024, friendly: 'This archive is damaged or not a valid TAR file.' });
    let bytes = 0;
    let files = 0;
    for (const line of stdout.split('\n')) {
      const m = /^\S+\s+\S+\s+(\d+)\s/.exec(line);
      if (m) {
        bytes += Number(m[1]);
        files++;
      }
    }
    return { files, bytes, encrypted: false };
  }
  if (SEVEN_ZIP_READS.has(format)) {
    if (!e.sevenZip) throw new ConversionError('7-Zip is not installed on this server.', { internal: true });
    const r = await run(e.sevenZip, ['l', '-slt', '-ba', `-p${password || ''}`, file], { signal, maxCapture: 64 * 1024 * 1024, allowedCodes: [0, 2] });
    if (r.code === 2) {
      if (/Wrong password|Can not open encrypted archive/i.test(r.stderr + r.stdout)) throw new ConversionError(password ? 'The archive password is incorrect.' : 'This archive is password protected. Enter its password in the settings.', { code: 'password' });
      throw new ConversionError('This archive is damaged or not a supported archive.', { detail: r.stderr.slice(-1000) });
    }
    let bytes = 0;
    let files = 0;
    let encrypted = false;
    for (const block of r.stdout.split(/\n\s*\n/)) {
      if (!/^Path = /m.test(block)) continue;
      if (/^Folder = \+/m.test(block)) continue;
      const size = /^Size = (\d+)/m.exec(block);
      if (size) bytes += Number(size[1]);
      if (/^Encrypted = \+/m.test(block)) encrypted = true;
      files++;
    }
    return { files, bytes, encrypted };
  }
  return { files: 1, bytes: 0, encrypted: false };
}

/** Counts bytes flowing through and aborts beyond the limit (for formats without an index). */
function limiter(limit) {
  let seen = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      seen += chunk.length;
      if (seen > limit) return cb(tooBig());
      cb(null, chunk);
    },
  });
}

/** Removes symlinks and anything else that is not a regular file or directory. */
async function sanitizeTree(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isSymbolicLink() || (!ent.isFile() && !ent.isDirectory())) await fs.rm(p, { force: true, recursive: true });
    else if (ent.isDirectory()) await sanitizeTree(p);
  }
}

export async function extractArchive(file, format, destDir, { password, signal, singleName } = {}) {
  const e = detectEngines();
  await fs.mkdir(destDir, { recursive: true });
  if (SINGLE[format]) {
    const out = path.join(destDir, singleName || 'file');
    if (format === 'gz') {
      await pipeline(createReadStream(file), zlib.createGunzip(), limiter(config.maxExtractBytes), createWriteStream(out), { signal });
    } else {
      const child = spawn(SINGLE[format], ['-dc', file], { stdio: ['ignore', 'pipe', 'pipe'] });
      const exit = new Promise((res, rej) => child.on('close', (c) => (c === 0 ? res() : rej(new ConversionError(`This ${format.toUpperCase()} file is damaged.`)))));
      try {
        await pipeline(child.stdout, limiter(config.maxExtractBytes), createWriteStream(out), { signal });
        await exit;
      } catch (err) {
        child.kill('SIGKILL');
        throw err;
      }
    }
    return;
  }
  const info = await inspectArchive(file, format, { password, signal });
  if (info.bytes > config.maxExtractBytes) throw tooBig();
  if (info.files > config.maxExtractEntries) throw new ConversionError(`This archive contains ${info.files.toLocaleString()} files, more than the ${config.maxExtractEntries.toLocaleString()} allowed.`);
  if (TAR_FAMILY.has(format)) {
    await run(e.tar, ['-xf', file, '-C', destDir, '--no-same-owner', '--no-same-permissions', '--no-overwrite-dir'], { signal, friendly: 'The archive could not be extracted.' });
  } else {
    const r = await run(e.sevenZip, ['x', '-y', '-bd', `-p${password || ''}`, `-o${destDir}`, file], { signal, allowedCodes: [0, 1, 2], maxCapture: 1024 * 1024 });
    if (r.code === 2) {
      if (/Wrong password/i.test(r.stderr + r.stdout)) throw new ConversionError(password ? 'The archive password is incorrect.' : 'This archive is password protected. Enter its password in the settings.', { code: 'password' });
      throw new ConversionError('The archive could not be extracted completely. It may be damaged or split into parts.', { detail: r.stderr.slice(-1000) });
    }
    if (r.code === 1) {
      /* warnings (e.g. headers) — files were extracted */
    }
  }
  await sanitizeTree(destDir);
}

/** Lists all regular files under dir as [{ abs, rel }]. */
export async function walkFiles(dir, base = dir) {
  const out = [];
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await walkFiles(p, base)));
    else if (ent.isFile()) out.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/') });
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

const LEVELS = { store: 0, fast: 1, normal: 5, max: 9 };

/** Packs the *contents* of srcDir into an archive of the given format. */
export async function createArchive(srcDir, format, outFile, { level = 'normal', password, signal } = {}) {
  const e = detectEngines();
  const mx = LEVELS[level] ?? 5;
  if (format === 'zip' || format === '7z') {
    if (!e.sevenZip) throw new ConversionError('7-Zip is not installed on this server.', { internal: true });
    const args = ['a', '-bd', '-y', `-t${format}`, `-mx=${mx}`];
    if (format === 'zip') args.push('-mcu=on'); // UTF-8 file names
    if (password) {
      args.push(`-p${password}`);
      if (format === 'zip') args.push('-mem=AES256');
      else args.push('-mhe=on');
    }
    await run(e.sevenZip, [...args, outFile, '.'], { cwd: srcDir, signal, friendly: 'The archive could not be created.' });
    return outFile;
  }
  if (TAR_FAMILY.has(format)) {
    const comp = { 'tar.gz': ['gzip', `-${Math.max(1, mx)}`], 'tar.bz2': ['bzip2', `-${Math.max(1, mx)}`], 'tar.xz': ['xz', `-${Math.min(9, Math.max(0, mx))}`, '-T0'] }[format];
    const args = ['-cf', outFile, '--owner=0', '--group=0', '--numeric-owner'];
    if (comp) args.push(`--use-compress-program=${comp.join(' ')}`);
    await run(e.tar, [...args, '-C', srcDir, '.'], { signal, friendly: 'The archive could not be created.' });
    return outFile;
  }
  if (SINGLE[format]) {
    const files = await walkFiles(srcDir);
    if (files.length !== 1) throw new ConversionError(`${format.toUpperCase()} can only compress a single file. Choose ZIP, 7Z or TAR.${format.toUpperCase()} for several files.`);
    if (format === 'gz') {
      await pipeline(createReadStream(files[0].abs), zlib.createGzip({ level: Math.max(1, mx) }), createWriteStream(outFile), { signal });
    } else {
      const child = spawn(SINGLE[format], ['-c', `-${Math.max(1, mx)}`, files[0].abs], { stdio: ['ignore', 'pipe', 'pipe'] });
      const exit = new Promise((res, rej) => child.on('close', (c) => (c === 0 ? res() : rej(new ConversionError('Compression failed.')))));
      await pipeline(child.stdout, createWriteStream(outFile), { signal });
      await exit;
    }
    return outFile;
  }
  throw new ConversionError(`Creating ${format} archives is not supported.`);
}

export async function zipDirectory(dir, outFile, opts = {}) {
  return createArchive(dir, 'zip', outFile, opts);
}

export const ARCHIVE_LEVEL_OPTION = {
  key: 'level',
  label: 'Compression',
  type: 'select',
  default: 'normal',
  choices: [
    { value: 'store', label: 'None (fastest)' },
    { value: 'fast', label: 'Fast' },
    { value: 'normal', label: 'Normal' },
    { value: 'max', label: 'Maximum (smallest)' },
  ],
};
