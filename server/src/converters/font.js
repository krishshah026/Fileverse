import { detectEngines } from '../engines/available.js';
import { python } from './pdf.js';

const FONTS = ['ttf', 'otf', 'woff', 'woff2'];

export default {
  id: 'font',
  label: 'Font converter',
  engines: ['py.fontTools', 'py.brotli', 'fontforge'],
  weight: 'light',
  routes: [{ from: FONTS, to: FONTS }],
  options() {
    return [];
  },
  quality(from, to) {
    if (to === 'woff' || to === 'woff2') return { level: 'lossless', message: 'Web font compression is lossless — every glyph, kerning pair and OpenType feature is kept.' };
    if ((from === 'otf' && to === 'ttf') || (from === 'ttf' && to === 'otf')) return { level: 'high', message: 'Outlines are converted between TrueType and PostScript curves with high precision; hinting may differ.' };
    return { level: 'lossless', message: 'The font data is unpacked without changes.' };
  },
  async run(ctx) {
    const out = ctx.outFile(ctx.to);
    await python('font_convert.py', [ctx.input.path, out, ctx.to, detectEngines().fontforge || 'fontforge'], ctx);
    return [out];
  },
};
