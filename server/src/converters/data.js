import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { ConversionError } from '../util/errors.js';

const DATA = ['json', 'yaml', 'xml', 'toml', 'csv', 'tsv'];
const MAX_BYTES = 256 * 1024 * 1024;

/** RFC 4180 parser: quoted fields, escaped quotes, embedded separators and newlines. */
export function parseDelimited(text, sep) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let quoted = false;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
    } else if (ch === sep) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      if (ch === '\r' && text[i + 1] === '\n') i++;
      i++;
    } else {
      field += ch;
      i++;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function inferValue(v) {
  if (v === '') return '';
  if (/^(true|false)$/i.test(v)) return v.toLowerCase() === 'true';
  if (/^null$/i.test(v)) return null;
  // Keep identifiers like 007, phone numbers and huge ints as strings.
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d+)?$/.test(v)) return Number(v);
  return v;
}

function delimitedToData(text, sep, { header = true, infer = true }) {
  const rows = parseDelimited(text.replace(/^﻿/, ''), sep);
  const conv = (v) => (infer ? inferValue(v) : v);
  if (!rows.length) return [];
  if (!header) return rows.map((r) => r.map(conv));
  const keys = uniqueKeys(rows[0]);
  return rows.slice(1).map((r) => Object.fromEntries(keys.map((k, idx) => [k, conv(r[idx] ?? '')])));
}

function uniqueKeys(headers) {
  const seen = new Map();
  return headers.map((h, i) => {
    let k = String(h).trim() || `column_${i + 1}`;
    if (seen.has(k)) {
      const c = seen.get(k) + 1;
      seen.set(k, c);
      k = `${k}_${c}`;
    } else seen.set(k, 1);
    return k;
  });
}

function flatten(obj, prefix = '', out = {}) {
  if (obj === null || typeof obj !== 'object') {
    out[prefix || 'value'] = obj;
    return out;
  }
  if (Array.isArray(obj)) {
    if (obj.every((x) => x === null || typeof x !== 'object')) {
      out[prefix || 'value'] = obj.join('; ');
      return out;
    }
    obj.forEach((v, i) => flatten(v, prefix ? `${prefix}.${i}` : String(i), out));
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

/** Finds the list of records in arbitrary data (e.g. { users: [...] } or an XML root with repeated children). */
function findRecords(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === 'object') {
    const entries = Object.entries(data).filter(([k]) => !k.startsWith('?'));
    if (entries.length === 1) {
      const [, v] = entries[0];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const arrays = Object.values(v).filter(Array.isArray);
        if (arrays.length === 1) return arrays[0];
        return findRecords(v);
      }
    }
    const arrays = entries.filter(([, v]) => Array.isArray(v));
    if (arrays.length === 1 && entries.length <= 3) return arrays[0][1];
    return [data];
  }
  return [{ value: data }];
}

function dataToDelimited(data, sep, { bom = false } = {}) {
  const records = findRecords(data).map((r) => (r !== null && typeof r === 'object' ? flatten(r) : { value: r }));
  const keys = [];
  const seen = new Set();
  for (const r of records) for (const k of Object.keys(r)) if (!seen.has(k)) seen.add(k), keys.push(k);
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.map(esc).join(sep), ...records.map((r) => keys.map((k) => esc(r[k])).join(sep))];
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n';
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', parseTagValue: false, parseAttributeValue: false, trimValues: true, ignoreDeclaration: true, ignorePiTags: true, processEntities: true });

function xmlName(k) {
  let n = String(k).replace(/[^A-Za-z0-9_.:-]/g, '_');
  if (!/^[A-Za-z_]/.test(n)) n = `_${n}`;
  return n;
}
function xmlSafe(v) {
  if (Array.isArray(v)) return v.map(xmlSafe);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.startsWith('@_') || k === '#text' ? k : xmlName(k), xmlSafe(x)]));
  return v;
}

function toXml(data, indent) {
  // XML needs exactly one root element; wrap whenever the data does not already have one.
  let root = data;
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).filter((k) => !k.startsWith('?')) : [];
  if (Array.isArray(data)) root = { root: { item: data } };
  else if (!data || typeof data !== 'object') root = { root: data };
  else if (keys.length !== 1 || Array.isArray(data[keys[0]]) || data[keys[0]] === null || typeof data[keys[0]] !== 'object') root = { root: data };
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', format: indent !== '', indentBy: indent, suppressEmptyNode: true });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlSafe(root))}`;
}

function stripNulls(v, counter) {
  if (Array.isArray(v)) return v.filter((x) => x !== null || (counter.n++, false)).map((x) => stripNulls(x, counter));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null || (counter.n++, false)).map(([k, x]) => [k, stripNulls(x, counter)]));
  }
  return v;
}

export async function readData(file, format, opts = {}) {
  const st = await fs.stat(file);
  if (st.size > MAX_BYTES) throw new ConversionError('Data files larger than 256 MB cannot be converted (they are parsed in memory).');
  const text = (await fs.readFile(file, 'utf8')).replace(/^﻿/, '');
  try {
    switch (format) {
      case 'json':
        return JSON.parse(text);
      case 'yaml': {
        const docs = yaml.loadAll(text);
        return docs.length === 1 ? docs[0] : docs;
      }
      case 'xml':
        return xmlParser.parse(text, true);
      case 'toml':
        return parseToml(text);
      case 'csv':
        return delimitedToData(text, ',', opts);
      case 'tsv':
        return delimitedToData(text, '\t', opts);
      default:
        throw new Error(`Unsupported data format ${format}`);
    }
  } catch (err) {
    if (err instanceof ConversionError) throw err;
    const msg = String(err.message || err).split('\n')[0].slice(0, 300);
    throw new ConversionError(`This ${format.toUpperCase()} file is not valid: ${msg}`);
  }
}

export function writeData(data, to, opts = {}, note = () => {}) {
  const indentStr = opts.indent === 'tab' ? '\t' : opts.indent === 'min' ? '' : ' '.repeat(Number(opts.indent || 2));
  switch (to) {
    case 'json':
      return JSON.stringify(data, null, indentStr) + '\n';
    case 'yaml':
      return yaml.dump(data, { lineWidth: -1, noRefs: true, indent: Number(opts.indent) > 0 ? Number(opts.indent) : 2 });
    case 'xml':
      return toXml(data, indentStr) + '\n';
    case 'toml': {
      let d = data;
      if (Array.isArray(d) || !d || typeof d !== 'object') {
        d = { items: Array.isArray(d) ? d : [d] };
        note('TOML requires a table at the top level, so the data was placed under "items".');
      }
      const counter = { n: 0 };
      d = stripNulls(d, counter);
      if (counter.n) note(`TOML has no null value, so ${counter.n} empty value${counter.n > 1 ? 's were' : ' was'} omitted.`);
      return stringifyToml(d) + '\n';
    }
    case 'csv':
      return dataToDelimited(data, ',', opts);
    case 'tsv':
      return dataToDelimited(data, '\t', opts);
    default:
      throw new Error(`Unsupported data format ${to}`);
  }
}

export default {
  id: 'data',
  label: 'Data converter',
  engines: [],
  weight: 'light',
  priority: 20,
  routes: [{ from: DATA, to: DATA }],
  options(from, to) {
    const opts = [];
    if ((from === 'csv' || from === 'tsv') && !['csv', 'tsv'].includes(to)) {
      opts.push({ key: 'header', label: 'First row contains column names', type: 'toggle', default: true });
      opts.push({ key: 'infer', label: 'Detect numbers and true/false', type: 'toggle', default: true, help: 'Values like 007 or long IDs always stay text.' });
    }
    if (['json', 'yaml', 'xml'].includes(to)) {
      opts.push({ key: 'indent', label: 'Indentation', type: 'select', default: '2', choices: [{ value: '2', label: '2 spaces' }, { value: '4', label: '4 spaces' }, ...(to !== 'yaml' ? [{ value: 'tab', label: 'Tabs' }, { value: 'min', label: 'Minified' }] : [])] });
    }
    if (to === 'csv') opts.push({ key: 'bom', label: 'Excel-compatible (UTF-8 BOM)', type: 'toggle', default: false, help: 'Makes Excel open accented and non-Latin characters correctly.' });
    return opts;
  },
  quality(from, to) {
    if (to === 'csv' || to === 'tsv') return { level: 'high', message: 'Nested objects are flattened into columns (e.g. address.city); lists of values are joined.' };
    if (from === 'xml') return { level: 'high', message: 'Elements become keys; attributes are kept with an "@_" prefix.' };
    if (to === 'toml') return { level: 'high', message: 'All values are kept except nulls, which TOML cannot represent.' };
    return { level: 'lossless', message: 'All data is preserved.' };
  },
  async run(ctx) {
    const delimited = { csv: ',', tsv: '\t' };
    if (delimited[ctx.input.format] && delimited[ctx.to]) {
      // CSV ↔ TSV: re-delimit rows verbatim — no type inference, nothing changes but the separator.
      const text = (await fs.readFile(ctx.input.path, 'utf8')).replace(/^﻿/, '');
      const sep = delimited[ctx.to];
      const esc = (s) => (s.includes(sep) || s.includes('"') || s.includes('\n') || s.includes('\r') ? `"${s.replace(/"/g, '""')}"` : s);
      const rows = parseDelimited(text, delimited[ctx.input.format]);
      const out = ctx.outFile(ctx.to);
      await fs.writeFile(out, (ctx.options.bom ? '﻿' : '') + rows.map((r) => r.map(esc).join(sep)).join('\r\n') + '\r\n', 'utf8');
      return [out];
    }
    const data = await readData(ctx.input.path, ctx.input.format, { header: ctx.options.header !== false, infer: ctx.options.infer !== false });
    const text = writeData(data, ctx.to, ctx.options, (n) => ctx.note(n));
    const out = ctx.outFile(ctx.to);
    await fs.writeFile(out, text, 'utf8');
    return [out];
  },
};
