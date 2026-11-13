import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { decodable, sharpInput, encode, preserveDepth, applyMetadata, magick, writeTga, LOSSLESS_SOURCES, SHARP_WRITES } from '../engines/image.js';
import { detectEngines } from '../engines/available.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';

const IMAGE_IN = ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico', 'svg', 'heic', 'tga', 'psd'];
const IMAGE_OUT = ['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'tiff', 'ico', 'tga'];
const DEFAULT_Q = { jpg: 92, webp: 90, avif: 75 };

export function imageQualityOptions(from, to, info) {
  const opts = [];
  const lossyCapable = ['jpg', 'webp', 'avif'].includes(to);
  if (to === 'webp' || to === 'avif') {
    opts.push({ key: 'lossless', label: 'Lossless', type: 'toggle', default: LOSSLESS_SOURCES.has(from), help: 'Pixel-perfect output. Recommended for screenshots, logos and graphics; photos become larger.' });
  }
  if (lossyCapable) {
    opts.push({ key: 'quality', label: 'Quality', type: 'range', min: 1, max: 100, step: 1, default: DEFAULT_Q[to], unit: '%', showIf: to === 'jpg' ? undefined : { lossless: [false] } });
  }
  if (to === 'jpg' && (info?.image?.hasAlpha || ['png', 'webp', 'gif', 'tiff', 'ico', 'svg', 'tga', 'psd', 'avif'].includes(from))) {
    opts.push({ key: 'background', label: 'Background for transparent areas', type: 'color', default: '#ffffff', help: 'JPG cannot store transparency.' });
  }
  if (to === 'png' && from !== 'png') {
    // nothing extra — PNG is lossless
  }
  if (to === 'ico') {
    opts.push({ key: 'icoSizes', label: 'Icon sizes', type: 'select', default: 'all', choices: [{ value: 'all', label: 'All standard sizes (16–256 px)' }, { value: '256', label: '256 px only' }, { value: '48', label: '48 px only' }, { value: '32', label: '32 px only' }, { value: '16', label: '16 px only' }] });
  }
  if (from === 'svg') {
    opts.push({ key: 'scale', label: 'Render scale', type: 'select', default: '1', choices: ['1', '2', '3', '4', '8'].map((v) => ({ value: v, label: `${v}× ${v === '1' ? '(native size)' : ''}`.trim() })), help: 'SVG is vector art: render it larger for sharp results on high-DPI screens or print.' });
  }
  if (!['ico', 'bmp', 'tga', 'gif'].includes(to)) {
    opts.push({ key: 'keepMetadata', label: 'Keep metadata (EXIF, colour profile)', type: 'toggle', default: true });
  }
  return opts;
}

/**
 * Core raster conversion. Shared by the convert route and the image tools.
 * `transform(pipeline, meta)` lets tools add resizing.
 */
export async function convertImage(ctx, { to, options, transform, outPath }) {
  const { input, workDir, signal } = ctx;
  const src = await decodable(input, workDir, signal);
  const density = input.format === 'svg' ? 72 * Number(options.scale || 1) : undefined;
  const probe = await sharp(src.path, { density, limitInputPixels: false, pages: 1 }).metadata().catch(() => null);
  if (!probe) throw new ConversionError('This image could not be read. It may be damaged or use an unsupported variant of the format.');
  const animatedOut = (to === 'webp' || to === 'gif') && (probe.pages || 1) > 1;
  if ((probe.pages || 1) > 1 && !animatedOut && ['gif', 'webp'].includes(src.format)) {
    ctx.note(`${to.toUpperCase()} cannot store animation, so the first frame was used.`);
  }
  let p = sharpInput(src.path, { animated: animatedOut, density });
  if (to !== 'gif' && to !== 'ico' && to !== 'bmp' && to !== 'tga') p = applyMetadata(p, options.keepMetadata !== false);
  else p = p.rotate();
  if (transform) p = await transform(p, probe);
  const lossless = options.lossless ?? (to === 'webp' || to === 'avif' ? LOSSLESS_SOURCES.has(input.format) : false);
  const opts = { quality: options.quality, lossless, background: options.background, palette: options.palette };

  const out = outPath || ctx.outFile(to);
  if (SHARP_WRITES.has(to)) {
    p = preserveDepth(p, to, probe);
    if (to === 'jpg' && probe.hasAlpha) ctx.note('JPG does not support transparency; transparent areas were filled with the background colour.');
    await encode(p, to, opts, probe).toFile(out);
    return out;
  }

  if (to === 'tga') return writeTga(p, out, probe.hasAlpha);
  // BMP / ICO: render a lossless PNG with sharp, then let ImageMagick write the target.
  const tmp = path.join(workDir, `stage-${Date.now()}.png`);
  if (to === 'ico') {
    const sizes = options.icoSizes && options.icoSizes !== 'all' ? [Number(options.icoSizes)] : [256, 128, 64, 48, 32, 24, 16];
    const max = Math.max(...sizes);
    await p.resize(max, max, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' }).png().toFile(tmp);
    await magick([tmp, '-define', `icon:auto-resize=${sizes.join(',')}`, `ico:${out}`], { signal });
    if (probe.width !== probe.height) ctx.note('Icons are square, so the image was centred on a transparent square canvas.');
  } else {
    await p.png().toFile(tmp);
    // BMP3 is the most compatible variant but has no alpha channel; keep transparency with BMP (v5) when present.
    const prefix = to === 'bmp' ? (probe.hasAlpha ? 'bmp' : 'bmp3') : to;
    await magick([tmp, `${prefix}:${out}`], { signal });
  }
  await fs.rm(tmp, { force: true });
  return out;
}

/** Single image → PDF page, embedded losslessly by img2pdf (JPEGs are not re-encoded at all). */
export async function imagesToPdf(ctx, inputs, options, outPath) {
  const e = detectEngines();
  const prepared = [];
  let i = 0;
  for (const input of inputs) {
    i++;
    const stepCtx = { ...ctx, input };
    if (input.format === 'jpg' || (input.format === 'png' && !(await sharp(input.path).metadata()).hasAlpha)) {
      prepared.push(input.path);
    } else {
      // img2pdf refuses transparency: flatten onto white losslessly (PNG).
      const out = path.join(ctx.workDir, `page-${String(i).padStart(4, '0')}.png`);
      await convertImage(stepCtx, { to: 'png', options: { keepMetadata: false }, outPath: out, transform: (p) => p.flatten({ background: '#ffffff' }) });
      prepared.push(out);
    }
    ctx.progress?.((i / inputs.length) * 0.8);
  }
  const args = ['--rotation=ifvalid', '-o', outPath];
  const size = options.pageSize || 'fit';
  if (size !== 'fit') {
    args.push('--pagesize', size === 'a4' ? 'A4' : size === 'letter' ? 'Letter' : 'A3', '--auto-orient', '--fit', 'into');
    if (options.margin && options.margin !== '0') args.push('--border', `${options.margin}mm`);
  }
  await run(e.python, ['-m', 'img2pdf', ...args, ...prepared], { signal: ctx.signal, friendly: 'Could not build the PDF from these images.' });
  return outPath;
}

export const pageSizeOptions = [
  { key: 'pageSize', label: 'Page size', type: 'select', default: 'fit', choices: [{ value: 'fit', label: 'Same as image' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }, { value: 'a3', label: 'A3' }] },
  { key: 'margin', label: 'Margin', type: 'select', default: '0', showIf: { pageSize: ['a4', 'letter', 'a3'] }, choices: [{ value: '0', label: 'None' }, { value: '10', label: 'Small (10 mm)' }, { value: '20', label: 'Large (20 mm)' }] },
];

export default {
  id: 'image',
  label: 'Image converter',
  engines: ['magick'],
  weight: 'light',
  routes: [
    { from: IMAGE_IN, to: IMAGE_OUT },
    { from: IMAGE_IN, to: ['pdf'], engines: ['py.img2pdf'] },
  ],
  priority: 10,
  options(from, to, info) {
    if (to === 'pdf') return pageSizeOptions;
    return imageQualityOptions(from, to, info);
  },
  quality(from, to, info, options = {}) {
    if (to === 'pdf') return { level: 'lossless', message: from === 'jpg' ? 'The JPG is embedded in the PDF as-is — no recompression at all.' : 'The image is embedded losslessly.' };
    const losslessOut = ['png', 'bmp', 'tiff', 'tga', 'ico'].includes(to) || ((to === 'webp' || to === 'avif') && (options.lossless ?? LOSSLESS_SOURCES.has(from)));
    if (to === 'gif') return { level: 'lossy', message: 'GIF is limited to 256 colours; photos will show some banding. Prefer WEBP or PNG.' };
    if (to === 'ico') return { level: 'high', message: 'Icons are generated at standard sizes (16–256 px) with high-quality resampling.' };
    if (from === 'svg') return { level: 'high', message: 'Vector art is rendered to pixels. Choose a larger scale for more detail.' };
    if (losslessOut) return { level: 'lossless', message: LOSSLESS_SOURCES.has(from) ? 'Lossless: every pixel is preserved.' : 'Stored losslessly — no further quality loss (the source was already compressed).' };
    return { level: 'high', message: `${to.toUpperCase()} is lossy. A high quality level (${options.quality ?? DEFAULT_Q[to]}%) is used by default; adjust it in settings.` };
  },
  async run(ctx) {
    if (ctx.to === 'pdf') return [await imagesToPdf(ctx, [ctx.input], ctx.options, ctx.outFile('pdf'))];
    return [await convertImage(ctx, { to: ctx.to, options: ctx.options })];
  },
};

export { IMAGE_IN, IMAGE_OUT };
