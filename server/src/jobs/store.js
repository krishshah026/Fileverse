import crypto from 'node:crypto';
import { config } from '../config.js';
import { getDb, hydrate } from './db.js';

const now = () => Date.now();
const ttl = () => config.fileTtlMinutes * 60 * 1000;
export const newId = () => crypto.randomBytes(16).toString('hex');

// ---------- files ----------
export function insertFile(f) {
  const t = now();
  getDb()
    .prepare('INSERT OR REPLACE INTO files (id, session, name, size, path, format, detection, info, created_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(f.id, f.session, f.name, f.size, f.path, f.format ?? null, JSON.stringify(f.detection ?? {}), JSON.stringify(f.info ?? {}), t, t + ttl());
  return getFile(f.id);
}
export function getFile(id) {
  return hydrate(getDb().prepare('SELECT * FROM files WHERE id = ?').get(id));
}
export function deleteFileRow(id) {
  getDb().prepare('DELETE FROM files WHERE id = ?').run(id);
}
export function extendFiles(ids, until) {
  const stmt = getDb().prepare('UPDATE files SET expires_at = MAX(expires_at, ?) WHERE id = ?');
  for (const id of ids) stmt.run(until, id);
}
export function expiredFiles(at = now()) {
  return getDb()
    .prepare(`SELECT * FROM files f WHERE expires_at < ? AND NOT EXISTS (
      SELECT 1 FROM jobs j, json_each(j.inputs) e WHERE e.value = f.id AND j.status IN ('queued','running'))`)
    .all(at)
    .map(hydrate);
}

// ---------- jobs ----------
export function insertJob(j) {
  const t = now();
  getDb()
    .prepare(`INSERT INTO jobs (id, session, ip, kind, tool, target, inputs, options, weight, status, quality, created_at, updated_at, expires_at)
              VALUES (?,?,?,?,?,?,?,?,?,'queued',?,?,?,?)`)
    .run(j.id, j.session, j.ip ?? null, j.kind, j.tool ?? null, j.target ?? null, JSON.stringify(j.inputs), JSON.stringify(j.options ?? {}), j.weight, JSON.stringify(j.quality ?? null), t, t, t + ttl() * 4);
  extendFiles(j.inputs, t + ttl());
  return getJob(j.id);
}
export function getJob(id) {
  return hydrate(getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id));
}
export function jobsForSession(session, limit = 200) {
  return getDb().prepare('SELECT * FROM jobs WHERE session = ? ORDER BY created_at DESC LIMIT ?').all(session, limit).map(hydrate);
}
export function jobsUpdatedSince(t) {
  return getDb().prepare('SELECT * FROM jobs WHERE updated_at > ? ORDER BY updated_at ASC').all(t).map(hydrate);
}
export function activeCount({ session, ip }) {
  const db = getDb();
  const s = db.prepare("SELECT COUNT(*) n FROM jobs WHERE session = ? AND status IN ('queued','running')").get(session).n;
  const i = ip ? db.prepare("SELECT COUNT(*) n FROM jobs WHERE ip = ? AND status IN ('queued','running')").get(ip).n : 0;
  return { session: s, ip: i };
}
export function queuePosition(job) {
  if (job.status !== 'queued') return 0;
  return getDb().prepare("SELECT COUNT(*) n FROM jobs WHERE status = 'queued' AND weight = ? AND created_at < ?").get(job.weight, job.created_at).n + 1;
}

/**
 * Atomically claims the next job of a weight class. Fair scheduling: sessions with the fewest
 * running jobs go first, so one person's 200-file batch cannot starve everybody else.
 */
export function claimJob(weight, workerId) {
  const t = now();
  const row = getDb()
    .prepare(`UPDATE jobs SET status = 'running', worker = ?, started_at = ?, updated_at = ?, attempts = attempts + 1, stage = NULL
      WHERE id = (
        SELECT j.id FROM jobs j WHERE j.status = 'queued' AND j.weight = ?
        ORDER BY (SELECT COUNT(*) FROM jobs r WHERE r.session = j.session AND r.status = 'running') ASC, j.created_at ASC
        LIMIT 1
      ) AND status = 'queued'
      RETURNING *`)
    .get(workerId, t, t, weight);
  return hydrate(row);
}

export function updateProgress(id, { progress, stage, eta }) {
  getDb().prepare("UPDATE jobs SET progress = ?, stage = COALESCE(?, stage), eta = ?, updated_at = ? WHERE id = ? AND status = 'running'").run(progress, stage ?? null, eta ?? null, now(), id);
}
export function setNotes(id, notes) {
  getDb().prepare('UPDATE jobs SET notes = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(notes), now(), id);
}
export function completeJob(id, { outputs, notes }) {
  const t = now();
  getDb()
    .prepare("UPDATE jobs SET status = 'done', progress = 1, eta = 0, stage = NULL, outputs = ?, notes = ?, options = '{}', finished_at = ?, updated_at = ?, expires_at = ? WHERE id = ? AND status = 'running'")
    .run(JSON.stringify(outputs), JSON.stringify(notes), t, t, t + ttl(), id);
}
export function failJob(id, error, notes = []) {
  const t = now();
  getDb()
    .prepare("UPDATE jobs SET status = 'failed', stage = NULL, eta = NULL, error = ?, notes = ?, options = '{}', finished_at = ?, updated_at = ?, expires_at = ? WHERE id = ? AND status IN ('running','queued')")
    .run(JSON.stringify(error), JSON.stringify(notes), t, t, t + ttl(), id);
}
export function cancelJob(id) {
  const t = now();
  return getDb().prepare("UPDATE jobs SET status = 'canceled', stage = NULL, eta = NULL, options = '{}', finished_at = ?, updated_at = ?, expires_at = ? WHERE id = ? AND status IN ('queued','running')").run(t, t, t + ttl(), id).changes > 0;
}
export function jobStatus(id) {
  return getDb().prepare('SELECT status FROM jobs WHERE id = ?').get(id)?.status;
}
export function touchJob(id) {
  getDb().prepare("UPDATE jobs SET updated_at = ? WHERE id = ? AND status = 'running'").run(now(), id);
}
/**
 * Running jobs send a heartbeat every few seconds. A running job without a heartbeat for
 * `staleMs` belongs to a worker that died: retry it once, then fail it with a clear message.
 */
export function requeueStale(staleMs = 90_000) {
  const db = getDb();
  const t = now();
  const rows = db.prepare("SELECT id, attempts FROM jobs WHERE status = 'running' AND updated_at < ?").all(t - staleMs);
  for (const r of rows) {
    if (r.attempts < 2) db.prepare("UPDATE jobs SET status = 'queued', progress = 0, eta = NULL, stage = 'Restarting after an interruption', updated_at = ? WHERE id = ?").run(t, r.id);
    else failJob(r.id, { message: 'The conversion was interrupted twice by a server restart. Please try again.' });
  }
  return rows.length;
}
export function deleteJobRow(id) {
  getDb().prepare('DELETE FROM jobs WHERE id = ?').run(id);
}
export function expiredJobs(at = now()) {
  return getDb().prepare("SELECT id FROM jobs WHERE expires_at < ? AND status NOT IN ('queued','running')").all(at);
}
export function queueStats() {
  const rows = getDb().prepare("SELECT weight, status, COUNT(*) n FROM jobs WHERE status IN ('queued','running') GROUP BY weight, status").all();
  const out = { queued: 0, running: 0, byWeight: {} };
  for (const r of rows) {
    out[r.status] += r.n;
    out.byWeight[r.weight] ??= { queued: 0, running: 0 };
    out.byWeight[r.weight][r.status] = r.n;
  }
  return out;
}
