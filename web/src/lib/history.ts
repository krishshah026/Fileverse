import { useSyncExternalStore } from 'react';
import type { Job } from './types';

/** Conversion history lives only in this browser (no accounts). Results expire on the server. */
export interface HistoryEntry {
  jobId: string;
  title: string;
  status: Job['status'];
  target?: string;
  tool?: string;
  inputs: { name: string; size: number }[];
  outputs: { index: number; name: string; size: number }[];
  error?: string;
  finishedAt: number;
  expiresAt: number;
}

const KEY = 'fv.history';
const MAX = 300;
const listeners = new Set<() => void>();
let cache: HistoryEntry[] = read();

function read(): HistoryEntry[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as HistoryEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function write(list: HistoryEntry[]) {
  cache = list.slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* storage full or disabled: keep in memory */
  }
  listeners.forEach((l) => l());
}

export function recordHistory(job: Job) {
  const existing = cache.find((h) => h.jobId === job.id);
  if (existing && existing.status === job.status) return;
  const entry: HistoryEntry = {
    jobId: job.id,
    title: job.inputs.length > 1 ? `${job.inputs.length} files` : job.inputs[0]?.name || 'File',
    status: job.status,
    target: job.target,
    tool: job.tool,
    inputs: job.inputs.map((i) => ({ name: i.name, size: i.size })),
    outputs: job.outputs.map((o) => ({ index: o.index, name: o.name, size: o.size })),
    error: job.error?.message,
    finishedAt: job.finishedAt || Date.now(),
    expiresAt: job.expiresAt,
  };
  write([entry, ...cache.filter((h) => h.jobId !== job.id)]);
}

export function removeHistory(jobId: string) {
  write(cache.filter((h) => h.jobId !== jobId));
}
export function clearHistory() {
  write([]);
}

export function useHistory(): HistoryEntry[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => cache,
  );
}
