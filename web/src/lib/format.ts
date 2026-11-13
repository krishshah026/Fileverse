export function bytes(n?: number): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = Number.isInteger(v) || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function duration(sec?: number): string {
  if (!sec || !Number.isFinite(sec)) return '';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** "about 2 min left" style estimate. */
export function eta(sec?: number): string {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return '';
  if (sec < 10) return 'a few seconds left';
  if (sec < 60) return `${Math.round(sec / 5) * 5} s left`;
  if (sec < 3600) return `about ${Math.round(sec / 60)} min left`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return `about ${h} h ${m} min left`;
}

export function speed(bps?: number): string {
  if (!bps || !Number.isFinite(bps)) return '';
  return `${bytes(bps)}/s`;
}

export function sizeChange(before: number, after: number): { text: string; smaller: boolean } {
  if (!before || !after) return { text: '', smaller: false };
  const pct = ((after - before) / before) * 100;
  if (Math.abs(pct) < 0.5) return { text: 'same size', smaller: false };
  return { text: `${pct < 0 ? '' : '+'}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`, smaller: pct < 0 };
}

export function timeLeft(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return 'expired';
  const min = Math.round(ms / 60000);
  if (min < 60) return `deleted in ${min} min`;
  return `deleted in ${Math.floor(min / 60)} h ${min % 60} min`;
}

export const ext = (id?: string | null) => (id ? `.${id}` : '');

export function plural(n: number, word: string, pluralWord = `${word}s`) {
  return `${n.toLocaleString()} ${n === 1 ? word : pluralWord}`;
}
