import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FileArchive, X } from 'lucide-react';
import { api, archiveUrl } from '../lib/api';
import { fmt, useCatalog } from '../lib/catalog';
import { addFiles, clearScope, dismissRun, moveItem, removeItem, runToolForItem, startRun, useStore, type Item } from '../lib/store';
import { linkClick } from '../lib/router';
import { plural } from '../lib/format';
import type { ToolInfo } from '../lib/types';
import { Dropzone } from '../components/Dropzone';
import { OptionsForm, missingRequired } from '../components/OptionsForm';
import { JobView, QualityNote } from '../components/JobView';
import { FileMeta, FileThumb, UploadStatus } from '../components/FileRow';
import { toolIcon } from '../components/icons';
import { NotFound } from './NotFound';
import { ToolGroups as ToolGroupsLazy } from '../components/Directory';

function ToolItemRow({ item, reorder, perFile, onRetry }: { item: Item; reorder: boolean; perFile: boolean; onRetry: () => void }) {
  const accepted = item.server?.format ?? item.guess;
  return (
    <article className={`row${item.job?.status === 'done' ? ' done' : item.job?.status === 'failed' ? ' failed' : ''}`} aria-label={item.name}>
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
        <button type="button" className="icon-btn" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}>
          <X size={17} />
        </button>
      </div>
      <div className="row-detail">
        <UploadStatus item={item} />
        {!accepted && item.upload.state === 'done' && <p className="info-box">This file type was not recognised.</p>}
        {perFile && item.submit?.state === 'waiting' && <p className="status-line">{item.submit.message}</p>}
        {perFile && item.submit?.state === 'error' && (
          <div className="error-box" role="alert">
            {item.submit.message}
          </div>
        )}
        {perFile && item.job && <JobView job={item.job} inputSize={item.size} onRetry={onRetry} />}
      </div>
    </article>
  );
}

export function ToolPage({ id }: { id: string }) {
  const { catalog } = useCatalog();
  const base = catalog?.tools.find((t) => t.id === id);
  const scope = `tool:${id}`;
  const items = useStore((s) => s.items.filter((i) => i.scope === scope));
  const runs = useStore((s) => s.runs.filter((r) => r.toolId === id));
  const [details, setDetails] = useState<ToolInfo | null>(null);
  const [options, setOptions] = useState<Record<string, unknown>>({});
  const firstServerId = items.find((i) => i.server)?.server?.id;

  useEffect(() => {
    if (base) document.title = `${base.title} — Fileverse`;
  }, [base]);
  // Settings can depend on the file (e.g. resolutions below the video's own), so refresh with the first upload.
  useEffect(() => {
    if (!base) return;
    api.tool(id, firstServerId).then(setDetails).catch(() => setDetails(null));
  }, [id, base, firstServerId]);

  const accept = useMemo(() => {
    if (!base || base.inputs.formats === '*') return undefined;
    return base.inputs.formats.flatMap((f) => (fmt(f)?.ext || [f]).map((e) => `.${e}`)).join(',');
  }, [base]);

  if (!catalog) return <main className="wrap page-head"><div className="skeleton" /></main>;
  if (!base) return <NotFound />;

  const multi = base.inputs.max > 1;
  const specs = details?.options || [];
  const missing = missingRequired(specs, options);
  const rejected = items.filter((i) => {
    const f = i.server?.format ?? i.guess;
    return base.inputs.formats !== '*' && f && !base.inputs.formats.includes(f);
  });
  const usable = items.filter((i) => !rejected.includes(i) && i.upload.state !== 'error');
  const enough = usable.length >= base.inputs.min;
  const Icon = toolIcon(base.icon);
  const lastRun = runs[runs.length - 1];
  const doneJobs = items.filter((i) => i.job?.status === 'done').map((i) => i.job!.id);
  const busy = multi ? Boolean(lastRun && (!lastRun.job || ['queued', 'running'].includes(lastRun.job.status))) : items.some((i) => i.job && ['queued', 'running'].includes(i.job.status));

  const run = () => {
    if (multi) startRun(id, usable.map((i) => i.id), options);
    else usable.filter((i) => !i.job || i.job.status !== 'done').forEach((i) => runToolForItem(i.id, id, options));
  };
  const formats = base.inputs.formats === '*' ? 'Any file' : base.inputs.formats.slice(0, 12).map((f) => f.toUpperCase()).join(', ') + (base.inputs.formats.length > 12 ? ' and more' : '');

  return (
    <main id="main" className="wrap">
      <div className="page-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/" onClick={linkClick}>Fileverse</a>
          <span aria-hidden="true">/</span>
          <a href="/tools" onClick={linkClick}>Tools</a>
        </nav>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span className="tool-ico" style={{ width: 56, height: 56, borderRadius: 16 }} aria-hidden="true">
            <Icon size={28} />
          </span>
          {base.title}
        </h1>
        <p className="lede">{base.description}</p>
      </div>

      <div className="run-panel">
        {!items.length ? (
          <Dropzone onFiles={(f) => addFiles(f, scope)} accept={accept} multiple title={multi ? 'Drag and drop the files to combine' : 'Drag and drop your files here'} hint={`Supports ${formats}.${multi ? ' Use the arrows to set the order.' : ' Add several files to process them all with the same settings.'}`} />
        ) : (
          <>
            <div className="ws-bar">
              <h2>{plural(items.length, 'file')}</h2>
              {!multi && doneJobs.length > 1 && (
                <a className="btn go" href={archiveUrl(doneJobs)}>
                  <FileArchive size={16} aria-hidden="true" /> Download all as ZIP
                </a>
              )}
              <button type="button" className="btn ghost" onClick={() => { clearScope(scope); runs.forEach((r) => dismissRun(r.id)); }}>
                Clear all
              </button>
            </div>
            <div className="rows">
              {items.map((i) => (
                <ToolItemRow key={i.id} item={i} reorder={multi && items.length > 1} perFile={!multi} onRetry={() => runToolForItem(i.id, id, options)} />
              ))}
            </div>
            <Dropzone compact onFiles={(f) => addFiles(f, scope)} accept={accept} />
            {rejected.length > 0 && <p className="info-box">{rejected.map((r) => r.name).join(', ')} {rejected.length === 1 ? 'is' : 'are'} not supported by {base.title} and will be skipped.</p>}
          </>
        )}

        {specs.length > 0 && <OptionsForm specs={specs} values={options} onChange={setOptions} />}
        {details?.quality && <QualityNote level={details.quality.level} message={details.quality.message} />}

        <div className="run-actions">
          <button type="button" className="btn primary big" disabled={!enough || Boolean(missing) || busy} onClick={run}>
            {base.title}
            {!multi && usable.length > 1 ? ` (${usable.length} files)` : ''}
          </button>
          {!enough && items.length > 0 && <span className="muted">Add at least {plural(base.inputs.min, 'file')} to continue.</span>}
          {missing && <span className="muted">{missing}</span>}
        </div>

        {multi && lastRun && (
          <div className="row" style={{ gridTemplateColumns: '1fr' }}>
            {lastRun.submit?.state === 'waiting' && <p className="status-line">{lastRun.submit.message}</p>}
            {lastRun.submit?.state === 'error' && <div className="error-box">{lastRun.submit.message}</div>}
            {lastRun.job && <JobView job={lastRun.job} onRetry={run} />}
          </div>
        )}
      </div>
    </main>
  );
}

export function ToolsIndex() {
  useEffect(() => {
    document.title = 'Tools — Fileverse';
  }, []);
  return (
    <main id="main" className="wrap">
      <div className="page-head" style={{ marginBottom: 28 }}>
        <h1>Tools</h1>
        <p className="lede">Professional tools for everyday file tasks — combine, split, compress, trim, secure and package your files in a few clicks.</p>
      </div>
      <ToolGroupsLazy />
    </main>
  );
}
