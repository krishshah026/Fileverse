import { useEffect } from 'react';
import { Dropzone } from '../components/Dropzone';
import { Workspace } from '../components/Workspace';
import { ConvertArrow } from '../components/icons';
import { Promises } from './Home';
import { fmt, pairSlug, parsePairSlug, useCatalog } from '../lib/catalog';
import { addFiles, useStore } from '../lib/store';
import { linkClick } from '../lib/router';
import { Tag } from '../components/Tag';
import { NotFound } from './NotFound';

const LEVEL_TEXT: Record<string, string> = {
  lossless: 'The original data is preserved exactly, so nothing is lost in conversion.',
  lossy: 'Because this format uses compression, Fileverse applies high-quality settings by default, and you can fine-tune them before converting.',
};

/** Landing page for one conversion, e.g. /convert/mkv-to-mp4. */
export function ConvertPage({ slug }: { slug: string }) {
  const { catalog } = useCatalog();
  const pair = catalog ? parsePairSlug(slug) : null;
  const hasItems = useStore((s) => s.items.some((i) => i.scope === 'convert'));
  useEffect(() => {
    if (pair) document.title = `Convert ${pair[0].toUpperCase()} to ${pair[1].toUpperCase()} — Fileverse`;
  }, [pair?.[0], pair?.[1]]);
  if (!catalog) return <main className="wrap page-head"><div className="skeleton" /></main>;
  if (!pair) return <NotFound />;
  const [from, to] = pair;
  const a = fmt(from)!;
  const b = fmt(to)!;
  const valid = a.targets.includes(to);
  const others = a.targets.filter((t) => t !== to).slice(0, 18);
  const reverse = fmt(to)?.targets.includes(from);
  const quality = b.codec === 'lossless' ? LEVEL_TEXT.lossless : b.codec === 'lossy' && a.codec !== 'lossy' ? LEVEL_TEXT.lossy : null;

  return (
    <main id="main" className="wrap">
      <div className="page-head">
        <nav className="crumbs" aria-label="Breadcrumb">
          <a href="/" onClick={linkClick}>Fileverse</a>
          <span aria-hidden="true">/</span>
          <a href={`/formats/${a.category}`} onClick={linkClick}>{a.name} conversions</a>
        </nav>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.4em', flexWrap: 'wrap' }}>
          <span className="sr-only">
            Convert {a.name} to {b.name}
          </span>
          <span className="ext-chip src" aria-hidden="true">.{from}</span>
          <ConvertArrow size={48} className="muted" />
          <span className="ext-chip dst" aria-hidden="true">.{to}</span>
        </h1>
        <p className="lede">
          Convert {a.name} files to {b.name} in seconds — free, with no limits and no sign-up. {quality}
        </p>
      </div>
      {!valid ? (
        <p className="info-box" style={{ marginTop: 24 }}>
          {a.name} cannot be converted to {b.name}.
        </p>
      ) : !hasItems ? (
        <Dropzone onFiles={(f) => addFiles(f, 'convert', to)} title={`Drag and drop your ${a.name} files here`} />
      ) : (
        <Workspace presetTarget={to} />
      )}

      <section className="section" aria-labelledby="more-h">
        <div className="section-head">
          <h2 id="more-h">Other ways to convert {a.name}</h2>
        </div>
        <div className="fmt-targets">
          {others.map((t) => (
            <a key={t} href={`/convert/${pairSlug(from, t)}`} onClick={linkClick}>
              <Tag id={t} kind="dst" />
            </a>
          ))}
          {reverse && (
            <a href={`/convert/${pairSlug(to, from)}`} onClick={linkClick} className="btn ghost small" style={{ marginLeft: 8 }}>
              Convert {b.name} to {a.name} instead
            </a>
          )}
        </div>
      </section>
      <section className="section">
        <Promises />
      </section>
    </main>
  );
}
