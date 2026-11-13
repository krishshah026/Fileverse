import { getFormat } from '../registry/formats.js';
import { routesFrom, describeRoute, toolsFor, publicTool } from '../registry/index.js';
import { publicSpecs } from '../registry/options.js';
import { summarizeInfo } from '../jobs/runner.js';
import * as store from '../jobs/store.js';

/** File record → JSON for the browser, including every conversion target available for it. */
export async function publicFile(f, { withTargets = true } = {}) {
  const fmt = getFormat(f.format);
  const out = {
    id: f.id,
    name: f.name,
    size: f.size,
    format: f.format,
    formatName: fmt?.name,
    category: fmt?.category,
    detection: { mismatch: Boolean(f.detection?.mismatch), note: f.detection?.note },
    info: summarizeInfo(f.info),
    media: f.info?.media ? { streams: f.info.media.streams?.map(({ index, type, codec, width, height, fps, channels, sampleRate, language, title, attachedPic }) => ({ index, type, codec, width, height, fps, channels, sampleRate, language, title, attachedPic })) } : undefined,
    expiresAt: f.expires_at,
  };
  if (!withTargets || !f.format) return { ...out, targets: [], tools: [] };
  const targets = [];
  for (const route of routesFrom(f.format)) {
    const d = await describeRoute(route, f.info);
    const tf = getFormat(route.to);
    targets.push({
      to: route.to,
      name: tf?.name,
      category: tf?.category,
      via: route.steps.length > 1 ? route.steps[0].to : undefined,
      quality: d.quality,
      unavailable: d.rejected || undefined,
      options: publicSpecs(d.specs),
    });
  }
  out.targets = targets;
  out.tools = toolsFor(f.format).map(publicTool);
  return out;
}

export function publicJob(j) {
  const inputs = j.inputs.map((id) => {
    const f = store.getFile(id);
    return f ? { id, name: f.name, size: f.size, format: f.format, info: summarizeInfo(f.info) } : { id, missing: true };
  });
  return {
    id: j.id,
    kind: j.kind,
    tool: j.tool || undefined,
    target: j.target || undefined,
    status: j.status,
    progress: j.progress,
    stage: j.stage || undefined,
    eta: j.eta ?? undefined,
    position: j.status === 'queued' ? store.queuePosition(j) : undefined,
    quality: j.quality || undefined,
    notes: j.notes || [],
    error: j.error ? { message: j.error.message, suggestion: j.error.suggestion, detail: j.error.detail, code: j.error.code } : undefined,
    inputs,
    outputs: (j.outputs || []).map((o) => ({ index: o.index, name: o.displayName || o.name, size: o.size, format: o.format, relPath: o.relPath, info: o.info })),
    createdAt: j.created_at,
    startedAt: j.started_at || undefined,
    finishedAt: j.finished_at || undefined,
    expiresAt: j.expires_at,
  };
}
