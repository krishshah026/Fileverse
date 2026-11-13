// Generates docs/FORMATS.md from the live registry (only routes whose engines are installed).
import fs from 'node:fs';
import { catalog, routesFrom } from '../src/registry/index.js';
const c = catalog();
let md = `# Formats, conversions and tools\n\nGenerated from the converter registry: ${c.stats.formats} formats, ${c.stats.conversions} conversions, ${c.stats.tools} tools.\nTwo-step routes go through a lossless or structural intermediate format (shown as *via*).\n`;
for (const cat of c.categories) {
  const fmts = cat.formats.map((id) => c.formats.find((f) => f.id === id)).filter(Boolean);
  if (!fmts.length) continue;
  md += `\n## ${cat.name}\n\n| From | To |\n|---|---|\n`;
  for (const f of fmts) {
    const routes = routesFrom(f.id);
    const to = routes.map((r) => (r.steps.length > 1 ? `${r.to.toUpperCase()} *(via ${r.steps[0].to.toUpperCase()})*` : r.to.toUpperCase())).join(', ');
    md += `| **${f.name}** (${f.ext.map((e) => '.' + e).join(' ')})${f.inputOnly ? ' — input only' : ''} | ${to || '—'} |\n`;
  }
}
md += `\n## Tools\n\n| Tool | Accepts | What it does |\n|---|---|---|\n`;
for (const t of c.tools) {
  const acc = t.inputs.formats === '*' ? 'any file' : t.inputs.formats.length > 14 ? `${t.inputs.formats.slice(0, 14).map((x) => x.toUpperCase()).join(', ')} and ${t.inputs.formats.length - 14} more` : t.inputs.formats.map((x) => x.toUpperCase()).join(', ');
  md += `| ${t.title} | ${acc}${t.inputs.max > 1 ? ` (${t.inputs.min}–${t.inputs.max} files)` : ''} | ${t.description} |\n`;
}
fs.writeFileSync(new URL('../../docs/FORMATS.md', import.meta.url), md);
console.log('written', c.stats);
