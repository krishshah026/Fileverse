import { ffmpeg, audioEncoderArgs } from '../engines/ffmpeg.js';
import { probeMedia } from '../detect/inspect.js';
import { formatsIn, getFormat } from '../registry/formats.js';
import { ConversionError } from '../util/errors.js';

const AUDIO_FORMATS = formatsIn('audio');
const VIDEO_FORMATS = formatsIn('video');
const LOSSLESS_CODECS = new Set(['flac', 'alac', 'wavpack', 'tak', 'ape', 'mlp', 'truehd']);
const isLosslessCodec = (c) => Boolean(c) && (c.startsWith('pcm_') || LOSSLESS_CODECS.has(c));

/** Per-target container facts. `copy` = source codecs that can be stored without re-encoding. */
export const AUDIO_TARGETS = {
  mp3: { muxer: 'mp3', copy: ['mp3'], enc: 'mp3', lossy: true, rates: [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000], maxCh: 2, cover: true },
  aac: { muxer: 'adts', copy: ['aac'], enc: 'aac', lossy: true, maxCh: 8 },
  m4a: { muxer: 'ipod', copy: ['aac', 'alac'], enc: 'aac', lossy: 'both', maxCh: 8, cover: true },
  ogg: { muxer: 'ogg', copy: ['vorbis', 'opus', 'flac'], enc: 'vorbis', lossy: true, maxCh: 8 },
  opus: { muxer: 'opus', copy: ['opus'], enc: 'opus', lossy: true, rates: [48000, 24000, 16000, 12000, 8000], maxCh: 8 },
  wma: { muxer: 'asf', copy: ['wmav2', 'wmav1'], enc: 'wma', lossy: true, rates: [48000, 44100, 32000, 22050, 16000, 11025, 8000], maxCh: 2 },
  ac3: { muxer: 'ac3', copy: ['ac3'], enc: 'ac3', lossy: true, rates: [48000, 44100, 32000], maxCh: 6 },
  wav: { muxer: 'wav', copy: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_u8'], enc: 'pcm', endian: 'le', lossy: false, maxCh: 8 },
  aiff: { muxer: 'aiff', copy: ['pcm_s16be', 'pcm_s24be', 'pcm_s32be'], enc: 'pcm', endian: 'be', lossy: false, maxCh: 8 },
  flac: { muxer: 'flac', copy: ['flac'], enc: 'flac', lossy: false, maxCh: 8, cover: true },
};

const BITRATES = ['64', '96', '128', '160', '192', '256', '320'];

function pickAudioStream(media, wanted) {
  const audio = media.streams.filter((s) => s.type === 'audio');
  if (!audio.length) return null;
  if (wanted !== undefined && wanted !== 'auto') return audio.find((s) => String(s.index) === String(wanted)) || audio[0];
  return audio.find((s) => s.default) || audio[0];
}

export function audioTrackChoices(media) {
  const audio = (media?.streams || []).filter((s) => s.type === 'audio');
  if (audio.length < 2) return null;
  return [
    { value: 'auto', label: 'Default track' },
    ...audio.map((s, i) => ({ value: String(s.index), label: `Track ${i + 1}${s.language ? ` · ${s.language}` : ''}${s.title ? ` · ${s.title}` : ''} · ${s.codec?.toUpperCase()} ${s.channels || ''}ch` })),
  ];
}

function nearestRate(rate, allowed) {
  if (!allowed || !rate) return undefined;
  if (allowed.includes(rate)) return undefined;
  return allowed.find((r) => r <= rate) ?? allowed[allowed.length - 1];
}

/** Builds ffmpeg arguments for a single-track audio output. Also used by the audio tools. */
export function planAudio(media, to, options = {}) {
  const t = AUDIO_TARGETS[to];
  const s = pickAudioStream(media, options.track);
  if (!s) throw new ConversionError('This file has no audio track.', { suggestion: 'Choose a file that contains sound.' });
  const notes = [];
  const args = ['-map', `0:${s.index}`];
  const explicitBitrate = options.bitrate && options.bitrate !== 'auto';
  const resample = options.sampleRate && options.sampleRate !== 'original';
  const remix = options.channels && options.channels !== 'original';
  const depthChange = options.bitDepth && options.bitDepth !== 'original';
  const wantCodec = to === 'm4a' && options.codec === 'alac' ? 'alac' : null;
  const copyable = t.copy.includes(s.codec) && !explicitBitrate && !resample && !remix && !depthChange && options.keepOriginal !== false && (!wantCodec || wantCodec === s.codec) && !(to === 'm4a' && options.codec === 'aac' && s.codec === 'alac');

  if (copyable) {
    args.push('-c:a', 'copy');
  } else {
    let enc = t.enc;
    if (to === 'm4a' && (options.codec === 'alac' || ((!options.codec || options.codec === 'auto') && isLosslessCodec(s.codec)))) enc = 'alac';
    if (enc === 'pcm') {
      const srcBits = s.bitsPerSample || (isLosslessCodec(s.codec) ? 16 : 16);
      const depth = depthChange ? Number(options.bitDepth) : srcBits > 16 ? 24 : 16;
      args.push(...audioEncoderArgs(`pcm_s${depth}${t.endian}`));
    } else if (enc === 'flac') {
      args.push(...audioEncoderArgs('flac'));
      const depth = depthChange ? Number(options.bitDepth) : (s.bitsPerSample || 16) > 16 ? 24 : 16;
      args.push('-sample_fmt', depth > 16 ? 's32' : 's16');
      if (depth > 16) args.push('-bits_per_raw_sample', '24');
    } else if (enc === 'alac') {
      args.push(...audioEncoderArgs('alac'));
      const depth = depthChange ? Number(options.bitDepth) : (s.bitsPerSample || 16) > 16 ? 24 : 16;
      args.push('-sample_fmt', depth > 16 ? 's32p' : 's16p');
    } else {
      const channelsOut = remix ? (options.channels === 'mono' ? 1 : 2) : Math.min(s.channels || 2, t.maxCh);
      args.push(...audioEncoderArgs(enc, { bitrate: options.bitrate || 'auto', channels: channelsOut }));
    }
    if (!t.lossy && !isLosslessCodec(s.codec)) notes.push(`The source audio (${s.codec?.toUpperCase()}) is already lossy. ${to.toUpperCase()} stores it without further loss, but cannot restore detail that was removed earlier — the file will be larger, not better.`);
    if (t.lossy && !copyable && !isLosslessCodec(s.codec)) notes.push(`Re-encoding from ${s.codec?.toUpperCase()} to ${to.toUpperCase()} — a high bitrate is used to keep the generational loss inaudible.`);
  }

  // Channels
  if (remix) args.push('-ac', options.channels === 'mono' ? '1' : '2');
  else if ((s.channels || 2) > t.maxCh && !args.includes('copy')) {
    args.push('-ac', String(t.maxCh));
    notes.push(`${to.toUpperCase()} supports at most ${t.maxCh} channels, so the ${s.channels}-channel audio was downmixed.`);
  }
  // Sample rate
  if (resample) args.push('-ar', String(options.sampleRate));
  else if (!args.includes('copy')) {
    const r = nearestRate(s.sampleRate, t.rates);
    if (r) args.push('-ar', String(r));
  }

  // Cover art (album art) travels with music files where the format supports it.
  const pic = t.cover && media.streams.find((x) => x.type === 'video' && x.attachedPic && ['mjpeg', 'png'].includes(x.codec));
  if (pic) {
    args.push('-map', `0:${pic.index}`, '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    if (to === 'mp3') args.push('-id3v2_version', '3');
  }
  args.push('-map_metadata', '0');
  if (to === 'mp3' && !pic) args.push('-id3v2_version', '3');
  return { args, notes, copied: args.includes('copy') && args[args.indexOf('-c:a') + 1] === 'copy', stream: s };
}

export function audioOptions(from, to, info) {
  const media = info?.media;
  const t = AUDIO_TARGETS[to];
  const opts = [];
  const tracks = audioTrackChoices(media);
  if (tracks) opts.push({ key: 'track', label: 'Audio track', type: 'select', default: 'auto', choices: tracks });
  if (to === 'm4a') {
    opts.push({ key: 'codec', label: 'Codec', type: 'select', default: 'auto', choices: [{ value: 'auto', label: 'Automatic (keep lossless sources lossless)' }, { value: 'aac', label: 'AAC (lossy, small)' }, { value: 'alac', label: 'ALAC (Apple Lossless)' }] });
  }
  if (t.lossy) {
    opts.push({ key: 'bitrate', label: 'Bitrate', type: 'select', default: 'auto', help: 'Automatic keeps the original stream when possible, otherwise uses a transparent high-quality setting.', choices: [{ value: 'auto', label: 'Automatic (highest quality)' }, ...BITRATES.filter((b) => !(to === 'ac3' && Number(b) < 96)).map((b) => ({ value: b, label: `${b} kbps` }))] });
  } else {
    opts.push({ key: 'bitDepth', label: 'Bit depth', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Original' }, { value: '16', label: '16-bit (CD)' }, { value: '24', label: '24-bit (studio)' }] });
  }
  opts.push({ key: 'sampleRate', label: 'Sample rate', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Original' }, ...(t.rates || [96000, 48000, 44100, 32000, 22050, 16000]).filter((r) => r >= 16000).map((r) => ({ value: String(r), label: `${r / 1000} kHz` }))] });
  opts.push({ key: 'channels', label: 'Channels', type: 'select', default: 'original', choices: [{ value: 'original', label: 'Original' }, { value: 'stereo', label: 'Stereo' }, { value: 'mono', label: 'Mono' }] });
  return opts;
}

export default {
  id: 'audio',
  label: 'Audio converter',
  engines: ['ffmpeg', 'ffprobe'],
  weight: 'heavy',
  routes: [{ from: [...AUDIO_FORMATS, ...VIDEO_FORMATS], to: Object.keys(AUDIO_TARGETS) }],
  accepts(from, to, info) {
    if (!info?.media) return true;
    return info.media.streams.some((s) => s.type === 'audio') ? true : 'This file has no audio track.';
  },
  options: audioOptions,
  quality(from, to, info, options = {}) {
    const media = info?.media;
    const t = AUDIO_TARGETS[to];
    if (media) {
      try {
        const p = planAudio(media, to, options);
        if (p.copied) return { level: 'lossless', message: `The original ${p.stream.codec.toUpperCase()} audio is copied without re-encoding — identical quality.` };
        if (!t.lossy && isLosslessCodec(p.stream.codec)) return { level: 'lossless', message: 'Lossless to lossless: bit-perfect audio.' };
        if (!t.lossy) return { level: 'lossless', message: 'Stored losslessly. The source was already lossy, so the result is larger but not better.' };
        return { level: 'high', message: `${to.toUpperCase()} is a lossy format. We use a transparent high-quality setting by default.` };
      } catch {
        /* fallthrough */
      }
    }
    if (!t.lossy) return { level: 'lossless', message: `${to.toUpperCase()} is lossless.` };
    if (getFormat(from)?.category === 'video') return { level: 'high', message: 'The audio track is copied when compatible, otherwise encoded at high quality.' };
    return { level: 'high', message: `${to.toUpperCase()} is lossy; a transparent high-quality setting is used by default.` };
  },
  async run(ctx) {
    const media = ctx.info?.media || (await probeMedia(ctx.input.path, ctx.signal));
    if (!media) throw new ConversionError('This file could not be read as audio. It may be damaged or incomplete.');
    const plan = planAudio(media, ctx.to, ctx.options);
    plan.notes.forEach((n) => ctx.note(n));
    if (plan.copied) ctx.note('The audio was copied without re-encoding — identical quality.');
    const out = ctx.outFile(ctx.to);
    await ffmpeg(['-i', ctx.input.path, ...plan.args, '-f', AUDIO_TARGETS[ctx.to].muxer, out], { duration: media.duration, onProgress: ctx.progress, signal: ctx.signal });
    return [out];
  },
};
export { isLosslessCodec };
