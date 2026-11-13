import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import * as store from '../jobs/store.js';
import { log } from '../util/log.js';

/**
 * Deletes expired uploads and results. Nothing is kept longer than FILE_TTL_MINUTES after it
 * was last needed; incomplete uploads are kept for PARTIAL_UPLOAD_TTL_MINUTES so they can resume.
 */
export async function sweep(tus) {
  let files = 0;
  let jobs = 0;
  for (const f of store.expiredFiles()) {
    await fs.rm(f.path, { force: true }).catch(() => {});
    await fs.rm(`${f.path}.json`, { force: true }).catch(() => {});
    store.deleteFileRow(f.id);
    files++;
  }
  for (const { id } of store.expiredJobs()) {
    await fs.rm(path.join(paths.jobs, id), { recursive: true, force: true }).catch(() => {});
    store.deleteJobRow(id);
    jobs++;
  }
  // Partial (never finished) uploads.
  try {
    const n = await tus.cleanUpExpiredUploads();
    if (n) log.info(`removed ${n} abandoned partial upload(s)`);
  } catch {
    /* nothing to clean */
  }
  // Orphaned job folders (e.g. after a crash) and stale temp files.
  const cutoff = Date.now() - (config.fileTtlMinutes + 60) * 60 * 1000;
  for (const dir of [paths.jobs, paths.tmp]) {
    for (const name of await fs.readdir(dir).catch(() => [])) {
      if (name === 'lo-template') continue;
      const p = path.join(dir, name);
      const st = await fs.stat(p).catch(() => null);
      if (st && st.mtimeMs < cutoff && (dir === paths.tmp || !store.getJob(name))) await fs.rm(p, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (files || jobs) log.info(`cleanup: deleted ${files} upload(s) and ${jobs} result set(s)`);
}

export function startCleanup(tus) {
  const run = () => sweep(tus).catch((err) => log.error('cleanup failed', err));
  run();
  return setInterval(run, 60_000);
}
