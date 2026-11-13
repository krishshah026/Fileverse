import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

// Apply the saved theme before first paint to avoid a flash.
try {
  const t = localStorage.getItem('fv.theme');
  document.documentElement.dataset.theme = t === 'dark' || t === 'light' ? t : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch {
  /* ignore */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
