import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { config, paths } from '../config.js';
import * as store from './store.js';
import { executeJob, toJobError } from './runner.js';
import { log } from '../util/log.js';

/** Wakes idle workers immediately when a job is created in the same process. */
export const wake = new EventEmitter();
wake.setMaxListeners(100);

const running = new Map(); // jobId → AbortController

export function abortLocal(jobId, reason = 'Cancelled') {
  const ac = running.get(jobId);
  if (ac) ac.abort(Object.assign(new Error(reason), { cancelled: true }));
  return Boolean(ac);
}

function slot(weight, n) {
  const workerId = `${os.hostname()}:${process.pid}:${weight}:${n}`;
  let stopped = false;
  let idleWaiter = null;

  const waitForWork = () =>
    new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        wake.off(weight, done);
        resolve();
      };
      const t = setTimeout(done, 1000);
      wake.on(weight, done);
      idleWaiter = done;
    });

  const loop = async () => {
    while (!stopped) {
      let job;
      try {
        job = store.claimJob(weight, workerId);
      } catch (err) {
        log.error('claim failed', err);
      }
      if (!job) {
        await waitForWork();
        continue;
      }
      await process1(job);
    }
  };

  async function process1(job) {
    const ac = new AbortController();
    running.set(job.id, ac);
    const timeout = AbortSignal.timeout(config.jobTimeoutMinutes * 60 * 1000);
    const signal = AbortSignal.any([ac.signal, timeout]);
    // Heartbeat + cross-process cancellation check.
    const beat = setInterval(() => {
      try {
        const status = store.jobStatus(job.id);
        if (status === 'canceled' || !status) ac.abort(Object.assign(new Error('Cancelled'), { cancelled: true }));
        else store.touchJob(job.id);
      } catch {
        /* db busy — next beat */
      }
    }, 5000);
    const t0 = Date.now();
    try {
      if (job.kind === 'tool') job.toolOutput = job.target;
      const { outputs, notes } = await executeJob(job, signal);
      store.completeJob(job.id, { outputs, notes });
      log.info(`job ${job.id} done in ${((Date.now() - t0) / 1000).toFixed(1)}s (${job.kind} ${job.tool || ''}${job.target ? `→${job.target}` : ''})`);
    } catch (err) {
      const e = toJobError(err?.cancelled || signal.reason?.cancelled ? { cancelled: true } : signal.aborted && timeout.aborted ? { name: 'TimeoutError' } : err);
      if (!e.cancelled) {
        store.failJob(job.id, e);
        log.warn(`job ${job.id} failed: ${e.message}${e.detail ? `\n  ${e.detail.split('\n').slice(-3).join('\n  ')}` : ''}`);
      }
      // Free disk space immediately on failure/cancel.
      await fs.rm(path.join(paths.jobs, job.id), { recursive: true, force: true }).catch(() => {});
    } finally {
      clearInterval(beat);
      running.delete(job.id);
    }
  }

  loop();
  return () => {
    stopped = true;
    idleWaiter?.();
  };
}

export function startWorkers({ exclusive = false } = {}) {
  // In single-process mode every "running" job at boot is an orphan of the previous run.
  const stale = store.requeueStale(exclusive ? 0 : 90_000);
  if (stale) log.info(`re-queued ${stale} interrupted job(s)`);
  const stops = [];
  for (let i = 0; i < config.heavyConcurrency; i++) stops.push(slot('heavy', i));
  for (let i = 0; i < config.lightConcurrency; i++) stops.push(slot('light', i));
  // Periodically recover jobs from crashed workers on other processes.
  const recover = setInterval(() => store.requeueStale(90_000), 30_000);
  log.info(`workers started: ${config.heavyConcurrency} heavy, ${config.lightConcurrency} light`);
  return () => {
    clearInterval(recover);
    stops.forEach((s) => s());
    for (const id of running.keys()) abortLocal(id, 'Server shutting down');
  };
}
