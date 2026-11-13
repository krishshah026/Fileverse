import { useState } from 'react';
import { linkClick } from '../lib/router';
import { pairSlug, popular, useCatalog } from '../lib/catalog';
import { toolIcon } from './icons';
import { PairInline, Tag } from './Tag';

export function PopularPairs({ limit = 16 }: { limit?: number }) {
  useCatalog();
  const pairs = popular(limit);
  return (
    <div className="pairs">
      {pairs.map(([a, b]) => (
        <a key={`${a}-${b}`} className="pair-link" href={`/convert/${pairSlug(a, b)}`} onClick={linkClick}>
          <PairInline from={a} to={b} />
        </a>
      ))}
    </div>
  );
}

/** A table of contents of every format: category on the left, its formats and targets on the right. */
export function CategoryIndex({ initial = 'video' }: { initial?: string }) {
  const { catalog } = useCatalog();
  const [cat, setCat] = useState(initial);
  if (!catalog) return <div className="skeleton" />;
  const current = catalog.categories.find((c) => c.id === cat) || catalog.categories[0];
  const formats = current.formats.map((id) => catalog.formats.find((f) => f.id === id)!).filter((f) => f && f.targets.length);
  return (
    <div className="cat-index">
      <ul className="cat-list" role="tablist" aria-label="Format categories">
        {catalog.categories.map((c) => {
          const n = c.formats.filter((id) => catalog.formats.find((f) => f.id === id)?.targets.length).length;
          if (!n) return null;
          return (
            <li key={c.id}>
              <button type="button" role="tab" aria-selected={c.id === current.id} aria-controls="cat-panel" onClick={() => setCat(c.id)}>
                {c.name}
                <span className="cat-count">{n} formats</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="cat-panel" id="cat-panel" role="tabpanel">
        <h3>{current.name}</h3>
        <p>{current.blurb}</p>
        <div className="fmt-table">
          {formats.map((f) => (
            <div className="fmt-row" key={f.id} id={f.id}>
              <div>
                <Tag id={f.id} kind="src" />
              </div>
              <div className="fmt-targets">
                {f.targets.map((t) => (
                  <a key={t} href={`/convert/${pairSlug(f.id, t)}`} onClick={linkClick} aria-label={`${f.name} to ${t.toUpperCase()}`}>
                    <Tag id={t} kind="dst" />
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ToolGroups() {
  const { catalog } = useCatalog();
  if (!catalog) return <div className="skeleton" />;
  const groups = catalog.categories.map((c) => ({ c, tools: catalog.tools.filter((t) => t.category === c.id) })).filter((g) => g.tools.length);
  // The largest group (PDF) gets a wide two-column block; the rest share the other half.
  const [wide, ...rest] = [...groups].sort((a, b) => b.tools.length - a.tools.length);
  const render = ({ c, tools }: (typeof groups)[number], isWide = false) => (
    <div className={`tool-group${isWide ? ' wide' : ''}`} key={c.id}>
      <h3>{c.id === 'pdf' ? 'PDF tools' : `${c.name.replace(/s$/, '')} tools`}</h3>
      <ul className="tool-links">
        {tools.map((t) => {
          const Icon = toolIcon(t.icon);
          return (
            <li key={t.id}>
              <a href={`/tools/${t.id}`} onClick={linkClick}>
                <span className="tool-ico" aria-hidden="true">
                  <Icon size={18} />
                </span>
                <span className="t">{t.title}</span>
                <span className="d">{t.description}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
  return (
    <div className="tool-layout">
      {wide && render(wide, true)}
      <div className="tool-groups">{rest.sort((a, b) => groups.indexOf(a) - groups.indexOf(b)).map((g) => render(g))}</div>
    </div>
  );
}
