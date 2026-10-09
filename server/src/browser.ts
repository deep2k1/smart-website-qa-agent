import type { RawFinding } from './analyzers';
import { assertPublicUrl, type SecurityPolicy } from './security';

export interface BrowserOptions { timeoutMs: number; policy: SecurityPolicy; maxPages: number }
export interface BrowserResult { findings: RawFinding[]; note?: string }
export type BrowserRunner = (urls: string[], opts: BrowserOptions) => Promise<BrowserResult>;

const clip = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n)}…` : s);
const MSG = (e: unknown) => (e instanceof Error ? e.message.split('\n')[0] : String(e));

/** Console/page errors, failed requests, mobile overflow and tiny tap targets. Skips cleanly if Chromium is unavailable. */
export const runBrowserChecks: BrowserRunner = async (urls, opts) => {
  let pw: typeof import('playwright');
  try {
    pw = await import('playwright');
  } catch (e) {
    return { findings: [], note: `Browser checks skipped: Playwright is not installed (${MSG(e)}).` };
  }
  let browser: Awaited<ReturnType<typeof pw.chromium.launch>>;
  try {
    browser = await pw.chromium.launch({ headless: true });
  } catch (e) {
    return { findings: [], note: `Browser checks skipped: could not launch Chromium (${MSG(e)}). Run "npm run setup:browser".` };
  }

  const findings: RawFinding[] = [];
  const targets = urls.slice(0, opts.maxPages);
  try {
    for (const url of targets) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        // SSRF guard for the browser: every request (incl. subresources/redirects) is validated.
        await context.route('**/*', async (route) => {
          let target: URL;
          try { target = new URL(route.request().url()); } catch { return route.abort('blockedbyclient'); }
          if (target.protocol !== 'http:' && target.protocol !== 'https:') return route.continue();
          try {
            await assertPublicUrl(target, opts.policy);
          } catch {
            return route.abort('blockedbyclient');
          }
          return route.continue();
        });
        const page = await context.newPage();
        const seen = new Set<string>();
        const add = (f: Omit<RawFinding, 'url'>, key: string) => {
          if (seen.has(key) || seen.size >= 15) return;
          seen.add(key);
          findings.push({ ...f, url });
        };
        page.on('console', (m) => {
          // Chromium logs every failed subresource as a console error; those are already reported via the response/requestfailed handlers.
          if (m.type() === 'error' && !/^Failed to load resource/i.test(m.text())) add({ category: 'browser', severity: 'medium', title: 'Console error', evidence: clip(m.text()), recommendation: 'Open DevTools on this page, reproduce and fix the logged error.' }, `c:${m.text()}`);
        });
        page.on('pageerror', (e) => add({ category: 'browser', severity: 'high', title: 'Uncaught page error', evidence: clip(e.message), recommendation: 'Fix the uncaught JavaScript exception; it can break page functionality.' }, `p:${e.message}`));
        page.on('requestfailed', (r) => {
          const reason = r.failure()?.errorText ?? 'unknown';
          if (reason.includes('BLOCKED_BY_CLIENT')) return; // our own SSRF block, not a site defect
          add({ category: 'browser', severity: 'low', title: 'Network request failed', evidence: `${r.method()} ${clip(r.url(), 120)} — ${reason}`, recommendation: 'Check that the resource exists and is reachable.' }, `f:${r.url()}`);
        });
        page.on('response', (r) => {
          if (r.status() >= 400 && r.url() !== url) add({ category: 'browser', severity: 'medium', title: `Resource returned HTTP ${r.status()}`, evidence: clip(r.url(), 160), recommendation: 'Fix or remove the reference to this resource.' }, `r:${r.url()}`);
        });

        await page.goto(url, { waitUntil: 'load', timeout: opts.timeoutMs });
        await page.waitForTimeout(300);

        await page.setViewportSize({ width: 375, height: 667 });
        await page.waitForTimeout(100);
        const m = await page.evaluate<{ sw: number; iw: number; small: number }>(`(() => {
          const small = [...document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea')]
            .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24); }).length;
          return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, small };
        })()`);
        if (m.sw > m.iw + 1) add({ category: 'responsive', severity: 'medium', title: 'Horizontal overflow at mobile width', evidence: `At 375px viewport, content is ${m.sw}px wide (scrollWidth) vs ${m.iw}px.`, recommendation: 'Use responsive units/max-width:100% and check wide tables, images and fixed-width elements.' }, 'overflow');
        if (m.small > 0) add({ category: 'accessibility', severity: 'low', title: 'Small tap targets at mobile width', evidence: `${m.small} interactive element(s) are smaller than 24×24 CSS px at 375px.`, recommendation: 'Increase size or spacing of small controls (WCAG 2.2 target size guidance).' }, 'tap');
      } catch (e) {
        findings.push({ url, category: 'browser', severity: 'medium', title: 'Page failed to load in browser', evidence: clip(MSG(e)), recommendation: 'Check that the page loads reliably (timeouts, blocked resources, server errors).' });
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
  return {
    findings,
    note: urls.length > targets.length ? `Browser checks ran on the first ${targets.length} of ${urls.length} pages (limit).` : undefined,
  };
};
