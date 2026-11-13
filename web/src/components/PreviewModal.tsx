import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Download, X } from 'lucide-react';
import { downloadUrl } from '../lib/api';
import { fmt } from '../lib/catalog';
import type { JobOutput } from '../lib/types';

export function PreviewModal({ jobId, output, onClose }: { jobId: string; output: JobOutput; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  const src = downloadUrl(jobId, output.index, true);
  const cat = fmt(output.format)?.category;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Preview of ${output.name}`}>
        <div className="modal-card">
          <div className="modal-head">
            <span className="n">{output.name}</span>
            <a className="btn go small" href={downloadUrl(jobId, output.index)} download>
              <Download size={14} aria-hidden="true" /> Download
            </a>
            <button ref={closeBtn} type="button" className="icon-btn" onClick={onClose} aria-label="Close preview">
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">
            {cat === 'image' && <img src={src} alt={`Converted ${output.name}`} />}
            {cat === 'video' && <video src={src} controls autoPlay playsInline />}
            {cat === 'audio' && <audio src={src} controls autoPlay />}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
