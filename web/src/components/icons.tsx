import {
  Archive, ArchiveRestore, Combine, Crop, FileArchive, FileAudio, FileCode2, FileImage, FileQuestion, FileSpreadsheet, FileText, FileType2, FileVideo2,
  Images, Lock, LockOpen, Minimize2, Presentation, RotateCw, ScanText, Scissors, Split, Subtitles, Trash2, BookOpen, FileStack, Type,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export const TOOL_ICONS: Record<string, LucideIcon> = {
  merge: Combine,
  split: Split,
  extract: FileStack,
  remove: Trash2,
  rotate: RotateCw,
  compress: Minimize2,
  lock: Lock,
  unlock: LockOpen,
  ocr: ScanText,
  archive: Archive,
  images: Images,
  resize: Crop,
  trim: Scissors,
};
export const toolIcon = (name?: string): LucideIcon => (name === 'extract' ? FileStack : TOOL_ICONS[name || ''] || FileType2);
export const extractIcon = ArchiveRestore;

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  image: FileImage,
  video: FileVideo2,
  audio: FileAudio,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  presentation: Presentation,
  ebook: BookOpen,
  archive: FileArchive,
  data: FileCode2,
  subtitle: Subtitles,
  font: Type,
};
export const categoryIcon = (c?: string): LucideIcon => CATEGORY_ICONS[c || ''] || FileQuestion;

/** The Fileverse mark: a source page (ochre) turning into a result page (cobalt). */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2.5" y="6" width="15" height="20" rx="4" fill="var(--source-fill)" />
      <rect x="12.5" y="3" width="17" height="24" rx="4.5" fill="var(--result-fill)" />
      <path d="M17 15h8m-3-3.5L25.5 15 22 18.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The long conversion arrow used between formats. */
export function ConvertArrow({ className = '', size }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size ? size * 0.4 : undefined} viewBox="0 0 100 40" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path d="M4 20h86M74 6l16 14-16 14" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
