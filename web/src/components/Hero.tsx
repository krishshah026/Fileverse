import { File as FileIcon } from 'lucide-react';
import { ConvertArrow, categoryIcon } from './icons';
import { useCatalog } from '../lib/catalog';
import { linkClick } from '../lib/router';
import { plural } from '../lib/format';

/**
 * The hero states the promise in general terms — any file, any format — and shows the full
 * breadth of the platform as category shortcuts, instead of featuring a single conversion.
 */
export function Hero() {
  const { catalog } = useCatalog();
  const categories = (catalog?.categories || [])
    .map((c) => ({ ...c, count: c.formats.filter((id) => catalog?.formats.find((f) => f.id === id)?.targets.length).length }))
    .filter((c) => c.count > 0);

  return (
    <div className="hero">
      <p className="hero-pair" aria-hidden="true">
        <span className="ext-chip src">
          <FileIcon className="chip-icon" />
          Any file
        </span>
        <ConvertArrow className="hero-arrow" />
        <span className="ext-chip dst">
          <FileIcon className="chip-icon" />
          Any format
        </span>
      </p>
      <h1 className="hero-title">Every file format. One reliable converter.</h1>
      <p className="hero-sub">
        Convert video, audio, images, PDFs, documents and more{catalog ? ` across ${plural(catalog.stats.formats, 'format')} and ${catalog.stats.conversions.toLocaleString()} conversion paths` : ''}. Files up to 20 GB, no daily limits, no sign-up, and your original quality preserved wherever the format allows.
      </p>
      {categories.length > 0 && (
        <nav className="hero-cats" aria-label="Browse by category">
          {categories.map((c) => {
            const Icon = categoryIcon(c.id);
            return (
              <a key={c.id} href={`/formats/${c.id}`} onClick={linkClick} className="hero-cat" title={`${c.count} ${c.name.toLowerCase()} format${c.count === 1 ? '' : 's'}`}>
                <Icon size={16} aria-hidden="true" />
                <span>{c.name}</span>
              </a>
            );
          })}
        </nav>
      )}
    </div>
  );
}
