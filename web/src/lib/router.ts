import { useSyncExternalStore } from 'react';

/** Tiny history-API router: real URLs (/convert/mkv-to-mp4, /tools/merge-pdf) without a dependency. */
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
window.addEventListener('popstate', notify);

export function navigate(to: string, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.scrollTo({ top: 0 });
  notify();
}

export function usePath(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => location.pathname,
  );
}

/** Intercepts clicks on internal <a href> links so navigation stays client-side. */
export function linkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  const a = e.currentTarget;
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === '_blank') return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  navigate(url.pathname + url.search);
}
