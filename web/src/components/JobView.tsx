import { useState } from 'react';
import { CheckCircle2, Download, Eye, FileArchive, Info, RotateCcw, X } from 'lucide-react';
import { archiveUrl, downloadUrl } from '../lib/api';
import { bytes, duration, eta, sizeChange } from '../lib/format';
import { cancel } from '../lib/store';
import { fmt } from '../lib/catalog';
import type { Job, JobOutput, MediaSummary } from '../lib/types';
import { PreviewModal } from './PreviewModal';

export function describe(info?: MediaSummary): string[] {
  if (!info) return [];
  const parts: string[] = [];
  if (info.width && info.height) parts.push(`${info.width}×${info.height}`);
  if (info.duration) parts.push(duration(info.duration));
  if (info.videoCodec) parts.push(info.videoCodec.toUpperCase());
  if (info.audioCodec && !info.videoCodec) parts.push(`${info.audioCodec.toUpperCase()}${info.sampleRate ? ` ${info.sampleRate / 1000} kHz` : ''}`);
  if (info.pages) parts.push(`${info.pages} page${info.pages === 1 ? '' : 's'}`);
  if (info.frames) parts.push(`${info.frames} frames`);
  return parts;
}

const PREVIEWABLE = new Set(['image', 'video', 'audio']);
const BROWSER_IMAGES = new Set(['png', 'jpg', 'webp', 'avif', 'gif', 'bmp', 'ico']);
const BROWSER_MEDIA = new Set(['mp4', 'webm', 'm4v', 'mov', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus', 'flac']);

function canPreview(o: JobOutput) {
  const cat = fmt(o.format)?.category;
  if (!cat || !PREVIEWABLE.has(cat)) return o.format === 'pdf';
  return BROWSER_IMAGES.has(o.format || '') || BROWSER_MEDIA.has(o.format || '');
}

export function QualityNote({ level, message }: { level: string; message: string }) {
  if (!message) return null;
  return (
    <p className={`quality ${level}`}>
      {level === 'lossless' ? <CheckCircle2 size={15} aria-hidden="true" /> : <Info size={15} aria-hidden="true" />}
      <span>{message}</span>
    </p>
  );
}

export function JobView({ job, inputSize, onRetry }: { job: Job; inputSize?: number; onRetry?: () => void }) {
  const [preview, setPreview] = useState<JobOutput | null>(null);
  if (job.status === 'queued' || job.status === 'running') {
    const pct = Math.round((job.progress || 0) * 100);
    const queued = job.status === 'queued';
    return (
      <div className="result" aria-live="polite">
        <div className={`progress convert${queued || pct === 0 ? ' indeterminate' : ''}`} role="progressbar" aria-label="Conversion progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={queued ? undefined : pct}>
          <span style={{ width: `${Math.max(2, pct)}%` }} />
        </div>
        <div className="status-line">
          <strong>{queued ? (job.position && job.position > 1 ? `In queue, position ${job.position}` : 'Preparing') : `Converting… ${pct}%`}</strong>
          {job.stage && !queued && <span>{job.stage}</span>}
          {job.eta ? <span>{eta(job.eta)}</span> : null}
          <button type="button" className="btn ghost small" onClick={() => cancel(job.id)} style={{ marginLeft: 'auto' }}>
            <X size={14} aria-hidden="true" /> Cancel
          </button>
        </div>
      </div>
    );
  }
  if (job.status === 'failed') {
    return (
      <div className="error-box" role="alert">
        <strong>{job.error?.message || 'This conversion could not be completed.'}</strong>
        {job.error?.suggestion && <p style={{ marginTop: 4 }}>{job.error.suggestion}</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {onRetry && (
            <button type="button" className="btn small" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" /> Try again
            </button>
          )}
        </div>
        {job.error?.detail && (
          <details>
            <summary>Technical details</summary>
            <pre>{job.error.detail}</pre>
          </details>
        )}
      </div>
    );
  }
  if (job.status === 'canceled') return <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>Conversion cancelled.</p>;

  const total = job.outputs.reduce((n, o) => n + o.size, 0);
  const many = job.outputs.length > 1;
  const shown = job.outputs.slice(0, 50);
  return (
    <div className="result">
      {shown.map((o) => {
        const delta = !many && inputSize ? sizeChange(inputSize, o.size) : null;
        return (
          <div className="result-file" key={o.index}>
            <span className="tag dst">.{o.format || '?'}</span>
            <span className="name" title={o.relPath || o.name}>
              {o.relPath || o.name}
            </span>
            <span className="stats">
              <span>{bytes(o.size)}</span>
              {delta?.text && <span className={`delta${delta.smaller ? ' smaller' : ''}`}>{delta.text}</span>}
              {describe(o.info).map((d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
            {canPreview(o) &&
              (o.format === 'pdf' ? (
                <a className="btn small" href={downloadUrl(job.id, o.index, true)} target="_blank" rel="noopener">
                  <Eye size={14} aria-hidden="true" /> Open
                </a>
              ) : (
                <button type="button" className="btn small" onClick={() => setPreview(o)}>
                  <Eye size={14} aria-hidden="true" /> Preview
                </button>
              ))}
            <a className="btn go small" href={downloadUrl(job.id, o.index)} download>
              <Download size={14} aria-hidden="true" /> Download
            </a>
          </div>
        );
      })}
      {job.outputs.length > shown.length && <p className="muted" style={{ fontSize: 'var(--fs-xs)' }}>…and {job.outputs.length - shown.length} more files in the ZIP.</p>}
      {many && (
        <div>
          <a className="btn go" href={archiveUrl([job.id])}>
            <FileArchive size={16} aria-hidden="true" /> Download all {job.outputs.length} files as ZIP ({bytes(total)})
          </a>
        </div>
      )}
      {job.notes.length > 0 && (
        <ul className="notes">
          {job.notes.map((n) => (
            <li key={n}>
              <Info size={13} aria-hidden="true" />
              <span>{n}</span>
            </li>
          ))}
        </ul>
      )}
      {preview && <PreviewModal jobId={job.id} output={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
