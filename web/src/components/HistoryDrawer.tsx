import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileArchive, Trash2, X } from 'lucide-react';
import { api, archiveUrl, downloadUrl } from '../lib/api';
import { clearHistory, removeHistory, useHistory } from '../lib/history';
import { bytes, timeLeft } from '../lib/format';
import { getCatalog } from '../lib/catalog';
import { Tag } from './Tag';

/** Past conversions from this browser. Downloads work until the server deletes the files. */
export function HistoryDrawer({ onClose }: { onClose: () => void }) {
  const history = useHistory();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    // Check which results still exist on the server.
    const ids = history.filter((h) => h.status === 'done' && h.expiresAt > Date.now()).map((h) => h.jobId).slice(0, 100);
    if (ids.length)
      api
        .jobs(ids)
        .then((jobs) => {
          const alive = new Set(jobs.filter((j) => j.status === 'done').map((j) => j.id));
          setGone(new Set(ids.filter((id) => !alive.has(id))));
        })
        .catch(() => {});
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tools = getCatalog()?.tools || [];
  const live = history.filter((h) => h.status === 'done' && h.expiresAt > Date.now() && !gone.has(h.jobId));

  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="history-title">
        <div className="drawer-head">
          <h2 id="history-title">History</h2>
          {live.length > 1 && (
            <a className="btn small" href={archiveUrl(live.map((h) => h.jobId))}>
              <FileArchive size={14} aria-hidden="true" /> All as ZIP
            </a>
          )}
          <button ref={close} type="button" className="icon-btn" onClick={onClose} aria-label="Close history">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body">
          {!history.length && <p className="empty-state">Your completed conversions will appear here. History is stored privately in this browser.</p>}
          {history.map((h) => {
            const expired = h.expiresAt <= Date.now() || gone.has(h.jobId);
            const tool = h.tool ? tools.find((t) => t.id === h.tool)?.title : null;
            return (
              <div className="hist" key={h.jobId}>
                <div className="hist-top">
                  <span className="n" title={h.title}>
                    {h.title}
                  </span>
                  {h.target && <Tag id={h.target} kind="dst" />}
                  <button type="button" className="btn ghost small" aria-label={`Remove ${h.title} from history`} onClick={() => removeHistory(h.jobId)}>
                    <Trash2 size={14} />
                  </button>
                </div>
                <small>
                  {tool ? `${tool}, ` : ''}
                  {h.status === 'failed' ? `failed: ${h.error}` : expired ? 'expired and securely deleted' : `${timeLeft(h.expiresAt)}`}
                </small>
                {h.status === 'done' && !expired && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {h.outputs.slice(0, 4).map((o) => (
                      <a key={o.index} className="btn small" href={downloadUrl(h.jobId, o.index)} download>
                        <Download size={13} aria-hidden="true" /> {o.name.length > 32 ? `${o.name.slice(0, 30)}…` : o.name} <span className="muted">{bytes(o.size)}</span>
                      </a>
                    ))}
                    {h.outputs.length > 4 && (
                      <a className="btn small" href={archiveUrl([h.jobId])}>
                        +{h.outputs.length - 4} more (ZIP)
                      </a>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {history.length > 0 && (
            <button type="button" className="btn ghost small" style={{ marginTop: 14 }} onClick={() => clearHistory()}>
              Clear history
            </button>
          )}
        </div>
      </aside>
    </>,
    document.body,
  );
}
