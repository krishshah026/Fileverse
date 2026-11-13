import { useEffect, useState } from 'react';
import { Header } from './components/Header';
import { HistoryDrawer } from './components/HistoryDrawer';
import { Home } from './pages/Home';
import { ConvertPage } from './pages/ConvertPage';
import { ToolPage, ToolsIndex } from './pages/ToolPage';
import { FormatsPage } from './pages/FormatsPage';
import { NotFound } from './pages/NotFound';
import { usePath, linkClick } from './lib/router';
import { connectLive, loadConfig, addFiles } from './lib/store';
import { loadCatalog, useCatalog } from './lib/catalog';

function route(path: string) {
  if (path === '/' || path === '') return <Home />;
  let m = /^\/convert\/([a-z0-9.-]+)\/?$/.exec(path);
  if (m) return <ConvertPage slug={m[1]} />;
  m = /^\/tools\/([a-z0-9-]+)\/?$/.exec(path);
  if (m) return <ToolPage id={m[1]} />;
  if (/^\/tools\/?$/.test(path)) return <ToolsIndex />;
  m = /^\/formats(?:\/([a-z]+))?\/?$/.exec(path);
  if (m) return <FormatsPage category={m[1]} />;
  return <NotFound />;
}

export function App() {
  const path = usePath();
  const [history, setHistory] = useState(false);
  const { error } = useCatalog();

  useEffect(() => {
    loadCatalog().catch(() => {});
    loadConfig();
    connectLive();
  }, []);
  useEffect(() => {
    if (path === '/') document.title = 'Fileverse — Convert any file, keep every detail';
  }, [path]);

  // Dropping files anywhere on the home page adds them to the converter.
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      if (location.pathname === '/') addFiles(Array.from(e.dataTransfer.files), 'convert');
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <>
      <a className="sr-only" href="#main">
        Skip to content
      </a>
      <Header onHistory={() => setHistory(true)} />
      {error && (
        <div className="wrap" style={{ paddingTop: 20 }}>
          <p className="error-box" role="alert">
            We can't reach the conversion service right now ({error}). Please check your connection and refresh the page.
          </p>
        </div>
      )}
      {route(path)}
      <footer className="site-footer">
        <div className="wrap">
          <span>Fileverse converts your files on secure servers and deletes them automatically.</span>
          <nav style={{ display: 'flex', gap: 18 }} aria-label="Footer">
            <a href="/tools" onClick={linkClick}>Tools</a>
            <a href="/formats" onClick={linkClick}>Formats</a>
          </nav>
        </div>
      </footer>
      {history && <HistoryDrawer onClose={() => setHistory(false)} />}
    </>
  );
}
