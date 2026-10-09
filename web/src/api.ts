import type { ApiError, ScanReport, ScanRequest } from '../../shared/types';

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => null)) as (T & Partial<ApiError>) | null;
  if (!res.ok) throw new Error(data?.error?.message ?? `Request failed (HTTP ${res.status})`);
  return data as T;
}

const network = (e: unknown): never => {
  if (e instanceof TypeError) throw new Error('Cannot reach the QA server. Is it running (npm run dev)?');
  throw e;
};

export async function startScan(req: Pick<ScanRequest, 'url' | 'mode' | 'maxPages' | 'browserChecks'>): Promise<{ id: string }> {
  try {
    return await parse(await fetch('/api/scans', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) }));
  } catch (e) {
    return network(e);
  }
}

export async function getScan(id: string): Promise<ScanReport> {
  try {
    return await parse(await fetch(`/api/scans/${id}`));
  } catch (e) {
    return network(e);
  }
}

export const exportUrl = (id: string) => `/api/scans/${id}/export`;
