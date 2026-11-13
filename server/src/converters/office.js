import path from 'node:path';
import fs from 'node:fs/promises';
import { soffice, pdfExportFilter, csvExportFilter, csvImportFilter } from '../engines/libreoffice.js';

const WRITER_IN = ['docx', 'doc', 'odt', 'rtf', 'txt', 'html', 'pages'];
const WRITER_OUT = ['pdf', 'docx', 'doc', 'odt', 'rtf', 'txt'];
const CALC_IN = ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'numbers'];
const CALC_OUT = ['pdf', 'xlsx', 'xls', 'ods', 'csv', 'tsv', 'html'];
const IMPRESS_IN = ['pptx', 'ppt', 'ppsx', 'odp', 'key'];
const IMPRESS_OUT = ['pdf', 'pptx', 'ppt', 'odp'];

const appOf = (from) => (WRITER_IN.includes(from) ? 'writer' : CALC_IN.includes(from) ? 'calc' : 'impress');

function filterFor(from, to, options) {
  const app = appOf(from);
  if (to === 'pdf') return pdfExportFilter(from === 'html' ? 'writer_web' : app, { pdfa: options.pdfa, lossless: options.imageQuality === 'lossless' }).replace(
    /\}$/,
    app === 'calc' && options.singlePageSheets ? ',"SinglePageSheets":{"type":"boolean","value":"true"}}' : '}',
  );
  const map = {
    docx: 'docx:MS Word 2007 XML',
    doc: 'doc:MS Word 97',
    odt: 'odt:writer8',
    rtf: 'rtf:Rich Text Format',
    txt: 'txt:Text (encoded):UTF8',
    xlsx: 'xlsx:Calc MS Excel 2007 XML',
    xls: 'xls:MS Excel 97',
    ods: 'ods:calc8',
    csv: csvExportFilter(44, { allSheets: options.sheets !== 'first' }),
    tsv: csvExportFilter(9, { allSheets: options.sheets !== 'first' }),
    html: 'html:HTML (StarCalc)',
    pptx: 'pptx:Impress MS PowerPoint 2007 XML',
    ppt: 'ppt:MS PowerPoint 97',
    odp: 'odp:impress8',
  };
  return map[to];
}

function infilterFor(from) {
  if (from === 'csv') return csvImportFilter(44);
  if (from === 'tsv') return csvImportFilter(9);
  if (from === 'txt') return 'Text (encoded):UTF8';
  return undefined;
}

export const pdfExportOptions = [
  { key: 'imageQuality', label: 'Image quality', type: 'select', default: 'high', choices: [{ value: 'high', label: 'Original resolution, high quality (95%)' }, { value: 'lossless', label: 'Lossless images (larger file)' }] },
  { key: 'pdfa', label: 'PDF/A (archival)', type: 'toggle', default: false, help: 'Embeds all fonts and colour information for long-term archiving.' },
];

export default {
  id: 'office',
  label: 'Office converter',
  engines: ['soffice'],
  weight: 'heavy',
  routes: [
    { from: WRITER_IN, to: WRITER_OUT },
    { from: CALC_IN, to: CALC_OUT },
    { from: IMPRESS_IN, to: IMPRESS_OUT },
  ],
  priority: 5,
  options(from, to) {
    const opts = [];
    if (to === 'pdf') opts.push(...pdfExportOptions);
    if (to === 'pdf' && appOf(from) === 'calc') opts.push({ key: 'singlePageSheets', label: 'One page per sheet', type: 'toggle', default: false, help: 'Exports each sheet as a single (possibly very long) page instead of splitting it into printed pages.' });
    if ((to === 'csv' || to === 'tsv') && ['xlsx', 'xls', 'ods', 'numbers'].includes(from)) {
      opts.push({ key: 'sheets', label: 'Sheets', type: 'select', default: 'all', choices: [{ value: 'all', label: 'Every sheet (one file per sheet)' }, { value: 'first', label: 'First sheet only' }] });
    }
    return opts;
  },
  quality(from, to) {
    if (to === 'txt') return { level: 'lossy', message: 'Plain text keeps the words only — formatting, images and tables are removed.' };
    if (to === 'csv' || to === 'tsv') return { level: 'lossy', message: 'CSV/TSV store cell values only. Formulas are saved as their results; formatting and charts are not kept.' };
    if (to === 'pdf') return { level: 'high', message: 'The layout is rendered faithfully. Fonts that are not available on the server are replaced with metric-compatible equivalents.' };
    if (to === 'doc' || to === 'xls' || to === 'ppt') return { level: 'high', message: 'Legacy Office format: content is preserved, but features newer than Office 2003 may be simplified.' };
    if (from === 'csv' || from === 'tsv') return { level: 'lossless', message: 'All values are imported as UTF-8; numbers and dates are recognised automatically.' };
    return { level: 'high', message: 'Text, formatting, images and tables are preserved. Very complex layouts or macros may differ slightly.' };
  },
  async run(ctx) {
    const { from, to, options } = { from: ctx.input.format, to: ctx.to, options: ctx.options };
    const src = await ctx.inputWithExt();
    const outDir = path.join(ctx.workDir, 'lo-out');
    const produced = await soffice(src, filterFor(from, to, options), outDir, { infilter: infilterFor(from), signal: ctx.signal });
    const results = produced.filter((f) => f.toLowerCase().endsWith(`.${to}`));
    if (results.length <= 1) {
      const out = ctx.outFile(to);
      await fs.rename(results[0] || produced[0], out);
      return [out];
    }
    // Multiple sheets → one file per sheet, named after the sheet.
    const stem = path.basename(src).replace(/\.[^.]+$/, '');
    const outs = [];
    for (const f of results.sort()) {
      const sheet = path.basename(f).slice(stem.length + 1).replace(/\.[^.]+$/, '');
      const out = ctx.outFile(to, { suffix: ` - ${sheet}` });
      await fs.rename(f, out);
      outs.push(out);
    }
    ctx.note(`The workbook has ${outs.length} sheets, so ${outs.length} ${to.toUpperCase()} files were created.`);
    return outs;
  },
};
