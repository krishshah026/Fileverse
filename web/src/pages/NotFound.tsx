import { linkClick } from '../lib/router';

export function NotFound() {
  return (
    <main id="main" className="wrap page-head">
      <h1>Page not found</h1>
      <p className="lede">This link may be outdated. Everything you need is available from the home page.</p>
      <p style={{ marginTop: 20 }}>
        <a className="btn primary" href="/" onClick={linkClick}>
          Back to Fileverse
        </a>
      </p>
    </main>
  );
}
