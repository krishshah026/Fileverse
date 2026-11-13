import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.env;
const MB = 1024 * 1024;
const here = path.dirname(fileURLToPath(import.meta.url));

function int(key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) throw new Error(`Environment variable ${key} must be an integer, got "${raw}"`);
  return n;
}

const cpus = Math.max(1, os.availableParallelism?.() ?? os.cpus().length);

export const config = {
  /** HTTP */
  port: int('PORT', 8080),
  host: env.HOST || '0.0.0.0',
  /** api = HTTP only, worker = conversions only, all = both in one process */
  role: (env.ROLE || 'all').toLowerCase(),
  trustProxy: env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal',
  /** Comma separated list of allowed browser origins when the web app is hosted on another domain. */
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),

  /** Storage */
  dataDir: path.resolve(env.DATA_DIR || path.join(here, '..', 'data')),
  webDist: path.resolve(env.WEB_DIST || path.join(here, '..', '..', 'web', 'dist')),

  /** Uploads */
  maxUploadBytes: int('MAX_UPLOAD_MB', 20 * 1024) * MB,
  chunkSizeBytes: int('UPLOAD_CHUNK_MB', 50) * MB,
  /** Free disk space that must remain after accepting an upload (outputs need room too). */
  diskReserveBytes: int('DISK_RESERVE_MB', 2048) * MB,

  /** Retention: uploads and results are deleted automatically after this many minutes. */
  fileTtlMinutes: int('FILE_TTL_MINUTES', 120),
  /** Incomplete uploads are kept longer so they can be resumed. */
  partialUploadTtlMinutes: int('PARTIAL_UPLOAD_TTL_MINUTES', 24 * 60),

  /** Processing */
  heavyConcurrency: int('HEAVY_CONCURRENCY', Math.max(1, Math.floor(cpus / 2))),
  lightConcurrency: int('LIGHT_CONCURRENCY', Math.max(2, cpus)),
  ffmpegThreads: int('FFMPEG_THREADS', 0),
  jobTimeoutMinutes: int('JOB_TIMEOUT_MINUTES', 12 * 60),
  maxImagePixels: int('MAX_IMAGE_MEGAPIXELS', 1000) * 1e6,
  /** Upper bound for the total uncompressed size of an archive being extracted. */
  maxExtractBytes: int('MAX_EXTRACT_MB', 50 * 1024) * MB,
  maxExtractEntries: int('MAX_EXTRACT_ENTRIES', 20000),
  maxBatchInputs: int('MAX_BATCH_INPUTS', 200),

  /** Fair use: concurrent (queued + running) jobs, never a daily cap. */
  maxActiveJobsPerSession: int('MAX_ACTIVE_JOBS_PER_SESSION', 25),
  maxActiveJobsPerIp: int('MAX_ACTIVE_JOBS_PER_IP', 60),

  cpus,

  bins: {
    ffmpeg: env.FFMPEG_PATH || 'ffmpeg',
    ffprobe: env.FFPROBE_PATH || 'ffprobe',
    magick: env.IMAGEMAGICK_PATH || '', // auto-detected (magick or convert)
    soffice: env.SOFFICE_PATH || 'soffice',
    pandoc: env.PANDOC_PATH || 'pandoc',
    qpdf: env.QPDF_PATH || 'qpdf',
    gs: env.GHOSTSCRIPT_PATH || 'gs',
    pdftoppm: env.PDFTOPPM_PATH || 'pdftoppm',
    pdftotext: env.PDFTOTEXT_PATH || 'pdftotext',
    pdftohtml: env.PDFTOHTML_PATH || 'pdftohtml',
    sevenZip: env.SEVENZIP_PATH || '', // auto-detected (7zz or 7z)
    tar: env.TAR_PATH || 'tar',
    calibre: env.EBOOK_CONVERT_PATH || 'ebook-convert',
    fontforge: env.FONTFORGE_PATH || 'fontforge',
    python: env.PYTHON_PATH || 'python3',
    ocrmypdf: env.OCRMYPDF_PATH || 'ocrmypdf',
    tesseract: env.TESSERACT_PATH || 'tesseract',
    heifConvert: env.HEIF_CONVERT_PATH || 'heif-convert',
  },
};

export const paths = {
  uploads: path.join(config.dataDir, 'uploads'),
  jobs: path.join(config.dataDir, 'jobs'),
  tmp: path.join(config.dataDir, 'tmp'),
  db: path.join(config.dataDir, 'fileverse.db'),
};
