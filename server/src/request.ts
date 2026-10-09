import type { ScanRequest } from '../../shared/types';
import { parseHttpUrl } from './security';

export class RequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestError';
  }
}

function int(value: unknown, name: string, def: number, min: number, max: number): number {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new RequestError(`"${name}" must be an integer.`);
  return Math.min(max, Math.max(min, n)); // clamp to documented bounds
}

/** Validates and normalizes a scan request body. Applies hard caps. */
export function normalizeRequest(body: unknown, maxPagesCap: number): ScanRequest {
  if (!body || typeof body !== 'object') throw new RequestError('Request body must be a JSON object.');
  const b = body as Record<string, unknown>;
  const url = parseHttpUrl(b.url).href; // throws UrlSecurityError
  const mode = b.mode ?? 'full';
  if (mode !== 'full' && mode !== 'single') throw new RequestError('"mode" must be "full" or "single".');
  if (b.browserChecks !== undefined && typeof b.browserChecks !== 'boolean') {
    throw new RequestError('"browserChecks" must be a boolean.');
  }
  return {
    url,
    mode,
    maxPages: mode === 'single' ? 1 : int(b.maxPages, 'maxPages', 20, 1, maxPagesCap),
    concurrency: int(b.concurrency, 'concurrency', 3, 1, 5),
    timeoutMs: int(b.timeoutMs, 'timeoutMs', 10000, 1000, 30000),
    browserChecks: b.browserChecks === undefined ? true : b.browserChecks,
  };
}
