import fs from 'node:fs/promises';
import path from 'node:path';
import { Server, EVENTS } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { config, paths } from '../config.js';
import { detectFormat } from '../detect/detect.js';
import { inspectFile } from '../detect/inspect.js';
import * as store from '../jobs/store.js';
import { log } from '../util/log.js';
import { publicFile } from './present.js';

export const SESSION_RE = /^[A-Za-z0-9_-]{16,64}$/;
const header = (req, name) => (typeof req.headers?.get === 'function' ? req.headers.get(name) : req.headers?.[name]);
const reject = (status_code, message) => ({ status_code, body: JSON.stringify({ error: message }) + '\n' });

export async function freeBytes(dir) {
  try {
    const s = await fs.statfs(dir);
    return s.bavail * s.bsize;
  } catch {
    return Infinity;
  }
}

/**
 * tus resumable uploads: the browser sends the file in chunks (default 50 MB), so multi-GB files
 * never sit in memory, interrupted uploads resume where they stopped, and every request stays
 * below the body-size limits of proxies such as Cloudflare (100 MB on the free plan).
 */
export function createTusServer() {
  const datastore = new FileStore({ directory: paths.uploads, expirationPeriodInMilliseconds: config.partialUploadTtlMinutes * 60 * 1000 });
  const tus = new Server({
    path: '/api/uploads',
    datastore,
    maxSize: config.maxUploadBytes,
    respectForwardedHeaders: true,
    relativeLocation: true,
    allowedOrigins: config.corsOrigins.length ? config.corsOrigins : undefined,
    allowedHeaders: ['X-Fileverse-Session'],
    exposedHeaders: ['X-Fileverse-File'],
    disableTerminationForFinishedUploads: false,
    async onIncomingRequest(req, id) {
      const session = header(req, 'x-fileverse-session');
      if (!session || !SESSION_RE.test(session)) throw reject(400, 'Missing session.');
      if (id && req.method !== 'POST') {
        // Only the browser session that created an upload may continue or delete it.
        try {
          const up = await datastore.getUpload(id);
          if (up.metadata?.session && up.metadata.session !== session) throw reject(403, 'This upload belongs to another session.');
        } catch (err) {
          if (err?.status_code) throw err;
        }
      }
    },
    async onUploadCreate(req, upload) {
      const session = header(req, 'x-fileverse-session');
      const meta = upload.metadata || {};
      if (upload.size === undefined) throw reject(400, 'The file size must be known before uploading.');
      if (!meta.filename) throw reject(400, 'Missing file name.');
      const free = await freeBytes(paths.uploads);
      if (free - upload.size < config.diskReserveBytes) {
        throw reject(507, 'The server does not have enough free space for this file right now. Please try again later.');
      }
      return { metadata: { ...meta, filename: String(meta.filename).slice(0, 255), session } };
    },
    async onUploadFinish(req, upload) {
      try {
        const file = await registerUpload(upload);
        return { status_code: 200, headers: { 'Content-Type': 'application/json', 'X-Fileverse-File': file.id }, body: JSON.stringify(await publicFile(file)) };
      } catch (err) {
        log.error('upload finish failed', err);
        return {};
      }
    },
  });
  tus.on(EVENTS.POST_TERMINATE, (_req, _res, id) => {
    store.deleteFileRow(id);
  });
  return { tus, datastore };
}

/** Detects the real format, inspects the content and records the file. */
export async function registerUpload(upload) {
  const filePath = path.join(paths.uploads, upload.id);
  const name = upload.metadata?.filename || 'file';
  const detection = await detectFormat(filePath, name);
  const info = detection.format ? await inspectFile(filePath, detection.format) : {};
  return store.insertFile({ id: upload.id, session: upload.metadata?.session, name, size: upload.size, path: filePath, format: detection.format, detection, info });
}
