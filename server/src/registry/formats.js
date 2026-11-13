/**
 * The format catalog. Every format the platform knows about lives here exactly once.
 * `ext` lists file extensions (first one is the canonical output extension).
 * `codec` hints whether the format is inherently lossy, lossless or can be either.
 */

export const CATEGORIES = [
  { id: 'image', name: 'Images', blurb: 'PNG, JPG, WEBP, AVIF, HEIC, SVG and more' },
  { id: 'video', name: 'Video', blurb: 'MP4, MKV, MOV, WEBM, AVI and more — multi-GB files welcome' },
  { id: 'audio', name: 'Audio', blurb: 'MP3, WAV, FLAC, AAC, OPUS and more' },
  { id: 'pdf', name: 'PDF', blurb: 'Convert, merge, split, compress, OCR and protect PDFs' },
  { id: 'document', name: 'Documents', blurb: 'Word, OpenDocument, RTF, Markdown, HTML, text' },
  { id: 'spreadsheet', name: 'Spreadsheets', blurb: 'Excel, OpenDocument, CSV, TSV' },
  { id: 'presentation', name: 'Presentations', blurb: 'PowerPoint, Keynote, OpenDocument' },
  { id: 'ebook', name: 'Ebooks', blurb: 'EPUB, MOBI, AZW3, FB2, comic archives' },
  { id: 'archive', name: 'Archives', blurb: 'ZIP, 7Z, RAR, TAR, GZ — extract, create, convert' },
  { id: 'data', name: 'Data', blurb: 'JSON, YAML, XML, TOML, CSV for developers' },
  { id: 'subtitle', name: 'Subtitles', blurb: 'SRT, VTT, ASS, SSA, LRC' },
  { id: 'font', name: 'Fonts', blurb: 'TTF, OTF, WOFF, WOFF2' },
];

const F = (id, name, category, ext, mime, codec, extra = {}) => ({ id, name, category, ext, mime, codec, ...extra });

export const FORMATS = [
  // Images
  F('png', 'PNG', 'image', ['png'], 'image/png', 'lossless', { alpha: true }),
  F('jpg', 'JPG', 'image', ['jpg', 'jpeg', 'jpe', 'jfif'], 'image/jpeg', 'lossy'),
  F('webp', 'WEBP', 'image', ['webp'], 'image/webp', 'both', { alpha: true, animated: true }),
  F('avif', 'AVIF', 'image', ['avif'], 'image/avif', 'both', { alpha: true }),
  F('gif', 'GIF', 'image', ['gif'], 'image/gif', 'lossless', { alpha: true, animated: true, note: 'GIF is limited to 256 colours per frame.' }),
  F('bmp', 'BMP', 'image', ['bmp', 'dib'], 'image/bmp', 'lossless'),
  F('tiff', 'TIFF', 'image', ['tiff', 'tif'], 'image/tiff', 'lossless', { alpha: true }),
  F('ico', 'ICO', 'image', ['ico'], 'image/vnd.microsoft.icon', 'lossless', { alpha: true }),
  F('svg', 'SVG', 'image', ['svg'], 'image/svg+xml', 'lossless', { vector: true }),
  F('heic', 'HEIC', 'image', ['heic', 'heif', 'hif'], 'image/heic', 'lossy', { inputOnly: true }),
  F('tga', 'TGA', 'image', ['tga'], 'image/x-tga', 'lossless', { alpha: true }),
  F('psd', 'PSD', 'image', ['psd'], 'image/vnd.adobe.photoshop', 'lossless', { inputOnly: true }),

  // Video
  F('mp4', 'MP4', 'video', ['mp4'], 'video/mp4', 'lossy'),
  F('mkv', 'MKV', 'video', ['mkv'], 'video/x-matroska', 'lossy'),
  F('mov', 'MOV', 'video', ['mov', 'qt'], 'video/quicktime', 'lossy'),
  F('webm', 'WEBM', 'video', ['webm'], 'video/webm', 'lossy'),
  F('avi', 'AVI', 'video', ['avi'], 'video/x-msvideo', 'lossy'),
  F('wmv', 'WMV', 'video', ['wmv', 'asf'], 'video/x-ms-wmv', 'lossy'),
  F('flv', 'FLV', 'video', ['flv'], 'video/x-flv', 'lossy'),
  F('mpeg', 'MPEG', 'video', ['mpeg', 'mpg', 'vob', 'mpe'], 'video/mpeg', 'lossy'),
  F('m4v', 'M4V', 'video', ['m4v'], 'video/x-m4v', 'lossy'),
  F('3gp', '3GP', 'video', ['3gp', '3g2'], 'video/3gpp', 'lossy'),
  F('ts', 'TS', 'video', ['ts', 'mts', 'm2ts'], 'video/mp2t', 'lossy'),
  F('ogv', 'OGV', 'video', ['ogv'], 'video/ogg', 'lossy'),

  // Audio
  F('mp3', 'MP3', 'audio', ['mp3'], 'audio/mpeg', 'lossy'),
  F('wav', 'WAV', 'audio', ['wav', 'wave'], 'audio/wav', 'lossless'),
  F('flac', 'FLAC', 'audio', ['flac'], 'audio/flac', 'lossless'),
  F('aac', 'AAC', 'audio', ['aac'], 'audio/aac', 'lossy'),
  F('m4a', 'M4A', 'audio', ['m4a'], 'audio/mp4', 'both'),
  F('ogg', 'OGG', 'audio', ['ogg', 'oga'], 'audio/ogg', 'lossy'),
  F('opus', 'OPUS', 'audio', ['opus'], 'audio/opus', 'lossy'),
  F('wma', 'WMA', 'audio', ['wma'], 'audio/x-ms-wma', 'lossy'),
  F('aiff', 'AIFF', 'audio', ['aiff', 'aif', 'aifc'], 'audio/aiff', 'lossless'),
  F('ac3', 'AC3', 'audio', ['ac3'], 'audio/ac3', 'lossy'),
  F('amr', 'AMR', 'audio', ['amr'], 'audio/amr', 'lossy', { inputOnly: true }),

  // PDF
  F('pdf', 'PDF', 'pdf', ['pdf'], 'application/pdf', undefined),

  // Documents
  F('docx', 'DOCX', 'document', ['docx'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  F('doc', 'DOC', 'document', ['doc'], 'application/msword'),
  F('odt', 'ODT', 'document', ['odt'], 'application/vnd.oasis.opendocument.text'),
  F('rtf', 'RTF', 'document', ['rtf'], 'application/rtf'),
  F('txt', 'TXT', 'document', ['txt', 'text', 'log'], 'text/plain'),
  F('html', 'HTML', 'document', ['html', 'htm', 'xhtml'], 'text/html'),
  F('md', 'Markdown', 'document', ['md', 'markdown'], 'text/markdown'),
  F('pages', 'Pages', 'document', ['pages'], 'application/vnd.apple.pages', undefined, { inputOnly: true }),

  // Spreadsheets
  F('xlsx', 'XLSX', 'spreadsheet', ['xlsx'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
  F('xls', 'XLS', 'spreadsheet', ['xls'], 'application/vnd.ms-excel'),
  F('ods', 'ODS', 'spreadsheet', ['ods'], 'application/vnd.oasis.opendocument.spreadsheet'),
  F('csv', 'CSV', 'spreadsheet', ['csv'], 'text/csv'),
  F('tsv', 'TSV', 'spreadsheet', ['tsv', 'tab'], 'text/tab-separated-values'),
  F('numbers', 'Numbers', 'spreadsheet', ['numbers'], 'application/vnd.apple.numbers', undefined, { inputOnly: true }),

  // Presentations
  F('pptx', 'PPTX', 'presentation', ['pptx'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation'),
  F('ppt', 'PPT', 'presentation', ['ppt', 'pps'], 'application/vnd.ms-powerpoint'),
  F('ppsx', 'PPSX', 'presentation', ['ppsx'], 'application/vnd.openxmlformats-officedocument.presentationml.slideshow', undefined, { inputOnly: true }),
  F('odp', 'ODP', 'presentation', ['odp'], 'application/vnd.oasis.opendocument.presentation'),
  F('key', 'Keynote', 'presentation', ['key'], 'application/vnd.apple.keynote', undefined, { inputOnly: true }),

  // Ebooks
  F('epub', 'EPUB', 'ebook', ['epub'], 'application/epub+zip'),
  F('mobi', 'MOBI', 'ebook', ['mobi', 'prc'], 'application/x-mobipocket-ebook'),
  F('azw3', 'AZW3', 'ebook', ['azw3', 'azw'], 'application/vnd.amazon.ebook'),
  F('fb2', 'FB2', 'ebook', ['fb2'], 'application/x-fictionbook+xml'),
  F('cbz', 'CBZ', 'ebook', ['cbz'], 'application/vnd.comicbook+zip', undefined, { inputOnly: true }),
  F('cbr', 'CBR', 'ebook', ['cbr'], 'application/vnd.comicbook-rar', undefined, { inputOnly: true }),

  // Archives (multi-part extensions are matched before single ones)
  F('zip', 'ZIP', 'archive', ['zip'], 'application/zip'),
  F('7z', '7Z', 'archive', ['7z'], 'application/x-7z-compressed'),
  F('tar', 'TAR', 'archive', ['tar'], 'application/x-tar'),
  F('tar.gz', 'TAR.GZ', 'archive', ['tar.gz', 'tgz'], 'application/gzip'),
  F('tar.bz2', 'TAR.BZ2', 'archive', ['tar.bz2', 'tbz2', 'tbz'], 'application/x-bzip2'),
  F('tar.xz', 'TAR.XZ', 'archive', ['tar.xz', 'txz'], 'application/x-xz'),
  F('gz', 'GZ', 'archive', ['gz'], 'application/gzip', undefined, { singleFile: true }),
  F('bz2', 'BZ2', 'archive', ['bz2'], 'application/x-bzip2', undefined, { singleFile: true }),
  F('xz', 'XZ', 'archive', ['xz'], 'application/x-xz', undefined, { singleFile: true }),
  F('rar', 'RAR', 'archive', ['rar'], 'application/vnd.rar', undefined, { inputOnly: true, note: 'RAR is a proprietary format: it can be extracted or converted, not created.' }),
  F('iso', 'ISO', 'archive', ['iso'], 'application/x-iso9660-image', undefined, { inputOnly: true }),

  // Data
  F('json', 'JSON', 'data', ['json'], 'application/json'),
  F('yaml', 'YAML', 'data', ['yaml', 'yml'], 'application/yaml'),
  F('xml', 'XML', 'data', ['xml'], 'application/xml'),
  F('toml', 'TOML', 'data', ['toml'], 'application/toml'),

  // Subtitles
  F('srt', 'SRT', 'subtitle', ['srt'], 'application/x-subrip'),
  F('vtt', 'VTT', 'subtitle', ['vtt'], 'text/vtt'),
  F('ass', 'ASS', 'subtitle', ['ass'], 'text/x-ass'),
  F('ssa', 'SSA', 'subtitle', ['ssa'], 'text/x-ssa'),
  F('lrc', 'LRC', 'subtitle', ['lrc'], 'application/x-lrc'),

  // Fonts
  F('ttf', 'TTF', 'font', ['ttf'], 'font/ttf'),
  F('otf', 'OTF', 'font', ['otf'], 'font/otf'),
  F('woff', 'WOFF', 'font', ['woff'], 'font/woff'),
  F('woff2', 'WOFF2', 'font', ['woff2'], 'font/woff2'),
];

export const FORMAT_BY_ID = new Map(FORMATS.map((f) => [f.id, f]));

/** Extensions sorted longest first so "tar.gz" wins over "gz". */
const EXT_INDEX = FORMATS.flatMap((f) => f.ext.map((e) => [e, f.id])).sort((a, b) => b[0].length - a[0].length);

export function formatFromName(name = '') {
  const lower = String(name).toLowerCase();
  for (const [ext, id] of EXT_INDEX) {
    if (lower.endsWith('.' + ext)) return id;
  }
  return null;
}

export function getFormat(id) {
  return FORMAT_BY_ID.get(id) || null;
}

export function formatsIn(category) {
  return FORMATS.filter((f) => f.category === category).map((f) => f.id);
}

/** Strips the format extension (including multi-part ones) from a file name. */
export function baseName(name, formatId) {
  const fmt = formatId && getFormat(formatId);
  const lower = name.toLowerCase();
  if (fmt) {
    for (const e of [...fmt.ext].sort((a, b) => b.length - a.length)) {
      if (lower.endsWith('.' + e)) return name.slice(0, -(e.length + 1)) || 'file';
    }
  }
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name || 'file';
}

export function outputExt(formatId) {
  return getFormat(formatId)?.ext[0] ?? formatId;
}
