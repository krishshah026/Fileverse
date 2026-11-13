import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import yazl from 'yazl';
import { config, paths } from '../config.js';
import * as store from '../jobs/store.js';
import { wake, abortLocal } from '../jobs/worker.js';
import { catalog, findRoute, describeRoute, getConverter, getTool, toolDetails, toolInputFormats } from '../registry/index.js';
import { validateOptions } from '../registry/options.js';
import { getFormat } from '../registry/formats.js';
import { engineSummary } from '../engines/available.js';
import { HttpError } from '../util/errors.js';
import { publicFile, publicJob } from './present.js';
import { SESSION_RE, freeBytes } from './uploads.js';
import { subscribe } from './events.js';

const ID_RE = /^[a-f0-9]{32}$/;
const COMPRESSED = new Set(['zip', '7z', 'rar', 'gz', 'bz2', 'xz', 'tar.gz', 'tar.bz2', 'tar.xz', 'jpg', 'png', 'webp', 'avif', 'gif', 'heic', 'mp4', 'mkv', 'mov', 'webm', 'avi', 'wmv', 'flv', 'm4v', '3gp', 'ts', 'ogv', 'mpeg', 'mp3', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'flac', 'ac3', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'woff', 'woff2', 'pdf']);
/** Never rendered inline: active content could run script on our origin. */
const UNSAFE_INLINE = new Set(['html', 'svg', 'xml', 'xhtml']);

function sessionOf(req) {
  const s = req.get('x-fileverse-session') || req.query.session;
  if (!s || !SESSION_RE.test(s)) throw new HttpError(400, 'Missing or invalid session.');
  return s;
}

function ownedFile(id, session) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'File not found.');
  const f = store.getFile(id);
  if (!f || f.session !== session) throw new HttpError(404, 'File not found or expired.');
  return f;
}

function ownedJob(id, session) {
  if (!ID_RE.test(id)) throw new HttpError(404, 'Conversion not found.');
  const j = store.getJob(id);
  if (!j || j.session !== session) throw new HttpError(404, 'Conversion not found or expired.');
  return j;
}

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

export function apiRouter() {
  const r = express.Router();
  r.use(express.json({ limit: '256kb' }));

  r.get('/health', (req, res) => {
    res.json({ ok: true, role: config.role, queue: store.queueStats(), engines: engineSummary() });
  });

  r.get('/config', wrap(async (req, res) => {
    res.json({
      maxUploadBytes: config.maxUploadBytes,
      chunkSizeBytes: config.chunkSizeBytes,
      fileTtlMinutes: config.fileTtlMinutes,
      maxBatchInputs: config.maxBatchInputs,
      maxActiveJobsPerSession: config.maxActiveJobsPerSession,
      freeBytes: await freeBytes(paths.uploads),
    });
  }));

  let catalogCache = null;
  r.get('/catalog', (req, res) => {
    catalogCache ??= catalog();
    res.set('Cache-Control', 'public, max-age=300').json(catalogCache);
  });

  r.get('/tools/:id', wrap(async (req, res) => {
    const tool = getTool(req.params.id);
    if (!tool) throw new HttpError(404, 'Tool not found.');
    let info = null;
    let input = null;
    if (req.query.file) {
      const f = ownedFile(String(req.query.file), sessionOf(req));
      info = f.info;
      input = { format: f.format, name: f.name };
    }
    res.json(await toolDetails(tool, info, input, {}));
  }));

  r.get('/files/:id', wrap(async (req, res) => {
    res.json(await publicFile(ownedFile(req.params.id, sessionOf(req))));
  }));

  r.delete('/files/:id', wrap(async (req, res) => {
    const f = ownedFile(req.params.id, sessionOf(req));
    await fs.promises.rm(f.path, { force: true });
    await fs.promises.rm(`${f.path}.json`, { force: true });
    store.deleteFileRow(f.id);
    res.json({ ok: true });
  }));

  r.post('/jobs', wrap(async (req, res) => {
    const session = sessionOf(req);
    const { inputs, target, tool: toolId, options = {} } = req.body || {};
    if (!Array.isArray(inputs) || !inputs.length) throw new HttpError(400, 'Choose at least one file.');
    if (inputs.length > config.maxBatchInputs) throw new HttpError(400, `At most ${config.maxBatchInputs} files can be combined in one operation.`);
    const files = inputs.map((id) => ownedFile(String(id), session));

    const active = store.activeCount({ session, ip: req.ip });
    if (active.session >= config.maxActiveJobsPerSession || active.ip >= config.maxActiveJobsPerIp) {
      // Not a usage cap: the browser keeps the extra files queued and submits them as slots free up.
      throw new HttpError(429, 'Too many conversions are running at the same time. New ones start automatically as soon as current ones finish.', { retryAfter: 3 });
    }

    let job;
    if (toolId) {
      const tool = getTool(String(toolId));
      if (!tool) throw new HttpError(404, 'This tool is not available.');
      const accepted = toolInputFormats(tool);
      if (files.length < tool.inputs.min) throw new HttpError(400, `${tool.title} needs at least ${tool.inputs.min} file${tool.inputs.min > 1 ? 's' : ''}.`);
      if (files.length > tool.inputs.max) throw new HttpError(400, `${tool.title} accepts at most ${tool.inputs.max} file${tool.inputs.max > 1 ? 's' : ''} at once.`);
      for (const f of files) {
        if (accepted !== '*' && !accepted.includes(f.format)) throw new HttpError(400, `${f.name} (${getFormat(f.format)?.name || 'unknown format'}) cannot be used with ${tool.title}.`);
      }
      const specs = (await tool.options?.(files[0].info, { format: files[0].format, name: files[0].name })) || [];
      const opts = validateOptions(specs, options);
      const output = typeof tool.output === 'function' ? tool.output({ format: files[0].format, name: files[0].name }, opts) : tool.output;
      job = store.insertJob({ id: store.newId(), session, ip: req.ip, kind: 'tool', tool: tool.id, target: output || null, inputs: files.map((f) => f.id), options: opts, weight: tool.weight || 'light', quality: tool.quality?.(opts) || null });
    } else {
      if (files.length !== 1) throw new HttpError(400, 'Convert one file per request.');
      const f = files[0];
      if (!f.format) throw new HttpError(415, 'This file format was not recognised.');
      const route = findRoute(f.format, String(target));
      if (!route) throw new HttpError(400, `${getFormat(f.format)?.name} to ${String(target).toUpperCase()} is not supported.`);
      const d = await describeRoute(route, f.info, options);
      if (d.rejected) throw new HttpError(422, d.rejected);
      const opts = validateOptions(d.specs, options);
      const final = await describeRoute(route, f.info, opts);
      const weight = route.steps.some((s) => getConverter(s.converter).weight === 'heavy') ? 'heavy' : 'light';
      job = store.insertJob({ id: store.newId(), session, ip: req.ip, kind: 'convert', target: route.to, inputs: [f.id], options: opts, weight, quality: final.quality });
    }
    wake.emit(job.weight);
    res.status(201).json(publicJob(job));
  }));

  r.get('/jobs', wrap(async (req, res) => {
    const session = sessionOf(req);
    const ids = String(req.query.ids || '').split(',').filter((x) => ID_RE.test(x));
    const list = ids.length ? ids.map((id) => store.getJob(id)).filter((j) => j && j.session === session) : store.jobsForSession(session);
    res.json(list.map(publicJob));
  }));

  r.get('/jobs/:id', wrap(async (req, res) => {
    res.json(publicJob(ownedJob(req.params.id, sessionOf(req))));
  }));

  r.delete('/jobs/:id', wrap(async (req, res) => {
    const j = ownedJob(req.params.id, sessionOf(req));
    if (store.cancelJob(j.id)) abortLocal(j.id);
    if (req.query.purge === '1') {
      await fs.promises.rm(path.join(paths.jobs, j.id), { recursive: true, force: true });
      store.deleteJobRow(j.id);
    }
    res.json({ ok: true });
  }));

  r.get('/jobs/:id/outputs/:index', wrap(async (req, res) => {
    const j = ownedJob(req.params.id, sessionOf(req));
    if (j.status !== 'done') throw new HttpError(409, 'This conversion has not finished.');
    const o = j.outputs.find((x) => String(x.index) === req.params.index);
    if (!o) throw new HttpError(404, 'File not found.');
    const file = path.join(paths.jobs, j.id, 'out', o.file);
    if (!fs.existsSync(file)) throw new HttpError(410, 'This file has expired and was deleted.');
    const inline = req.query.inline === '1' && !UNSAFE_INLINE.has(o.format);
    const mime = getFormat(o.format)?.mime;
    res.set('Cache-Control', 'private, no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    if (inline) {
      res.type(mime || 'application/octet-stream');
      res.set('Content-Disposition', 'inline');
      return res.sendFile(file, { acceptRanges: true, dotfiles: 'allow' });
    }
    if (mime) res.type(mime);
    res.download(file, o.displayName || o.name, { acceptRanges: true, dotfiles: 'allow' });
  }));

  /** Streams every output of the given jobs as one ZIP (ZIP64 for files over 4 GB). */
  r.get('/archive', wrap(async (req, res) => {
    const session = sessionOf(req);
    const ids = String(req.query.jobs || '').split(',').filter((x) => ID_RE.test(x));
    const jobs = ids.map((id) => store.getJob(id)).filter((j) => j && j.session === session && j.status === 'done');
    if (!jobs.length) throw new HttpError(404, 'No finished conversions to download.');
    const zip = new yazl.ZipFile();
    const names = new Set();
    for (const j of jobs) {
      for (const o of j.outputs) {
        const file = path.join(paths.jobs, j.id, 'out', o.file);
        if (!fs.existsSync(file)) continue;
        const wanted = (o.relPath || o.displayName || o.name).replace(/^\/+/, '');
        let name = wanted;
        const dot = wanted.lastIndexOf('.');
        let n = 1;
        while (names.has(name.toLowerCase())) name = dot > 0 ? `${wanted.slice(0, dot)} (${++n})${wanted.slice(dot)}` : `${wanted} (${++n})`;
        names.add(name.toLowerCase());
        zip.addFile(file, name, { compress: !COMPRESSED.has(o.format), forceZip64Format: o.size > 4_000_000_000 });
      }
    }
    if (!names.size) throw new HttpError(410, 'These files have expired.');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="fileverse-${new Date().toISOString().slice(0, 10)}.zip"`);
    res.set('Cache-Control', 'private, no-store');
    zip.outputStream.pipe(res);
    zip.outputStream.on('error', () => res.destroy());
    zip.end();
  }));

  r.get('/events', (req, res, next) => {
    try {
      subscribe(sessionOf(req), req, res);
    } catch (err) {
      next(err);
    }
  });

  return r;
}
