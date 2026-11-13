import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { fmt, getCatalog, POPULAR } from '../lib/catalog';
import type { QualityLevel, Target } from '../lib/types';

const LEVEL_LABEL: Record<QualityLevel, string> = { lossless: 'Lossless', high: 'High quality', lossy: 'Lossy' };

interface Option {
  to: string;
  category: string;
  level?: QualityLevel;
  unavailable?: string;
}

interface Props {
  from: string | null;
  targets?: Target[];
  value?: string;
  onChange: (to: string) => void;
  label?: string;
}

/** Choose the output format. Grouped by category, with the most common choices first. */
export function TargetPicker({ from, targets, value, onChange, label = 'Convert to' }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  const options: Option[] = useMemo(() => {
    if (targets) return targets.filter((t) => !t.unavailable).map((t) => ({ to: t.to, category: t.category, level: t.quality?.level }));
    const f = fmt(from);
    return (f?.targets || []).map((to) => ({ to, category: fmt(to)?.category || 'other' }));
  }, [from, targets]);

  const groups = useMemo(() => {
    const cat = getCatalog();
    const filtered = options.filter((o) => !q || o.to.includes(q.toLowerCase().replace(/^\./, '')) || (fmt(o.to)?.name || '').toLowerCase().includes(q.toLowerCase()));
    const popular = POPULAR.filter(([a]) => a === from).map(([, b]) => b);
    const srcCat = fmt(from)?.category;
    const recommended = q ? [] : filtered.filter((o) => popular.includes(o.to)).slice(0, 4);
    const order = [srcCat, ...(cat?.categories.map((c) => c.id) || [])];
    const byCat = new Map<string, Option[]>();
    for (const o of filtered) {
      if (!byCat.has(o.category)) byCat.set(o.category, []);
      byCat.get(o.category)!.push(o);
    }
    const list = [...byCat.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
    return { recommended, list, names: Object.fromEntries((cat?.categories || []).map((c) => [c.id, c.name])) };
  }, [options, q, from]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const width = Math.min(440, window.innerWidth - 24);
      const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
      const below = window.innerHeight - r.bottom - 16;
      const above = r.top - 16;
      const useAbove = below < 320 && above > below;
      const maxHeight = Math.min(560, useAbove ? above : below);
      setPos({ top: useAbove ? r.top - 8 - maxHeight : r.bottom + 8, left, maxHeight });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (to: string) => {
    onChange(to);
    setOpen(false);
    setQ('');
    btn.current?.focus();
  };

  const renderOpt = (o: Option) => (
    <button key={o.to} type="button" className="picker-opt" aria-pressed={o.to === value} onClick={() => choose(o.to)}>
      <span className="fmt">.{o.to}</span>
      {o.level && (
        <span className="lvl">
          <span className={`lvl-dot ${o.level}`} aria-hidden="true" />
          {LEVEL_LABEL[o.level]}
        </span>
      )}
    </button>
  );

  if (!options.length) return <span className="muted" style={{ fontSize: 'var(--fs-xs)' }}>No conversions for this file</span>;

  return (
    <>
      <button ref={btn} type="button" className={`target-btn${value ? '' : ' empty'}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {value ? (
          <>
            <span className="muted" style={{ fontWeight: 400 }}>to</span>
            <span className="tag dst">.{value}</span>
          </>
        ) : (
          label
        )}
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div ref={pop} className="popover" role="dialog" aria-label="Choose output format" style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}>
            <div className="popover-search">
              <input autoFocus type="search" placeholder="Search formats" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search output formats" />
            </div>
            <div className="popover-body">
              {groups.recommended.length > 0 && (
                <div className="picker-group">
                  <h4>Most chosen</h4>
                  <div className="picker-grid">{groups.recommended.map(renderOpt)}</div>
                </div>
              )}
              {groups.list.map(([cat, opts]) => (
                <div className="picker-group" key={cat}>
                  <h4>{groups.names[cat] || cat}</h4>
                  <div className="picker-grid">{opts.map(renderOpt)}</div>
                </div>
              ))}
              {!groups.list.length && <p className="muted" style={{ padding: 10 }}>No format matches “{q}”.</p>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
