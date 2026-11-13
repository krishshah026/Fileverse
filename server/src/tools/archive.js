import path from 'node:path';
import fs from 'node:fs/promises';
import { extractArchive, createArchive, walkFiles, ARCHIVE_LEVEL_OPTION, SINGLE } from '../engines/archive.js';
import { baseName } from '../registry/formats.js';
import { passwordInOption } from '../converters/archive.js';
import { ConversionError } from '../util/errors.js';

const EXTRACTABLE = ['zip', '7z', 'rar', 'tar', 'tar.gz', 'tar.bz2', 'tar.xz', 'gz', 'bz2', 'xz', 'iso', 'cbz', 'cbr'];
const MAX_INDIVIDUAL = 300;

export const archiveTools = [
  {
    id: 'archive-extract',
    title: 'Extract archive',
    description: 'Open ZIP, RAR, 7Z, TAR, GZ and ISO files and download what is inside.',
    category: 'archive',
    icon: 'extract',
    engines: ['sevenZip', 'tar'],
    weight: 'heavy',
    inputs: { formats: EXTRACTABLE, min: 1, max: 1 },
    output: null,
    options: (info, input) => (['zip', '7z', 'rar', 'cbz', 'cbr'].includes(input?.format) ? [passwordInOption] : []),
    quality: () => ({ level: 'lossless', message: 'Files are extracted exactly as they were stored.' }),
    async run(ctx) {
      const input = ctx.inputs[0];
      const dir = path.join(ctx.workDir, 'extracted');
      await extractArchive(input.path, input.format, dir, { password: ctx.options.password, signal: ctx.signal, singleName: SINGLE[input.format] ? baseName(input.name, input.format) : undefined });
      const files = await walkFiles(dir);
      if (!files.length) throw new ConversionError('The archive is empty.');
      if (files.length > MAX_INDIVIDUAL) {
        // Too many files to list individually: hand back one tidy ZIP instead.
        const out = ctx.outFile('zip', { suffix: ' (extracted)' });
        await createArchive(dir, 'zip', out, { level: 'fast', signal: ctx.signal });
        ctx.note(`The archive contains ${files.length.toLocaleString()} files, so they were packed into a single ZIP for download.`);
        return [out];
      }
      return files.map((f) => ({ path: f.abs, name: path.basename(f.rel), relPath: f.rel }));
    },
  },
  {
    id: 'archive-create',
    title: 'Create archive',
    description: 'Pack any files into a ZIP, 7Z or TAR archive — optionally password-protected with AES-256.',
    category: 'archive',
    icon: 'archive',
    engines: ['sevenZip', 'tar'],
    weight: 'heavy',
    inputs: { formats: '*', min: 1, max: 1000 },
    output: (input, options) => options?.format || 'zip',
    options: () => [
      { key: 'format', label: 'Format', type: 'select', default: 'zip', choices: [{ value: 'zip', label: 'ZIP — opens everywhere' }, { value: '7z', label: '7Z — smaller' }, { value: 'tar.gz', label: 'TAR.GZ' }, { value: 'tar.xz', label: 'TAR.XZ — smallest' }] },
      ARCHIVE_LEVEL_OPTION,
      { key: 'newPassword', label: 'Password (optional)', type: 'password', secret: true, showIf: { format: ['zip', '7z'] }, help: 'Encrypted with AES-256.' },
      { key: 'name', label: 'Archive name', type: 'text', placeholder: 'archive', maxLength: 120, pattern: '^[^/\\\\:*?"<>|]*$' },
    ],
    quality: () => ({ level: 'lossless', message: 'Archives are lossless: files are stored byte-for-byte.' }),
    async run(ctx) {
      const dir = path.join(ctx.workDir, 'pack');
      await fs.mkdir(dir, { recursive: true });
      const used = new Set();
      for (const input of ctx.inputs) {
        let name = input.name.replace(/[/\\]/g, '_');
        const dot = name.lastIndexOf('.');
        let n = 1;
        while (used.has(name.toLowerCase())) name = dot > 0 ? `${input.name.slice(0, dot)} (${++n})${input.name.slice(dot)}` : `${input.name} (${++n})`;
        used.add(name.toLowerCase());
        await fs.link(input.path, path.join(dir, name)).catch(() => fs.copyFile(input.path, path.join(dir, name)));
      }
      const format = ctx.options.format || 'zip';
      const out = ctx.outFile(format, { name: ctx.options.name?.trim() || (ctx.inputs.length === 1 ? undefined : 'archive') });
      await createArchive(dir, format, out, { level: ctx.options.level, password: ctx.options.newPassword, signal: ctx.signal });
      return [out];
    },
  },
];
