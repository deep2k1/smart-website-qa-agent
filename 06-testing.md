# 06 – Testing

## Test inventory (Vitest, `npm test`) — **written, NOT yet run**
| File | Covers |
|---|---|
| `tests/security.test.ts` | private-IP table, URL parsing, `assertPublicUrl` blocks, allow-list, safeFetch GET, redirect-to-metadata refusal, redirect loop, timeout, default-policy block |
| `tests/analyzers.test.ts` | missing title/meta/H1/lang/viewport, multiple H1/skips, alt rules, CTA detection, spelling/lorem/labels, clean page = no findings, finding schema |
| `tests/scanner.test.ts` | full-site discovery (links 2 levels, sitemap-only, unlinked excluded), all finding types with evidence, no contact with private targets, page limit, schema/IDs/counts/JSON-safe, **single-page: only `GET /`, no sitemap, no other GET, HEAD-only link checks**, failure handling (unreachable/blocked/timeout) |
| `tests/ai.test.ts` | deterministic summary truthfulness, invented IDs dropped, fallback on 500 and on non-JSON |
| `tests/api.test.ts` | 400s, SSRF 400s, 404s, end-to-end full scan + export, single-page via API, maxPages cap |
| `tests/browser.test.ts` | console/page errors captured; regression for duplicate missing-image reports (skips itself if Chromium is unavailable) |

Fixture: `tests/fixtures/site.ts` – a local HTTP server with known defects and a request log (used both by tests and `npm run sample-report`).

## Results actually obtained (details in 07)
| Check | Result |
|---|---|
| `npm install`, `npm run typecheck`, `npm test`, `npm run build`, `npm run sample-report` | **NOT RUN** (no registry access in build environment) |
| Ad hoc tsx script exercising `security.ts` + fixture (9 groups) | **9/9 passed** |
| Ad hoc tsx script running `browser.ts` with real Chromium on the fixture | Passed after fix D3 (output in 07) |
| Best-effort `tsc` with dependencies missing | **Not a pass**: 77 diagnostics, all attributable to missing packages/types (see D2) |

> The ad hoc scripts are not Vitest runs. They cover only a subset of the scenarios in the test files above.

## Debugging investigation (real events only)
**D1 – harness failure (not a product bug).** First ad hoc run of the security smoke script failed with `Top-level await is currently not supported with the "cjs" output format`. Cause: the script lived in `/tmp`, which has no `"type":"module"`, so tsx compiled it as CommonJS. Fix: renamed to `.mts`. Re-run passed 9/9. (The project itself has `"type":"module"`, so `scripts/sample-report.ts` is unaffected.)

**D2 – typecheck cannot be evidenced offline.** `tsc -p tsconfig.json --noEmit` printed a single error, `TS2688 Cannot find type definition file for 'node'`, which suppresses all other diagnostics. Re-running with `types: []` produced 77 errors: 22× TS2304, 5× TS2307 (cheerio, express, playwright), 35× TS7006 (callbacks implicitly `any` because cheerio/express types are absent), plus TS2339/TS2503/TS2552/TS2584/TS2591 on `import.meta.url`, `NodeJS`, `fetch`, `console`. None points at a logic error, but this is **not** a clean typecheck; `npm run typecheck` after `npm install` is the real gate.

**D3 – real product defect found by running browser checks.** Command: `runBrowserChecks` on the fixture home page `/` (has an intentionally missing image).
Before fix, findings: `Console error: "Failed to load resource: the server responded with a status of 404"` **and** `Resource returned HTTP 404 (…/img/missing.png)` **and** `Small tap targets…` → the same missing image reported twice, one with no URL.
Root cause: Chromium logs every failed subresource as a console error, and the `response` handler already reports it.
Fix: ignore console errors that start with `Failed to load resource` in `server/src/browser.ts`.
After fix: `['Resource returned HTTP 404', 'Small tap targets at mobile width']`; `/js-error` still yields `['Console error', 'Uncaught page error']`.
Regression test: second test in `tests/browser.test.ts` (not yet run under Vitest; the scenario itself was run via tsx).

## Manual test plan (after `npm run dev`)
1. Scan `https://example.com` full → completes, summary labelled "rule-based fallback".
2. Scan with "Single page only" → Pages tab shows 1 page.
3. Enter `http://169.254.169.254/` → red banner "…private/local address and is blocked".
4. Stop the server mid-poll → error banner after 3 failed polls.
5. Click "Export JSON" → file downloads and parses.
