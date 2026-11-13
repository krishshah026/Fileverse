import { Hero } from '../components/Hero';
import { Dropzone } from '../components/Dropzone';
import { Search } from '../components/Search';
import { Workspace } from '../components/Workspace';
import { CategoryIndex, PopularPairs, ToolGroups } from '../components/Directory';
import { addFiles, useStore } from '../lib/store';
import { bytes } from '../lib/format';
import { linkClick } from '../lib/router';

export function Promises() {
  const cfg = useStore((s) => s.config);
  const ttl = cfg?.fileTtlMinutes ?? 120;
  const ttlText = ttl % 60 === 0 ? `${ttl / 60} hour${ttl === 60 ? '' : 's'}` : `${ttl} minutes`;
  return (
    <dl className="promises">
      <div className="promise">
        <dt>Unlimited conversions</dt>
        <dd>No daily caps, no paywalls and no account. When demand is high, files wait briefly in a fair queue rather than being turned away.</dd>
      </div>
      <div className="promise">
        <dt>Engineered for large files</dt>
        <dd>Uploads travel in secure chunks and resume automatically if your connection drops, so multi-gigabyte videos arrive intact{cfg ? `. Up to ${bytes(cfg.maxUploadBytes)} per file` : ''}.</dd>
      </div>
      <div className="promise">
        <dt>Quality you can trust</dt>
        <dd>Whenever the target format can hold the original data, it is carried over untouched. If a format requires compression, you see exactly what changes before you convert.</dd>
      </div>
      <div className="promise">
        <dt>Private by design</dt>
        <dd>Your files are visible only to you and are permanently deleted {ttlText} after conversion. Nothing is shared, indexed or kept.</dd>
      </div>
    </dl>
  );
}

export function Faq() {
  return (
    <div className="faq">
      <details>
        <summary>Why are some video conversions almost instant?</summary>
        <p>Formats such as MKV and MP4 are containers. When the video and audio inside already suit the new container (for example H.264 and AAC), Fileverse transfers them directly instead of re-encoding. The result is bit-for-bit identical in quality and takes seconds, even for a 6 GB file.</p>
      </details>
      <details>
        <summary>Will conversion reduce the quality of my file?</summary>
        <p>Only when the target format itself requires it. Lossless conversions, such as PNG to WEBP, WAV to FLAC or MKV to MP4, preserve every detail. Compressed formats such as JPG and MP3 use the highest-quality settings by default, and every conversion explains its impact before you start. You can adjust the settings at any time.</p>
      </details>
      <details>
        <summary>Can I turn a scanned PDF into an editable Word document?</summary>
        <p>Yes. Scanned PDFs are recognised automatically and text recognition (OCR) is enabled for you, in 14 languages. Accuracy depends on scan quality, so we recommend reviewing names and figures afterwards.</p>
      </details>
      <details>
        <summary>Are there any limitations?</summary>
        <p>A few, by design. RAR archives can be extracted but not created, as the format is proprietary. DRM-protected ebooks and password-protected PDFs require their owner's rights or password. Uncommon fonts in office documents are replaced with metric-compatible equivalents, so very unusual typefaces may differ slightly in PDF output.</p>
      </details>
      <details>
        <summary>How are my files kept private?</summary>
        <p>Files travel over an encrypted connection to the Fileverse server that performs the conversion. Only your browser can access your files and results, and both are deleted automatically. Your conversion history is stored in your own browser, never on our servers.</p>
      </details>
    </div>
  );
}

export function Home() {
  const hasItems = useStore((s) => s.items.some((i) => i.scope === 'convert'));
  return (
    <main id="main" className="wrap">
      {!hasItems && <Hero />}
      {!hasItems ? (
        <>
          <Dropzone onFiles={(f) => addFiles(f, 'convert')} />
          <Search />
        </>
      ) : (
        <>
          <div style={{ paddingTop: 28 }}>
            <Search />
          </div>
          <Workspace />
        </>
      )}

      <section className="section" aria-labelledby="popular-h">
        <div className="section-head">
          <h2 id="popular-h">Most popular conversions</h2>
          <a href="/formats" onClick={linkClick} className="btn ghost">
            View all formats
          </a>
        </div>
        <PopularPairs />
      </section>

      <section className="section" aria-labelledby="tools-h">
        <div className="section-head">
          <h2 id="tools-h">Tools</h2>
          <p>Purpose-built tools to merge, split, compress, trim and secure your files.</p>
        </div>
        <ToolGroups />
      </section>

      <section className="section" aria-labelledby="formats-h">
        <div className="section-head">
          <h2 id="formats-h">Browse by format</h2>
          <p>Select a category to see every supported format and where it can go.</p>
        </div>
        <CategoryIndex />
      </section>

      <section className="section" aria-labelledby="promise-h">
        <div className="section-head">
          <h2 id="promise-h">Why Fileverse</h2>
        </div>
        <Promises />
      </section>

      <section className="section" aria-labelledby="faq-h">
        <div className="section-head">
          <h2 id="faq-h">Frequently asked questions</h2>
        </div>
        <Faq />
      </section>
    </main>
  );
}
