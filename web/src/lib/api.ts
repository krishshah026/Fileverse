import type { Catalog, Job, ServerConfig, ServerFile, ToolInfo } from './types';

/** Set VITE_API_URL when the web app is hosted separately from the API (e.g. on a static host). */
export const API = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

function makeSession(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** An anonymous, per-browser id. It scopes your files and conversions — there are no accounts. */
export const SESSION: string = (() => {
  try {
    const existing = localStorage.getItem('fv.session');
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const s = makeSession();
    localStorage.setItem('fv.session', s);
    return s;
  } catch {
    return makeSession();
  }
})();

export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  constructor(message: string, status: number, retryAfter?: number) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + url, {
      method,
      headers: { 'X-Fileverse-Session': SESSION, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const d = data as { error?: string; retryAfter?: number } | null;
    throw new ApiError(d?.error || `Request failed (${res.status}).`, res.status, d?.retryAfter);
  }
  return data as T;
}

export const api = {
  catalog: () => request<Catalog>('GET', '/api/catalog'),
  config: () => request<ServerConfig>('GET', '/api/config'),
  file: (id: string) => request<ServerFile>('GET', `/api/files/${id}`),
  deleteFile: (id: string) => request<{ ok: true }>('DELETE', `/api/files/${id}`),
  tool: (id: string, fileId?: string) => request<ToolInfo>('GET', `/api/tools/${id}${fileId ? `?file=${fileId}` : ''}`),
  createJob: (body: { inputs: string[]; target?: string; tool?: string; options?: Record<string, unknown> }) => request<Job>('POST', '/api/jobs', body),
  jobs: (ids: string[]) => request<Job[]>('GET', `/api/jobs?ids=${ids.join(',')}`),
  cancelJob: (id: string, purge = false) => request<{ ok: true }>('DELETE', `/api/jobs/${id}${purge ? '?purge=1' : ''}`),
};

export const downloadUrl = (jobId: string, index: number, inline = false) => `${API}/api/jobs/${jobId}/outputs/${index}?session=${SESSION}${inline ? '&inline=1' : ''}`;
export const archiveUrl = (jobIds: string[]) => `${API}/api/archive?jobs=${jobIds.join(',')}&session=${SESSION}`;
export const eventsUrl = () => `${API}/api/events?session=${SESSION}`;
export const uploadEndpoint = () => `${API}/api/uploads`;
