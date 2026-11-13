import { config } from './config.js';
import { getDb } from './jobs/db.js';
import { detectEngines, engineSummary } from './engines/available.js';
import { createApp } from './http/app.js';
import { startWorkers } from './jobs/worker.js';
import { startCleanup } from './storage/cleanup.js';
import { catalog } from './registry/index.js';
import { log } from './util/log.js';

getDb();
detectEngines();
const missing = Object.entries(engineSummary()).filter(([, ok]) => !ok).map(([k]) => k);
const stats = catalog().stats;
log.info(`Fileverse ${config.role} — ${stats.formats} formats, ${stats.conversions} conversions, ${stats.tools} tools`);
if (missing.length) log.warn(`engines not found (their conversions are hidden): ${missing.join(', ')}`);

const stops = [];
let server;

if (config.role === 'api' || config.role === 'all') {
  const { app, tus } = createApp();
  server = app.listen(config.port, config.host, () => log.info(`listening on http://${config.host}:${config.port}`));
  // Long uploads/downloads: never time out an active request at the Node level.
  server.requestTimeout = 0;
  server.headersTimeout = 120_000;
  server.keepAliveTimeout = 75_000;
  const t = startCleanup(tus);
  stops.push(() => clearInterval(t));
}

if (config.role === 'worker' || config.role === 'all') {
  stops.push(startWorkers({ exclusive: config.role === 'all' }));
}

function shutdown(sig) {
  log.info(`${sig} received, shutting down`);
  stops.forEach((s) => s());
  if (server) server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));
