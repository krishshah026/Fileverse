import fs from 'node:fs/promises';
import path from 'node:path';
import { config, paths } from '../config.js';
import { getConverter, findRoute, getTool } from '../registry/index.js';
import { baseName, outputExt, formatFromName, getFormat } from '../registry/formats.js';
import { inspectFile } from '../detect/inspect.js';
import { ConversionError, explainFailure } from '../util/errors.js';
import * as store from './store.js';

/** Removes characters that are unsafe in file names on any OS; keeps Unicode letters. */
export function safeName(name, max = 150) {
  let s = String(name || 'file')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .trim();
  if (!s) s = 'file';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  return s.length > max ? s.slice(0, max).trim() : s;
}

class ProgressReporter {
  constructor(jobId) {
    this.jobId = jobId;
    this.started = Date.now();
    this.lastWrite = 0;
    this.value = 0;
    this.stage = null;
    this.etaSmooth = null;
  }
  set(fraction, stage) {
    const v = Math.max(this.value, Math.min(0.999, Number.isFinite(fraction) ? fraction : 0));
    this.value = v;
    if (stage) this.stage = stage;
    const t = Date.now();
    if (t - this.lastWrite < 500 && !stage) return;
    this.lastWrite = t;
    const elapsed = (t - this.started) / 1000;
    let eta = null;
    if (v > 0.02 && elapsed > 2) {
      const raw = (elapsed / v) * (1 - v);
      this.etaSmooth = this.etaSmooth == null ? raw : this.etaSmooth * 0.7 + raw * 0.3;
      eta = Math.max(1, Math.round(this.etaSmooth));
    }
    store.updateProgress(this.jobId, { progress: v, stage: this.stage, eta });
  }
}

async function linkOrCopy(src, dest) {
  try {
    await fs.link(src, dest);
  } catch {
    await fs.copyFile(src, dest);
  }
}

/** Builds the per-step context passed to converters and tools. */
function makeContext({ job, input, inputs, to, options, stepDir, outDir, signal, report, notes, span, displayBase }) {
  const used = new Set();
  const base = safeName(displayBase);
  const ctx = {
    jobId: job.id,
    input,
    inputs,
    info: input?.info,
    to,
    options,
    signal,
    workDir: stepDir,
    baseName: base,
    toolOutput: job.toolOutput ?? job.target,
    outFile(ext, { suffix = '', name } = {}) {
      const stem = safeName(`${name ? safeName(name) : base}${suffix}`);
      let file = `${stem}.${outputExt(ext)}`;
      let n = 1;
      while (used.has(file.toLowerCase())) file = `${stem} (${++n}).${outputExt(ext)}`;
      used.add(file.toLowerCase());
      return path.join(outDir, file);
    },
    async inputWithExt() {
      const ext = outputExt(input.format);
      const dest = path.join(stepDir, `${safeName(base, 100)}.${ext}`);
      await fs.rm(dest, { force: true });
      await linkOrCopy(input.path, dest);
      return dest;
    },
    progress(f) {
      report.set(span[0] + (span[1] - span[0]) * Math.max(0, Math.min(1, f)));
    },
    stage(label) {
      report.set(report.value, label);
    },
    note(msg) {
      if (msg && !notes.includes(msg)) notes.push(msg);
    },
  };
  return ctx;
}

async function describeOutput(file, relPath) {
  const st = await fs.stat(file);
  const name = path.basename(file);
  const format = formatFromName(name);
  let info = {};
  if (format && ['video', 'audio', 'image', 'pdf'].includes(getFormat(format)?.category)) {
    info = await inspectFile(file, format).catch(() => ({}));
  }
  return { name, size: st.size, format, relPath, info: summarizeInfo(info) };
}

/** Small, UI-oriented summary used for before/after comparisons. */
export function summarizeInfo(info = {}) {
  const out = {};
  if (info.media) {
    const v = info.media.streams?.find((s) => s.type === 'video' && !s.attachedPic);
    const a = info.media.streams?.find((s) => s.type === 'audio');
    out.duration = info.media.duration;
    if (v) Object.assign(out, { width: v.width, height: v.height, videoCodec: v.codec, fps: v.fps });
    if (a) Object.assign(out, { audioCodec: a.codec, sampleRate: a.sampleRate, channels: a.channels });
    out.bitRate = info.media.bitRate;
    out.tracks = { video: info.media.streams.filter((s) => s.type === 'video' && !s.attachedPic).length, audio: info.media.streams.filter((s) => s.type === 'audio').length, subtitle: info.media.streams.filter((s) => s.type === 'subtitle').length };
  }
  if (info.image) Object.assign(out, { width: info.image.width, height: info.image.height, hasAlpha: info.image.hasAlpha, frames: info.image.pages > 1 ? info.image.pages : undefined });
  if (info.pdf) Object.assign(out, { pages: info.pdf.pages, encrypted: info.pdf.encrypted || undefined, hasText: info.pdf.hasText });
  return out;
}

/** Normalises converter return values ([path] or [{path,name,relPath}]). */
function normalizeOutputs(list) {
  return (list || []).map((o) => (typeof o === 'string' ? { path: o } : o));
}

/**
 * Executes a job end to end. Throws ConversionError for user-facing failures.
 */
export async function executeJob(job, signal) {
  const jobDir = path.join(paths.jobs, job.id);
  const outDir = path.join(jobDir, 'out');
  await fs.rm(jobDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  const notes = [];
  const report = new ProgressReporter(job.id);
  report.set(0, 'Starting');

  const inputs = job.inputs.map((id) => {
    const f = store.getFile(id);
    if (!f) throw new ConversionError('The uploaded file has expired or was deleted. Please upload it again.');
    return { id: f.id, path: f.path, name: f.name, format: f.format, size: f.size, info: f.info };
  });
  for (const i of inputs) {
    try {
      await fs.access(i.path);
    } catch {
      throw new ConversionError('The uploaded file is no longer available. Please upload it again.');
    }
  }

  let results;
  if (job.kind === 'convert') {
    results = await runConvert(job, inputs[0], { jobDir, outDir, signal, report, notes });
  } else {
    results = await runTool(job, inputs, { jobDir, outDir, signal, report, notes });
  }

  // Describe outputs (size, dimensions, duration, pages) for the before/after view.
  const finalOutputs = [];
  const taken = new Set();
  for (const [index, o] of results.entries()) {
    let target = path.join(outDir, path.basename(o.path));
    if (path.dirname(o.path) !== outDir) {
      // Outputs produced elsewhere (e.g. extracted archives) may share a name: keep them all.
      const ext = path.extname(target);
      const stem = target.slice(0, target.length - ext.length);
      let n = 1;
      while (taken.has(target) || (await fs.access(target).then(() => true, () => false))) target = `${stem} (${++n})${ext}`;
      await fs.rename(o.path, target).catch(async () => {
        await fs.copyFile(o.path, target);
      });
    }
    taken.add(target);
    const d = await describeOutput(target, o.relPath);
    if (o.name && o.name !== d.name) d.displayName = o.name;
    finalOutputs.push({ index, file: path.basename(target), ...d });
  }
  if (!finalOutputs.length) throw new ConversionError('The conversion produced no output.');
  const empty = finalOutputs.find((o) => o.size === 0);
  if (empty) throw new ConversionError('The conversion produced an empty file. The input may not contain the expected data.');
  await fs.rm(path.join(jobDir, 'work'), { recursive: true, force: true }).catch(() => {});
  return { outputs: finalOutputs, notes };
}

async function runConvert(job, input, { jobDir, outDir, signal, report, notes }) {
  const route = findRoute(input.format, job.target);
  if (!route) throw new ConversionError(`Converting ${input.format?.toUpperCase()} to ${job.target?.toUpperCase()} is not supported.`);
  let current = [input];
  const displayBase = baseName(input.name, input.format);
  for (const [i, step] of route.steps.entries()) {
    const conv = getConverter(step.converter);
    const span = [i / route.steps.length, (i + 1) / route.steps.length];
    const last = i === route.steps.length - 1;
    const stepOut = last ? outDir : path.join(jobDir, 'work', `step-${i}-out`);
    await fs.mkdir(stepOut, { recursive: true });
    report.set(span[0], route.steps.length > 1 ? `Step ${i + 1} of ${route.steps.length}: ${conv.label}` : conv.label);
    const next = [];
    for (const [k, file] of current.entries()) {
      const stepDir = path.join(jobDir, 'work', `step-${i}-${k}`);
      await fs.mkdir(stepDir, { recursive: true });
      const sub = [span[0] + ((span[1] - span[0]) * k) / current.length, span[0] + ((span[1] - span[0]) * (k + 1)) / current.length];
      const fileBase = file === input ? displayBase : baseName(file.name, file.format);
      const ctx = makeContext({ job, input: file, inputs: [file], to: step.to, options: job.options, stepDir, outDir: stepOut, signal, report, notes, span: sub, displayBase: fileBase });
      const produced = normalizeOutputs(await conv.run(ctx));
      for (const p of produced) {
        const name = path.basename(p.path);
        next.push({ ...p, name, format: step.to, info: null });
      }
    }
    current = next;
  }
  return current;
}

async function runTool(job, inputs, { jobDir, outDir, signal, report, notes }) {
  const tool = getTool(job.tool);
  if (!tool) throw new ConversionError('This tool is not available on the server.');
  const work = path.join(jobDir, 'work');
  await fs.mkdir(work, { recursive: true });
  // Some tools (Merge PDF) accept any format that can be converted to their working format first.
  let prepared = inputs;
  if (tool.inputs.convertTo) {
    const needs = inputs.filter((i) => i.format !== tool.inputs.convertTo);
    if (needs.length) {
      prepared = [];
      for (const [k, input] of inputs.entries()) {
        if (input.format === tool.inputs.convertTo) {
          prepared.push(input);
          continue;
        }
        report.set((k / inputs.length) * 0.5, `Converting ${input.name} to ${tool.inputs.convertTo.toUpperCase()}`);
        const route = findRoute(input.format, tool.inputs.convertTo);
        if (!route) throw new ConversionError(`${input.name} cannot be converted to ${tool.inputs.convertTo.toUpperCase()}.`);
        const sub = { ...job, kind: 'convert', target: tool.inputs.convertTo, options: {} };
        const subOut = path.join(work, `pre-${k}`);
        await fs.mkdir(subOut, { recursive: true });
        const res = await runConvert(sub, input, { jobDir: path.join(work, `pre-${k}-job`), outDir: subOut, signal, report: { set: () => {}, value: 0 }, notes });
        prepared.push({ ...input, path: res[0].path, format: tool.inputs.convertTo, info: null });
      }
    }
  }
  const pre = prepared === inputs ? 0 : 0.5;
  const ctx = makeContext({
    job,
    input: prepared[0],
    inputs: prepared,
    to: job.toolOutput,
    options: job.options,
    stepDir: work,
    outDir,
    signal,
    report,
    notes,
    span: [pre, 1],
    displayBase: baseName(inputs[0].name, inputs[0].format),
  });
  report.set(pre, tool.title);
  return normalizeOutputs(await tool.run(ctx));
}

/** Converts any thrown error to the JSON stored on the job. */
export function toJobError(err) {
  if (err?.cancelled) return { message: 'Cancelled.', cancelled: true };
  if (err?.name === 'TimeoutError') return { message: `The conversion took longer than the ${config.jobTimeoutMinutes}-minute limit and was stopped.` };
  if (err instanceof ConversionError && !err.internal) {
    return { message: explainFailure(err) && /failed|could not|not be/i.test(err.message) ? explainFailure(err) : err.message, suggestion: err.suggestion, detail: err.detail?.slice(-1500), code: err.code };
  }
  const explained = explainFailure(err);
  return { message: explained || 'Something went wrong while converting this file.', detail: String(err?.detail || err?.stack || err?.message || err).slice(-1500) };
}
