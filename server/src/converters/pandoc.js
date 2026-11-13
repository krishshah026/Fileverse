import path from 'node:path';
import fs from 'node:fs/promises';
import { detectEngines } from '../engines/available.js';
import { run } from '../util/proc.js';
import { zipDirectory } from '../engines/archive.js';

const READER = { md: 'markdown', html: 'html', docx: 'docx', odt: 'odt', epub: 'epub', rtf: 'rtf' };
const WRITER = { md: 'gfm', html: 'html5', docx: 'docx', odt: 'odt', epub: 'epub3', txt: 'plain' };

export default {
  id: 'pandoc',
  label: 'Markup converter (Pandoc)',
  engines: ['pandoc'],
  weight: 'light',
  priority: 8,
  routes: [
    { from: ['md'], to: ['html', 'docx', 'odt', 'epub', 'txt'] },
    { from: ['docx', 'odt', 'epub', 'html', 'rtf'], to: ['md'] },
    { from: ['docx', 'odt', 'epub', 'rtf'], to: ['html'] },
    { from: ['docx', 'odt', 'html'], to: ['epub'] },
    { from: ['epub'], to: ['docx', 'odt', 'txt'] },
  ],
  options(from, to) {
    const opts = [];
    if (to === 'md') {
      opts.push({ key: 'flavor', label: 'Markdown flavour', type: 'select', default: 'gfm', choices: [{ value: 'gfm', label: 'GitHub (GFM)' }, { value: 'commonmark_x', label: 'CommonMark' }, { value: 'markdown', label: 'Pandoc Markdown' }] });
    }
    if (['html', 'docx', 'odt', 'epub'].includes(to)) opts.push({ key: 'toc', label: 'Add table of contents', type: 'toggle', default: false });
    return opts;
  },
  quality(from, to) {
    if (to === 'md') return { level: 'high', message: 'Structure is kept (headings, lists, tables, links, emphasis). Page layout and fonts do not exist in Markdown. Images are packaged next to the file.' };
    if (to === 'html') return { level: 'high', message: 'A single self-contained HTML file with images embedded.' };
    if (to === 'txt') return { level: 'lossy', message: 'Plain text keeps the words only.' };
    if (from === 'md') return { level: 'high', message: 'Markdown is converted with proper headings, lists, tables and code blocks.' };
    return { level: 'high', message: 'Content and structure are preserved; visual styling is simplified.' };
  },
  async run(ctx) {
    const e = detectEngines();
    const { to, options } = ctx;
    const src = await ctx.inputWithExt();
    const args = ['-f', READER[ctx.input.format] || ctx.input.format, '-t', to === 'md' ? options.flavor || 'gfm' : WRITER[to], '--wrap=none'];
    if (['html', 'epub', 'docx', 'odt'].includes(to)) args.push('--standalone');
    if (to === 'html') args.push('--embed-resources', '--metadata', `title=${ctx.baseName}`);
    if (to === 'epub') args.push('--metadata', `title=${ctx.baseName}`);
    if (options.toc) args.push('--toc');
    const mediaDir = path.join(ctx.workDir, 'md-export');
    if (to === 'md') args.push(`--extract-media=${mediaDir}`);
    const out = ctx.outFile(to);
    await run(e.pandoc, [...args, '-o', out, src], { signal: ctx.signal, cwd: ctx.workDir, friendly: 'The document could not be converted.' });
    if (to === 'md') {
      const hasMedia = await fs.readdir(mediaDir).then((l) => l.length > 0).catch(() => false);
      if (hasMedia) {
        // Rewrite absolute media paths to relative ones and ship .md + images together.
        const md = (await fs.readFile(out, 'utf8')).split(mediaDir).join('media');
        const bundleDir = path.join(ctx.workDir, 'bundle');
        await fs.mkdir(bundleDir, { recursive: true });
        await fs.writeFile(path.join(bundleDir, path.basename(out)), md);
        await fs.cp(mediaDir, path.join(bundleDir, 'media'), { recursive: true });
        const zip = ctx.outFile('zip');
        await zipDirectory(bundleDir, zip);
        await fs.rm(out, { force: true });
        ctx.note('The document contains images, so the Markdown file and its images were packaged together in a ZIP.');
        return [zip];
      }
    }
    return [out];
  },
};
