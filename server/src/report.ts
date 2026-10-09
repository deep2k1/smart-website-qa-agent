import type { ScanReport } from '../../shared/types';

/** Renders a human-readable Markdown report from a real ScanReport. */
export function renderMarkdown(r: ScanReport): string {
  const L: string[] = [];
  L.push(`# QA Report: ${r.request.url}`, '');
  L.push(`- Mode: **${r.request.mode}** | Status: **${r.status}** | Pages scanned: **${r.pages.length}**`);
  L.push(`- Started: ${r.startedAt}${r.finishedAt ? ` | Finished: ${r.finishedAt}` : ''}`);
  L.push(`- Limits: maxPages=${r.request.maxPages}, concurrency=${r.request.concurrency}, timeout=${r.request.timeoutMs}ms, browserChecks=${r.request.browserChecks}`, '');
  if (r.error) L.push(`> **Scan error:** ${r.error}`, '');
  L.push('## Counts', '', '| Severity | Count |', '|---|---|');
  for (const [s, n] of Object.entries(r.counts.bySeverity)) L.push(`| ${s} | ${n} |`);
  L.push(`| **total** | **${r.counts.total}** |`, '');
  if (r.ai) {
    L.push(`## Summary (${r.ai.provider}${r.ai.model ? `, ${r.ai.model}` : ''})`, '', r.ai.summary, '', `_${r.ai.disclaimer}_`, '');
    if (r.ai.priorities.length) L.push('Priorities:', ...r.ai.priorities.map((p) => `- ${p.findingId}: ${p.reason}`), '');
  }
  if (r.notes.length) L.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '');
  L.push('## Pages', '', '| URL | Status | Source | Title |', '|---|---|---|---|');
  for (const p of r.pages) L.push(`| ${p.url} | ${p.status || 'n/a'} | ${p.source} | ${(p.title ?? '').replace(/\|/g, '\\|')} |`);
  L.push('', '## Findings', '');
  for (const f of r.findings) {
    L.push(`### ${f.id} [${f.severity}/${f.category}] ${f.title}`, '', `- URL: ${f.url}`, `- Evidence: ${f.evidence}`, `- Recommendation: ${f.recommendation}`, '');
  }
  return L.join('\n');
}
