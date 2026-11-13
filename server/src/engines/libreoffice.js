import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { paths } from '../config.js';
import { detectEngines } from './available.js';
import { run } from '../util/proc.js';
import { ConversionError } from '../util/errors.js';

/**
 * LibreOffice keeps per-user state in a profile directory and refuses to run twice against the
 * same profile. Every job gets its own copy of a pre-initialised template profile so conversions
 * run in parallel and start fast (~1s instead of ~5s for a cold profile).
 */
let templateReady = null;

async function ensureTemplate() {
  if (!templateReady) {
    templateReady = (async () => {
      const dir = path.join(paths.tmp, 'lo-template');
      try {
        await fs.access(path.join(dir, 'user'));
        return dir;
      } catch {
        /* create it */
      }
      await fs.mkdir(dir, { recursive: true });
      const e = detectEngines();
      await run(e.soffice, ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', `-env:UserInstallation=${pathToFileURL(dir).href}`, '--terminate_after_init'], { allowedCodes: [0, 1, 81] }).catch(() => {});
      return dir;
    })();
  }
  return templateReady;
}

/**
 * Converts `inputPath` (which must carry the right extension) with a LibreOffice export filter.
 * Returns the list of produced files in outDir.
 */
export async function soffice(inputPath, filter, outDir, { infilter, signal, timeoutMs = 30 * 60 * 1000 } = {}) {
  const e = detectEngines();
  const profile = path.join(path.dirname(outDir), `lo-profile-${Math.random().toString(36).slice(2)}`);
  const template = await ensureTemplate();
  await fs.cp(template, profile, { recursive: true }).catch(() => fs.mkdir(profile, { recursive: true }));
  await fs.mkdir(outDir, { recursive: true });
  const args = ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard', `-env:UserInstallation=${pathToFileURL(profile).href}`];
  if (infilter) args.push(`--infilter=${infilter}`);
  args.push('--convert-to', filter, '--outdir', outDir, inputPath);
  const timer = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timer]) : timer;
  try {
    const before = new Set(await fs.readdir(outDir));
    const { stdout, stderr } = await run(e.soffice, args, { signal: combined, env: { HOME: profile, SAL_USE_VCLPLUGIN: 'svp' }, friendly: 'The office document could not be converted.' });
    const produced = (await fs.readdir(outDir)).filter((f) => !before.has(f));
    if (!produced.length) {
      const msg = `${stdout}\n${stderr}`;
      if (/password/i.test(msg)) throw new ConversionError('This document is password protected. Remove the password and try again.');
      throw new ConversionError('LibreOffice could not open this document. It may be damaged, password protected, or in an unsupported variant of the format.', { detail: msg.slice(-2000) });
    }
    return produced.map((f) => path.join(outDir, f));
  } finally {
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

/** JSON filter options (LibreOffice ≥ 7.4). */
export function pdfExportFilter(app, { pdfa = false, lossless = false } = {}) {
  const opts = {
    ReduceImageResolution: { type: 'boolean', value: 'false' },
    Quality: { type: 'long', value: '95' },
    ExportBookmarks: { type: 'boolean', value: 'true' },
    ExportFormFields: { type: 'boolean', value: 'true' },
  };
  if (lossless) opts.UseLosslessCompression = { type: 'boolean', value: 'true' };
  if (pdfa) opts.SelectPdfVersion = { type: 'long', value: '2' };
  return `pdf:${app}_pdf_Export:${JSON.stringify(opts)}`;
}

/** CSV filter tokens: separator, quote, charset(76 = UTF-8), first line, …, sheet (-1 = all sheets). */
export function csvExportFilter(sep, { allSheets = true } = {}) {
  return `csv:Text - txt - csv (StarCalc):${sep},34,76,1,,0,false,true,false,false,false,${allSheets ? '-1' : '1'}`;
}
export function csvImportFilter(sep) {
  return `CSV:${sep},34,76,1`;
}
