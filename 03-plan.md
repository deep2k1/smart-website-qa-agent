# 03 – Plan, architecture and change request

## Architecture
Single repo, one `package.json`. `shared/types.ts` is imported by both server and web so the API contract is type-checked on both sides. The Express API keeps scans in a `Map` (max 50 kept). A scan runs asynchronously; the UI polls `GET /api/scans/:id` once per second.

Scan pipeline (`server/src/scanner.ts`):
1. Fetch the start page (SSRF-checked). Fail the scan with a message if it cannot be fetched.
2. **Full mode:** read `sitemap.xml` (+ up to 3 child sitemaps), then BFS-crawl same-origin links, `concurrency` pages at a time, until `maxPages`.
   **Single mode:** analyse only the start page.
3. Analyse each HTML page with Cheerio (`analyzers.ts`).
4. Check every unique link/image target (HEAD; results of crawled pages are reused) with a cap of 200.
5. Optional Playwright checks on up to 5 pages.
6. Sort findings, assign IDs (`F-001`…), compute counts, produce the AI/deterministic summary.

## Key decisions
- Findings are aggregated per page per issue type (e.g. one "3 images missing alt" finding listing sources) to avoid noise; broken links are one finding per page+target.
- A failing AI provider never fails a scan (fallback + note).
- Private-network targets in page links are *reported* (security/medium) rather than fetched.
- `ALLOW_HOSTS` (not a blanket "allow private" flag) is the only escape hatch, so tests can use `127.0.0.1` while redirects to `169.254.x.x` are still refused.

## Change request: single-page mode (mandatory)
**Request:** add a mode that scans exactly one URL and never crawls other pages.

**Impact analysis (written before the code for it):**
| Area | Impact |
|---|---|
| API contract | New `mode: "full" \| "single"` on `ScanRequest`; server forces `maxPages = 1` in single mode |
| Scanner | Guard in `analyze()` so discovered links are only enqueued in full mode; sitemap read skipped; crawl loop skipped |
| Link checking | Still needed (requirement R5) → HEAD requests to targets; never parsed. This is the subtle part: "doesn't crawl" must not mean "doesn't check links" |
| Findings/report | No schema change; `request.mode` is echoed in the report and AI summary |
| UI | Scope radio buttons; max-pages input disabled in single mode |
| Tests | New: only `GET /` reaches the fixture, no `/sitemap.xml`, no GET to other pages; link problems still reported using HEAD only; API-level single-mode test |
| Risk | Accidentally enqueuing links; mitigated by the request-log assertion in `tests/scanner.test.ts` and `tests/api.test.ts` |

**Process disclosure:** the project was generated in one pass under a 3-prompt budget, so the single-page mode was implemented in the same pass as full-site mode rather than as a separate later commit. The repository history will not show a separate before/after. The impact analysis above is real design reasoning but was not written in a distinct earlier phase.
