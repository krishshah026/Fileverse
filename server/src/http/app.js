import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from '../config.js';
import { HttpError } from '../util/errors.js';
import { log } from '../util/log.js';
import { createTusServer } from './uploads.js';
import { apiRouter } from './api.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const { tus, datastore } = createTusServer();

  // Security headers for every response.
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('X-Frame-Options', 'DENY');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // CORS for the JSON API when the web app is served from another origin (tus handles its own).
  if (config.corsOrigins.length) {
    app.use('/api', (req, res, next) => {
      if (req.path.startsWith('/uploads')) return next();
      const origin = req.get('origin');
      if (origin && config.corsOrigins.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
        res.set('Access-Control-Allow-Headers', 'Content-Type, X-Fileverse-Session');
        res.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length');
      }
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });
  }

  // Resumable uploads — must see the raw request stream, so it runs before any body parser.
  app.use((req, res, next) => {
    if (req.path === '/api/uploads' || req.path.startsWith('/api/uploads/')) {
      return tus.handle(req, res).catch(next);
    }
    next();
  });

  app.use('/api', apiRouter());
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

  // The web app (single-page app) — hashed assets are cached forever, HTML never.
  const dist = config.webDist;
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    const indexHtml = path.join(dist, 'index.html');
    app.use(
      express.static(dist, {
        index: false,
        setHeaders(res, file) {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
          else res.set('Cache-Control', 'public, max-age=3600');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      res.set('Cache-Control', 'no-cache');
      res.set(
        'Content-Security-Policy',
        ["default-src 'self'", "img-src 'self' blob: data:", "media-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join('; '),
      );
      res.sendFile(indexHtml);
    });
  } else {
    app.get('/', (req, res) => res.type('text').send('Fileverse API is running. Build the web app (npm run build in /web) to serve the interface from here.'));
  }

  // Errors → JSON with a human message.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) {
      if (err.extra?.retryAfter) res.set('Retry-After', String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message, ...err.extra });
    }
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
    log.error(err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' });
  });

  return { app, tus, datastore };
}
