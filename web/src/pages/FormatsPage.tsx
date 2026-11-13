import { useEffect } from 'react';
import { CategoryIndex } from '../components/Directory';
import { useCatalog } from '../lib/catalog';

export function FormatsPage({ category }: { category?: string }) {
  const { catalog } = useCatalog();
  useEffect(() => {
    document.title = 'All formats — Fileverse';
    if (location.hash) setTimeout(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }), 50);
  }, [catalog]);
  return (
    <main id="main" className="wrap">
      <div className="page-head" style={{ marginBottom: 28 }}>
        <h1>Formats</h1>
        <p className="lede">
          {catalog ? `${catalog.stats.formats} formats and ${catalog.stats.conversions.toLocaleString()} conversion paths.` : ''} Select a category, then choose the format you need to get started.
        </p>
      </div>
      <CategoryIndex key={category} initial={category || 'video'} />
    </main>
  );
}
