import { useEffect, useState } from 'react';
import { History, Moon, Sun, LayoutGrid, Wrench } from 'lucide-react';
import { BrandMark } from './icons';
import { linkClick, usePath } from '../lib/router';
import { useStore } from '../lib/store';

type Theme = 'light' | 'dark';
function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('fv.theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function Header({ onHistory }: { onHistory: () => void }) {
  const path = usePath();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [scrolled, setScrolled] = useState(false);
  const active = useStore((s) => s.items.filter((i) => i.job && ['queued', 'running'].includes(i.job.status)).length + s.runs.filter((r) => r.job && ['queued', 'running'].includes(r.job.status)).length);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('fv.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`site-header${scrolled ? ' scrolled' : ''}`}>
      <div className="wrap">
        <a href="/" className="brand" onClick={linkClick} aria-label="Fileverse home">
          <BrandMark />
          Fileverse
        </a>
        <nav aria-label="Main" style={{ display: 'flex', gap: 2 }}>
          <a href="/tools" className="nav-link" onClick={linkClick} aria-current={path.startsWith('/tools') ? 'page' : undefined}>
            <Wrench size={17} aria-hidden="true" />
            <span className="label">Tools</span>
          </a>
          <a href="/formats" className="nav-link" onClick={linkClick} aria-current={path.startsWith('/formats') ? 'page' : undefined}>
            <LayoutGrid size={17} aria-hidden="true" />
            <span className="label">Formats</span>
          </a>
          <button type="button" className="nav-link" onClick={onHistory}>
            <History size={17} aria-hidden="true" />
            <span className="label">History</span>
            {active > 0 && <span className="count-dot" aria-label={`${active} in progress`}>{active}</span>}
          </button>
        </nav>
        <button type="button" className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
}
