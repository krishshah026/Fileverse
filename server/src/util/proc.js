import { spawn, execFileSync } from 'node:child_process';
import { ConversionError } from './errors.js';

/**
 * Runs a binary without a shell (arguments are never interpolated into a command line).
 * - `signal` aborts the process (job cancelled / timed out)
 * - `onStdoutLine` / `onStderrLine` receive output line by line (progress parsing)
 * Resolves with { code, stdout, stderr }; rejects with a ConversionError on non-zero exit.
 */
export function run(bin, args, opts = {}) {
  const {
    cwd,
    env,
    signal,
    onStdoutLine,
    onStderrLine,
    captureStdout = true,
    maxCapture = 256 * 1024,
    allowedCodes = [0],
    input,
    friendly,
  } = opts;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    let child;
    try {
      child = spawn(bin, args, {
        cwd,
        env: { ...process.env, ...env },
        stdio: [input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32', // own process group → kill whole tree
      });
    } catch (err) {
      return reject(new ConversionError(`Could not start ${bin}: ${err.message}`, { internal: true }));
    }

    let stdout = '';
    let stderr = '';
    let outBuf = '';
    let errBuf = '';

    const kill = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const onAbort = () => kill();
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (chunk) => {
      const s = chunk.toString();
      if (captureStdout && stdout.length < maxCapture) stdout += s;
      if (onStdoutLine) {
        outBuf += s;
        let i;
        while ((i = outBuf.indexOf('\n')) >= 0) {
          onStdoutLine(outBuf.slice(0, i).replace(/\r$/, ''));
          outBuf = outBuf.slice(i + 1);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      const s = chunk.toString();
      stderr += s;
      if (stderr.length > maxCapture) stderr = stderr.slice(-maxCapture);
      if (onStderrLine) {
        errBuf += s;
        let i;
        while ((i = errBuf.search(/[\r\n]/)) >= 0) {
          onStderrLine(errBuf.slice(0, i));
          errBuf = errBuf.slice(i + 1);
        }
      }
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(new ConversionError(`Could not run ${bin}: ${err.message}`, { internal: true }));
    });
    child.on('close', (code, sig) => {
      signal?.removeEventListener('abort', onAbort);
      if (outBuf && onStdoutLine) onStdoutLine(outBuf);
      if (signal?.aborted) return reject(abortError(signal));
      if (allowedCodes.includes(code)) return resolve({ code, stdout, stderr });
      const tail = stderr.trim().split('\n').slice(-12).join('\n');
      reject(
        new ConversionError(friendly || `${bin.split('/').pop()} failed (exit ${code ?? sig})`, {
          detail: tail || stdout.slice(-2000),
          code,
        }),
      );
    });
  });
}

function abortError(signal) {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new ConversionError(typeof reason === 'string' ? reason : 'Cancelled', { cancelled: true });
}

const whichCache = new Map();
/** Returns the absolute path of a binary or null if it is not installed. */
export function which(bin) {
  if (!bin) return null;
  if (whichCache.has(bin)) return whichCache.get(bin);
  let found = null;
  try {
    found = execFileSync('sh', ['-c', 'command -v "$1"', 'sh', bin], { encoding: 'utf8' }).trim() || null;
  } catch {
    found = null;
  }
  whichCache.set(bin, found);
  return found;
}

export function pythonHasModule(python, mod) {
  try {
    execFileSync(python, ['-c', `import ${mod}`], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
}
