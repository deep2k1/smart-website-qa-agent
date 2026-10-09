import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deterministicProvider } from '../server/src/ai';
import { createReport, runScan } from '../server/src/scanner';
import type { ScanReport, ScanRequest } from '../shared/types';
import { startFixture, type Fixture } from './fixtures/site';

let fx: Fixture;
const deps = { policy: { allowedHosts: ['127.0.0.1'] }, ai: deterministicProvider };
const req = (over: Partial<ScanRequest>): ScanRequest => ({ url: fx.baseUrl + '/', mode: 'full', maxPages: 20, concurrency: 3, timeoutMs: 5000, browserChecks: false, ...over });
const scan = async (over: Partial<ScanRequest>): Promise<ScanReport> => { const r = createReport('t', req(over)); await runScan(r, deps); return r; };
const has = (r: ScanReport, cat: string, title: RegExp, urlPart?: string) => r.findings.some((f) => f.category === cat && title.test(f.title) && (!urlPart || f.evidence.includes(urlPart)));

beforeAll(async () => { fx = await startFixture(); });
afterAll(async () => { await fx.close(); });
beforeEach(() => fx.reset());

describe('full-site scan', () => {
  it('discovers pages via links (2 levels deep) and sitemap, never unlinked pages', async () => {
    const r = await scan({});
    expect(r.status).toBe('completed');
    const paths = r.pages.map((p) => new URL(p.url).pathname);
    expect(paths).toEqual(expect.arrayContaining(['/', '/about', '/deep', '/signup', '/orphan']));
    expect(paths).not.toContain('/private-unlinked');
    expect(r.pages.find((p) => p.url.endsWith('/orphan'))?.source).toBe('sitemap');
    expect(r.pages.find((p) => p.url.endsWith('/deep'))?.source).toBe('link');
  });
  it('detects broken links/images, alt, SEO, headings, CTA, content issues with evidence', async () => {
    const r = await scan({});
    expect(has(r, 'links', /Broken link \(HTTP 404\)/, '/missing-page')).toBe(true);
    expect(has(r, 'images', /Broken image \(HTTP 404\)/, '/img/missing.png')).toBe(true);
    expect(r.findings.some((f) => f.category === 'images' && /missing alt/.test(f.title) && f.url.endsWith('/'))).toBe(true);
    expect(r.findings.some((f) => f.category === 'seo' && /Missing or empty <title>/.test(f.title) && f.url.endsWith('/about'))).toBe(true);
    expect(r.findings.some((f) => f.category === 'headings' && /Missing H1/.test(f.title) && f.url.endsWith('/about'))).toBe(true);
    expect(has(r, 'cta', /no destination/, 'Buy now')).toBe(true);
    expect(has(r, 'content', /spelling/)).toBe(true);
    expect(has(r, 'content', /lorem/)).toBe(true);
    const home = r.pages.find((p) => new URL(p.url).pathname === '/')!;
    expect(home.ctas).toEqual(expect.arrayContaining([expect.objectContaining({ text: 'Get started', href: `${fx.baseUrl}/signup` })]));
  });
  it('does not contact private targets: link to 10.0.0.5 and a redirect to 169.254.x are reported, not fetched', async () => {
    const r = await scan({});
    expect(r.findings.some((f) => f.category === 'security' && f.evidence.includes('10.0.0.5'))).toBe(true);
    expect(r.findings.some((f) => f.category === 'security' && f.evidence.includes('redirect-private'))).toBe(true);
    expect(fx.requests.some((q) => q.path.includes('meta-data'))).toBe(false);
  });
  it('respects the page limit and records a note', async () => {
    const r = await scan({ maxPages: 2 });
    expect(r.pages.length).toBe(2);
    expect(r.notes.join(' ')).toMatch(/Page limit reached/);
  });
  it('produces schema-valid findings with unique IDs, counts and an AI summary referencing real IDs only', async () => {
    const r = await scan({});
    const ids = r.findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of r.findings) expect(Object.keys(f).sort()).toEqual(['category', 'evidence', 'id', 'recommendation', 'severity', 'title', 'url']);
    expect(r.counts.total).toBe(r.findings.length);
    expect(Object.values(r.counts.bySeverity).reduce((a, b) => a + b, 0)).toBe(r.findings.length);
    expect(r.ai?.provider).toBe('deterministic');
    for (const p of r.ai!.priorities) expect(ids).toContain(p.findingId);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // JSON-export safe
  });
});

describe('single-page scan (change request)', () => {
  it('scans exactly one page and never fetches any other page or the sitemap', async () => {
    const r = await scan({ mode: 'single', maxPages: 1 });
    expect(r.status).toBe('completed');
    expect(r.pages.map((p) => new URL(p.url).pathname)).toEqual(['/']);
    const pageGets = fx.requests.filter((q) => q.method === 'GET');
    expect(pageGets.map((q) => q.path)).toEqual(['/']);
    expect(fx.requests.some((q) => q.path === '/sitemap.xml')).toBe(false);
    for (const p of ['/about', '/deep', '/orphan', '/signup']) expect(fx.requests.some((q) => q.method === 'GET' && q.path === p)).toBe(false);
  });
  it('still checks link/image destinations of that page (HEAD only) and reports broken ones', async () => {
    const r = await scan({ mode: 'single' });
    expect(has(r, 'links', /Broken link \(HTTP 404\)/, '/missing-page')).toBe(true);
    expect(fx.requests.filter((q) => q.path === '/missing-page').every((q) => q.method === 'HEAD')).toBe(true);
  });
});

describe('failure handling', () => {
  it('fails cleanly with a message when the start URL is unreachable', async () => {
    const r = await scan({ url: 'http://127.0.0.1:1/' });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Could not fetch/);
  });
  it('fails cleanly for a blocked start URL', async () => {
    const r = createReport('t', req({ url: 'http://169.254.169.254/' }));
    await runScan(r, { ...deps, policy: { allowedHosts: [] } });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/blocked|private/i);
  });
  it('reports a timeout error for a slow start page', async () => {
    const r = await scan({ url: fx.baseUrl + '/slow', timeoutMs: 1000 });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Timed out/);
  });
});
