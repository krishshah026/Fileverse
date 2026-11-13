import sharp from 'sharp';
import { config } from '../config.js';
import { detectEngines } from '../engines/available.js';
import { run } from '../util/proc.js';
import { getFormat } from '../registry/formats.js';

/** ffprobe → a compact, UI-friendly description of the streams. */
export async function probeMedia(filePath, signal) {
  const e = detectEngines();
  if (!e.ffprobe) return null;
  try {
    const { stdout } = await run(e.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', '-show_chapters', filePath], { signal, maxCapture: 4 * 1024 * 1024 });
    const data = JSON.parse(stdout);
    const streams = (data.streams || []).map((s) => ({
      index: s.index,
      type: s.codec_type,
      codec: s.codec_name,
      profile: s.profile,
      width: s.width,
      height: s.height,
      pixFmt: s.pix_fmt,
      fps: parseRate(s.avg_frame_rate) || parseRate(s.r_frame_rate),
      bitRate: num(s.bit_rate),
      sampleRate: num(s.sample_rate),
      channels: s.channels,
      channelLayout: s.channel_layout,
      bitsPerSample: s.bits_per_raw_sample ? Number(s.bits_per_raw_sample) : s.bits_per_sample || undefined,
      language: s.tags?.language,
      title: s.tags?.title,
      attachedPic: s.disposition?.attached_pic === 1,
      default: s.disposition?.default === 1,
      colorTransfer: s.color_transfer,
      rotation: rotationOf(s),
    }));
    const duration = num(data.format?.duration) || Math.max(0, ...(data.streams || []).map((s) => num(s.duration) || 0));
    return {
      container: data.format?.format_name,
      duration: duration || undefined,
      bitRate: num(data.format?.bit_rate),
      chapters: (data.chapters || []).length,
      tags: data.format?.tags || {},
      streams,
    };
  } catch {
    return null;
  }
}

function rotationOf(s) {
  const sd = (s.side_data_list || []).find((d) => d.rotation !== undefined);
  if (sd) return Number(sd.rotation);
  if (s.tags?.rotate) return Number(s.tags.rotate);
  return 0;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function parseRate(r) {
  if (!r || r === '0/0') return undefined;
  const [a, b] = r.split('/').map(Number);
  if (!b) return undefined;
  const v = a / b;
  return v > 0 && v < 1000 ? Math.round(v * 1000) / 1000 : undefined;
}

export async function probeImage(filePath, format) {
  try {
    const m = await sharp(filePath, { limitInputPixels: config.maxImagePixels, pages: 1 }).metadata();
    return {
      width: m.autoOrient?.width ?? m.width,
      height: m.autoOrient?.height ?? m.height,
      hasAlpha: Boolean(m.hasAlpha),
      pages: m.pages || 1,
      space: m.space,
      depth: m.depth,
      density: m.density,
      hasProfile: Boolean(m.icc),
      hasExif: Boolean(m.exif),
    };
  } catch {
    // Formats libvips cannot read (HEIC, PSD, TGA, ICO …) → ImageMagick identify.
    const e = detectEngines();
    if (!e.magick) return null;
    try {
      const args = e.magickIsV7 ? ['identify'] : [];
      const bin = e.magickIsV7 ? e.magick : e.magick.replace(/convert$/, 'identify');
      const { stdout } = await run(bin, [...args, '-format', '%w %h %A %n\n', `${{ heic: 'heic:', ico: 'ico:', psd: 'psd:', tga: 'tga:', bmp: 'bmp:' }[format] || ''}${filePath}[0]`], { allowedCodes: [0, 1] });
      const [w, h, alpha] = stdout.trim().split('\n')[0].split(' ');
      return { width: Number(w) || undefined, height: Number(h) || undefined, hasAlpha: /true|blend/i.test(alpha || ''), pages: 1 };
    } catch {
      return null;
    }
  }
}

export async function probePdf(filePath) {
  const e = detectEngines();
  if (!e.qpdf) return null;
  const info = { pages: undefined, encrypted: false };
  try {
    // qpdf --is-encrypted: exit 0 = encrypted, 2 = not encrypted
    const r = await run(e.qpdf, ['--is-encrypted', filePath], { allowedCodes: [0, 2] });
    info.encrypted = r.code === 0;
    if (info.encrypted) {
      const rp = await run(e.qpdf, ['--requires-password', filePath], { allowedCodes: [0, 2, 3] });
      info.requiresPassword = rp.code === 0;
    }
  } catch {
    /* ignore */
  }
  try {
    const { stdout } = await run(e.qpdf, ['--show-npages', filePath], { allowedCodes: [0, 3] });
    info.pages = Number.parseInt(stdout.trim(), 10) || undefined;
  } catch {
    /* password protected or damaged */
  }
  if (e.pdftotext && info.pages && !info.requiresPassword) {
    // Detect scanned PDFs (no text layer) so we can suggest OCR.
    try {
      const { stdout } = await run(e.pdftotext, ['-l', String(Math.min(info.pages, 3)), filePath, '-'], { maxCapture: 64 * 1024 });
      info.hasText = stdout.replace(/\s+/g, '').length > 20;
    } catch {
      /* ignore */
    }
  }
  return info;
}

/** Collects everything we know about a file for the UI and for route filtering. */
export async function inspectFile(filePath, formatId) {
  const fmt = getFormat(formatId);
  if (!fmt) return {};
  const out = {};
  if (fmt.category === 'video' || fmt.category === 'audio') out.media = await probeMedia(filePath);
  if (fmt.category === 'image' && fmt.id !== 'svg') out.image = await probeImage(filePath, fmt.id);
  if (fmt.id === 'svg') out.image = await probeImage(filePath, 'svg');
  if (fmt.id === 'gif') out.media = await probeMedia(filePath);
  if (fmt.id === 'pdf') out.pdf = await probePdf(filePath);
  return out;
}
