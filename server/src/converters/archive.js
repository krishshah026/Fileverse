import path from 'node:path';
import { extractArchive, createArchive, ARCHIVE_LEVEL_OPTION, SINGLE, walkFiles } from '../engines/archive.js';
import { baseName } from '../registry/formats.js';

const MULTI_IN = ['zip', '7z', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'rar', 'iso'];
const MULTI_OUT = ['zip', '7z', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz'];
const SINGLE_IN = ['gz', 'bz2', 'xz'];

export const passwordInOption = { key: 'password', label: 'Archive password', type: 'password', secret: true, help: 'Only needed if the archive is encrypted.' };
export const passwordOutOption = { key: 'newPassword', label: 'Protect with password', type: 'password', secret: true, help: 'Optional. ZIP uses AES-256; 7Z also encrypts file names.' };

export default {
  id: 'archive',
  label: 'Archive converter',
  engines: ['sevenZip', 'tar'],
  weight: 'heavy',
  routes: [
    { from: MULTI_IN, to: MULTI_OUT },
    { from: SINGLE_IN, to: ['gz', 'bz2', 'xz', 'zip', '7z'] },
  ],
  options(from, to) {
    const opts = [];
    if (['zip', '7z', 'rar'].includes(from)) opts.push(passwordInOption);
    if (to !== 'tar') opts.push(ARCHIVE_LEVEL_OPTION);
    if (to === 'zip' || to === '7z') opts.push(passwordOutOption);
    return opts;
  },
  quality() {
    return { level: 'lossless', message: 'Archives are lossless: every file is repacked byte-for-byte, with folder structure preserved.' };
  },
  async run(ctx) {
    const dir = path.join(ctx.workDir, 'contents');
    const inner = SINGLE[ctx.input.format] ? baseName(ctx.input.name, ctx.input.format) || 'file' : undefined;
    await extractArchive(ctx.input.path, ctx.input.format, dir, { password: ctx.options.password, signal: ctx.signal, singleName: inner });
    ctx.progress(0.5);
    const files = await walkFiles(dir);
    if (!files.length) ctx.note('The archive is empty.');
    const out = ctx.outFile(ctx.to);
    await createArchive(dir, ctx.to, out, { level: ctx.options.level, password: ctx.options.newPassword, signal: ctx.signal });
    return [out];
  },
};

export { MULTI_IN, MULTI_OUT, SINGLE_IN };
