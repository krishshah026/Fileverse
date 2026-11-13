import fs from 'node:fs/promises';
import { fileTypeFromFile } from 'file-type';
import { formatFromName, getFormat } from '../registry/formats.js';

/** Maps file-type's extension names to catalog ids. */
const MAGIC_MAP = {
  jpg: 'jpg', png: 'png', apng: 'png', webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp', tif: 'tiff',
  ico: 'ico', cur: 'ico', heic: 'heic', psd: 'psd',
  mp4: 'mp4', m4v: 'm4v', mov: 'mov', qt: 'mov', mkv: 'mkv', webm: 'webm', avi: 'avi', asf: 'wmv', wmv: 'wmv',
  flv: 'flv', mpg: 'mpeg', mts: 'ts', '3gp': '3gp', '3g2': '3gp', ogv: 'ogv',
  mp3: 'mp3', wav: 'wav', flac: 'flac', aac: 'aac', m4a: 'm4a', ogg: 'ogg', oga: 'ogg', opus: 'opus', wma: 'wma',
  aif: 'aiff', ac3: 'ac3', amr: 'amr',
  pdf: 'pdf', docx: 'docx', xlsx: 'xlsx', pptx: 'pptx', odt: 'odt', ods: 'ods', odp: 'odp', rtf: 'rtf',
  epub: 'epub', mobi: 'mobi', zip: 'zip', '7z': '7z', tar: 'tar', gz: 'gz', bz2: 'bz2', xz: 'xz', rar: 'rar',
  iso: 'iso', ttf: 'ttf', otf: 'otf', woff: 'woff', woff2: 'woff2', xml: 'xml', cfb: 'cfb', svg: 'svg',
};

/**
 * Formats sharing a physical container. If the extension and the magic bytes agree on the family,
 * the (more specific) extension wins — e.g. a .m4a is ISO-BMFF exactly like an .mp4.
 */
const FAMILIES = [
  ['mp4', 'm4v', 'mov', 'm4a', '3gp', 'aac'],
  ['ogg', 'opus', 'ogv'],
  ['mkv', 'webm'],
  ['zip', 'docx', 'xlsx', 'pptx', 'ppsx', 'odt', 'ods', 'odp', 'epub', 'cbz', 'pages', 'numbers', 'key'],
  ['cfb', 'doc', 'xls', 'ppt'],
  ['gz', 'tar.gz'],
  ['bz2', 'tar.bz2'],
  ['xz', 'tar.xz'],
  ['rar', 'cbr'],
  ['wmv', 'wma'],
  ['mpeg', 'ts'],
  ['mobi', 'azw3'],
  ['xml', 'svg', 'fb2', 'html'],
  ['tar'],
];
const TEXT_FORMATS = new Set(['txt', 'csv', 'tsv', 'json', 'yaml', 'xml', 'toml', 'srt', 'vtt', 'ass', 'ssa', 'lrc', 'md', 'html', 'svg', 'fb2', 'rtf']);

function sameFamily(a, b) {
  if (a === b) return true;
  return FAMILIES.some((fam) => fam.includes(a) && fam.includes(b));
}

/** Content sniffing for text formats without magic numbers. */
export function sniffText(buf) {
  if (!buf.length) return null;
  // Binary data contains NUL bytes; text (UTF-8/Latin-1) does not.
  const sample = buf.subarray(0, Math.min(buf.length, 8192));
  if (sample.includes(0) && !(sample[0] === 0xff && sample[1] === 0xfe) && !(sample[0] === 0xfe && sample[1] === 0xff)) return null;
  const s = sample.toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^\{\\rtf/.test(s)) return 'rtf';
  if (/^WEBVTT/.test(s)) return 'vtt';
  if (/^\[Script Info\]/i.test(s)) return /ScriptType:\s*v4\.00\+/i.test(s) ? 'ass' : 'ssa';
  if (/^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(s)) return 'srt';
  if (/^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) || /^<svg[\s>]/i.test(s)) return 'svg';
  if (/<FictionBook[\s>]/.test(s.slice(0, 2000))) return 'fb2';
  if (/^<!doctype html|^<html[\s>]/i.test(s)) return 'html';
  if (/^<\?xml|^<[A-Za-z_][\w.-]*[\s>/]/.test(s)) return 'xml';
  if (/^[[{]/.test(s)) {
    try {
      JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
      return 'json';
    } catch {
      /* fallthrough: maybe truncated sample */
      if (buf.length > sample.length) return 'json';
    }
  }
  if (/^\[(ar|ti|al|by|length|offset|\d{1,2}:\d{2})/.test(s)) return 'lrc';
  return 'txt';
}

/**
 * Detects the true format of a file.
 * Returns { format, byExtension, byContent, mismatch, note }.
 */
export async function detectFormat(filePath, originalName) {
  const byExtension = formatFromName(originalName);
  let byContent = null;
  try {
    const ft = await fileTypeFromFile(filePath);
    if (ft) byContent = MAGIC_MAP[ft.ext] || null;
  } catch {
    byContent = null;
  }

  if (!byContent) {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(16384);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      const head = buf.subarray(0, bytesRead);
      if (byExtension && TEXT_FORMATS.has(byExtension) && sniffText(head)) {
        return { format: byExtension, byExtension, byContent: 'text', mismatch: false };
      }
      const sniffed = sniffText(head);
      if (sniffed) byContent = sniffed;
      // MPEG-TS: sync byte 0x47 every 188 bytes
      else if (head.length >= 376 && head[0] === 0x47 && head[188] === 0x47) byContent = 'ts';
      // TGA has no reliable magic; trust the extension.
    } finally {
      await fh.close();
    }
  }

  if (byExtension && byContent) {
    if (sameFamily(byExtension, byContent) || (TEXT_FORMATS.has(byExtension) && TEXT_FORMATS.has(byContent) && byContent === 'txt')) {
      return { format: byExtension, byExtension, byContent, mismatch: false };
    }
    // Legacy Office (OLE2) files share one container; only the extension tells doc/xls/ppt apart.
    if (byContent === 'cfb') return { format: byExtension, byExtension, byContent, mismatch: false };
    const fmt = getFormat(byContent);
    return {
      format: fmt ? byContent : byExtension,
      byExtension,
      byContent,
      mismatch: Boolean(fmt),
      note: fmt ? `This file is named .${getFormat(byExtension)?.ext[0] ?? byExtension} but its contents are actually ${fmt.name}. We'll treat it as ${fmt.name}.` : undefined,
    };
  }
  if (byContent === 'cfb') return { format: null, byExtension, byContent, mismatch: false, note: 'Legacy Office file without a recognisable extension. Rename it to .doc, .xls or .ppt.' };
  return { format: byContent || byExtension || null, byExtension, byContent, mismatch: false };
}
