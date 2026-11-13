import { config } from '../config.js';
import { which, pythonHasModule } from '../util/proc.js';

/**
 * Detects which conversion engines are installed. Converters declare the engines they need;
 * routes whose engines are missing are simply not offered, so the UI never shows a dead option.
 */
let cache = null;

export function detectEngines() {
  if (cache) return cache;
  const b = config.bins;
  const py = which(b.python);
  const magick = b.magick ? which(b.magick) : which('magick') || which('convert');
  const sevenZip = b.sevenZip ? which(b.sevenZip) : which('7zz') || which('7z');
  const e = {
    ffmpeg: which(b.ffmpeg),
    ffprobe: which(b.ffprobe),
    magick,
    magickIsV7: Boolean(magick && magick.endsWith('magick')),
    soffice: which(b.soffice) || which('libreoffice'),
    pandoc: which(b.pandoc),
    qpdf: which(b.qpdf),
    gs: which(b.gs),
    pdftoppm: which(b.pdftoppm),
    pdftotext: which(b.pdftotext),
    pdftohtml: which(b.pdftohtml),
    sevenZip,
    tar: which(b.tar),
    calibre: which(b.calibre),
    fontforge: which(b.fontforge),
    ocrmypdf: which(b.ocrmypdf),
    tesseract: which(b.tesseract),
    heifConvert: which(b.heifConvert),
    python: py,
    py: {
      pdf2docx: Boolean(py && pythonHasModule(py, 'pdf2docx')),
      pdfplumber: Boolean(py && pythonHasModule(py, 'pdfplumber')),
      openpyxl: Boolean(py && pythonHasModule(py, 'openpyxl')),
      pptx: Boolean(py && pythonHasModule(py, 'pptx')),
      img2pdf: Boolean(py && pythonHasModule(py, 'img2pdf')),
      fontTools: Boolean(py && pythonHasModule(py, 'fontTools')),
      brotli: Boolean(py && pythonHasModule(py, 'brotli')),
    },
    sharp: true,
  };
  cache = e;
  return e;
}

/** Returns true when every requirement is available. Requirements look like 'ffmpeg' or 'py.pdf2docx'. */
export function hasAll(reqs = []) {
  const e = detectEngines();
  return reqs.every((r) => {
    if (r.startsWith('py.')) return Boolean(e.py[r.slice(3)]);
    return Boolean(e[r]);
  });
}

export function engineSummary() {
  const e = detectEngines();
  const out = {};
  for (const [k, v] of Object.entries(e)) {
    if (k === 'py') for (const [m, ok] of Object.entries(v)) out[`python:${m}`] = ok;
    else if (k !== 'magickIsV7') out[k] = Boolean(v);
  }
  return out;
}
