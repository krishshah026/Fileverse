import * as store from '../jobs/store.js';
import { publicJob } from './present.js';

/**
 * Server-Sent Events. One shared poller reads changed jobs from SQLite and fans them out, which
 * works identically whether conversions run in this process or in separate worker processes.
 */
const subscribers = new Map(); // session → Set<res>
let timer = null;
let cursor = Date.now();
const sent = new Map(); // jobId → updated_at already pushed (overlap window makes delivery gap-free)

function tick() {
  if (!subscribers.size) return;
  let rows;
  try {
    rows = store.jobsUpdatedSince(cursor - 2000);
  } catch {
    return;
  }
  const t = Date.now();
  for (const [id, at] of sent) if (at < cursor - 10_000) sent.delete(id);
  if (rows.length) cursor = Math.max(cursor, ...rows.map((r) => r.updated_at));
  else cursor = Math.max(cursor, t - 1000);
  for (const j of rows) {
    if (sent.get(j.id) === j.updated_at) continue;
    sent.set(j.id, j.updated_at);
    const subs = subscribers.get(j.session);
    if (!subs) continue;
    const payload = `event: job\ndata: ${JSON.stringify(publicJob(j))}\n\n`;
    for (const res of subs) res.write(payload);
  }
}

export function subscribe(session, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable proxy buffering (nginx)
  });
  res.write('retry: 3000\n\n');
  // Send the current state of active jobs so a reconnecting client is immediately consistent.
  for (const j of store.jobsForSession(session, 100)) {
    if (['queued', 'running'].includes(j.status) || Date.now() - (j.finished_at || 0) < 60_000) {
      res.write(`event: job\ndata: ${JSON.stringify(publicJob(j))}\n\n`);
    }
  }
  if (!subscribers.has(session)) subscribers.set(session, new Set());
  subscribers.get(session).add(res);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
  if (!timer) {
    cursor = Date.now();
    timer = setInterval(tick, 500);
  }
  req.on('close', () => {
    clearInterval(heartbeat);
    const set = subscribers.get(session);
    set?.delete(res);
    if (set && !set.size) subscribers.delete(session);
    if (!subscribers.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  });
}
