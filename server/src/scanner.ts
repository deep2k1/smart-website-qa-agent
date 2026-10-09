import {
  CATEGORIES, SEVERITIES, type Counts, type Finding, type PageSummary, type ScanReport, type ScanRequest,
} from '../../shared/types';
import { analyzeHtml, type PageAnalysis, type RawFinding } from './analyzers';
import { summarizeWithFallback, type AiProvider } from './ai';
import { runBrowserChecks, type BrowserRunner } from './browser';
import { fetchSitemapUrls, isAssetUrl, normalizeUrl } from './discovery';
import { mapPool } from './pool';
import { classifyError, parseHttpUrl, safeFetch, type ErrorKind, type SecurityPolicy } from './security';

export interface ScanDeps {
  policy: SecurityPolicy;
  ai: AiProvider;
  runBrowser?: BrowserRunner;
}

const MAX_LINK_CHECKS = 200;
const MAX_BROWSER_PAGES = 5;
const SEEN_SLACK = 500;

interface LinkResult { status?: number; errorKind?: ErrorKind; message?: string }
interface PageData { summary: PageSummary; html?: string; result: LinkResult }
interface Occurrence { page: string; kind: 'link' | 'image'; target: string; label: string; isCta: boolean }

export function emptyCounts(): Counts {
  return {
    total: 0,
    bySeverity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Counts['bySeverity'],
    byCategory: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Counts['byCategory'],
  };
}

export function createReport(id: string, request: ScanRequest): ScanReport {
  return {
    id, status: 'queued', request, startedAt: new Date().toISOString(),
    progress: { phase: 'queued', pagesDiscovered: 0, pagesScanned: 0, linksChecked: 0, linksTotal: 0 },
    pages: [], findings: [], counts: emptyCounts(), notes: [],
  };
}

async function fetchPage(url: string, source: PageSummary['source'], deps: ScanDeps, timeoutMs: number): Promise<PageData> {
  const base = { url, source, linkCount: 0, imageCount: 0, ctas: [] as PageSummary['ctas'] };
  try {
    const res = await safeFetch(url, { method: 'GET', timeoutMs, policy: deps.policy });
    const isHtml = /html/i.test(res.contentType) || (!res.contentType && /^\s*<(!doctype|html)/i.test(res.body));
    return {
      summary: { ...base, status: res.status, finalUrl: res.url !== url ? res.url : undefined },
      html: isHtml && res.status < 400 ? res.body : undefined,
      result: { status: res.status },
    };
  } catch (e) {
    const c = classifyError(e);
    return { summary: { ...base, status: 0, error: c.message }, result: { errorKind: c.kind, message: c.message } };
  }
}

async function checkUrl(url: string, deps: ScanDeps, timeoutMs: number): Promise<LinkResult> {
  try {
    let res = await safeFetch(url, { method: 'HEAD', timeoutMs, policy: deps.policy });
    if (res.status === 405 || res.status === 501) res = await safeFetch(url, { method: 'GET', timeoutMs, policy: deps.policy, readBody: false });
    return { status: res.status };
  } catch (e) {
    const c = classifyError(e);
    return { errorKind: c.kind, message: c.message };
  }
}

const sevOrder = (s: string) => SEVERITIES.indexOf(s as (typeof SEVERITIES)[number]);

export function finalizeFindings(raw: RawFinding[]): Finding[] {
  const sorted = [...raw].sort((a, b) => sevOrder(a.severity) - sevOrder(b.severity) || a.category.localeCompare(b.category) || a.url.localeCompare(b.url) || a.title.localeCompare(b.title));
  return sorted.map((f, i) => ({ id: `F-${String(i + 1).padStart(3, '0')}`, ...f }));
}

export function computeCounts(findings: Finding[]): Counts {
  const c = emptyCounts();
  for (const f of findings) { c.total++; c.bySeverity[f.severity]++; c.byCategory[f.category]++; }
  return c;
}

/** Runs a scan, mutating `report` as it progresses. Never throws: failures set status="failed". */
export async function runScan(report: ScanReport, deps: ScanDeps): Promise<void> {
  const { request } = report;
  const t = request.timeoutMs;
  const raw: RawFinding[] = [];
  const phase = (p: string) => { report.progress.phase = p; };
  try {
    report.status = 'running';
    phase('fetching start page');
    const start = parseHttpUrl(request.url);
    const startPage = await fetchPage(start.href, 'start', deps, t);
    if (startPage.result.errorKind) throw new Error(`Could not fetch ${start.href}: ${startPage.result.message}`);

    const pages: PageData[] = [startPage];
    const analyses = new Map<PageData, PageAnalysis>();
    const origin = new URL(startPage.summary.finalUrl ?? start.href).origin;
    const seen = new Set<string>([normalizeUrl(start.href)!]);
    const queue: { url: string; source: PageSummary['source'] }[] = [];
    const full = request.mode === 'full';

    const enqueue = (url: string, source: PageSummary['source']) => {
      const n = normalizeUrl(url);
      if (!n || seen.has(n) || new URL(n).origin !== origin || isAssetUrl(n) || seen.size >= request.maxPages + SEEN_SLACK) return;
      seen.add(n);
      queue.push({ url: n, source });
    };
    const analyze = (pd: PageData) => {
      if (!pd.html) return;
      const a = analyzeHtml(pd.html, pd.summary.finalUrl ?? pd.summary.url);
      analyses.set(pd, a);
      raw.push(...a.findings);
      Object.assign(pd.summary, { title: a.title, ctas: a.ctas, linkCount: a.links.length, imageCount: a.images.length });
      // Single-page mode NEVER enqueues discovered links; full mode enqueues same-origin ones only.
      if (full) a.links.forEach((l) => enqueue(l.url, 'link'));
    };
    const sync = () => {
      report.pages = pages.map((p) => p.summary);
      report.progress.pagesScanned = pages.length;
      report.progress.pagesDiscovered = Math.max(seen.size, pages.length);
    };

    analyze(startPage);
    if (full) {
      phase('reading sitemap.xml');
      (await fetchSitemapUrls(origin, deps.policy, t, report.notes)).forEach((u) => enqueue(u, 'sitemap'));
    }
    sync();

    phase(full ? 'crawling pages' : 'analysing page');
    while (full && queue.length && pages.length < request.maxPages) {
      const batch = queue.splice(0, Math.min(request.concurrency, request.maxPages - pages.length));
      const results = await mapPool(batch, request.concurrency, (b) => fetchPage(b.url, b.source, deps, t));
      for (const r of results) { pages.push(r); analyze(r); }
      sync();
    }
    if (queue.length) report.notes.push(`Page limit reached (${request.maxPages}); ${queue.length} discovered URL(s) were not scanned.`);

    // Non-OK start page / dead sitemap entries (broken links to crawled pages are reported by the link check below).
    for (const p of pages) {
      const s = p.summary;
      const bad = s.status >= 400 || s.status === 0;
      if (!bad) continue;
      if (s.source === 'start') raw.push({ category: 'links', severity: 'critical', title: `Start page returned HTTP ${s.status}`, url: s.url, evidence: `GET ${s.url} → ${s.status}`, recommendation: 'Fix the page or scan a working URL.' });
      else if (s.source === 'sitemap') raw.push({ category: 'links', severity: 'high', title: 'Sitemap lists a URL that does not load', url: s.url, evidence: s.status ? `GET ${s.url} → HTTP ${s.status}` : (s.error ?? 'No response'), recommendation: 'Remove dead URLs from sitemap.xml or restore the pages.' });
    }

    // Duplicate titles across scanned pages.
    const byTitle = new Map<string, string[]>();
    for (const p of pages) if (p.summary.title) byTitle.set(p.summary.title, [...(byTitle.get(p.summary.title) ?? []), p.summary.url]);
    for (const [title, urls] of byTitle) if (urls.length > 1) raw.push({ category: 'seo', severity: 'low', title: 'Duplicate page title', url: urls[0], evidence: `"${title}" is used on ${urls.length} pages: ${urls.slice(0, 3).join(', ')}`, recommendation: 'Give every page a unique title.' });

    // ---- Link / image / CTA destination checks (HEAD, status only: never parsed or crawled) ---
    phase('checking links and images');
    const occurrences: Occurrence[] = [];
    for (const [pd, a] of analyses) {
      const page = pd.summary.finalUrl ?? pd.summary.url;
      const dedupe = new Set<string>();
      for (const l of a.links) { const target = normalizeUrl(l.url)!; const k = `l|${target}`; if (!dedupe.has(k)) { dedupe.add(k); occurrences.push({ page, kind: 'link', target, label: l.text, isCta: l.isCta }); } }
      for (const i of a.images) { const target = normalizeUrl(i.url)!; const k = `i|${target}`; if (!dedupe.has(k)) { dedupe.add(k); occurrences.push({ page, kind: 'image', target, label: i.alt ?? '', isCta: false }); } }
    }
    const cache = new Map<string, LinkResult>();
    for (const p of pages) { cache.set(normalizeUrl(p.summary.url)!, p.result); if (p.summary.finalUrl) cache.set(normalizeUrl(p.summary.finalUrl)!, p.result); }
    const pending = [...new Set(occurrences.map((o) => o.target))].filter((u) => !cache.has(u));
    const toCheck = pending.slice(0, MAX_LINK_CHECKS);
    if (pending.length > toCheck.length) report.notes.push(`Link check limit reached: checked ${toCheck.length} of ${pending.length} unique link/image targets.`);
    report.progress.linksTotal = toCheck.length;
    await mapPool(toCheck, request.concurrency, async (u) => {
      cache.set(u, await checkUrl(u, deps, t));
      report.progress.linksChecked++;
    });

    for (const o of occurrences) {
      const r = cache.get(o.target);
      if (!r) continue;
      const noun = o.kind === 'image' ? 'image' : o.isCta ? 'CTA link' : 'link';
      const category = o.kind === 'image' ? 'images' : o.isCta ? 'cta' : 'links';
      const where = `${o.kind === 'image' ? 'Image' : 'Link'} "${o.label || o.target}" → ${o.target}`;
      if (r.errorKind === 'blocked') raw.push({ category: 'security', severity: 'medium', title: `${noun[0].toUpperCase()}${noun.slice(1)} target not checked (blocked by safety policy)`, url: o.page, evidence: `${where}: ${r.message}`, recommendation: 'Confirm the target is a public address. The scanner never contacts private/local networks.' });
      else if (r.errorKind === 'timeout') raw.push({ category, severity: 'medium', title: `${noun[0].toUpperCase()}${noun.slice(1)} target timed out`, url: o.page, evidence: `${where}: ${r.message}`, recommendation: 'Check the target server responsiveness and the link address.' });
      else if (r.errorKind === 'network') raw.push({ category, severity: 'high', title: `Broken ${noun} (unreachable)`, url: o.page, evidence: `${where}: ${r.message}`, recommendation: 'Fix or remove the link; the host could not be reached.' });
      else if ((r.status ?? 0) >= 400) {
        const unverifiable = [401, 403, 429, 999].includes(r.status!);
        raw.push({ category, severity: unverifiable ? 'low' : 'high', title: unverifiable ? `${noun[0].toUpperCase()}${noun.slice(1)} could not be verified (HTTP ${r.status})` : `Broken ${noun} (HTTP ${r.status})`, url: o.page, evidence: `${where} → HTTP ${r.status}`, recommendation: unverifiable ? 'The server restricted automated access; verify this target manually.' : 'Update the link to a working URL or remove it.' });
      }
    }

    // ---- Browser checks (optional) --------------------------------------------------------
    if (request.browserChecks) {
      phase('running browser checks');
      const urls = pages.filter((p) => p.html).map((p) => p.summary.finalUrl ?? p.summary.url);
      const res = await (deps.runBrowser ?? runBrowserChecks)(urls, { timeoutMs: t, policy: deps.policy, maxPages: MAX_BROWSER_PAGES });
      raw.push(...res.findings);
      if (res.note) report.notes.push(res.note);
    } else {
      report.notes.push('Browser checks were disabled for this scan; console/page-error and mobile-overflow checks were not run.');
    }

    phase('summarising');
    report.findings = finalizeFindings(raw);
    report.counts = computeCounts(report.findings);
    const ai = await summarizeWithFallback(deps.ai, { request, pagesScanned: pages.length, findings: report.findings });
    report.ai = ai.summary;
    if (ai.note) report.notes.push(ai.note);
    sync();
    phase('done');
    report.status = 'completed';
  } catch (e) {
    report.status = 'failed';
    report.error = e instanceof Error ? e.message : String(e);
    report.progress.phase = 'failed';
    report.findings = finalizeFindings(raw);
    report.counts = computeCounts(report.findings);
  } finally {
    report.finishedAt = new Date().toISOString();
  }
}
