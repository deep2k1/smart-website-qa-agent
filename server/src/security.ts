import dns from 'node:dns/promises';
import net from 'node:net';

export class UrlSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlSecurityError';
  }
}
export class FetchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

export interface SecurityPolicy {
  /** Hostnames exempt from the private-network block (local development / tests only). */
  allowedHosts: string[];
}

const USER_AGENT = 'SmartWebsiteQAAgent/1.0 (+internship-assignment; respectful crawler)';
const BLOCKED_NAME = /(^|\.)(localhost|local|internal|localdomain|home\.arpa)$/i;

function isPrivateV4(ip: string): boolean {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function isPrivateV6(ip: string): boolean {
  if (ip === '::' || ip === '::1') return true;
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  const mappedHex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateV4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  const first = parseInt(ip.split(':')[0] || '0', 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // multicast
  return false;
}

/** True for private, loopback, link-local, reserved or unparseable addresses. */
export function isPrivateIp(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '').toLowerCase();
  const v = net.isIP(addr);
  if (v === 4) return isPrivateV4(addr);
  if (v === 6) return isPrivateV6(addr);
  return true;
}

/** Parses and validates a user-supplied URL (syntax only; no network). */
export function parseHttpUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || !raw.trim()) throw new UrlSecurityError('A URL is required.');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UrlSecurityError('Invalid URL. Include the scheme, e.g. https://example.com');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UrlSecurityError(`Unsupported protocol "${u.protocol}". Only http and https are allowed.`);
  }
  if (u.username || u.password) throw new UrlSecurityError('URLs containing credentials are not allowed.');
  u.hash = '';
  return u;
}

/** Throws unless every address the host resolves to is public (or the host is explicitly allow-listed). */
export async function assertPublicUrl(u: URL, policy: SecurityPolicy): Promise<void> {
  const host = u.hostname.toLowerCase();
  if (policy.allowedHosts.includes(host)) return;
  if (BLOCKED_NAME.test(host)) throw new UrlSecurityError(`Host "${host}" is a local name and is blocked.`);
  const bare = host.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (isPrivateIp(bare)) throw new UrlSecurityError(`Address ${bare} is private/local and is blocked.`);
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UrlSecurityError(`Could not resolve host "${host}".`);
  }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) {
    throw new UrlSecurityError(`Host "${host}" resolves to a private/local address and is blocked.`);
  }
}

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  timeoutMs: number;
  policy: SecurityPolicy;
  maxRedirects?: number;
  maxBytes?: number;
  /** When false the response body is discarded (status check only). */
  readBody?: boolean;
}
export interface SafeResponse {
  url: string; // final URL after redirects
  status: number;
  contentType: string;
  body: string;
  redirects: string[];
  truncated: boolean;
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * fetch() with: scheme check, DNS/IP validation on EVERY hop, manual redirect following
 * (max 5), a single overall deadline, and a response size cap.
 */
export async function safeFetch(rawUrl: string, opts: SafeFetchOptions): Promise<SafeResponse> {
  const maxRedirects = opts.maxRedirects ?? 5;
  const maxBytes = opts.maxBytes ?? 2_000_000;
  const method = opts.method ?? 'GET';
  const deadline = Date.now() + opts.timeoutMs;
  let current = parseHttpUrl(rawUrl);
  const redirects: string[] = [];

  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicUrl(current, opts.policy);
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new FetchTimeoutError(`Timed out after ${opts.timeoutMs}ms: ${current.href}`);

    let res: Response;
    try {
      res = await fetch(current, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5' },
      });
    } catch (e) {
      if (isAbort(e)) throw new FetchTimeoutError(`Timed out after ${opts.timeoutMs}ms: ${current.href}`);
      throw e;
    }

    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => undefined);
      let next: URL;
      try {
        next = parseHttpUrl(new URL(location, current).href); // re-validates scheme/credentials
      } catch (e) {
        throw e instanceof UrlSecurityError ? new UrlSecurityError(`Redirect rejected: ${e.message}`) : e;
      }
      redirects.push(next.href);
      current = next;
      continue;
    }

    const contentType = res.headers.get('content-type') ?? '';
    let body = '';
    let truncated = false;
    try {
      if (method === 'GET' && opts.readBody !== false && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            truncated = true;
            await reader.cancel().catch(() => undefined);
            break;
          }
          body += decoder.decode(value, { stream: true });
        }
      } else {
        await res.body?.cancel().catch(() => undefined);
      }
    } catch (e) {
      if (isAbort(e)) throw new FetchTimeoutError(`Timed out while reading body after ${opts.timeoutMs}ms: ${current.href}`);
      throw e;
    }
    return { url: current.href, status: res.status, contentType, body, redirects, truncated };
  }
  throw new UrlSecurityError(`Too many redirects (more than ${maxRedirects}).`);
}

export type ErrorKind = 'blocked' | 'timeout' | 'network';
export function classifyError(e: unknown): { kind: ErrorKind; message: string } {
  if (e instanceof UrlSecurityError) return { kind: 'blocked', message: e.message };
  if (e instanceof FetchTimeoutError) return { kind: 'timeout', message: e.message };
  const err = e as { message?: string; cause?: { code?: string; message?: string } };
  const detail = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
  return { kind: 'network', message: `Network error: ${detail}` };
}
