import { ffmpeg, CONTAINERS, VIDEO_ENCODERS, TEXT_SUB_CODECS, audioEncoderArgs, displaySize, is10bit } from '../engines/ffmpeg.js';
import { probeMedia } from '../detect/inspect.js';
import { formatsIn } from '../registry/formats.js';
import { ConversionError } from '../util/errors.js';

const VIDEO_FORMATS = formatsIn('video');
const NO_COPY_INTO_MKV = new Set(['gif', 'apng', 'webp', 'png']);
const RESOLUTIONS = [4320, 2160, 1440, 1080, 720, 480, 360, 240];

const mainVideo = (media) => media?.streams?.find((s) => s.type === 'video' && !s.attachedPic);
const isHdr = (v) => /smpte2084|arib-std-b67/.test(v?.colorTransfer || '');

function qualityChoices() {
  return [
    { value: 'original', label: 'Original quality', hint: 'Copies the video/audio streams untouched when the target supports them. Re-encodes only what is incompatible, at visually lossless quality.' },
    { value: 'high', label: 'High (visually lossless)', hint: 'Always re-encodes at a very high quality level.' },
    { value: 'balanced', label: 'Balanced', hint: 'Good quality, noticeably smaller files.' },
    { value: 'small', label: 'Smallest file', hint: 'Strong compression; some loss of detail is visible.' },
  ];
}

export function resolutionChoices(media) {
  const v = mainVideo(media);
  const d = displaySize(v);
  const short = d ? Math.min(d.width, d.height) : Infinity;
  return [
    { value: 'original', label: d ? `Original (${d.width}×${d.height})` : 'Original' },
    ...RESOLUTIONS.filter((r) => r < short).map((r) => ({ value: String(r), label: r === 2160 ? '4K (2160p)' : r === 4320 ? '8K (4320p)' : `${r}p` })),
  ];
}

export const speedOption = {
  key: 'speed',
  label: 'Encoding speed',
  type: 'select',
  default: 'veryfast',
  help: 'Applies only when re-encoding. Slower presets produce smaller files at the same visual quality.',
  choices: [
    { value: 'ultrafast', label: 'Fastest' },
    { value: 'veryfast', label: 'Fast (recommended)' },
    { value: 'fast', label: 'Balanced' },
    { value: 'medium', label: 'Slower, smaller file' },
    { value: 'slow', label: 'Slowest, smallest file' },
  ],
};

/** Builds the filter chain for scaling / fps changes. Downscale only, never upscale. */
export function videoFilters(v, { resolution, fps }) {
  const filters = [];
  const d = displaySize(v);
  if (resolution && resolution !== 'original') {
    const target = Number(resolution);
    if (d && Math.min(d.width, d.height) > target) {
      filters.push(d.width >= d.height ? `scale=-2:${target}:flags=lanczos` : `scale=${target}:-2:flags=lanczos`);
    }
  }
  if (fps && fps !== 'original' && (!v?.fps || v.fps > Number(fps) + 0.01)) filters.push(`fps=${fps}`);
  if (!filters.some((f) => f.startsWith('scale')) && d && (d.width % 2 || d.height % 2)) {
    // 4:2:0 encoders require even dimensions.
    filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  return filters;
}

/**
 * Decides, stream by stream, whether to copy, encode or drop — the heart of "no unnecessary re-encoding".
 */
export function planVideo(media, to, options = {}) {
  const c = CONTAINERS[to];
  const mode = options.quality || 'original';
  const reencodeAll = mode !== 'original';
  const filtersWanted = (options.resolution && options.resolution !== 'original') || (options.fps && options.fps !== 'original');
  const notes = [];
  const args = [];
  const decisions = [];

  const vStreams = media.streams.filter((s) => s.type === 'video' && !s.attachedPic);
  const aStreams = media.streams.filter((s) => s.type === 'audio');
  const sStreams = media.streams.filter((s) => s.type === 'subtitle');
  if (!vStreams.length) throw new ConversionError('This file has no video stream to convert.', { suggestion: 'Convert it to an audio format instead.' });

  let encoderKey = options.videoCodec && options.videoCodec !== 'auto' ? options.videoCodec : c.defaultVideo;
  if (!c.encoders.includes(encoderKey)) encoderKey = c.defaultVideo;
  const hdr = isHdr(vStreams[0]);
  if (hdr && (!options.videoCodec || options.videoCodec === 'auto') && c.encoders.includes('hevc')) encoderKey = 'hevc';

  let out = 0;
  let vOut = 0;
  let aOut = 0;
  let sOut = 0;
  let videoEncoded = false;

  for (const s of vStreams) {
    const copyable = c.video === '*' ? !NO_COPY_INTO_MKV.has(s.codec) : c.video.includes(s.codec);
    const encode = reencodeAll || filtersWanted || !copyable;
    args.push('-map', `0:${s.index}`);
    if (encode) {
      const enc = VIDEO_ENCODERS[encoderKey];
      const quality = mode === 'original' ? 'high' : mode;
      const q = enc.crf[quality];
      const filters = videoFilters(s, options);
      args.push(`-c:${out}`, enc.codec, ...prefixed(enc.args(q, options.speed), `v:${vOut}`));
      args.push(`-pix_fmt:v:${vOut}`, enc.pixFmt(s));
      if (filters.length) args.push(`-filter:v:${vOut}`, filters.join(','));
      if (enc.tag && (to === 'mp4' || to === 'mov' || to === 'm4v')) args.push(`-tag:v:${vOut}`, enc.tag);
      videoEncoded = true;
      decisions.push({ stream: s.index, type: 'video', action: 'encode', codec: encoderKey });
      if (!copyable && mode === 'original') notes.push(`The ${s.codec?.toUpperCase()} video stream is not supported by ${to.toUpperCase()}, so it was re-encoded to ${enc.label.split(' (')[0]} at visually lossless quality.`);
      if (hdr && enc.pixFmt(s) === 'yuv420p') notes.push('This is an HDR video. Re-encoding to 8-bit H.264 cannot keep HDR — choose H.265 to preserve 10-bit colour.');
    } else {
      args.push(`-c:${out}`, 'copy');
      if (s.codec === 'hevc' && (to === 'mp4' || to === 'mov' || to === 'm4v')) args.push(`-tag:v:${vOut}`, 'hvc1');
      decisions.push({ stream: s.index, type: 'video', action: 'copy', codec: s.codec });
    }
    out++;
    vOut++;
  }

  const explicitAudio = options.audioBitrate && options.audioBitrate !== 'auto';
  for (const s of aStreams) {
    const copyable = c.audio === '*' || c.audio.includes(s.codec);
    args.push('-map', `0:${s.index}`);
    if (copyable && !explicitAudio) {
      args.push(`-c:${out}`, 'copy');
      decisions.push({ stream: s.index, type: 'audio', action: 'copy', codec: s.codec });
    } else {
      args.push(...audioEncoderArgs(c.defaultAudio, { bitrate: options.audioBitrate || 'auto', channels: s.channels, outIndex: String(out) }));
      if (c.defaultAudio === 'mp3' || c.defaultAudio === 'wma') {
        if ((s.channels || 2) > 2) args.push(`-ac:${out}`, '2');
        if ((s.sampleRate || 48000) > 48000) args.push(`-ar:${out}`, '48000');
      }
      if (c.defaultAudio === 'opus' && s.sampleRate && ![48000, 24000, 16000, 12000, 8000].includes(s.sampleRate)) args.push(`-ar:${out}`, '48000');
      if (c.defaultAudio === 'mp2') {
        if ((s.channels || 2) > 2) args.push(`-ac:${out}`, '2');
        if (![48000, 44100, 32000].includes(s.sampleRate)) args.push(`-ar:${out}`, '48000');
      }
      if (c.defaultAudio === 'ac3' && ![48000, 44100, 32000].includes(s.sampleRate)) args.push(`-ar:${out}`, '48000');
      if (!copyable) notes.push(`The ${s.codec?.toUpperCase()} audio track is not supported by ${to.toUpperCase()}, so it was re-encoded at high bitrate.`);
      decisions.push({ stream: s.index, type: 'audio', action: 'encode', codec: c.defaultAudio });
    }
    out++;
    aOut++;
  }

  if (options.keepSubtitles !== false) {
    let dropped = 0;
    for (const s of sStreams) {
      const isText = TEXT_SUB_CODECS.has(s.codec);
      if (isText && c.textSubs) {
        args.push('-map', `0:${s.index}`);
        let codec = c.textSubs;
        if (codec === 'copy') codec = s.codec === 'mov_text' ? 'srt' : 'copy';
        args.push(`-c:${out}`, codec);
        decisions.push({ stream: s.index, type: 'subtitle', action: codec === 'copy' ? 'copy' : 'convert', codec });
        out++;
        sOut++;
      } else if (!isText && c.bitmapSubs) {
        args.push('-map', `0:${s.index}`, `-c:${out}`, 'copy');
        decisions.push({ stream: s.index, type: 'subtitle', action: 'copy', codec: s.codec });
        out++;
        sOut++;
      } else dropped++;
    }
    if (dropped) {
      notes.push(
        c.textSubs
          ? `${dropped} image-based subtitle track${dropped > 1 ? 's were' : ' was'} left out: ${to.toUpperCase()} only supports text subtitles. Use MKV to keep ${dropped > 1 ? 'them' : 'it'}.`
          : `${dropped} subtitle track${dropped > 1 ? 's were' : ' was'} left out: ${to.toUpperCase()} cannot store subtitles. Use MKV or MP4 to keep ${dropped > 1 ? 'them' : 'it'}.`,
      );
    }
  }

  if (c.attachments && media.streams.some((s) => s.type === 'attachment')) args.push('-map', '0:t?', '-c:t', 'copy');

  args.push('-map_metadata', '0', '-map_chapters', '0', '-max_muxing_queue_size', '9999');
  if (c.faststart) args.push('-movflags', '+faststart+use_metadata_tags');
  return { args, notes, decisions, videoEncoded, copiedAll: decisions.every((d) => d.action === 'copy') };
}

function prefixed(args, spec) {
  // Turn ['-crf','18','-preset','fast'] into ['-crf:v:0','18','-preset:v:0','fast']
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('-') && i + 1 < args.length) out.push(`${a.split(':')[0]}:${spec}`, args[++i]);
    else out.push(a);
  }
  return out;
}

function encoderChoices(to) {
  const c = CONTAINERS[to];
  return [{ value: 'auto', label: `Automatic (${VIDEO_ENCODERS[c.defaultVideo].label.split(' (')[0]})` }, ...c.encoders.map((k) => ({ value: k, label: VIDEO_ENCODERS[k].label }))];
}

const gifOptions = (media) => {
  const d = displaySize(mainVideo(media));
  const widths = ['1280', '1080', '800', '640', '480', '320', '240'].filter((w) => !d || Number(w) < d.width);
  return [
  { key: 'fps', label: 'Frame rate', type: 'select', default: '15', choices: ['5', '10', '12', '15', '20', '25', '30'].map((v) => ({ value: v, label: `${v} fps` })) },
  {
    key: 'width',
    label: 'Width',
    type: 'select',
    default: widths.includes('640') ? '640' : 'original',
    choices: [{ value: 'original', label: d ? `Original (${d.width}px)` : 'Original' }, ...widths.map((w) => ({ value: w, label: `${w}px` }))],
  },
  { key: 'start', label: 'Start at', type: 'time', placeholder: '0 or 00:00:05', help: 'Seconds or hh:mm:ss' },
  { key: 'duration', label: 'Length', type: 'time', placeholder: 'Whole clip', help: 'Leave empty for the whole video. GIFs get very large beyond ~15 seconds.' },
  { key: 'loop', label: 'Loop forever', type: 'toggle', default: true },
  ];
};

async function runAnimated(ctx, media) {
  const { input, to, options } = ctx;
  const out = ctx.outFile(to);
  const pre = [];
  if (options.start) pre.push('-ss', String(options.start));
  const post = [];
  if (options.duration) post.push('-t', String(options.duration));
  const scale = options.width && options.width !== 'original' ? `,scale='min(iw,${options.width})':-2:flags=lanczos` : '';
  const total = Math.max(0.1, (options.duration || (media.duration || 0) - (options.start || 0)) || 1);
  if (to === 'gif') {
    await ffmpeg(
      [...pre, '-i', input.path, ...post, '-filter_complex', `[0:v:0]fps=${options.fps || 15}${scale},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-an', '-loop', options.loop === false ? '-1' : '0', '-f', 'gif', out],
      { duration: total, onProgress: ctx.progress, signal: ctx.signal },
    );
  } else {
    await ffmpeg(
      [...pre, '-i', input.path, ...post, '-map', '0:v:0', '-vf', `fps=${options.fps || 15}${scale}`, '-c:v', 'libwebp_anim', '-lossless', '0', '-q:v', '80', '-compression_level', '4', '-loop', options.loop === false ? '1' : '0', '-an', '-f', 'webp', out],
      { duration: total, onProgress: ctx.progress, signal: ctx.signal },
    );
  }
  return [out];
}

export default {
  id: 'video',
  label: 'Video converter',
  engines: ['ffmpeg', 'ffprobe'],
  weight: 'heavy',
  routes: [
    { from: [...VIDEO_FORMATS, 'gif'], to: VIDEO_FORMATS },
    { from: VIDEO_FORMATS, to: ['gif', 'webp'] },
  ],
  accepts(from, to, info) {
    if (!info?.media) return true;
    if (!mainVideo(info.media)) return 'This file has no video stream.';
    return true;
  },
  options(from, to, info) {
    const media = info?.media;
    if (to === 'gif' || to === 'webp') return gifOptions(media);
    return [
      { key: 'quality', label: 'Quality', type: 'select', default: 'original', choices: qualityChoices() },
      { key: 'videoCodec', label: 'Video codec', type: 'select', default: 'auto', choices: encoderChoices(to), help: 'Used only when the video has to be re-encoded.' },
      { key: 'resolution', label: 'Resolution', type: 'select', default: 'original', choices: resolutionChoices(media) },
      { key: 'fps', label: 'Frame rate', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Original' }, ...['60', '50', '30', '25', '24'].map((v) => ({ value: v, label: `${v} fps` }))] },
      { key: 'audioBitrate', label: 'Audio bitrate', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Original / automatic' }, ...['96', '128', '192', '256', '320'].map((v) => ({ value: v, label: `${v} kbps` }))] },
      { key: 'keepSubtitles', label: 'Keep subtitle tracks', type: 'toggle', default: true },
      speedOption,
    ];
  },
  quality(from, to, info, options = {}) {
    if (to === 'gif') return { level: 'lossy', message: 'GIF is limited to 256 colours per frame and has no audio. Colours are optimised per clip for the best possible result.' };
    if (to === 'webp') return { level: 'lossy', message: 'Animated WEBP — high quality, much smaller than GIF, no audio.' };
    if (from === 'gif') return { level: 'high', message: 'The GIF is encoded to video at visually lossless quality (and usually becomes much smaller).' };
    const media = info?.media;
    if (!media) return { level: 'high', message: 'Streams are copied when compatible, otherwise re-encoded at visually lossless quality.' };
    try {
      const p = planVideo(media, to, { ...options, quality: options.quality || 'original' });
      if (p.copiedAll) return { level: 'lossless', message: 'No re-encoding: the original video and audio streams are copied bit-for-bit. Identical quality, and very fast.' };
      const v = p.decisions.find((d) => d.type === 'video');
      if (v?.action === 'copy') return { level: 'lossless', message: 'The video stream is copied untouched. Only incompatible audio/subtitles are converted.' };
      if ((options.quality || 'original') === 'original' || options.quality === 'high') return { level: 'high', message: `${to.toUpperCase()} does not support this video codec, so it will be re-encoded at visually lossless quality.` };
      return { level: 'lossy', message: 'The video will be re-encoded with compression; expect a smaller file with some loss of detail.' };
    } catch {
      return { level: 'high', message: 'Streams are copied when compatible.' };
    }
  },
  async run(ctx) {
    const media = ctx.info?.media || (await probeMedia(ctx.input.path, ctx.signal));
    if (!media) throw new ConversionError('This file could not be read as a video. It may be damaged or incomplete.');
    if (ctx.to === 'gif' || ctx.to === 'webp') return runAnimated(ctx, media);
    const plan = planVideo(media, ctx.to, ctx.options);
    const out = ctx.outFile(ctx.to);
    try {
      await ffmpeg(['-i', ctx.input.path, ...plan.args, '-f', CONTAINERS[ctx.to].muxer, out], { duration: media.duration, onProgress: ctx.progress, signal: ctx.signal });
      plan.notes.forEach((n) => ctx.note(n));
      const av = plan.decisions.filter((d) => d.type !== 'subtitle');
      if (av.every((d) => d.action === 'copy')) ctx.note('Converted without re-encoding — the original video and audio streams were copied, so quality is identical.');
    } catch (err) {
      if (err.cancelled || !plan.decisions.some((d) => d.action === 'copy' && d.type === 'video')) throw err;
      // Rare: a stream that should be copyable is rejected by the muxer (odd timestamps, unusual profiles).
      // Fall back to a high-quality re-encode instead of failing the user.
      ctx.note('The original streams could not be copied cleanly, so the video was re-encoded at visually lossless quality.');
      const retry = planVideo(media, ctx.to, { ...ctx.options, quality: 'high' });
      retry.notes.filter((n) => !/re-encoded to/.test(n)).forEach((n) => ctx.note(n));
      await ffmpeg(['-i', ctx.input.path, ...retry.args, '-f', CONTAINERS[ctx.to].muxer, out], { duration: media.duration, onProgress: ctx.progress, signal: ctx.signal });
    }
    return [out];
  },
};

export { mainVideo, isHdr, is10bit };
