import { useEffect, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { useStore } from '../lib/store';
import { bytes } from '../lib/format';

interface Props {
  onFiles: (files: File[]) => void;
  compact?: boolean;
  accept?: string;
  multiple?: boolean;
  title?: string;
  hint?: string;
}

/** Click, drag-and-drop or paste. Files are streamed in chunks, never read into memory. */
export function Dropzone({ onFiles, compact, accept, multiple = true, title, hint }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const max = useStore((s) => s.config?.maxUploadBytes);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        onFiles(files);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);

  return (
    <div
      className={`dropzone${over ? ' over' : ''}${compact ? ' compact' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={title || 'Choose files to convert'}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = Array.from(e.dataTransfer.files || []);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
    >
      <div className="drop-icon" aria-hidden="true">
        <Upload size={compact ? 20 : 26} strokeWidth={2.2} />
      </div>
      <div>
        <div className="drop-title">{over ? 'Release to upload' : title || (compact ? 'Add more files' : 'Drag and drop your files here')}</div>
        <div className="drop-sub">{hint || `or browse from your device. Any format, up to ${max ? bytes(max) : '20 GB'} per file. Paste works too.`}</div>
      </div>
      {!compact && (
        <span className="btn primary big" aria-hidden="true">
          Browse files
        </span>
      )}
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
