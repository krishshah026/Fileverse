export type QualityLevel = 'lossless' | 'high' | 'lossy';
export interface Quality {
  level: QualityLevel;
  message: string;
}

export interface OptionChoice {
  value: string | number | boolean;
  label: string;
  hint?: string;
}
export interface OptionSpec {
  key: string;
  label: string;
  type: 'select' | 'range' | 'number' | 'toggle' | 'text' | 'pages' | 'time' | 'password' | 'color';
  default?: unknown;
  choices?: OptionChoice[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  showIf?: Record<string, unknown[]>;
}

export interface Category {
  id: string;
  name: string;
  blurb: string;
  formats: string[];
}
export interface FormatInfo {
  id: string;
  name: string;
  category: string;
  ext: string[];
  inputOnly: boolean;
  codec?: string;
  note?: string;
  targets: string[];
}
export interface ToolInfo {
  id: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  batch: boolean;
  inputs: { formats: string[] | '*'; min: number; max: number };
  options?: OptionSpec[];
  quality?: Quality | null;
}
export interface Catalog {
  categories: Category[];
  formats: FormatInfo[];
  tools: ToolInfo[];
  stats: { formats: number; conversions: number; tools: number };
}

export interface MediaSummary {
  duration?: number;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
  fps?: number;
  sampleRate?: number;
  channels?: number;
  bitRate?: number;
  pages?: number;
  hasText?: boolean;
  frames?: number;
  hasAlpha?: boolean;
  encrypted?: boolean;
  tracks?: { video: number; audio: number; subtitle: number };
}

export interface Target {
  to: string;
  name: string;
  category: string;
  via?: string;
  quality: Quality;
  unavailable?: string;
  options: OptionSpec[];
}

export interface ServerFile {
  id: string;
  name: string;
  size: number;
  format: string | null;
  formatName?: string;
  category?: string;
  detection: { mismatch: boolean; note?: string };
  info: MediaSummary;
  targets: Target[];
  tools: ToolInfo[];
  expiresAt: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export interface JobOutput {
  index: number;
  name: string;
  size: number;
  format: string | null;
  relPath?: string;
  info: MediaSummary;
}
export interface Job {
  id: string;
  kind: 'convert' | 'tool';
  tool?: string;
  target?: string;
  status: JobStatus;
  progress: number;
  stage?: string;
  eta?: number;
  position?: number;
  quality?: Quality;
  notes: string[];
  error?: { message: string; suggestion?: string; detail?: string; code?: string };
  inputs: { id: string; name: string; size: number; format: string | null; info?: MediaSummary; missing?: boolean }[];
  outputs: JobOutput[];
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  expiresAt: number;
}

export interface ServerConfig {
  maxUploadBytes: number;
  chunkSizeBytes: number;
  fileTtlMinutes: number;
  maxBatchInputs: number;
  maxActiveJobsPerSession: number;
  freeBytes: number;
}
