import fs from 'node:fs/promises';
import { convertImage, IMAGE_IN } from '../converters/image.js';
import { ConversionError } from '../util/errors.js';

const EDITABLE = IMAGE_IN.filter((f) => f !== 'svg');
const sameOrPng = (input) => (['heic', 'psd', 'svg'].includes(input.format) ? (input.format === 'heic' ? 'jpg' : 'png') : input.format);

export const imageTools = [
  {
    id: 'image-compress',
    title: 'Compress image',
    description: 'Make JPG, PNG, WEBP and AVIF images smaller with minimal visible difference.',
    category: 'image',
    icon: 'compress',
    engines: [],
    weight: 'light',
    inputs: { formats: ['jpg', 'png', 'webp', 'avif', 'gif', 'tiff', 'heic'], min: 1, max: 1 },
    batch: true,
    output: (input, options) => (options?.format && options.format !== 'same' ? options.format : input.format === 'heic' ? 'jpg' : input.format === 'tiff' ? 'jpg' : input.format),
    options: () => [
      { key: 'level', label: 'Compression', type: 'select', default: 'balanced', choices: [{ value: 'light', label: 'Light — visually lossless' }, { value: 'balanced', label: 'Balanced — recommended' }, { value: 'strong', label: 'Strong — smallest' }] },
      { key: 'format', label: 'Output format', type: 'select', default: 'same', choices: [{ value: 'same', label: 'Keep the same format' }, { value: 'webp', label: 'WEBP (usually 25–35% smaller)' }, { value: 'avif', label: 'AVIF (smallest, newer browsers)' }, { value: 'jpg', label: 'JPG' }] },
      { key: 'maxSide', label: 'Limit size (longest side)', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Keep dimensions' }, ...['3840', '2560', '1920', '1280', '1024', '800'].map((v) => ({ value: v, label: `${v} px` }))] },
      { key: 'stripMetadata', label: 'Remove metadata (EXIF, GPS location)', type: 'toggle', default: true },
    ],
    quality: (opts) => (opts?.level === 'light' ? { level: 'high', message: 'Visually lossless: differences are not visible at normal viewing.' } : { level: 'lossy', message: 'Lossy compression tuned to keep images looking clean.' }),
    async run(ctx) {
      const input = ctx.inputs[0];
      const to = ctx.toolOutput;
      const level = ctx.options.level || 'balanced';
      const q = { jpg: { light: 88, balanced: 78, strong: 62 }, webp: { light: 88, balanced: 78, strong: 60 }, avif: { light: 70, balanced: 58, strong: 45 } }[to]?.[level];
      const options = { quality: q, lossless: false, keepMetadata: !ctx.options.stripMetadata, palette: to === 'png' && level !== 'light', background: '#ffffff' };
      if (to === 'png') options.quality = { light: 100, balanced: 90, strong: 70 }[level];
      const out = ctx.outFile(to, { suffix: ' (compressed)' });
      const max = ctx.options.maxSide && ctx.options.maxSide !== 'original' ? Number(ctx.options.maxSide) : null;
      await convertImage({ ...ctx, input }, { to, options, outPath: out, transform: max ? (p) => p.resize(max, max, { fit: 'inside', withoutEnlargement: true, kernel: 'lanczos3' }) : undefined });
      const [a, b] = await Promise.all([fs.stat(input.path), fs.stat(out)]);
      if (b.size >= a.size && to === input.format && !max) {
        await fs.copyFile(input.path, out);
        ctx.note('This image is already optimally compressed — the original was kept because re-compressing would not make it smaller.');
      }
      return [out];
    },
  },
  {
    id: 'image-resize',
    title: 'Resize image',
    description: 'Resize images by pixels or percentage, with high-quality Lanczos resampling.',
    category: 'image',
    icon: 'resize',
    engines: [],
    weight: 'light',
    inputs: { formats: EDITABLE, min: 1, max: 1 },
    batch: true,
    output: sameOrPng,
    options: (info) => [
      { key: 'by', label: 'Resize by', type: 'select', default: 'pixels', choices: [{ value: 'pixels', label: 'Pixels' }, { value: 'percent', label: 'Percentage' }] },
      { key: 'width', label: 'Width (px)', type: 'number', min: 1, max: 30000, placeholder: info?.image?.width ? String(info.image.width) : 'auto', showIf: { by: ['pixels'] } },
      { key: 'height', label: 'Height (px)', type: 'number', min: 1, max: 30000, placeholder: info?.image?.height ? String(info.image.height) : 'auto', showIf: { by: ['pixels'] } },
      { key: 'fit', label: 'When both are set', type: 'select', default: 'inside', showIf: { by: ['pixels'] }, choices: [{ value: 'inside', label: 'Fit inside (keep proportions)' }, { value: 'cover', label: 'Fill and crop to exact size' }, { value: 'contain', label: 'Fit and pad to exact size' }, { value: 'fill', label: 'Stretch to exact size' }] },
      { key: 'percent', label: 'Scale (%)', type: 'range', min: 1, max: 400, default: 50, unit: '%', showIf: { by: ['percent'] } },
      { key: 'enlarge', label: 'Allow enlarging', type: 'toggle', default: false },
    ],
    quality: () => ({ level: 'high', message: 'High-quality Lanczos resampling; the original format and quality settings are kept.' }),
    async run(ctx) {
      const input = ctx.inputs[0];
      const o = ctx.options;
      if (o.by !== 'percent' && !o.width && !o.height) throw new ConversionError('Enter a width, a height, or both.');
      const to = ctx.toolOutput;
      const out = ctx.outFile(to, { suffix: ' (resized)' });
      await convertImage(
        { ...ctx, input },
        {
          to,
          options: { keepMetadata: true, quality: to === 'jpg' ? 92 : undefined },
          outPath: out,
          transform: (p, meta) => {
            if (o.by === 'percent') {
              const pct = Number(o.percent || 50) / 100;
              const w = Math.max(1, Math.round((meta.autoOrient?.width ?? meta.width) * pct));
              return p.resize(w, null, { kernel: 'lanczos3', withoutEnlargement: !o.enlarge });
            }
            return p.resize(o.width || null, o.height || null, { fit: o.width && o.height ? o.fit || 'inside' : 'inside', background: { r: 255, g: 255, b: 255, alpha: 0 }, kernel: 'lanczos3', withoutEnlargement: !o.enlarge });
          },
        },
      );
      return [out];
    },
  },
];

