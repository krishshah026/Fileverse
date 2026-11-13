import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { detectEngines } from '../engines/available.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';
import { expandPages } from '../registry/options.js';
import { probePdf } from '../detect/inspect.js';
import { ocrPdf, ocrLanguageChoices } from '../converters/pdf.js';
import { imagesToPdf, pageSizeOptions, IMAGE_IN } from '../converters/image.js';

const qpdf = (args, ctx, friendly) => run(detectEngines().qpdf, args, { signal: ctx.signal, allowedCodes: [0, 3], friendly });

async function pageCount(file) {
  const info = await probePdf(file);
  if (info?.requiresPassword) throw new ConversionError('This PDF is password protected. Unlock it first with the "Unlock PDF" tool.');
  if (!info?.pages) throw new ConversionError('This PDF could not be read. It may be damaged.');
  return info.pages;
}

const rangeString = (pages) => pages.join(',');

async function finalizeSmaller(original, candidate, out, ctx) {
  const [a, b] = await Promise.all([fs.stat(original), fs.stat(candidate)]);
  if (b.size >= a.size * 0.99) {
    await fs.copyFile(original, out);
    ctx.note('This PDF is already well optimised — compressing it further would not make it smaller, so the original was kept.');
  } else {
    await fs.rename(candidate, out);
  }
}

export const pdfTools = [
  {
    id: 'pdf-merge',
    title: 'Merge PDF',
    description: 'Combine several PDFs — or Word, PowerPoint, Excel and image files — into one PDF, in the order you choose.',
    category: 'pdf',
    icon: 'merge',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], convertTo: 'pdf', min: 2, max: 200 },
    output: 'pdf',
    options: () => [],
    async run(ctx) {
      const files = ctx.inputs.map((i) => i.path);
      for (const f of files) await pageCount(f);
      const out = ctx.outFile('pdf', { name: 'merged' });
      await qpdf(['--empty', '--pages', ...files, '--', out], ctx, 'The PDFs could not be merged.');
      return [out];
    },
  },
  {
    id: 'pdf-split',
    title: 'Split PDF',
    description: 'Split a PDF into single pages, fixed-size chunks or custom page ranges.',
    category: 'pdf',
    icon: 'split',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [
      { key: 'mode', label: 'Split into', type: 'select', default: 'every', choices: [{ value: 'every', label: 'Every page as its own PDF' }, { value: 'chunks', label: 'Chunks of N pages' }, { value: 'ranges', label: 'Custom ranges' }] },
      { key: 'chunk', label: 'Pages per file', type: 'number', default: 5, min: 1, max: 10000, showIf: { mode: ['chunks'] } },
      { key: 'ranges', label: 'Ranges (one file per range)', type: 'text', placeholder: '1-3; 4-10; 11-end', showIf: { mode: ['ranges'] }, help: 'Separate ranges with semicolons. Each range becomes one PDF.' },
    ],
    async run(ctx) {
      const src = ctx.inputs[0];
      const total = await pageCount(src.path);
      const groups = [];
      if (ctx.options.mode === 'ranges') {
        const parts = String(ctx.options.ranges || '').split(';').map((s) => s.trim()).filter(Boolean);
        if (!parts.length) throw new ConversionError('Enter at least one page range, e.g. 1-3; 4-10.');
        for (const p of parts) groups.push(expandPages(p, total));
      } else {
        const size = ctx.options.mode === 'chunks' ? Number(ctx.options.chunk || 5) : 1;
        for (let p = 1; p <= total; p += size) groups.push(Array.from({ length: Math.min(size, total - p + 1) }, (_, k) => p + k));
      }
      const outs = [];
      for (const [i, g] of groups.entries()) {
        const label = g.length === 1 ? `page ${g[0]}` : `pages ${g[0]}-${g[g.length - 1]}`;
        const out = ctx.outFile('pdf', { suffix: ` - ${label}` });
        await qpdf([src.path, '--pages', '.', rangeString(g), '--', out], ctx, 'The PDF could not be split.');
        outs.push(out);
        ctx.progress((i + 1) / groups.length);
      }
      return outs;
    },
  },
  {
    id: 'pdf-extract',
    title: 'Extract pages',
    description: 'Create a new PDF containing only the pages you pick.',
    category: 'pdf',
    icon: 'extract',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [{ key: 'pages', label: 'Pages to extract', type: 'pages', required: true, placeholder: '1-3, 5, 8-end' }],
    async run(ctx) {
      const src = ctx.inputs[0];
      const pages = expandPages(ctx.options.pages, await pageCount(src.path));
      const out = ctx.outFile('pdf', { suffix: ' (extracted)' });
      await qpdf([src.path, '--pages', '.', rangeString(pages), '--', out], ctx);
      return [out];
    },
  },
  {
    id: 'pdf-remove-pages',
    title: 'Remove pages',
    description: 'Delete unwanted pages from a PDF.',
    category: 'pdf',
    icon: 'remove',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [{ key: 'pages', label: 'Pages to remove', type: 'pages', required: true, placeholder: '2, 4-6' }],
    async run(ctx) {
      const src = ctx.inputs[0];
      const total = await pageCount(src.path);
      const remove = new Set(expandPages(ctx.options.pages, total));
      const keep = Array.from({ length: total }, (_, i) => i + 1).filter((p) => !remove.has(p));
      if (!keep.length) throw new ConversionError('You cannot remove every page.');
      const out = ctx.outFile('pdf');
      await qpdf([src.path, '--pages', '.', rangeString(keep), '--', out], ctx);
      return [out];
    },
  },
  {
    id: 'pdf-rotate',
    title: 'Rotate PDF',
    description: 'Rotate all or some pages of a PDF, losslessly.',
    category: 'pdf',
    icon: 'rotate',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [
      { key: 'angle', label: 'Rotation', type: 'select', default: '90', choices: [{ value: '90', label: '90° clockwise' }, { value: '180', label: '180°' }, { value: '270', label: '90° counter-clockwise' }] },
      { key: 'pages', label: 'Pages', type: 'pages', placeholder: 'All pages' },
    ],
    async run(ctx) {
      const src = ctx.inputs[0];
      const total = await pageCount(src.path);
      const range = ctx.options.pages ? rangeString(expandPages(ctx.options.pages, total)) : '1-z';
      const out = ctx.outFile('pdf');
      await qpdf([src.path, `--rotate=+${ctx.options.angle || 90}:${range}`, out], ctx);
      return [out];
    },
  },
  {
    id: 'pdf-compress',
    title: 'Compress PDF',
    description: 'Reduce PDF file size while keeping it readable. Choose how much quality to trade for size.',
    category: 'pdf',
    icon: 'compress',
    engines: ['qpdf', 'gs'],
    weight: 'heavy',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    batch: true,
    output: 'pdf',
    options: () => [
      {
        key: 'level',
        label: 'Compression level',
        type: 'select',
        default: 'recommended',
        choices: [
          { value: 'lossless', label: 'Lossless', hint: 'Restructures and recompresses the file without touching image quality.' },
          { value: 'high', label: 'High quality', hint: 'Images kept at 300 DPI — suitable for printing.' },
          { value: 'recommended', label: 'Recommended', hint: 'Images at 150 DPI — great on screen, much smaller.' },
          { value: 'strong', label: 'Maximum compression', hint: 'Images at 72 DPI — smallest file, for previews and email.' },
        ],
      },
      { key: 'grayscale', label: 'Convert to greyscale', type: 'toggle', default: false },
    ],
    quality: (opts) => (opts?.level === 'lossless' ? { level: 'lossless', message: 'Lossless: content and image quality are unchanged.' } : { level: 'lossy', message: 'Images are downsampled and recompressed; text and vector graphics stay sharp.' }),
    async run(ctx) {
      const src = ctx.inputs[0];
      const total = await pageCount(src.path);
      const e = detectEngines();
      const tmp = path.join(ctx.workDir, 'compressed.pdf');
      const out = ctx.outFile('pdf', { suffix: ' (compressed)' });
      if (ctx.options.level === 'lossless' && !ctx.options.grayscale) {
        await qpdf([src.path, '--object-streams=generate', '--compress-streams=y', '--recompress-flate', '--compression-level=9', '--remove-unreferenced-resources=yes', tmp], ctx);
        await finalizeSmaller(src.path, tmp, out, ctx);
        return [out];
      }
      const preset = { high: '/printer', recommended: '/ebook', strong: '/screen', lossless: '/default' }[ctx.options.level || 'recommended'];
      const args = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.6', `-dPDFSETTINGS=${preset}`, '-dNOPAUSE', '-dBATCH', '-dSAFER', '-dDetectDuplicateImages=true', '-dCompressFonts=true', '-dSubsetFonts=true', '-dAutoRotatePages=/None'];
      if (ctx.options.grayscale) args.push('-sColorConversionStrategy=Gray', '-dProcessColorModel=/DeviceGray');
      await run(e.gs, [...args, `-sOutputFile=${tmp}`, src.path], {
        signal: ctx.signal,
        onStdoutLine: (line) => {
          const m = /^Page (\d+)/.exec(line);
          if (m) ctx.progress(Math.min(0.97, Number(m[1]) / total));
        },
        friendly: 'The PDF could not be compressed.',
      });
      // Linearize ("fast web view") and pack object streams — lossless extra savings.
      const tmp2 = path.join(ctx.workDir, 'compressed2.pdf');
      await qpdf([tmp, '--object-streams=generate', '--linearize', tmp2], ctx).then(() => fs.rename(tmp2, tmp)).catch(() => {});
      if (ctx.options.grayscale) await fs.rename(tmp, out);
      else await finalizeSmaller(src.path, tmp, out, ctx);
      return [out];
    },
  },
  {
    id: 'pdf-protect',
    title: 'Protect PDF',
    description: 'Encrypt a PDF with a password (AES-256).',
    category: 'pdf',
    icon: 'lock',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [
      { key: 'password', label: 'Password', type: 'password', required: true, secret: true, maxLength: 127 },
      { key: 'allowPrint', label: 'Allow printing', type: 'toggle', default: true },
      { key: 'allowCopy', label: 'Allow copying text', type: 'toggle', default: true },
      { key: 'allowEdit', label: 'Allow editing', type: 'toggle', default: false },
    ],
    async run(ctx) {
      const src = ctx.inputs[0];
      await pageCount(src.path);
      const owner = crypto.randomBytes(24).toString('base64url');
      const out = ctx.outFile('pdf', { suffix: ' (protected)' });
      const restrictions = [`--print=${ctx.options.allowPrint === false ? 'none' : 'full'}`, `--extract=${ctx.options.allowCopy === false ? 'n' : 'y'}`, `--modify=${ctx.options.allowEdit ? 'all' : 'none'}`];
      await qpdf(['--encrypt', ctx.options.password, owner, '256', ...restrictions, '--', src.path, out], ctx);
      return [out];
    },
  },
  {
    id: 'pdf-unlock',
    title: 'Unlock PDF',
    description: 'Remove the password and restrictions from a PDF you have the password for.',
    category: 'pdf',
    icon: 'unlock',
    engines: ['qpdf'],
    weight: 'light',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [{ key: 'password', label: 'Current password', type: 'password', secret: true, help: 'Leave empty if the PDF opens without a password but has restrictions.' }],
    async run(ctx) {
      const src = ctx.inputs[0];
      const out = ctx.outFile('pdf', { suffix: ' (unlocked)' });
      const r = await run(detectEngines().qpdf, ['--decrypt', `--password=${ctx.options.password || ''}`, src.path, out], { signal: ctx.signal, allowedCodes: [0, 2, 3] });
      if (r.code === 2) throw new ConversionError(ctx.options.password ? 'The password is incorrect.' : 'This PDF needs its password to be unlocked.', { code: 'password' });
      return [out];
    },
  },
  {
    id: 'pdf-ocr',
    title: 'OCR PDF',
    description: 'Make scanned PDFs searchable and selectable by recognising their text.',
    category: 'pdf',
    icon: 'ocr',
    engines: ['ocrmypdf', 'tesseract'],
    weight: 'heavy',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    batch: true,
    output: 'pdf',
    options: async () => [
      { key: 'lang', label: 'Document language', type: 'select', default: 'eng', choices: await ocrLanguageChoices() },
      { key: 'mode', label: 'Pages that already have text', type: 'select', default: 'skip', choices: [{ value: 'skip', label: 'Leave them as they are' }, { value: 'redo', label: 'Redo OCR on them' }, { value: 'force', label: 'Rasterise and OCR everything' }] },
    ],
    async run(ctx) {
      const out = ctx.outFile('pdf', { suffix: ' (OCR)' });
      await ocrPdf(ctx.inputs[0].path, out, ctx, { lang: ctx.options.lang, mode: ctx.options.mode });
      return [out];
    },
  },
  {
    id: 'pdf-to-pdfa',
    title: 'PDF to PDF/A',
    description: 'Convert a PDF to PDF/A-2b for long-term archiving.',
    category: 'pdf',
    icon: 'archive',
    engines: ['ocrmypdf', 'gs'],
    weight: 'heavy',
    inputs: { formats: ['pdf'], min: 1, max: 1 },
    output: 'pdf',
    options: () => [],
    async run(ctx) {
      const out = ctx.outFile('pdf', { suffix: ' (PDF-A)' });
      // --tesseract-timeout 0 disables OCR: ocrmypdf only performs its robust PDF/A conversion.
      await run(detectEngines().ocrmypdf, ['--skip-text', '--tesseract-timeout', '0', '--output-type', 'pdfa-2', ctx.inputs[0].path, out], { signal: ctx.signal, allowedCodes: [0, 6, 10], friendly: 'The PDF could not be converted to PDF/A.' });
      return [out];
    },
  },
  {
    id: 'images-to-pdf',
    title: 'Images to PDF',
    description: 'Combine JPG, PNG, HEIC, WEBP and other images into one PDF — JPGs are embedded without recompression.',
    category: 'pdf',
    icon: 'images',
    engines: ['py.img2pdf'],
    weight: 'light',
    inputs: { formats: IMAGE_IN, min: 1, max: 500 },
    output: 'pdf',
    options: () => pageSizeOptions,
    async run(ctx) {
      const out = ctx.outFile('pdf', { name: ctx.inputs.length > 1 ? 'images' : undefined });
      await imagesToPdf(ctx, ctx.inputs, ctx.options, out);
      return [out];
    },
  },
];
