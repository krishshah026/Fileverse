import { HttpError } from '../util/errors.js';

/**
 * Option specs are declared by converters and rendered generically by the web app.
 * Types: select | range | number | toggle | text | pages | time | password | color
 * `showIf: { otherKey: [values] }` hides an option unless another option has one of the values.
 * `secret: true` options are wiped from storage when the job finishes.
 */

export const PAGE_RANGE_RE = /^\s*(\d+|\d+\s*-\s*(\d+|end)?|end)(\s*,\s*(\d+|\d+\s*-\s*(\d+|end)?|end))*\s*$/i;
export const TIME_RE = /^\s*(\d+(\.\d+)?|(\d{1,2}:)?\d{1,2}:\d{1,2}(\.\d+)?)\s*$/;

export function parseTime(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v).trim();
  if (!TIME_RE.test(s)) return NaN;
  if (!s.includes(':')) return Number(s);
  const parts = s.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

/** Expands "1-3,5,8-end" into sorted unique 1-based page numbers bounded by total. */
export function expandPages(spec, total) {
  if (!spec || !PAGE_RANGE_RE.test(spec)) throw new HttpError(400, `Invalid page selection "${spec}". Use e.g. 1-3, 5, 8-end.`);
  const set = new Set();
  for (const raw of spec.split(',')) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    let a;
    let b;
    if (part.includes('-')) {
      const [x, y] = part.split('-').map((t) => t.trim());
      a = x === 'end' ? total : Number(x);
      b = !y || y === 'end' ? total : Number(y);
    } else {
      a = b = part === 'end' ? total : Number(part);
    }
    if (a > b) [a, b] = [b, a];
    for (let p = Math.max(1, a); p <= Math.min(total, b); p++) set.add(p);
  }
  const pages = [...set].sort((x, y) => x - y);
  if (!pages.length) throw new HttpError(400, `No pages selected — this document has ${total} page${total === 1 ? '' : 's'}.`);
  return pages;
}

export function validateOptions(specs = [], input = {}) {
  const out = {};
  const raw = input && typeof input === 'object' ? input : {};
  for (const spec of specs) {
    const has = raw[spec.key] !== undefined && raw[spec.key] !== null && raw[spec.key] !== '';
    let v = has ? raw[spec.key] : spec.default;
    if (v === undefined) {
      if (spec.required && isVisible(spec, out)) throw new HttpError(400, `${spec.label} is required.`);
      continue;
    }
    switch (spec.type) {
      case 'select': {
        const ok = spec.choices.some((c) => String(c.value) === String(v));
        if (!ok) throw new HttpError(400, `Invalid value for ${spec.label}.`);
        const match = spec.choices.find((c) => String(c.value) === String(v));
        v = match.value;
        break;
      }
      case 'range':
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new HttpError(400, `${spec.label} must be a number.`);
        if (spec.min !== undefined && n < spec.min) throw new HttpError(400, `${spec.label} must be at least ${spec.min}.`);
        if (spec.max !== undefined && n > spec.max) throw new HttpError(400, `${spec.label} must be at most ${spec.max}.`);
        v = spec.integer === false ? n : Math.round(n);
        break;
      }
      case 'toggle':
        v = v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
        break;
      case 'pages':
        v = String(v).trim();
        if (!PAGE_RANGE_RE.test(v)) throw new HttpError(400, `${spec.label}: use page numbers and ranges like 1-3, 5, 8-end.`);
        break;
      case 'time': {
        const t = parseTime(v);
        if (!Number.isFinite(t) || t < 0) throw new HttpError(400, `${spec.label}: use seconds (90) or hh:mm:ss (00:01:30).`);
        v = t;
        break;
      }
      case 'color':
        v = String(v).trim();
        if (!/^#[0-9a-f]{6}$/i.test(v)) throw new HttpError(400, `${spec.label} must be a colour like #ffffff.`);
        break;
      case 'text':
      case 'password':
        v = String(v);
        if (v.length > (spec.maxLength ?? 500)) throw new HttpError(400, `${spec.label} is too long.`);
        if (spec.pattern && !new RegExp(spec.pattern).test(v)) throw new HttpError(400, `Invalid value for ${spec.label}.`);
        break;
      default:
        break;
    }
    out[spec.key] = v;
  }
  return out;
}

function isVisible(spec, values) {
  if (!spec.showIf) return true;
  return Object.entries(spec.showIf).every(([k, allowed]) => allowed.map(String).includes(String(values[k])));
}

/** Option specs sent to the browser (strip server-only fields). */
export function publicSpecs(specs = []) {
  return specs.map(({ secret, ...rest }) => ({ ...rest, secret: Boolean(secret) || undefined }));
}
