// Shared by server and web. Keep runtime values minimal: only constants and types.
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = [
  'links',
  'images',
  'seo',
  'headings',
  'content',
  'cta',
  'browser',
  'responsive',
  'accessibility',
  'security',
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Finding {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  url: string; // affected URL
  evidence: string;
  recommendation: string;
}

export type ScanMode = 'full' | 'single';
export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanRequest {
  url: string;
  mode: ScanMode;
  maxPages: number;
  concurrency: number;
  timeoutMs: number;
  browserChecks: boolean;
}

export interface PageSummary {
  url: string;
  finalUrl?: string;
  status: number; // 0 = no HTTP response (network error / blocked)
  source: 'start' | 'sitemap' | 'link';
  title?: string | null;
  error?: string;
  linkCount: number;
  imageCount: number;
  ctas: { text: string; href: string | null; kind: 'link' | 'button' }[];
}

export interface ScanProgress {
  phase: string;
  pagesDiscovered: number;
  pagesScanned: number;
  linksChecked: number;
  linksTotal: number;
}

export interface AiSummary {
  provider: 'deterministic' | 'anthropic';
  model?: string;
  summary: string;
  priorities: { findingId: string; reason: string }[];
  disclaimer: string;
}

export interface Counts {
  total: number;
  bySeverity: Record<Severity, number>;
  byCategory: Record<Category, number>;
}

export interface ScanReport {
  id: string;
  status: ScanStatus;
  request: ScanRequest;
  startedAt: string;
  finishedAt?: string;
  progress: ScanProgress;
  pages: PageSummary[];
  findings: Finding[];
  counts: Counts;
  ai?: AiSummary;
  notes: string[];
  error?: string;
}

export interface ApiError {
  error: { code: 'invalid_request' | 'url_blocked' | 'busy' | 'not_found' | 'internal'; message: string };
}
