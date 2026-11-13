import { useState } from 'react';
import { ArrowDown, ArrowUp, Pause, Play, Settings2, X } from 'lucide-react';
import type { Item } from '../lib/store';
import { convert, moveItem, pauseUpload, removeItem, resumeUpload, setOptions, setTarget } from '../lib/store';
import { bytes, eta, speed } from '../lib/format';
import { fmt } from '../lib/catalog';
import { categoryIcon } from './icons';
import { TargetPicker } from './TargetPicker';
import { OptionsForm, missingRequired } from './OptionsForm';
import { JobView, QualityNote, describe } from './JobView';
import { Tag } from './Tag';

export function UploadStatus({ item }: { item: Item }) {
  const u = item.upload;
  if (u.state === 'done') return null;
  if (u.state === 'error') {
    return (
      <div className="error-box" role="alert">
        {u.error}
        {item.file && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn small" onClick={() => resumeUpload(item.id)}>
              <Play size={14} aria-hidden="true" /> Resume upload
            </button>
          </div>
        )}
      </div>
    );
  }
  const pct = item.size ? Math.round((u.sent / item.size) * 100) : 0;
  return (
    <div className="result">
      <div className="progress upload" role="progressbar" aria-label={`Uploading ${item.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span style={{ width: `${Math.max(1, pct)}%` }} />
      </div>
      <div className="status-line">
        <strong>{u.state === 'queued' ? 'Queued for upload' : u.state === 'paused' ? `Upload paused at ${pct}%` : `Uploading ${pct}%`}</strong>
        {u.state === 'uploading' && (
          <>
            <span>
              {bytes(u.sent)} of {bytes(item.size)}
            </span>
            {u.speed ? <span>{speed(u.speed)}</span> : null}
            {u.eta && pct > 1 ? <span>{eta(u.eta)}</span> : null}
          </>
        )}
        {u.state === 'uploading' && (
          <button type="button" className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => pauseUpload(item.id)}>
            <Pause size={14} aria-hidden="true" /> Pause
          </button>
        )}
        {u.state === 'paused' && (
          <button type="button" className="btn ghost small" style={{ marginLeft: 'auto' }} onClick={() => resumeUpload(item.id)}>
            <Play size={14} aria-hidden="true" /> Resume
          </button>
        )}
      </div>
    </div>
  );
}

export function FileThumb({ item }: { item: Item }) {
  const Icon = categoryIcon(fmt(item.server?.format ?? item.guess)?.category);
  return <div className="thumb">{item.previewUrl ? <img src={item.previewUrl} alt="" /> : <Icon size={24} aria-hidden="true" />}</div>;
}

export function FileMeta({ item }: { item: Item }) {
  const format = item.server?.format ?? item.guess;
  return (
    <div className="row-meta">
      <Tag id={format} kind="src" />
      <span>{bytes(item.size)}</span>
      {describe(item.server?.info).map((d) => (
        <span key={d}>{d}</span>
      ))}
      {item.server?.info?.tracks && item.server.info.tracks.subtitle > 0 && <span>{item.server.info.tracks.subtitle} subtitle track{item.server.info.tracks.subtitle > 1 ? 's' : ''}</span>}
    </div>
  );
}

/** One file in the converter: pick a format, tune settings, watch progress, download. */
export function FileRow({ item, reorder }: { item: Item; reorder?: boolean }) {
  const [showSettings, setShowSettings] = useState(false);
  const target = item.server?.targets.find((t) => t.to === item.target);
  const job = item.job;
  const busy = job && ['queued', 'running'].includes(job.status);
  const format = item.server?.format ?? item.guess;
  const unknown = item.upload.state === 'done' && !item.server?.format;
  const missing = target ? missingRequired(target.options, item.options) : null;
  const state = job?.status === 'done' ? ' done' : job?.status === 'failed' || item.upload.state === 'error' ? ' failed' : '';

  return (
    <article className={`row${state}`} aria-label={item.name}>
      <FileThumb item={item} />
      <div className="row-main">
        <div className="row-name" title={item.name}>
          {item.name}
        </div>
        <FileMeta item={item} />
      </div>
      <div className="row-actions">
        {reorder && (
          <>
            <button type="button" className="icon-btn" onClick={() => moveItem(item.id, -1)} aria-label={`Move ${item.name} up`}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="icon-btn" onClick={() => moveItem(item.id, 1)} aria-label={`Move ${item.name} down`}>
              <ArrowDown size={16} />
            </button>
          </>
        )}
        {!unknown && format && (
          <TargetPicker
            from={format}
            targets={item.server?.targets}
            value={item.target}
            onChange={(to) => {
              setTarget(item.id, to);
            }}
          />
        )}
        {target && target.options.length > 0 && (
          <button type="button" className="icon-btn" aria-label="Conversion settings" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}>
            <Settings2 size={17} />
          </button>
        )}
        {!busy && item.target && job?.status !== 'done' && (
          <button type="button" className="btn primary" disabled={Boolean(missing) || item.submit?.state === 'submitting' || item.upload.state === 'error'} onClick={() => convert(item.id)}>
            Convert
          </button>
        )}
        {job?.status === 'done' && (
          <button type="button" className="btn ghost small" onClick={() => convert(item.id)}>
            Convert again
          </button>
        )}
        <button type="button" className="icon-btn" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>
          <X size={17} />
        </button>
      </div>
      <div className="row-detail">
        <UploadStatus item={item} />
        {item.server?.detection.note && <p className="info-box">{item.server.detection.note}</p>}
        {item.notice && <p className="info-box">{item.notice}</p>}
        {unknown && <p className="info-box">We couldn't identify this file type. If the file extension is incorrect, rename the file and add it again.</p>}
        {item.server?.format && item.server.targets.length === 0 && <p className="info-box">Conversions for {fmt(item.server.format)?.name} files aren't available yet.</p>}
        {target && !job && <QualityNote level={target.quality.level} message={target.quality.message} />}
        {showSettings && target && <OptionsForm specs={target.options} values={item.options} onChange={(v) => setOptions(item.id, v)} />}
        {missing && <p className="quality lossy">{missing}</p>}
        {item.submit?.state === 'waiting' && <p className="status-line">{item.submit.message}</p>}
        {item.submit?.state === 'error' && (
          <div className="error-box" role="alert">
            {item.submit.message}
          </div>
        )}
        {job && <JobView job={job} inputSize={item.size} onRetry={() => convert(item.id)} />}
      </div>
    </article>
  );
}
