import { useRef, useSyncExternalStore } from 'react';
import * as tus from 'tus-js-client';
import { api, ApiError, eventsUrl, SESSION, uploadEndpoint } from './api';
import { formatFromName } from './catalog';
import { recordHistory } from './history';
import type { Job, ServerConfig, ServerFile } from './types';

export type UploadState = 'queued' | 'uploading' | 'done' | 'error' | 'paused';

export interface Item {
  id: string;
  scope: string; // 'convert' or 'tool:<id>'
  file?: File;
  name: string;
  size: number;
  guess: string | null;
  upload: { state: UploadState; sent: number; speed?: number; eta?: number; error?: string };
  server?: ServerFile;
  target?: string;
  options: Record<string, unknown>;
  autoStart: boolean;
  job?: Job;
  submit?: { state: 'waiting' | 'submitting' | 'error'; message?: string };
  previewUrl?: string;
  notice?: string;
}

export interface ToolRun {
  id: string;
  toolId: string;
  job?: Job;
  submit?: { state: 'waiting' | 'submitting' | 'error'; message?: string };
  itemIds: string[];
}

interface State {
  items: Item[];
  runs: ToolRun[];
  config: ServerConfig | null;
  live: boolean;
}

let state: State = { items: [], runs: [], config: null, live: false };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function set(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}
export function patchItem(id: string, patch: Partial<Item> | ((i: Item) => Partial<Item>)) {
  set({ items: state.items.map((i) => (i.id === id ? { ...i, ...(typeof patch === 'function' ? patch(i) : patch) } : i)) });
}
function patchRun(id: string, patch: Partial<ToolRun>) {
  set({ runs: state.runs.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
  return false;
}
const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
};

/**
 * Selects a slice of the store. Snapshots are memoised per store version and compared shallowly,
 * so selectors that build arrays (e.g. filter) do not cause render loops.
 */
export function useStore<T>(select: (s: State) => T): T {
  const cache = useRef<{ state: State; value: T } | null>(null);
  const getSnapshot = () => {
    const cur = cache.current;
    if (cur && cur.state === state) return cur.value;
    const value = select(state);
    if (cur && shallowEqual(cur.value, value)) {
      cache.current = { state, value: cur.value };
      return cur.value;
    }
    cache.current = { state, value };
    return value;
  };
  return useSyncExternalStore(subscribe, getSnapshot);
}
export const getState = () => state;

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ---------- config ----------
export async function loadConfig() {
  if (state.config) return state.config;
  try {
    const c = await api.config();
    set({ config: c });
    return c;
  } catch {
    return null;
  }
}

// ---------- uploads ----------
const uploads = new Map<string, tus.Upload>();
const MAX_PARALLEL_UPLOADS = 3;

export function addFiles(files: File[], scope: string, presetTarget?: string): string[] {
  const max = state.config?.maxUploadBytes ?? Infinity;
  const added: Item[] = files.map((file) => {
    const guess = formatFromName(file.name);
    const tooBig = file.size > max;
    const isImage = /^image\/(png|jpeg|webp|gif|avif|bmp|svg\+xml)$/.test(file.type) && file.size < 40 * 1024 * 1024;
    return {
      id: uid(),
      scope,
      file,
      name: file.name,
      size: file.size,
      guess,
      upload: tooBig ? { state: 'error', sent: 0, error: `This file is larger than the ${(max / 1024 ** 3).toFixed(0)} GB limit of this server.` } : { state: 'queued', sent: 0 },
      target: presetTarget,
      options: {},
      autoStart: false,
      previewUrl: isImage ? URL.createObjectURL(file) : undefined,
    };
  });
  set({ items: [...state.items, ...added] });
  pumpUploads();
  return added.map((a) => a.id);
}

function pumpUploads() {
  const active = state.items.filter((i) => i.upload.state === 'uploading').length;
  const next = state.items.filter((i) => i.upload.state === 'queued').slice(0, Math.max(0, MAX_PARALLEL_UPLOADS - active));
  next.forEach(startUpload);
}

function startUpload(item: Item) {
  if (!item.file) return;
  const chunkSize = state.config?.chunkSizeBytes ?? 50 * 1024 * 1024;
  let last = { t: performance.now(), sent: 0 };
  let ema = 0;
  patchItem(item.id, { upload: { state: 'uploading', sent: 0 } });
  const up = new tus.Upload(item.file, {
    endpoint: uploadEndpoint(),
    chunkSize,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000, 60000],
    metadata: { filename: item.name, filetype: item.file.type || 'application/octet-stream' },
    headers: { 'X-Fileverse-Session': SESSION },
    removeFingerprintOnSuccess: true,
    storeFingerprintForResuming: true,
    onProgress(sent, total) {
      const now = performance.now();
      const dt = (now - last.t) / 1000;
      if (dt > 0.5) {
        const inst = (sent - last.sent) / dt;
        ema = ema ? ema * 0.75 + inst * 0.25 : inst;
        last = { t: now, sent };
      }
      patchItem(item.id, { upload: { state: 'uploading', sent, speed: ema || undefined, eta: ema ? (total - sent) / ema : undefined } });
    },
    onError(err) {
      const body = (err as tus.DetailedError).originalResponse?.getBody?.();
      let message = 'The upload was interrupted. Check your connection and select Resume — it will continue where it left off.';
      try {
        if (body) message = JSON.parse(body).error || message;
      } catch {
        /* keep default */
      }
      uploads.delete(item.id);
      patchItem(item.id, (i) => ({ upload: { ...i.upload, state: 'error', error: message } }));
      pumpUploads();
    },
    onSuccess({ lastResponse }) {
      uploads.delete(item.id);
      let server: ServerFile | null = null;
      try {
        server = JSON.parse(lastResponse.getBody());
      } catch {
        server = null;
      }
      const finish = (sf: ServerFile) => onUploaded(item.id, sf);
      if (server?.id) finish(server);
      else {
        const id = up.url?.split('/').pop();
        if (id) api.file(id).then(finish, () => patchItem(item.id, { upload: { state: 'error', sent: 0, error: 'The file was uploaded but could not be analysed.' } }));
      }
      pumpUploads();
    },
  });
  uploads.set(item.id, up);
  // Resume an earlier interrupted upload of the same file (same name, size and modification time).
  up.findPreviousUploads()
    .then((previous) => {
      if (previous.length) up.resumeFromPreviousUpload(previous[0]);
      up.start();
    })
    .catch(() => up.start());
}

function onUploaded(id: string, sf: ServerFile) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  // Keep the chosen/preset target only if this exact file supports it, and say why when it does not.
  let target = item.target;
  let notice: string | undefined;
  if (target) {
    const t = sf.targets.find((x) => x.to === target);
    if (!t || t.unavailable) {
      notice = t?.unavailable ? `Cannot convert to .${target}: ${t.unavailable}` : `${sf.formatName || 'This'} files cannot be converted to .${target}. Choose another format.`;
      target = undefined;
    }
  }
  patchItem(id, { server: sf, upload: { state: 'done', sent: item.size }, target, guess: sf.format, notice, autoStart: target ? item.autoStart : false, submit: target ? item.submit : undefined });
  const fresh = state.items.find((i) => i.id === id)!;
  if (fresh.autoStart && fresh.target) convert(id);
  // Tool runs waiting for this upload
  for (const run of state.runs) if (!run.job && run.submit?.state === 'waiting' && run.itemIds.includes(id)) submitRun(run.id);
}

export function pauseUpload(id: string) {
  uploads.get(id)?.abort();
  uploads.delete(id);
  patchItem(id, (i) => ({ upload: { ...i.upload, state: 'paused' } }));
  pumpUploads();
}
export function resumeUpload(id: string) {
  patchItem(id, (i) => ({ upload: { ...i.upload, state: 'queued', error: undefined } }));
  pumpUploads();
}

export async function removeItem(id: string) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  uploads.get(id)?.abort(true).catch(() => {});
  uploads.delete(id);
  if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  set({ items: state.items.filter((i) => i.id !== id), runs: state.runs.map((r) => ({ ...r, itemIds: r.itemIds.filter((x) => x !== id) })) });
  if (item.job && ['queued', 'running'].includes(item.job.status)) api.cancelJob(item.job.id).catch(() => {});
  if (item.server && !state.items.some((i) => i.server?.id === item.server!.id)) api.deleteFile(item.server.id).catch(() => {});
  pumpUploads();
}

export function clearScope(scope: string) {
  for (const i of state.items.filter((x) => x.scope === scope)) removeItem(i.id);
}

export function moveItem(id: string, dir: -1 | 1) {
  const idx = state.items.findIndex((i) => i.id === id);
  const scope = state.items[idx]?.scope;
  const scoped = state.items.map((it, k) => ({ it, k })).filter(({ it }) => it.scope === scope);
  const pos = scoped.findIndex(({ it }) => it.id === id);
  const swap = scoped[pos + dir];
  if (!swap) return;
  const items = [...state.items];
  [items[idx], items[swap.k]] = [items[swap.k], items[idx]];
  set({ items });
}

// ---------- conversions ----------
export function setTarget(id: string, target: string) {
  patchItem(id, { target, options: {}, job: undefined, submit: undefined, notice: undefined });
}
export function setOptions(id: string, options: Record<string, unknown>) {
  patchItem(id, { options });
}

async function createWithRetry(body: Parameters<typeof api.createJob>[0], onWait: (msg: string) => void): Promise<Job> {
  for (;;) {
    try {
      return await api.createJob(body);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        onWait('Queued — starting as soon as a processing slot is free');
        await new Promise((r) => setTimeout(r, (err.retryAfter || 3) * 1000));
        continue;
      }
      throw err;
    }
  }
}

export async function convert(id: string) {
  const item = state.items.find((i) => i.id === id);
  if (!item?.target) return;
  if (!item.server) {
    // Upload still running: convert automatically as soon as it finishes.
    patchItem(id, { autoStart: true, submit: { state: 'waiting', message: 'Conversion will start automatically when the upload completes' } });
    return;
  }
  patchItem(id, { autoStart: false, submit: { state: 'submitting' }, job: undefined });
  try {
    const job = await createWithRetry({ inputs: [item.server.id], target: item.target, options: item.options }, (message) => patchItem(id, { submit: { state: 'waiting', message } }));
    patchItem(id, { job, submit: undefined });
  } catch (err) {
    patchItem(id, { submit: { state: 'error', message: (err as Error).message } });
  }
}

export async function runToolForItem(id: string, toolId: string, options: Record<string, unknown>) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  if (!item.server) {
    patchItem(id, { submit: { state: 'waiting', message: 'Starts automatically when the upload completes' }, autoStart: false });
    const wait = setInterval(() => {
      const fresh = state.items.find((i) => i.id === id);
      if (!fresh) return clearInterval(wait);
      if (fresh.server) {
        clearInterval(wait);
        runToolForItem(id, toolId, options);
      }
    }, 400);
    return;
  }
  patchItem(id, { submit: { state: 'submitting' }, job: undefined });
  try {
    const job = await createWithRetry({ inputs: [item.server.id], tool: toolId, options }, (message) => patchItem(id, { submit: { state: 'waiting', message } }));
    patchItem(id, { job, submit: undefined });
  } catch (err) {
    patchItem(id, { submit: { state: 'error', message: (err as Error).message } });
  }
}

/** Multi-input tools (merge, images → PDF, create archive) run once over several files. */
export function startRun(toolId: string, itemIds: string[], options: Record<string, unknown>): string {
  const run: ToolRun = { id: uid(), toolId, itemIds, submit: { state: 'waiting', message: 'Starts automatically when all uploads complete' } };
  set({ runs: [...state.runs, run] });
  runOptions.set(run.id, options);
  submitRun(run.id);
  return run.id;
}
const runOptions = new Map<string, Record<string, unknown>>();

async function submitRun(runId: string) {
  const run = state.runs.find((r) => r.id === runId);
  if (!run || run.job) return;
  const items = run.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean) as Item[];
  if (items.some((i) => !i.server)) {
    patchRun(runId, { submit: { state: 'waiting', message: 'Starts automatically when all uploads complete' } });
    return;
  }
  patchRun(runId, { submit: { state: 'submitting' } });
  try {
    const job = await createWithRetry({ inputs: items.map((i) => i.server!.id), tool: run.toolId, options: runOptions.get(runId) || {} }, (message) => patchRun(runId, { submit: { state: 'waiting', message } }));
    patchRun(runId, { job, submit: undefined });
  } catch (err) {
    patchRun(runId, { submit: { state: 'error', message: (err as Error).message } });
  }
}

export function dismissRun(runId: string) {
  set({ runs: state.runs.filter((r) => r.id !== runId) });
}

export async function cancel(jobId: string) {
  await api.cancelJob(jobId).catch(() => {});
}

// ---------- live job updates (Server-Sent Events, with polling fallback) ----------
function applyJob(job: Job) {
  let touched = false;
  const items = state.items.map((i) => {
    if (i.job?.id !== job.id) return i;
    touched = true;
    return { ...i, job };
  });
  const runs = state.runs.map((r) => {
    if (r.job?.id !== job.id) return r;
    touched = true;
    return { ...r, job };
  });
  if (touched) set({ items, runs });
  if (job.status === 'done' || job.status === 'failed') recordHistory(job);
}

let source: EventSource | null = null;
let poller: ReturnType<typeof setInterval> | null = null;
let failures = 0;

export function connectLive() {
  if (source || typeof EventSource === 'undefined') return startPolling();
  source = new EventSource(eventsUrl());
  source.addEventListener('job', (e) => {
    failures = 0;
    applyJob(JSON.parse((e as MessageEvent).data));
  });
  source.onopen = () => {
    set({ live: true });
    failures = 0;
    // Catch up on anything that changed while disconnected.
    refreshActive();
  };
  source.onerror = () => {
    set({ live: false });
    if (++failures > 3) {
      source?.close();
      source = null;
      startPolling();
    }
  };
}

function activeJobIds() {
  return [...state.items.map((i) => i.job), ...state.runs.map((r) => r.job)].filter((j): j is Job => Boolean(j && ['queued', 'running'].includes(j.status))).map((j) => j.id);
}

async function refreshActive() {
  const ids = activeJobIds();
  if (!ids.length) return;
  try {
    (await api.jobs(ids)).forEach(applyJob);
  } catch {
    /* next round */
  }
}

function startPolling() {
  if (poller) return;
  poller = setInterval(refreshActive, 1500);
}
