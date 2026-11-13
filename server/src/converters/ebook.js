import { detectEngines } from '../engines/available.js';
import { run } from '../util/proc.js';

const EBOOK_IN = ['epub', 'mobi', 'azw3', 'fb2'];
const COMICS = ['cbz', 'cbr'];
const EBOOK_OUT = ['epub', 'mobi', 'azw3', 'fb2', 'pdf', 'docx', 'txt'];

export default {
  id: 'ebook',
  label: 'Ebook converter (Calibre)',
  engines: ['calibre'],
  weight: 'heavy',
  priority: 6,
  routes: [
    { from: EBOOK_IN, to: EBOOK_OUT },
    // Comics are page images: text formats would be empty, so only image-capable targets are offered.
    { from: COMICS, to: ['epub', 'mobi', 'azw3', 'pdf'] },
    { from: ['docx', 'odt', 'rtf', 'txt', 'html', 'md', 'pdf'], to: ['epub', 'mobi', 'azw3', 'fb2'] },
  ],
  options(from, to) {
    const opts = [];
    if (to === 'pdf') {
      opts.push({ key: 'paper', label: 'Paper size', type: 'select', default: 'a5', choices: [{ value: 'a5', label: 'A5 (book)' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'US Letter' }] });
      opts.push({ key: 'fontSize', label: 'Base font size', type: 'select', default: '14', choices: ['10', '12', '14', '16', '18', '20'].map((v) => ({ value: v, label: `${v} pt` })) });
    }
    return opts;
  },
  quality(from, to) {
    if (from === 'pdf') return { level: 'high', message: 'PDF pages are re-flowed into an ebook. Text flows well; complex page layouts (columns, footnotes) are simplified.' };
    if (from === 'cbz' || from === 'cbr') return { level: 'high', message: 'Comic pages are kept as full-resolution images.' };
    if (to === 'txt') return { level: 'lossy', message: 'Plain text keeps the words only.' };
    return { level: 'high', message: 'Text, chapters, images and metadata (title, author, cover) are preserved. DRM-protected books cannot be converted.' };
  },
  async run(ctx) {
    const e = detectEngines();
    const src = await ctx.inputWithExt();
    const out = ctx.outFile(ctx.to);
    const args = [src, out];
    if (ctx.to === 'pdf') args.push('--paper-size', ctx.options.paper || 'a5', '--pdf-default-font-size', String(ctx.options.fontSize || 14), '--pdf-page-numbers', '--preserve-cover-aspect-ratio');
    if (ctx.to === 'mobi') args.push('--mobi-file-type', 'both');
    if (ctx.input.format === 'pdf') args.push('--enable-heuristics');
    if (ctx.input.format === 'md') args.push('--formatting-type', 'markdown', '--paragraph-type', 'off');
    await run(e.calibre, args, {
      signal: ctx.signal,
      env: { QT_QPA_PLATFORM: 'offscreen', QTWEBENGINE_CHROMIUM_FLAGS: '--no-sandbox', QTWEBENGINE_DISABLE_SANDBOX: '1', CALIBRE_CONFIG_DIRECTORY: `${ctx.workDir}/calibre-config` },
      onStdoutLine: (line) => {
        const m = /^(\d{1,3})%/.exec(line.trim());
        if (m) ctx.progress(Math.min(0.99, Number(m[1]) / 100));
      },
      friendly: /drm/i.test(ctx.input.name) ? 'This ebook appears to be DRM protected and cannot be converted.' : 'The ebook could not be converted. It may be DRM protected or damaged.',
    });
    return [out];
  },
};
