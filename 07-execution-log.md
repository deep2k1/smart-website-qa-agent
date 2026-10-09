# 07 – Execution log

Only commands that were actually executed are listed. Environment: Ubuntu sandbox, Node v22.22.2, **network disabled** (npm registry unreachable). Globally available: `typescript`, `tsx`, `playwright`, `react`. Not available: `cheerio`, `express`, `vitest`, `vite`, `@types/node`.

## A. Build-environment log
| # | Command / action | Result |
|---|---|---|
| 1 | List `/mnt/user-data/uploads`, `/home/claude`, `/mnt/user-data/outputs` (3 times across the conversation) | No project, no assignment PDF. Nothing to audit/fix; no results invented |
| 2 | Search for globally installed packages | typescript, tsx, playwright, react found; cheerio/express/vitest/vite not found |
| 3 | `tsx /tmp/smoke/smoke.ts` | **FAILED** – top-level await with cjs (D1) |
| 4 | Renamed to `smoke.mts`; `tsx /tmp/smoke/smoke.mts` | **PASS 9/9**: isPrivateIp table; parseHttpUrl; assertPublicUrl (localhost, 127.0.0.1, [::1], 169.254.169.254, 10.0.0.5, decimal IP 2130706433, .internal); safeFetch GET 200; redirect to 169.254.x refused and never requested; redirect loop stopped; 300 ms timeout enforced; fixture blocked without allow-list; HEAD 404 |
| 5 | `tsc -p tsconfig.json --noEmit` | 1 error (TS2688 missing `@types/node`), hides other diagnostics |
| 6 | `tsc -p /tmp/tsconfig.partial.json --noEmit` (`types: []`, server+shared) | 77 errors, all from missing packages/types (D2). **Not a pass** |
| 7 | `tsx b.mts` (copy of project in `/tmp/proj` with global Playwright symlinked) – `runBrowserChecks` on fixture `/js-error` and `/` | Real Chromium ran. Found console error + uncaught error on `/js-error`; on `/`: duplicate missing-image report (D3) |
| 8 | Applied fix in `server/src/browser.ts`, re-ran step 7 | `/` → `['Resource returned HTTP 404','Small tap targets at mobile width']`; `/js-error` → `['Console error','Uncaught page error']` |

## B. Never executed in the build environment
`npm install` · `npm run setup:browser` · `npm run typecheck` · `npm test` (all 6 Vitest files) · `npm run build` · `npm run dev` / `npm start` · `npm run sample-report` · any test of `analyzers.ts`, `discovery.ts`, `scanner.ts`, `app.ts`, `ai.ts`, or the React UI · any real Anthropic API call.

## C. Local verification by the submitter — **fill in with real output**
Run on your machine and paste the real result/date here (leave "not run" if you skip one).

| Command | Date | Result (pass/fail + counts) | Notes / fixes made |
|---|---|---|---|
| `npm install` | | | |
| `npm run setup:browser` | | | |
| `npm run typecheck` | | | |
| `npm test` | | | |
| `npm run build` | | | |
| `npm run sample-report` | | | |
| Manual test plan (06) | | | |

Any failure you fix should be added to `06-testing.md` §Debugging investigation with the real error text and root cause.
