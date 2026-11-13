import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { paths } from '../config.js';

/**
 * SQLite (built into Node ≥ 22.13) in WAL mode. It is the durable job queue shared by the API
 * and worker processes on one host: jobs survive restarts, and claiming a job is a single atomic
 * UPDATE … RETURNING statement, so two workers can never take the same job.
 */
let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(paths.uploads, { recursive: true });
  fs.mkdirSync(paths.jobs, { recursive: true });
  fs.mkdirSync(paths.tmp, { recursive: true });
  db = new DatabaseSync(paths.db);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 10000;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      session TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      path TEXT NOT NULL,
      format TEXT,
      detection TEXT,
      info TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS files_session ON files(session);
    CREATE INDEX IF NOT EXISTS files_expires ON files(expires_at);

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      session TEXT NOT NULL,
      ip TEXT,
      kind TEXT NOT NULL,
      tool TEXT,
      target TEXT,
      inputs TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '{}',
      weight TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      stage TEXT,
      eta INTEGER,
      quality TEXT,
      notes TEXT NOT NULL DEFAULT '[]',
      error TEXT,
      outputs TEXT NOT NULL DEFAULT '[]',
      attempts INTEGER NOT NULL DEFAULT 0,
      worker TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, weight, created_at);
    CREATE INDEX IF NOT EXISTS jobs_session ON jobs(session, status);
    CREATE INDEX IF NOT EXISTS jobs_updated ON jobs(updated_at);
    CREATE INDEX IF NOT EXISTS jobs_expires ON jobs(expires_at);
  `);
  return db;
}

const JSON_COLS = ['inputs', 'options', 'notes', 'error', 'outputs', 'quality', 'detection', 'info'];
export function hydrate(row) {
  if (!row) return null;
  const out = { ...row };
  for (const c of JSON_COLS) if (typeof out[c] === 'string') out[c] = JSON.parse(out[c]);
  return out;
}
