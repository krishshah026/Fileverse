import fs from 'node:fs/promises';
import { ffmpeg, TEXT_SUB_CODECS } from '../engines/ffmpeg.js';
import { probeMedia } from '../detect/inspect.js';
import { formatsIn } from '../registry/formats.js';
import { ConversionError } from '../util/errors.js';

const SUBS = formatsIn('subtitle');
const VIDEO = formatsIn('video');
const ENCODER = { srt: 'srt', vtt: 'webvtt', ass: 'ass', ssa: 'ssa', lrc: 'text' };
const MUXER = { srt: 'srt', vtt: 'webvtt', ass: 'ass', ssa: 'ass', lrc: 'lrc' };

function isUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

function textTracks(media) {
  return (media?.streams || []).filter((s) => s.type === 'subtitle' && TEXT_SUB_CODECS.has(s.codec));
}

export default {
  id: 'subtitle',
  label: 'Subtitle converter',
  engines: ['ffmpeg', 'ffprobe'],
  weight: 'light',
  routes: [
    { from: SUBS, to: SUBS },
    { from: VIDEO, to: ['srt', 'vtt', 'ass'] },
  ],
  accepts(from, to, info) {
    if (!VIDEO.includes(from) || !info?.media) return true;
    if (textTracks(info.media).length) return true;
    return info.media.streams.some((s) => s.type === 'subtitle') ? 'The subtitles in this video are images (e.g. Blu-ray PGS), which cannot be turned into text without OCR.' : 'This video has no subtitle tracks.';
  },
  options(from, to, info) {
    const opts = [];
    if (VIDEO.includes(from)) {
      const tracks = textTracks(info?.media);
      if (tracks.length > 1) {
        opts.push({
          key: 'track',
          label: 'Subtitle track',
          type: 'select',
          default: String(tracks[0].index),
          choices: tracks.map((s, i) => ({ value: String(s.index), label: `Track ${i + 1}${s.language ? ` · ${s.language}` : ''}${s.title ? ` · ${s.title}` : ''}` })),
        });
      }
    }
    if (SUBS.includes(from)) {
      opts.push({ key: 'shift', label: 'Shift timing (seconds)', type: 'number', default: 0, min: -36000, max: 36000, step: 0.1, integer: false, help: 'Positive values delay the subtitles, negative values show them earlier.' });
    }
    return opts;
  },
  quality(from, to) {
    if ((from === 'ass' || from === 'ssa') && !['ass', 'ssa'].includes(to)) return { level: 'high', message: 'Text and timing are kept. Advanced ASS styling (fonts, positions, effects) cannot be represented in this format.' };
    if (to === 'lrc') return { level: 'high', message: 'LRC stores one timestamp per line (lyrics format); end times are not kept.' };
    return { level: 'lossless', message: 'Text and timings are preserved.' };
  },
  async run(ctx) {
    const { input, to, options } = ctx;
    const out = ctx.outFile(to);
    const pre = [];
    let map = ['-map', '0:s:0'];
    if (VIDEO.includes(input.format)) {
      const media = ctx.info?.media || (await probeMedia(input.path, ctx.signal));
      const tracks = textTracks(media);
      if (!tracks.length) throw new ConversionError('This video has no text subtitle tracks to extract.');
      const track = tracks.find((s) => String(s.index) === String(options.track)) || tracks[0];
      map = ['-map', `0:${track.index}`];
    } else {
      const head = await fs.readFile(input.path);
      if (!isUtf8(head)) {
        pre.push('-sub_charenc', 'CP1252');
        ctx.note('The subtitle file was not UTF-8; it was read as Windows-1252 and saved as UTF-8.');
      }
      if (options.shift) pre.push('-itsoffset', String(options.shift));
    }
    await ffmpeg([...pre, '-i', input.path, ...map, '-c:s', ENCODER[to], '-f', MUXER[to], out], { signal: ctx.signal });
    const st = await fs.stat(out);
    if (!st.size) throw new ConversionError('The subtitle track is empty.');
    return [out];
  },
};
