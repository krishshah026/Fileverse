import { useId, useMemo, useRef, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import { pairSlug, search, useCatalog } from '../lib/catalog';
import { navigate } from '../lib/router';
import { toolIcon } from './icons';
import { PairInline } from './Tag';

export function Search() {
  useCatalog();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(q, 10), [q]);

  const href = (h: (typeof hits)[number]) => (h.kind === 'pair' ? `/convert/${pairSlug(h.from, h.to)}` : h.kind === 'tool' ? `/tools/${h.tool.id}` : `/formats/${h.format.category}#${h.format.id}`);
  const go = (i: number) => {
    const h = hits[i];
    if (!h) return;
    setOpen(false);
    setQ('');
    navigate(href(h));
  };

  return (
    <div className="search">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Find a conversion or tool
      </label>
      <SearchIcon className="search-icon" size={20} aria-hidden="true" />
      <input
        ref={inputRef}
        id={`${listId}-input`}
        type="search"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        placeholder="Search any format or tool"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setSel(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSel((s) => Math.min(hits.length - 1, s + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSel((s) => Math.max(0, s - 1));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            go(sel);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && q.trim() && (
        <ul className="search-results" id={listId} role="listbox">
          {hits.length === 0 && <li className="muted" style={{ padding: '10px 12px' }}>No matches yet. Try a file extension such as WEBP, or a task such as “merge PDF”.</li>}
          {hits.map((h, i) => {
            const Icon = h.kind === 'tool' ? toolIcon(h.tool.icon) : null;
            return (
              <li key={i} role="option" aria-selected={i === sel}>
                <a
                  href={href(h)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    go(i);
                  }}
                  onMouseEnter={() => setSel(i)}
                >
                  {h.kind === 'pair' && (
                    <>
                      <PairInline from={h.from} to={h.to} />
                      <span className="hint">Conversion</span>
                    </>
                  )}
                  {h.kind === 'tool' && Icon && (
                    <>
                      <Icon size={18} aria-hidden="true" />
                      <span>{h.tool.title}</span>
                      <span className="hint">Tool</span>
                    </>
                  )}
                  {h.kind === 'format' && (
                    <>
                      <span className="tag src">.{h.format.id}</span>
                      <span>All {h.format.name} conversions</span>
                      <span className="hint">{h.format.targets.length} targets</span>
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
