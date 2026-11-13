import { hasAll } from '../engines/available.js';
import { FORMATS, CATEGORIES, getFormat, formatsIn } from './formats.js';
import { publicSpecs } from './options.js';

import video from '../converters/video.js';
import audio from '../converters/audio.js';
import subtitle from '../converters/subtitle.js';
import image, { IMAGE_OUT } from '../converters/image.js';
import office from '../converters/office.js';
import pandoc from '../converters/pandoc.js';
import data from '../converters/data.js';
import pdf from '../converters/pdf.js';
import ebook from '../converters/ebook.js';
import font from '../converters/font.js';
import archive from '../converters/archive.js';
import { pdfTools } from '../tools/pdf.js';
import { mediaTools } from '../tools/media.js';
import { imageTools } from '../tools/image.js';
import { archiveTools } from '../tools/archive.js';

export const CONVERTERS = [video, audio, subtitle, image, office, pandoc, data, pdf, ebook, font, archive];
const ALL_TOOLS = [...pdfTools, ...imageTools, ...mediaTools, ...archiveTools];
const CONVERTER_BY_ID = new Map(CONVERTERS.map((c) => [c.id, c]));

/**
 * Two-step routes through a lossless or structural "pivot" format, used only when no direct
 * converter exists. Every rule here was chosen so the extra hop costs no quality.
 */
const PIVOTS = [
  { via: 'pdf', fromCategories: ['document', 'spreadsheet', 'presentation', 'ebook'], to: ['png', 'jpg', 'tiff'] },
  { via: 'docx', from: ['pdf', 'md', 'html', 'rtf', 'odt', 'txt', 'pages', 'doc', 'epub'], to: ['odt', 'rtf', 'doc', 'md', 'html', 'epub', 'txt', 'pdf'] },
  { via: 'png', fromCategories: ['image'], to: [...IMAGE_OUT, 'pdf'] },
  { via: 'png', from: ['pdf'], to: ['webp', 'avif', 'gif', 'bmp'] },
  { via: 'csv', fromCategories: ['spreadsheet'], to: ['json', 'yaml', 'xml', 'toml'] },
  { via: 'csv', fromCategories: ['data'], to: ['xlsx', 'ods', 'xls', 'pdf'] },
  { via: 'epub', from: ['mobi', 'azw3', 'fb2'], to: ['md', 'html', 'odt'] },
];

const LEVEL_RANK = { lossless: 0, high: 1, lossy: 2 };

let graph = null;

function routeOk(conv, route) {
  return hasAll([...(conv.engines || []), ...(route.engines || [])]);
}

/** from → to → converter (best priority wins). */
function buildGraph() {
  const g = new Map();
  for (const conv of CONVERTERS) {
    for (const route of conv.routes) {
      if (!routeOk(conv, route)) continue;
      for (const f of route.from) {
        for (const t of route.to) {
          if (f === t || getFormat(t)?.inputOnly) continue;
          if (!g.has(f)) g.set(f, new Map());
          const cur = g.get(f).get(t);
          if (!cur || (conv.priority ?? 0) > (cur.priority ?? 0)) g.get(f).set(t, conv);
        }
      }
    }
  }
  return g;
}

function getGraph() {
  if (!graph) graph = buildGraph();
  return graph;
}

/** All routes from a format: [{ to, steps: [{ converter, from, to }] }]. */
export function routesFrom(from) {
  const g = getGraph();
  const direct = g.get(from) || new Map();
  const routes = [...direct.entries()].map(([to, conv]) => ({ to, steps: [{ converter: conv.id, from, to }] }));
  const have = new Set(direct.keys());
  const cat = getFormat(from)?.category;
  for (const rule of PIVOTS) {
    const matches = rule.from ? rule.from.includes(from) : rule.fromCategories.includes(cat);
    if (!matches || from === rule.via || !direct.has(rule.via)) continue;
    const second = g.get(rule.via) || new Map();
    for (const to of rule.to) {
      if (to === from || have.has(to) || !second.has(to)) continue;
      have.add(to);
      routes.push({ to, steps: [{ converter: direct.get(rule.via).id, from, to: rule.via }, { converter: second.get(to).id, from: rule.via, to }] });
    }
  }
  return routes;
}

export function findRoute(from, to) {
  return routesFrom(from).find((r) => r.to === to) || null;
}

export function getConverter(id) {
  return CONVERTER_BY_ID.get(id);
}

/** Resolves accepted-ness, option specs and the quality statement for a route. */
export async function describeRoute(route, info, options = {}) {
  const specs = [];
  const seen = new Set();
  let quality = null;
  let rejected = null;
  for (const [i, step] of route.steps.entries()) {
    const conv = getConverter(step.converter);
    const stepInfo = i === 0 ? info : null;
    if (conv.accepts) {
      const ok = conv.accepts(step.from, step.to, stepInfo);
      if (ok !== true) rejected = typeof ok === 'string' ? ok : 'Not available for this file.';
    }
    const s = (await conv.options?.(step.from, step.to, stepInfo)) || [];
    for (const spec of s) {
      if (seen.has(spec.key)) continue;
      seen.add(spec.key);
      specs.push({ ...spec, step: i });
    }
    const q = conv.quality?.(step.from, step.to, stepInfo, options) || { level: 'high', message: '' };
    if (!quality || LEVEL_RANK[q.level] > LEVEL_RANK[quality.level]) quality = q;
  }
  return { specs, quality, rejected };
}

export function availableTools() {
  return ALL_TOOLS.filter((t) => hasAll(t.engines || []));
}

export function getTool(id) {
  return availableTools().find((t) => t.id === id) || null;
}

/** Formats a tool accepts, including those that can be converted to its working format first. */
export function toolInputFormats(tool) {
  if (tool.inputs.formats === '*') return '*';
  const set = new Set(tool.inputs.formats);
  if (tool.inputs.convertTo) {
    for (const f of FORMATS) if (findRoute(f.id, tool.inputs.convertTo)) set.add(f.id);
  }
  return [...set];
}

export function toolsFor(format) {
  return availableTools().filter((t) => {
    const fm = toolInputFormats(t);
    return fm === '*' ? t.id === 'archive-create' : fm.includes(format);
  });
}

export function publicTool(t) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    category: t.category,
    icon: t.icon,
    batch: Boolean(t.batch),
    inputs: { formats: toolInputFormats(t), min: t.inputs.min, max: t.inputs.max },
  };
}

export async function toolDetails(tool, info, input, options) {
  const specs = (await tool.options?.(info, input)) || [];
  const quality = tool.quality ? tool.quality(options || {}) : null;
  return { ...publicTool(tool), options: publicSpecs(specs), quality };
}

/** The public catalog: everything the UI needs for search, directory and landing pages. */
export function catalog() {
  const formats = FORMATS.map((f) => {
    const routes = routesFrom(f.id);
    return {
      id: f.id,
      name: f.name,
      category: f.category,
      ext: f.ext,
      inputOnly: Boolean(f.inputOnly),
      codec: f.codec,
      note: f.note,
      targets: routes.map((r) => r.to),
    };
  }).filter((f) => f.targets.length || FORMATS.some((o) => routesFrom(o.id).some((r) => r.to === f.id)));
  const conversions = formats.reduce((n, f) => n + f.targets.length, 0);
  return {
    categories: CATEGORIES.map((c) => ({ ...c, formats: formats.filter((f) => f.category === c.id).map((f) => f.id) })),
    formats,
    tools: availableTools().map(publicTool),
    stats: { formats: formats.length, conversions, tools: availableTools().length },
  };
}

export function invalidateGraph() {
  graph = null;
}

export { formatsIn };
