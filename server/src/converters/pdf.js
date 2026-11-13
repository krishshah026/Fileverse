import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectEngines } from '../engines/available.js';
import { soffice } from '../engines/libreoffice.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';
import { expandPages } from '../registry/options.js';
import { probePdf } from '../detect/inspect.js';

export const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');

/** Runs one of our python helpers, translating "PROGRESS a b" / "NOTE text" lines. */
export async function python(script, args, ctx, { weight = 1, offset = 0 } = {}) {
  const e = detectEngines();
  return run(e.python, [path.join(SCRIPTS, script), ...args], {
    signal: ctx.signal,
    env: { PYTHONUNBUFFERED: '1', PYTHONWARNINGS: 'ignore' },
    onStdoutLine: (line) => {
      const p = /^PROGRESS (\d+) (\d+)/.exec(line);
      if (p) ctx.progress?.(offset + (Number(p[1]) / Number(p[2])) * weight);
      const n = /^NOTE (.+)/.exec(line);
      if (n) ctx.note?.(n[1]);
    },
    friendly: 'The PDF could not be converted.',
  });
}

/** Makes a searchable copy of a scanned PDF with OCR (ocrmypdf + tesseract). */
export async function ocrPdf(input, out, ctx, { lang = 'eng', mode = 'skip', sidecar } = {}) {
  const e = detectEngines();
  const args = ['--output-type', 'pdf', '--optimize', '1', '-l', lang, '--jobs', String(Math.max(1, Math.min(4, os.cpus().length)))];
  if (sidecar) args.push('--sidecar', sidecar);
  args.push(mode === 'force' ? '--force-ocr' : mode === 'redo' ? '--redo-ocr' : '--skip-text');
  const r = await run(e.ocrmypdf, [...args, input, out], {
    signal: ctx.signal,
    allowedCodes: [0, 6, 10],
    onStderrLine: (line) => {
      const m = /(\d+)\/(\d+)/.exec(line);
      if (m && /OCR|page/i.test(line)) ctx.progress?.(Math.min(0.95, Number(m[1]) / Number(m[2])));
    },
    friendly: 'Text recognition (OCR) failed.',
  });
  if (r.code === 6) ctx.note('This PDF already contains text, so OCR was skipped.');
  return out;
}

export const OCR_LANGUAGES = [
  ['eng', 'English'], ['hin', 'Hindi'], ['deu', 'German'], ['fra', 'French'], ['spa', 'Spanish'], ['ita', 'Italian'], ['por', 'Portuguese'],
  ['nld', 'Dutch'], ['ara', 'Arabic'], ['chi_sim', 'Chinese (Simplified)'], ['chi_tra', 'Chinese (Traditional)'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['rus', 'Russian'],
];

export async function ocrLanguageChoices() {
  const e = detectEngines();
  let installed = null;
  try {
    const { stdout, stderr } = await run(e.tesseract, ['--list-langs']);
    installed = new Set(`${stdout}\n${stderr}`.split('\n').map((s) => s.trim()));
  } catch {
    installed = new Set(['eng']);
  }
  return OCR_LANGUAGES.filter(([code]) => installed.has(code)).map(([value, label]) => ({ value, label }));
}

const IMAGE_DEVICES = { png: ['-png'], jpg: ['-jpeg', '-jpegopt', 'quality=95,optimize=y'], tiff: ['-tiff', '-tiffcompression', 'lzw'] };

async function renderPages(ctx, input, to, { dpi = 200, pages, outDir, prefix = 'page' }) {
  const e = detectEngines();
  const info = ctx.info?.pdf || (await probePdf(input));
  const total = info?.pages || 1;
  const list = pages ? expandPages(pages, total) : null;
  await fs.mkdir(outDir, { recursive: true });
  const ranges = list ? toRanges(list) : [[1, total]];
  let done = 0;
  const count = list ? list.length : total;
  for (const [a, b] of ranges) {
    await run(e.pdftoppm, [...IMAGE_DEVICES[to], '-r', String(dpi), '-f', String(a), '-l', String(b), '-progress', input, path.join(outDir, prefix)], {
      signal: ctx.signal,
      onStderrLine: (line) => {
        if (/^\d+ \d+ /.test(line)) ctx.progress?.(Math.min(0.99, ++done / count));
      },
      friendly: 'The PDF pages could not be rendered.',
    });
  }
  return (await fs.readdir(outDir)).filter((f) => f.startsWith(prefix)).sort().map((f) => path.join(outDir, f));
}

function toRanges(list) {
  const out = [];
  for (const p of list) {
    const last = out[out.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else out.push([p, p]);
  }
  return out;
}

const ocrOption = (info) =>
  info?.pdf?.hasText === false
    ? [{ key: 'ocr', label: 'Recognise text (OCR)', type: 'toggle', default: true, help: 'This PDF looks scanned (no selectable text). OCR makes the text editable.' }]
    : [{ key: 'ocr', label: 'Run OCR first (for scanned pages)', type: 'toggle', default: false }];

export default {
  id: 'pdf',
  label: 'PDF converter',
  engines: ['qpdf'],
  weight: 'heavy',
  priority: 10,
  routes: [
    { from: ['pdf'], to: ['docx'], engines: ['py.pdf2docx'] },
    { from: ['pdf'], to: ['txt'], engines: ['pdftotext'] },
    { from: ['pdf'], to: ['png', 'jpg', 'tiff'], engines: ['pdftoppm'] },
    { from: ['pdf'], to: ['pptx'], engines: ['soffice', 'pdftoppm', 'py.pptx'] },
    { from: ['pdf'], to: ['xlsx'], engines: ['py.pdfplumber', 'py.openpyxl'] },
  ],
  async options(from, to, info) {
    const opts = [];
    if (info?.pdf?.encrypted) opts.push({ key: 'password', label: 'PDF password', type: 'password', secret: true, required: Boolean(info.pdf.requiresPassword) });
    if (to === 'docx' || to === 'txt' || to === 'xlsx') {
      if (detectEngines().ocrmypdf) {
        opts.push(...ocrOption(info));
        const langs = await ocrLanguageChoices();
        if (langs.length > 1) opts.push({ key: 'ocrLang', label: 'Document language', type: 'select', default: 'eng', choices: langs, showIf: { ocr: [true] } });
      }
    }
    if (to === 'txt') opts.push({ key: 'layout', label: 'Text layout', type: 'select', default: 'reading', choices: [{ value: 'reading', label: 'Reading order (best for copying)' }, { value: 'layout', label: 'Keep physical layout (columns, tables)' }] });
    if (['png', 'jpg', 'tiff'].includes(to)) {
      opts.push({ key: 'dpi', label: 'Resolution', type: 'select', default: '200', choices: [{ value: '72', label: '72 DPI (screen, small)' }, { value: '150', label: '150 DPI' }, { value: '200', label: '200 DPI (sharp)' }, { value: '300', label: '300 DPI (print)' }, { value: '600', label: '600 DPI (archival)' }] });
    }
    if (['png', 'jpg', 'tiff', 'xlsx'].includes(to)) opts.push({ key: 'pages', label: 'Pages', type: 'pages', placeholder: 'All pages, or e.g. 1-3, 5' });
    if (to === 'pptx') {
      opts.push({ key: 'mode', label: 'Conversion mode', type: 'select', default: 'editable', choices: [{ value: 'editable', label: 'Editable text and shapes' }, { value: 'exact', label: 'Exact look (each page as a picture)' }] });
    }
    return opts;
  },
  quality(from, to, info) {
    const scanned = info?.pdf?.hasText === false;
    switch (to) {
      case 'docx':
        return { level: 'high', message: scanned ? 'This PDF is scanned: OCR turns the page images into editable text. Accuracy depends on scan quality.' : 'Paragraphs, tables, images and columns are reconstructed as editable Word content. Very complex layouts may need small touch-ups.' };
      case 'txt':
        return { level: 'lossy', message: 'Extracts the text only — no images or formatting.' };
      case 'pptx':
        return { level: 'high', message: 'Editable mode recreates text boxes and shapes; Exact mode keeps the look pixel-perfect as pictures.' };
      case 'xlsx':
        return { level: 'high', message: 'Tables are detected on each page and placed into sheets; numbers become real numbers.' };
      default:
        return { level: 'high', message: 'Each page is rendered at the chosen resolution. Multiple pages produce multiple images.' };
    }
  },
  async run(ctx) {
    let input = ctx.input.path;
    const e = detectEngines();
    // Decrypt first if a password was given (qpdf, lossless).
    if (ctx.options.password || ctx.info?.pdf?.encrypted) {
      const dec = path.join(ctx.workDir, 'decrypted.pdf');
      try {
        await run(e.qpdf, ['--decrypt', `--password=${ctx.options.password || ''}`, input, dec], { signal: ctx.signal, allowedCodes: [0, 3] });
        input = dec;
      } catch {
        throw new ConversionError('The PDF password is incorrect.', { code: 'password' });
      }
    }
    let sidecar = null;
    if (ctx.options.ocr && e.ocrmypdf) {
      const ocr = path.join(ctx.workDir, 'ocr.pdf');
      sidecar = path.join(ctx.workDir, 'ocr.txt');
      ctx.stage?.('Recognising text (OCR)');
      await ocrPdf(input, ocr, { ...ctx, progress: (f) => ctx.progress(f * 0.6) }, { lang: ctx.options.ocrLang || 'eng', mode: 'skip', sidecar });
      input = ocr;
      ctx.stage?.('Converting');
    }
    const base = ctx.options.ocr ? 0.6 : 0;
    const scaled = { ...ctx, progress: (f) => ctx.progress(base + f * (1 - base)) };
    const to = ctx.to;
    if (to === 'docx') {
      const out = ctx.outFile('docx');
      // Fully scanned PDFs: OCR text lives in an invisible layer that layout converters skip,
      // so the recognised text itself becomes the editable document.
      const scannedOnly = ctx.info?.pdf?.hasText === false || (sidecar && (await probePdf(ctx.input.path))?.hasText === false);
      if (sidecar && scannedOnly) {
        await python('text_to_docx.py', [sidecar, out], scaled);
        ctx.note('The text was recognised with OCR and placed in an editable Word document. Check names and numbers — OCR accuracy depends on the scan quality.');
      } else {
        await python('pdf_to_docx.py', [input, out], scaled);
      }
      return [out];
    }
    if (to === 'txt') {
      const out = ctx.outFile('txt');
      await run(e.pdftotext, [...(ctx.options.layout === 'layout' ? ['-layout'] : []), '-enc', 'UTF-8', input, out], { signal: ctx.signal, friendly: 'Could not extract text from this PDF.' });
      const st = await fs.stat(out);
      if (st.size < 5) ctx.note('No text was found. This PDF is probably scanned — enable OCR to recognise the text.');
      return [out];
    }
    if (to === 'xlsx') {
      const out = ctx.outFile('xlsx');
      const info = await probePdf(input);
      const pages = ctx.options.pages ? expandPages(ctx.options.pages, info?.pages || 1).join(',') : 'all';
      await python('pdf_to_xlsx.py', [input, out, pages], scaled);
      return [out];
    }
    if (['png', 'jpg', 'tiff'].includes(to)) {
      const files = await renderPages(scaled, input, to, { dpi: Number(ctx.options.dpi || 200), pages: ctx.options.pages, outDir: path.join(ctx.workDir, 'pages') });
      if (files.length === 1) {
        const out = ctx.outFile(to);
        await fs.rename(files[0], out);
        return [out];
      }
      const outs = [];
      for (const f of files) {
        const n = /-(\d+)\.[a-z]+$/i.exec(f)?.[1] ?? String(outs.length + 1);
        const out = ctx.outFile(to, { suffix: ` - page ${Number(n)}` });
        await fs.rename(f, out);
        outs.push(out);
      }
      return outs;
    }
    if (to === 'pptx') {
      const out = ctx.outFile('pptx');
      if (ctx.options.mode === 'exact') {
        const files = await renderPages({ ...scaled, progress: (f) => scaled.progress(f * 0.7) }, input, 'png', { dpi: 200, outDir: path.join(ctx.workDir, 'slides') });
        await python('images_to_pptx.py', [out, ...files], { ...scaled, progress: (f) => scaled.progress(0.7 + f * 0.3) });
        return [out];
      }
      const named = path.join(ctx.workDir, 'deck.pdf');
      await fs.copyFile(input, named);
      const produced = await soffice(named, 'pptx:Impress MS PowerPoint 2007 XML', path.join(ctx.workDir, 'lo-out'), { infilter: 'impress_pdf_import', signal: ctx.signal });
      await fs.rename(produced[0], out);
      return [out];
    }
    throw new ConversionError(`PDF to ${to.toUpperCase()} is not supported.`);
  },
};

export { renderPages };
