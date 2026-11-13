import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.js';
import { detectEngines } from './available.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';

sharp.cache(false);
sharp.concurrency(Math.max(1, Math.min(4, config.cpus)));

/** Formats libvips (sharp prebuilt) reads natively. Others are decoded by ImageMagick first. */
export const SHARP_READS = new Set(['png', 'jpg', 'webp', 'avif', 'gif', 'tiff', 'svg']);
export const SHARP_WRITES = new Set(['png', 'jpg', 'webp', 'avif', 'gif', 'tiff']);
export const LOSSLESS_SOURCES = new Set(['png', 'bmp', 'tiff', 'gif', 'tga', 'ico', 'psd', 'svg']);

export function magick(args, opts = {}) {
  const e = detectEngines();
  if (!e.magick) throw new ConversionError('ImageMagick is not installed on this server.', { internal: true });
  return e.magickIsV7 ? run(e.magick, args, opts) : run(e.magick, args, opts);
}

/** Picks the largest frame of a multi-resolution .ico. */
async function largestIcoFrame(file) {
  try {
    const { stdout } = await magick([`ico:${file}`, '-format', '%w\n', 'info:']);
    const widths = stdout.trim().split('\n').map(Number);
    let best = 0;
    widths.forEach((w, i) => {
      if (w > widths[best]) best = i;
    });
    return best;
  } catch {
    return 0;
  }
}

/**
 * Returns a path sharp can read. HEIC/PSD/TGA/BMP/ICO are decoded to a lossless 16-bit-capable PNG.
 */
export async function decodable(input, workDir, signal) {
  if (SHARP_READS.has(input.format)) return { path: input.path, format: input.format };
  const out = path.join(workDir, 'decoded.png');
  const e = detectEngines();
  if (input.format === 'heic' && e.heifConvert) {
    try {
      await run(e.heifConvert, [input.path, out], { signal });
      return { path: out, format: 'png' };
    } catch {
      /* fall back to ImageMagick */
    }
  }
  // Uploads have no extension, so the format is always given to ImageMagick explicitly.
  let src = input.path;
  if (input.format === 'psd') src = `psd:${input.path}[0]`;
  if (input.format === 'ico') src = `ico:${input.path}[${await largestIcoFrame(input.path)}]`;
  if (input.format === 'heic') src = `heic:${input.path}[0]`;
  if (input.format === 'tga') src = `tga:${input.path}`;
  if (input.format === 'bmp') src = `bmp:${input.path}`;
  await magick([src, '-auto-orient', `png:${out}`], { signal, friendly: `Could not read this ${input.format.toUpperCase()} image.` });
  return { path: out, format: 'png' };
}

export function sharpInput(file, { animated = false, density } = {}) {
  return sharp(file, {
    limitInputPixels: config.maxImagePixels,
    animated,
    pages: animated ? -1 : 1,
    density,
    failOn: 'none',
  });
}

/** Applies the output encoder. `opts.quality` 1..100, `opts.lossless` boolean. */
export function encode(pipeline, to, opts = {}, meta = {}) {
  const q = opts.quality;
  switch (to) {
    case 'png':
      return opts.palette
        ? pipeline.png({ palette: true, quality: q ?? 80, effort: 10, compressionLevel: 9, dither: 1 })
        : // NB: never pass `effort`/`quality`/`colours` here — in sharp they switch PNG to a lossy 256-colour palette.
          pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false });
    case 'jpg':
      return pipeline
        .flatten({ background: opts.background || '#ffffff' })
        .jpeg({ quality: q ?? 92, mozjpeg: true, chromaSubsampling: (q ?? 92) >= 90 ? '4:4:4' : '4:2:0' });
    case 'webp':
      return opts.lossless ? pipeline.webp({ lossless: true, effort: 5 }) : pipeline.webp({ quality: q ?? 90, effort: 5, smartSubsample: true, alphaQuality: 100 });
    case 'avif':
      return opts.lossless ? pipeline.avif({ lossless: true, effort: 4 }) : pipeline.avif({ quality: q ?? 75, effort: 4, chromaSubsampling: (q ?? 75) >= 85 ? '4:4:4' : '4:2:0' });
    case 'gif':
      return pipeline.gif({ effort: 10, dither: 1, reuse: true, interFrameMaxError: 0, interPaletteMaxError: 3 });
    case 'tiff':
      return pipeline.tiff({ compression: opts.tiffCompression || 'lzw', predictor: 'horizontal' });
    default:
      throw new Error(`sharp cannot write ${to}`);
  }
}

/** Keeps 16-bit precision when both the source and target support it. */
export function preserveDepth(pipeline, to, meta) {
  if ((to === 'png' || to === 'tiff') && meta?.depth === 'ushort') {
    return pipeline.toColourspace((meta.channels || 3) <= 2 ? 'grey16' : 'rgb16');
  }
  return pipeline;
}

export function applyMetadata(pipeline, keep) {
  // Pixels are always auto-oriented so resizing/cropping works on the image as people see it;
  // sharp then writes Orientation=1, so the result displays identically everywhere.
  return keep ? pipeline.rotate().keepMetadata() : pipeline.rotate().keepIccProfile();
}

/**
 * Exact TGA writer (RLE-compressed true colour, top-left origin, straight alpha).
 * Written natively because general-purpose tools round semi-transparent colours.
 */
export async function writeTga(pipeline, out, hasAlpha) {
  const { data, info } = await (hasAlpha ? pipeline.ensureAlpha() : pipeline.removeAlpha()).raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const bpp = channels;
  const header = Buffer.alloc(18);
  header[2] = 10; // RLE true-colour
  header.writeUInt16LE(width, 12);
  header.writeUInt16LE(height, 14);
  header[16] = bpp * 8;
  header[17] = (bpp === 4 ? 8 : 0) | 0x20; // alpha bits + top-left origin
  const chunks = [header];
  const px = (i) => (bpp === 4 ? [data[i + 2], data[i + 1], data[i], data[i + 3]] : [data[i + 2], data[i + 1], data[i]]);
  const same = (a, b) => data.compare(data, a, a + bpp) === 0 && data[a] === data[b] && data.subarray(a, a + bpp).equals(data.subarray(b, b + bpp));
  for (let y = 0; y < height; y++) {
    const row = y * width * bpp;
    let x = 0;
    while (x < width) {
      const start = row + x * bpp;
      let run = 1;
      while (x + run < width && run < 128 && same(start, start + run * bpp)) run++;
      if (run > 1) {
        chunks.push(Buffer.from([0x80 | (run - 1), ...px(start)]));
        x += run;
        continue;
      }
      let raw = 1;
      while (x + raw < width && raw < 128 && !(x + raw + 1 < width && same(row + (x + raw) * bpp, row + (x + raw + 1) * bpp))) raw++;
      const buf = [raw - 1];
      for (let k = 0; k < raw; k++) buf.push(...px(row + (x + k) * bpp));
      chunks.push(Buffer.from(buf));
      x += raw;
    }
  }
  chunks.push(Buffer.from('\0\0\0\0\0\0\0\0TRUEVISION-XFILE.\0', 'binary'));
  await fs.writeFile(out, Buffer.concat(chunks));
  return out;
}
