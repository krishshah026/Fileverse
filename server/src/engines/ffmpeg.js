import { config } from '../config.js';
import { detectEngines } from './available.js';
import { run } from '../util/proc.js';

/**
 * Runs ffmpeg with machine-readable progress (-progress pipe:1) and reports a 0..1 fraction.
 * `duration` (seconds) is the expected output duration used to compute progress.
 */
export async function ffmpeg(args, { duration, onProgress, signal, friendly } = {}) {
  const e = detectEngines();
  const threads = config.ffmpegThreads > 0 ? ['-threads', String(config.ffmpegThreads)] : [];
  const full = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args];
  // -threads must come after the input for encoders; append just before the output path.
  if (threads.length) full.splice(full.length - 1, 0, ...threads);
  let lastReport = 0;
  return run(e.ffmpeg, full, {
    signal,
    friendly,
    captureStdout: false,
    onStdoutLine: (line) => {
      if (!onProgress || !duration) return;
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m) {
        const sec = Number(m[1]) / 1e6;
        const now = Date.now();
        if (now - lastReport > 400) {
          lastReport = now;
          onProgress(Math.max(0, Math.min(0.995, sec / duration)));
        }
      } else if (line === 'progress=end') onProgress(1);
    },
  });
}

/** Stream copy / encode compatibility per output container. */
export const CONTAINERS = {
  mp4: {
    muxer: 'mp4',
    video: ['h264', 'hevc', 'av1', 'mpeg4', 'vp9', 'mpeg2video', 'mpeg1video'],
    audio: ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'opus', 'flac', 'mp2'],
    textSubs: 'mov_text',
    bitmapSubs: false,
    encoders: ['h264', 'hevc', 'av1'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
    faststart: true,
  },
  m4v: null, // filled below (same as mp4)
  mov: {
    muxer: 'mov',
    video: ['h264', 'hevc', 'mpeg4', 'prores', 'mjpeg', 'dnxhd', 'png', 'qtrle', 'mpeg2video'],
    audio: ['aac', 'mp3', 'alac', 'ac3', 'eac3', 'pcm_s16le', 'pcm_s24le', 'pcm_s16be', 'pcm_s24be', 'pcm_f32le'],
    textSubs: 'mov_text',
    bitmapSubs: false,
    encoders: ['h264', 'hevc', 'prores'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
    faststart: true,
  },
  mkv: {
    muxer: 'matroska',
    video: '*',
    audio: '*',
    textSubs: 'copy',
    bitmapSubs: true,
    attachments: true,
    encoders: ['h264', 'hevc', 'av1', 'vp9'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
  },
  webm: {
    muxer: 'webm',
    video: ['vp8', 'vp9', 'av1'],
    audio: ['opus', 'vorbis'],
    textSubs: 'webvtt',
    bitmapSubs: false,
    encoders: ['vp9', 'av1'],
    defaultVideo: 'vp9',
    defaultAudio: 'opus',
  },
  avi: {
    muxer: 'avi',
    video: ['mpeg4', 'h264', 'mjpeg', 'msmpeg4v3', 'msmpeg4v2'],
    audio: ['mp3', 'ac3', 'pcm_s16le', 'mp2'],
    textSubs: null,
    bitmapSubs: false,
    encoders: ['mpeg4', 'h264'],
    defaultVideo: 'mpeg4',
    defaultAudio: 'mp3',
  },
  wmv: {
    muxer: 'asf',
    video: ['wmv1', 'wmv2', 'msmpeg4v3'],
    audio: ['wmav1', 'wmav2'],
    textSubs: null,
    bitmapSubs: false,
    encoders: ['wmv2'],
    defaultVideo: 'wmv2',
    defaultAudio: 'wma',
  },
  flv: {
    muxer: 'flv',
    video: ['h264', 'flv1'],
    audio: ['aac', 'mp3'],
    textSubs: null,
    bitmapSubs: false,
    encoders: ['h264'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
  },
  mpeg: {
    muxer: 'mpeg',
    video: ['mpeg1video', 'mpeg2video'],
    audio: ['mp2', 'mp3', 'ac3'],
    textSubs: null,
    bitmapSubs: false,
    encoders: ['mpeg2'],
    defaultVideo: 'mpeg2',
    defaultAudio: 'mp2',
  },
  '3gp': {
    muxer: '3gp',
    video: ['h264', 'h263', 'mpeg4'],
    audio: ['aac', 'amr_nb'],
    textSubs: 'mov_text',
    bitmapSubs: false,
    encoders: ['h264'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
    faststart: true,
  },
  ts: {
    muxer: 'mpegts',
    video: ['h264', 'hevc', 'mpeg2video', 'mpeg1video'],
    audio: ['aac', 'mp3', 'ac3', 'eac3', 'mp2', 'opus'],
    textSubs: null,
    bitmapSubs: true,
    encoders: ['h264', 'hevc'],
    defaultVideo: 'h264',
    defaultAudio: 'aac',
  },
  ogv: {
    muxer: 'ogg',
    video: ['theora'],
    audio: ['vorbis', 'opus', 'flac'],
    textSubs: null,
    bitmapSubs: false,
    encoders: ['theora'],
    defaultVideo: 'theora',
    defaultAudio: 'vorbis',
  },
};
CONTAINERS.m4v = { ...CONTAINERS.mp4 };

export const TEXT_SUB_CODECS = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text', 'text', 'microdvd', 'subviewer', 'jacosub', 'sami', 'realtext', 'stl', 'mpl2', 'pjs', 'vplayer', 'ttml']);

/** Encoder recipes. `quality` is one of high|balanced|small. */
export const VIDEO_ENCODERS = {
  h264: {
    label: 'H.264 (most compatible)',
    codec: 'libx264',
    crf: { high: 18, balanced: 23, small: 28 },
    args: (q, speed) => ['-crf', String(q), '-preset', speed || 'veryfast'],
    pixFmt: () => 'yuv420p',
    sameAs: 'h264',
  },
  hevc: {
    label: 'H.265 / HEVC (smaller files)',
    codec: 'libx265',
    crf: { high: 20, balanced: 26, small: 30 },
    args: (q, speed) => ['-crf', String(q), '-preset', speed || 'veryfast', '-x265-params', 'log-level=error'],
    pixFmt: (src) => (is10bit(src) ? 'yuv420p10le' : 'yuv420p'),
    tag: 'hvc1',
    sameAs: 'hevc',
  },
  av1: {
    label: 'AV1 (smallest, slower)',
    codec: 'libsvtav1',
    crf: { high: 28, balanced: 35, small: 42 },
    args: (q, speed) => ['-crf', String(q), '-preset', String({ ultrafast: 12, superfast: 11, veryfast: 10, faster: 9, fast: 8, medium: 7, slow: 6, slower: 5 }[speed] ?? 10)],
    pixFmt: (src) => (is10bit(src) ? 'yuv420p10le' : 'yuv420p'),
    sameAs: 'av1',
  },
  vp9: {
    label: 'VP9',
    codec: 'libvpx-vp9',
    crf: { high: 24, balanced: 32, small: 38 },
    args: (q, speed) => ['-crf', String(q), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', String({ ultrafast: 8, superfast: 7, veryfast: 6, faster: 5, fast: 4, medium: 3, slow: 2, slower: 1 }[speed] ?? 5)],
    pixFmt: (src) => (is10bit(src) ? 'yuv420p10le' : 'yuv420p'),
    sameAs: 'vp9',
  },
  mpeg4: {
    label: 'MPEG-4 Part 2 (Xvid compatible)',
    codec: 'mpeg4',
    crf: { high: 2, balanced: 4, small: 7 },
    args: (q) => ['-q:v', String(q), '-tag', 'xvid'],
    pixFmt: () => 'yuv420p',
    sameAs: 'mpeg4',
  },
  wmv2: {
    label: 'WMV 8',
    codec: 'wmv2',
    crf: { high: 2, balanced: 4, small: 7 },
    args: (q) => ['-q:v', String(q)],
    pixFmt: () => 'yuv420p',
    sameAs: 'wmv2',
  },
  mpeg2: {
    label: 'MPEG-2',
    codec: 'mpeg2video',
    crf: { high: 2, balanced: 4, small: 7 },
    args: (q) => ['-q:v', String(q), '-maxrate', '40M', '-bufsize', '20M'],
    pixFmt: () => 'yuv420p',
    sameAs: 'mpeg2video',
  },
  theora: {
    label: 'Theora',
    codec: 'libtheora',
    crf: { high: 9, balanced: 7, small: 5 },
    args: (q) => ['-q:v', String(q)],
    pixFmt: () => 'yuv420p',
    sameAs: 'theora',
  },
  prores: {
    label: 'ProRes 422 HQ (editing, very large)',
    codec: 'prores_ks',
    crf: { high: 3, balanced: 2, small: 1 },
    args: (q) => ['-profile:v', String(q), '-vendor', 'apl0'],
    pixFmt: () => 'yuv422p10le',
    sameAs: 'prores',
  },
};

export function is10bit(stream) {
  return /10le|10be|12le|12be|p010/.test(stream?.pixFmt || '');
}

/** Audio encoder recipe; bitrate in kbps or 'auto' (transparent quality). */
export function audioEncoderArgs(kind, { bitrate = 'auto', channels = 2, outIndex = 'a' } = {}) {
  const spec = `:${outIndex}`;
  const ch = Math.max(1, channels || 2);
  switch (kind) {
    case 'aac': {
      const kbps = bitrate === 'auto' ? Math.min(768, Math.max(256, ch * 96)) : Number(bitrate);
      return [`-c${spec}`, 'aac', `-b${spec}`, `${kbps}k`];
    }
    case 'mp3':
      // "Automatic" = the format's maximum: 320 kbps CBR, highest encoder quality.
      return [`-c${spec}`, 'libmp3lame', `-b${spec}`, `${bitrate === 'auto' ? 320 : bitrate}k`, `-compression_level${spec}`, '0'];
    case 'opus': {
      const kbps = bitrate === 'auto' ? Math.min(512, Math.max(160, ch * 80)) : Number(bitrate);
      return [`-c${spec}`, 'libopus', `-b${spec}`, `${kbps}k`, `-vbr${spec}`, 'constrained', `-compression_level${spec}`, '10'];
    }
    case 'vorbis':
      return bitrate === 'auto' ? [`-c${spec}`, 'libvorbis', `-q${spec}`, '8'] : [`-c${spec}`, 'libvorbis', `-b${spec}`, `${bitrate}k`];
    case 'wma': {
      const kbps = bitrate === 'auto' ? 192 : Number(bitrate);
      return [`-c${spec}`, 'wmav2', `-b${spec}`, `${kbps}k`];
    }
    case 'ac3': {
      const kbps = bitrate === 'auto' ? (ch > 2 ? 640 : 384) : Number(bitrate);
      return [`-c${spec}`, 'ac3', `-b${spec}`, `${Math.min(640, kbps)}k`];
    }
    case 'mp2': {
      const kbps = bitrate === 'auto' ? 384 : Number(bitrate);
      return [`-c${spec}`, 'mp2', `-b${spec}`, `${Math.min(384, kbps)}k`];
    }
    case 'flac':
      return [`-c${spec}`, 'flac', `-compression_level${spec}`, '8'];
    case 'alac':
      return [`-c${spec}`, 'alac'];
    case 'pcm_s16le':
    case 'pcm_s24le':
    case 'pcm_s16be':
    case 'pcm_s24be':
      return [`-c${spec}`, kind];
    default:
      throw new Error(`Unknown audio encoder ${kind}`);
  }
}

/** Map our audio encoder names to the codec names ffprobe reports (for copy decisions). */
export const AUDIO_CODEC_OF = { aac: 'aac', mp3: 'mp3', opus: 'opus', vorbis: 'vorbis', wma: 'wmav2', ac3: 'ac3', mp2: 'mp2', flac: 'flac', alac: 'alac' };

/** Displayed (rotation-aware) dimensions of a video stream. */
export function displaySize(v) {
  if (!v?.width || !v?.height) return null;
  const rot = Math.abs(v.rotation || 0) % 180 === 90;
  return rot ? { width: v.height, height: v.width } : { width: v.width, height: v.height };
}
