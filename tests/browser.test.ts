import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBrowserChecks } from '../server/src/browser';
import { startFixture, type Fixture } from './fixtures/site';

let fx: Fixture;
beforeAll(async () => { fx = await startFixture(); });
afterAll(async () => { await fx.close(); });

describe('browser checks (needs Chromium: npm run setup:browser)', () => {
  it('captures console errors and uncaught page errors, or skips with a note when Chromium is unavailable', async (ctx) => {
    const res = await runBrowserChecks([`${fx.baseUrl}/js-error`], { timeoutMs: 8000, policy: { allowedHosts: ['127.0.0.1'] }, maxPages: 1 });
    if (res.note?.startsWith('Browser checks skipped')) return ctx.skip();
    expect(res.findings.some((f) => f.category === 'browser' && f.title === 'Console error' && f.evidence.includes('fixture console error'))).toBe(true);
    expect(res.findings.some((f) => f.category === 'browser' && f.title === 'Uncaught page error' && f.evidence.includes('fixture uncaught'))).toBe(true);
  });
  it('regression: a missing image is reported once (HTTP 404), not again as a generic console error', async (ctx) => {
    const res = await runBrowserChecks([`${fx.baseUrl}/`], { timeoutMs: 8000, policy: { allowedHosts: ['127.0.0.1'] }, maxPages: 1 });
    if (res.note?.startsWith('Browser checks skipped')) return ctx.skip();
    expect(res.findings.some((f) => f.title === 'Resource returned HTTP 404' && f.evidence.includes('/img/missing.png'))).toBe(true);
    expect(res.findings.some((f) => f.title === 'Console error' && /Failed to load resource/i.test(f.evidence))).toBe(false);
  });
});
