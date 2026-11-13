// Minimal Fileverse API client used by the end-to-end tests (same protocol as the web app).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as tus from 'tus-js-client';

export class Client {
  constructor(base, session = crypto.randomBytes(16).toString('hex')) {
    this.base = base.replace(/\/$/, '');
    this.session = session;
  }

  headers(extra = {}) {
    return { 'X-Fileverse-Session': this.session, ...extra };
  }

  async json(method, url, body) {
    const res = await fetch(this.base + url, { method, headers: this.headers(body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(data.error || `${res.status} ${res.statusText}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  upload(file, { chunkSize = 50 * 1024 * 1024, name = path.basename(file), onProgress } = {}) {
    const size = fs.statSync(file).size;
    return new Promise((resolve, reject) => {
      const up = new tus.Upload(fs.createReadStream(file), {
        endpoint: `${this.base}/api/uploads`,
        chunkSize,
        uploadSize: size,
        retryDelays: [0, 1000, 3000],
        metadata: { filename: name },
        headers: this.headers(),
        onProgress,
        onError: reject,
        onSuccess: ({ lastResponse }) => {
          try {
            resolve(JSON.parse(lastResponse.getBody()));
          } catch {
            const id = up.url.split('/').pop();
            this.json('GET', `/api/files/${id}`).then(resolve, reject);
          }
        },
      });
      up.start();
    });
  }

  async createJob(body) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.json('POST', '/api/jobs', body);
      } catch (err) {
        if (err.status === 429 && attempt < 2000) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        throw err;
      }
    }
  }

  async waitFor(ids, { timeoutMs = 60 * 60 * 1000, onUpdate } = {}) {
    const pending = new Set(ids);
    const done = new Map();
    const t0 = Date.now();
    while (pending.size) {
      if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for jobs');
      const batch = [...pending].slice(0, 100);
      const jobs = await this.json('GET', `/api/jobs?ids=${batch.join(',')}`);
      for (const j of jobs) {
        onUpdate?.(j);
        if (['done', 'failed', 'canceled'].includes(j.status)) {
          pending.delete(j.id);
          done.set(j.id, j);
        }
      }
      if (pending.size) await new Promise((r) => setTimeout(r, 700));
    }
    return ids.map((id) => done.get(id));
  }

  async download(jobId, index, dest) {
    const res = await fetch(`${this.base}/api/jobs/${jobId}/outputs/${index}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const { Readable } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
    return { dest, disposition: res.headers.get('content-disposition'), type: res.headers.get('content-type') };
  }
}
