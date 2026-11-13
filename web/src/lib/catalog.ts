import { useSyncExternalStore } from 'react';
import { api } from './api';
import type { Catalog, FormatInfo, ToolInfo } from './types';

let catalog: Catalog | null = null;
let loading: Promise<Catalog> | null = null;
let failed: string | null = null;
const listeners = new Set<() => void>();

export function loadCatalog(): Promise<Catalog> {
  if (catalog) return Promise.resolve(catalog);
  loading ??= api
    .catalog()
    .then((c) => {
      catalog = c;
      index = buildIndex(c);
      listeners.forEach((l) => l());
      return c;
    })
    .catch((err) => {
      failed = err.message;
      loading = null;
      listeners.forEach((l) => l());
      throw err;
    });
  return loading;
}

export function useCatalog(): { catalog: Catalog | null; error: string | null } {
  const c = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => catalog,
  );
  if (!c && !loading && !failed) loadCatalog().catch(() => {});
  return { catalog: c, error: failed };
}

export const getCatalog = () => catalog;
export const fmt = (id?: string | null): FormatInfo | undefined => (id ? catalog?.formats.find((f) => f.id === id) : undefined);

/** Client-side guess from the file name — instant targets while the upload is still running. */
export function formatFromName(name: string): string | null {
  if (!catalog) return null;
  const lower = name.toLowerCase();
  let best: { id: string; len: number } | null = null;
  for (const f of catalog.formats) {
    for (const e of f.ext) {
      if (lower.endsWith(`.${e}`) && (!best || e.length > best.len)) best = { id: f.id, len: e.length };
    }
  }
  return best?.id ?? null;
}

export const POPULAR: [string, string][] = [
  ['mkv', 'mp4'], ['mp4', 'mp3'], ['heic', 'jpg'], ['pdf', 'docx'], ['docx', 'pdf'], ['png', 'jpg'], ['webp', 'png'], ['mov', 'mp4'],
  ['jpg', 'pdf'], ['xlsx', 'csv'], ['pptx', 'pdf'], ['mp4', 'gif'], ['wav', 'mp3'], ['svg', 'png'], ['webm', 'mp4'], ['png', 'webp'],
  ['epub', 'pdf'], ['csv', 'xlsx'], ['pdf', 'jpg'], ['flac', 'mp3'], ['json', 'yaml'], ['rar', 'zip'], ['avi', 'mp4'], ['ttf', 'woff2'],
];

export function popular(limit = 24): [string, string][] {
  if (!catalog) return [];
  return POPULAR.filter(([a, b]) => fmt(a)?.targets.includes(b)).slice(0, limit);
}

export const pairSlug = (from: string, to: string) => `${from.replace('.', '')}-to-${to.replace('.', '')}`;
export function parsePairSlug(slug: string): [string, string] | null {
  const m = /^(.+)-to-(.+)$/.exec(slug);
  if (!m || !catalog) return null;
  const find = (s: string) => catalog!.formats.find((f) => f.id.replace('.', '') === s)?.id;
  const a = find(m[1]);
  const b = find(m[2]);
  return a && b ? [a, b] : null;
}

// ---------- search ----------
export type SearchHit = { kind: 'pair'; from: string; to: string; score: number } | { kind: 'tool'; tool: ToolInfo; score: number } | { kind: 'format'; format: FormatInfo; score: number };

let index: { from: string; to: string; key: string }[] = [];
function buildIndex(c: Catalog) {
  return c.formats.flatMap((f) => f.targets.map((t) => ({ from: f.id, to: t, key: `${f.id} ${t}` })));
}

const ALIASES: Record<string, string> = { jpeg: 'jpg', tif: 'tiff', word: 'docx', excel: 'xlsx', powerpoint: 'pptx', yml: 'yaml', htm: 'html', markdown: 'md', heif: 'heic', mpg: 'mpeg', kindle: 'azw3', text: 'txt', image: 'png' };

function normalizeToken(t: string) {
  const s = t.replace(/^\./, '').toLowerCase();
  return ALIASES[s] ?? s;
}

export function search(query: string, limit = 12): SearchHit[] {
  if (!catalog) return [];
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const words = q.split(/\s+|,/).filter((w) => w && !['to', 'into', 'in', 'convert', 'converter', 'file', 'files', 'online', 'free', '->', '→', 'a', 'my'].includes(w));
  const hits: SearchHit[] = [];
  const formatIds = new Set(catalog.formats.map((f) => f.id));
  const tokens = words.map(normalizeToken);
  const fmts = tokens.filter((t) => formatIds.has(t));

  // "mkv mp4" / "mkv to mp4"
  if (fmts.length >= 2) {
    const [a, b] = fmts;
    if (fmt(a)?.targets.includes(b)) hits.push({ kind: 'pair', from: a, to: b, score: 100 });
  }
  if (fmts.length >= 1) {
    const a = fmts[0];
    const f = fmt(a);
    if (f) {
      hits.push({ kind: 'format', format: f, score: 60 });
      for (const t of f.targets) if (!hits.some((h) => h.kind === 'pair' && h.from === a && h.to === t)) hits.push({ kind: 'pair', from: a, to: t, score: 40 - f.targets.indexOf(t) * 0.1 });
      // Conversions *to* this format
      for (const e of index) if (e.to === a && fmts.length === 1) hits.push({ kind: 'pair', from: e.from, to: a, score: 20 });
    }
  }
  // Tools by words ("compress pdf", "merge", "trim video")
  for (const tool of catalog.tools) {
    const hay = `${tool.title} ${tool.description} ${tool.category}`.toLowerCase();
    const matched = words.filter((w) => hay.includes(w)).length;
    if (matched) hits.push({ kind: 'tool', tool, score: 50 + matched * 15 + (tool.title.toLowerCase().includes(words[0]) ? 20 : 0) });
  }
  // Prefix matches on format names ("we" → webp, webm)
  if (!fmts.length && words.length === 1) {
    for (const f of catalog.formats) if (f.id.startsWith(tokens[0]) || f.name.toLowerCase().startsWith(tokens[0])) hits.push({ kind: 'format', format: f, score: 30 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
