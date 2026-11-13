import path from 'node:path';
import fs from 'node:fs/promises';
import { ffmpeg, CONTAINERS, VIDEO_ENCODERS, audioEncoderArgs } from '../engines/ffmpeg.js';
import { probeMedia } from '../detect/inspect.js';
import { formatsIn } from '../registry/formats.js';
import { ConversionError } from '../util/errors.js';
import { videoFilters, resolutionChoices, speedOption, mainVideo } from '../converters/video.js';
import { planAudio, AUDIO_TARGETS } from '../converters/audio.js';

const VIDEO = formatsIn('video');
const AUDIO = formatsIn('audio');

async function mediaOf(ctx) {
  const m = ctx.inputs[0].info?.media || (await probeMedia(ctx.inputs[0].path, ctx.signal));
  if (!m) throw new ConversionError('This file could not be read as media. It may be damaged.');
  return m;
}

function trimWindow(media, options) {
  const start = Number(options.start || 0);
  const end = options.end ? Number(options.end) : media.duration;
  if (media.duration && start >= media.duration) throw new ConversionError(`The start time is beyond the end of the file (${media.duration.toFixed(1)} s).`);
  if (end !== undefined && end <= start) throw new ConversionError('The end time must be after the start time.');
  return { start, duration: end !== undefined ? end - start : undefined };
}

const trimOptions = (precise) => [
  { key: 'start', label: 'Start', type: 'time', default: 0, placeholder: '00:00:00', help: 'Seconds (75) or hh:mm:ss (00:01:15)' },
  { key: 'end', label: 'End', type: 'time', placeholder: 'End of file', help: 'Leave empty to keep everything after the start.' },
  ...(precise
    ? [{ key: 'mode', label: 'Cut accuracy', type: 'select', default: 'fast', choices: [{ value: 'fast', label: 'Instant — no re-encoding (cuts at the nearest keyframe)' }, { value: 'precise', label: 'Frame-accurate — re-encodes at visually lossless quality' }] }]
    : []),
];

export const mediaTools = [
  {
    id: 'video-compress',
    title: 'Compress video',
    description: 'Shrink videos for sharing or storage — by quality level or to an exact target size. Also changes resolution.',
    category: 'video',
    icon: 'compress',
    engines: ['ffmpeg', 'ffprobe'],
    weight: 'heavy',
    inputs: { formats: VIDEO, min: 1, max: 1 },
    batch: true,
    output: (input) => (['mp4', 'mkv', 'mov', 'webm'].includes(input.format) ? input.format : 'mp4'),
    options: (info) => [
      { key: 'method', label: 'Compress by', type: 'select', default: 'quality', choices: [{ value: 'quality', label: 'Quality level' }, { value: 'size', label: 'Target file size' }] },
      { key: 'level', label: 'Compression', type: 'select', default: 'balanced', showIf: { method: ['quality'] }, choices: [{ value: 'light', label: 'Light — visually lossless' }, { value: 'balanced', label: 'Balanced — recommended' }, { value: 'strong', label: 'Strong — smallest' }] },
      { key: 'targetMb', label: 'Target size (MB)', type: 'number', default: 25, min: 1, max: 100000, showIf: { method: ['size'] } },
      { key: 'resolution', label: 'Resolution', type: 'select', default: 'original', choices: resolutionChoices(info?.media) },
      { key: 'codec', label: 'Codec', type: 'select', default: 'h264', choices: [{ value: 'h264', label: 'H.264 — plays everywhere' }, { value: 'hevc', label: 'H.265 — ~40% smaller, newer devices' }] },
      speedOption,
    ],
    quality: () => ({ level: 'lossy', message: 'Compression re-encodes the video. "Light" is visually indistinguishable from the original; stronger levels trade detail for size.' }),
    async run(ctx) {
      const media = await mediaOf(ctx);
      const v = mainVideo(media);
      if (!v) throw new ConversionError('This file has no video stream.');
      const to = ctx.toolOutput;
      const c = CONTAINERS[to];
      const codecKey = to === 'webm' ? 'vp9' : ctx.options.codec === 'hevc' ? 'hevc' : 'h264';
      const enc = VIDEO_ENCODERS[codecKey];
      const filters = videoFilters(v, ctx.options);
      const audio = media.streams.filter((s) => s.type === 'audio');
      const out = ctx.outFile(to, { suffix: ' (compressed)' });
      const audioArgs = audio.length ? ['-map', '0:a?', ...audioEncoderArgs(c.defaultAudio, { bitrate: '128', outIndex: 'a' })] : [];
      const common = ['-map', `0:${v.index}`, '-c:v', enc.codec, '-pix_fmt', enc.pixFmt(v), ...(filters.length ? ['-vf', filters.join(',')] : []), ...(enc.tag && to !== 'mkv' && to !== 'webm' ? ['-tag:v', enc.tag] : [])];
      const tail = ['-map_metadata', '0', ...(c.faststart ? ['-movflags', '+faststart'] : []), '-f', c.muxer, out];
      if (ctx.options.method === 'size') {
        if (!media.duration) throw new ConversionError('The video duration is unknown, so a target size cannot be calculated.');
        const totalKbps = (Number(ctx.options.targetMb) * 8 * 1024 * 1024) / media.duration / 1000;
        const audioKbps = audio.length ? 128 : 0;
        const videoKbps = Math.floor(totalKbps * 0.97 - audioKbps);
        if (videoKbps < 80) throw new ConversionError(`${ctx.options.targetMb} MB is too small for a ${Math.round(media.duration)}-second video. Try at least ${Math.ceil(((80 + audioKbps) * media.duration) / 8 / 1024 / 0.97)} MB.`);
        const passlog = path.join(ctx.workDir, 'pass');
        const rate = ['-b:v', `${videoKbps}k`, '-maxrate', `${Math.round(videoKbps * 1.5)}k`, '-bufsize', `${videoKbps * 2}k`];
        const preset = codecKey === 'vp9' ? ['-deadline', 'good', '-cpu-used', '4', '-row-mt', '1'] : ['-preset', ctx.options.speed || 'veryfast'];
        const passArgs = (n) => (codecKey === 'hevc' ? ['-x265-params', `pass=${n}:stats=${passlog}.log:log-level=error`] : ['-pass', String(n), '-passlogfile', passlog]);
        await ffmpeg(['-i', ctx.inputs[0].path, ...common, ...rate, ...preset, ...passArgs(1), '-an', '-f', 'null', '/dev/null'], { duration: media.duration, onProgress: (f) => ctx.progress(f * 0.5), signal: ctx.signal });
        await ffmpeg(['-i', ctx.inputs[0].path, ...common, ...rate, ...preset, ...passArgs(2), ...audioArgs, ...tail], { duration: media.duration, onProgress: (f) => ctx.progress(0.5 + f * 0.5), signal: ctx.signal });
      } else {
        const q = { light: 'high', balanced: 'balanced', strong: 'small' }[ctx.options.level || 'balanced'];
        await ffmpeg(['-i', ctx.inputs[0].path, ...common, ...enc.args(enc.crf[q], ctx.options.speed), ...audioArgs, ...tail], { duration: media.duration, onProgress: ctx.progress, signal: ctx.signal });
      }
      const [a, b] = await Promise.all([fs.stat(ctx.inputs[0].path), fs.stat(out)]);
      if (b.size >= a.size) ctx.note('The video was already very efficiently compressed, so the result is not smaller. Try a stronger level, a lower resolution or H.265.');
      return [out];
    },
  },
  {
    id: 'video-trim',
    title: 'Trim video',
    description: 'Cut a section out of a video — instantly without re-encoding, or frame-accurately.',
    category: 'video',
    icon: 'trim',
    engines: ['ffmpeg', 'ffprobe'],
    weight: 'heavy',
    inputs: { formats: VIDEO, min: 1, max: 1 },
    output: (input) => input.format,
    options: () => trimOptions(true),
    quality: (opts) => (opts?.mode === 'precise' ? { level: 'high', message: 'Re-encoded at visually lossless quality so the cut lands on the exact frame.' } : { level: 'lossless', message: 'No re-encoding — the original quality is kept. The cut snaps to the nearest keyframe.' }),
    async run(ctx) {
      const media = await mediaOf(ctx);
      const { start, duration } = trimWindow(media, ctx.options);
      const to = ctx.toolOutput;
      const c = CONTAINERS[to] || CONTAINERS.mkv;
      const out = ctx.outFile(to, { suffix: ' (trimmed)' });
      const win = ['-ss', String(start), ...(duration ? ['-t', String(duration)] : [])];
      if (ctx.options.mode === 'precise') {
        const v = mainVideo(media);
        const key = c.encoders.includes('h264') ? 'h264' : c.defaultVideo;
        const enc = VIDEO_ENCODERS[key];
        const filters = videoFilters(v, {});
        await ffmpeg([...win, '-i', ctx.inputs[0].path, '-map', '0:v:0', '-map', '0:a?', '-c:v', enc.codec, ...enc.args(enc.crf.high, 'veryfast'), '-pix_fmt', enc.pixFmt(v), ...(filters.length ? ['-vf', filters.join(',')] : []), ...audioEncoderArgs(c.defaultAudio, { bitrate: 'auto', outIndex: 'a' }), '-map_metadata', '0', ...(c.faststart ? ['-movflags', '+faststart'] : []), '-f', c.muxer, out], { duration: duration || media.duration - start, onProgress: ctx.progress, signal: ctx.signal });
      } else {
        await ffmpeg([...win, '-i', ctx.inputs[0].path, '-map', '0:v?', '-map', '0:a?', '-map', '0:s?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', '-map_metadata', '0', ...(c.faststart ? ['-movflags', '+faststart'] : []), '-f', c.muxer, out], { duration: duration || media.duration - start, onProgress: ctx.progress, signal: ctx.signal });
      }
      return [out];
    },
  },
  {
    id: 'audio-trim',
    title: 'Trim audio',
    description: 'Cut a section from a song, podcast or recording without losing quality.',
    category: 'audio',
    icon: 'trim',
    engines: ['ffmpeg', 'ffprobe'],
    weight: 'heavy',
    inputs: { formats: AUDIO.filter((f) => AUDIO_TARGETS[f]), min: 1, max: 1 },
    output: (input) => input.format,
    options: () => [
      ...trimOptions(false),
      { key: 'fadeIn', label: 'Fade in (seconds)', type: 'number', default: 0, min: 0, max: 30, step: 0.5, integer: false },
      { key: 'fadeOut', label: 'Fade out (seconds)', type: 'number', default: 0, min: 0, max: 30, step: 0.5, integer: false },
    ],
    quality: (opts) => (opts?.fadeIn || opts?.fadeOut ? { level: 'high', message: 'Fades require re-encoding; a transparent high-quality setting is used.' } : { level: 'lossless', message: 'The audio is cut without re-encoding — identical quality.' }),
    async run(ctx) {
      const media = await mediaOf(ctx);
      const { start, duration } = trimWindow(media, ctx.options);
      const to = ctx.toolOutput;
      const out = ctx.outFile(to, { suffix: ' (trimmed)' });
      const fades = [];
      const len = duration || media.duration - start;
      if (ctx.options.fadeIn) fades.push(`afade=t=in:st=0:d=${ctx.options.fadeIn}`);
      if (ctx.options.fadeOut) fades.push(`afade=t=out:st=${Math.max(0, len - ctx.options.fadeOut)}:d=${ctx.options.fadeOut}`);
      const plan = planAudio(media, to, fades.length ? { keepOriginal: false } : {});
      const args = [...plan.args];
      if (fades.length) args.push('-af', fades.join(','));
      await ffmpeg(['-ss', String(start), ...(duration ? ['-t', String(duration)] : []), '-i', ctx.inputs[0].path, ...args, '-f', AUDIO_TARGETS[to].muxer, out], { duration: len, onProgress: ctx.progress, signal: ctx.signal });
      return [out];
    },
  },
  {
    id: 'audio-compress',
    title: 'Compress audio',
    description: 'Make audio files smaller by choosing a lower bitrate or an efficient format like Opus or AAC.',
    category: 'audio',
    icon: 'compress',
    engines: ['ffmpeg', 'ffprobe'],
    weight: 'heavy',
    inputs: { formats: [...AUDIO, ...VIDEO], min: 1, max: 1 },
    batch: true,
    output: (input, options) => (options?.format && options.format !== 'same' ? options.format : AUDIO_TARGETS[input.format]?.lossy === true ? input.format : 'mp3'),
    options: () => [
      { key: 'format', label: 'Output format', type: 'select', default: 'same', choices: [{ value: 'same', label: 'Same as input (MP3 for lossless/video files)' }, { value: 'mp3', label: 'MP3' }, { value: 'm4a', label: 'M4A (AAC)' }, { value: 'opus', label: 'OPUS (smallest at equal quality)' }] },
      { key: 'bitrate', label: 'Bitrate', type: 'select', default: '128', choices: ['48', '64', '96', '128', '160', '192'].map((b) => ({ value: b, label: `${b} kbps${b === '128' ? ' (recommended)' : b === '64' ? ' (speech)' : ''}` })) },
      { key: 'channels', label: 'Channels', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Original' }, { value: 'mono', label: 'Mono (half the size, for speech)' }] },
    ],
    quality: () => ({ level: 'lossy', message: 'Lower bitrates make files smaller. 128 kbps is transparent for most listeners; 64 kbps works well for speech.' }),
    async run(ctx) {
      const media = await mediaOf(ctx);
      const to = ctx.toolOutput;
      const plan = planAudio(media, to, { bitrate: ctx.options.bitrate, channels: ctx.options.channels, keepOriginal: false, codec: 'aac' });
      const out = ctx.outFile(to, { suffix: ' (compressed)' });
      await ffmpeg(['-i', ctx.inputs[0].path, ...plan.args, '-f', AUDIO_TARGETS[to].muxer, out], { duration: media.duration, onProgress: ctx.progress, signal: ctx.signal });
      return [out];
    },
  },
];
