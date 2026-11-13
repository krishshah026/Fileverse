import { useMemo, useState } from 'react';
import { FileArchive, Trash2 } from 'lucide-react';
import { useStore, addFiles, convert, setTarget, clearScope } from '../lib/store';
import { archiveUrl } from '../lib/api';
import { fmt, getCatalog } from '../lib/catalog';
import { plural } from '../lib/format';
import { Dropzone } from './Dropzone';
import { FileRow } from './FileRow';

/** The converter: a list of files, each with its own target, plus batch actions. */
export function Workspace({ presetTarget }: { presetTarget?: string }) {
  const items = useStore((s) => s.items.filter((i) => i.scope === 'convert'));
  const [bulk, setBulk] = useState('');

  // Formats every file in the list can be converted to (for "Convert all to …").
  const common = useMemo(() => {
    const lists = items.map((i) => (i.server ? i.server.targets.filter((t) => !t.unavailable).map((t) => t.to) : fmt(i.guess)?.targets || []));
    if (!lists.length) return [];
    return lists.reduce((acc, l) => acc.filter((x) => l.includes(x)));
  }, [items]);

  const done = items.filter((i) => i.job?.status === 'done').map((i) => i.job!.id);
  const ready = items.filter((i) => i.target && !i.job && i.upload.state !== 'error');
  const cats = getCatalog()?.categories || [];

  if (!items.length) return null;
  return (
    <section className="workspace" aria-label="Your files">
      <div className="ws-bar">
        <h2>{plural(items.length, 'file')}</h2>
        {items.length > 1 && common.length > 0 && (
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <span className="label">Convert all to</span>
            <select
              value={bulk}
              onChange={(e) => {
                setBulk(e.target.value);
                if (e.target.value) for (const i of items) if (!i.job || i.job.status !== 'running') setTarget(i.id, e.target.value);
              }}
              style={{ width: 'auto', height: 40, borderRadius: 9, border: '1px solid var(--line-strong)', background: 'var(--surface)', padding: '0 10px' }}
            >
              <option value="">Choose…</option>
              {cats.map((c) => {
                const opts = common.filter((t) => fmt(t)?.category === c.id);
                return opts.length ? (
                  <optgroup key={c.id} label={c.name}>
                    {opts.map((t) => (
                      <option key={t} value={t}>
                        .{t}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </select>
          </label>
        )}
        {ready.length > 1 && (
          <button type="button" className="btn primary" onClick={() => ready.forEach((i) => convert(i.id))}>
            Convert {ready.length} files
          </button>
        )}
        {done.length > 1 && (
          <a className="btn go" href={archiveUrl(done)}>
            <FileArchive size={16} aria-hidden="true" /> Download all as ZIP
          </a>
        )}
        <button type="button" className="btn ghost" onClick={() => clearScope('convert')}>
          <Trash2 size={16} aria-hidden="true" /> Clear
        </button>
      </div>
      <div className="rows">
        {items.map((i) => (
          <FileRow key={i.id} item={i} />
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <Dropzone compact onFiles={(f) => addFiles(f, 'convert', presetTarget)} />
      </div>
    </section>
  );
}
