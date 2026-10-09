# Smart Website QA Agent

Scan a website (whole site or one page) and get structured, evidence-backed QA findings: broken links/images, missing alt text, SEO tags, heading problems, CTA destinations, likely spelling/content problems, browser console errors, mobile overflow and basic accessibility issues. A dashboard shows progress, severity counts, filters, issue details and JSON export. AI summaries are optional; a deterministic fallback is always available.

> **Status:** see [FINAL-REPORT.md](FINAL-REPORT.md) for exactly what was and was not verified. The project was written in an environment without npm registry access, so `npm install`, the Vitest suites, `vite build` and the sample report must be run on your machine (commands below).

## Requirements
- Node.js **>= 20.12** (22 LTS recommended), npm
- Chromium for Playwright (optional; browser checks are skipped with a note if unavailable)

## Setup
```bash
npm install
npm run setup:browser        # downloads Chromium for Playwright (optional but recommended)
cp .env.example .env         # optional; every value has a default (Windows: copy .env.example .env)
```

## Run
| Purpose | Command | Notes |
|---|---|---|
| Development (API + UI) | `npm run dev` | UI http://localhost:5173 (proxies `/api` to the API on 127.0.0.1:3001) |
| Typecheck (server + web) | `npm run typecheck` | `tsc --noEmit` for both tsconfigs |
| Tests | `npm test` | Vitest; uses a local fixture server, no internet needed |
| Production build | `npm run build` | typecheck, then `vite build web` → `web/dist` |
| Production run | `npm start` | after `npm run build`; serves API **and** UI on http://127.0.0.1:3001 |
| Sample QA report | `npm run sample-report` | scans the local fixture, writes `sample-report/sample-{full,single}.{json,md}` |

The server runs TypeScript through `tsx` (no separate server compile step). There is no linter configured.

## Configuration (`.env`, never committed)
| Variable | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `3001` / `127.0.0.1` | API bind address |
| `ANTHROPIC_API_KEY` | empty | Enables AI summaries. Empty → deterministic fallback. Server-side only; never sent to the browser |
| `AI_MODEL` | `claude-sonnet-5-5` | Model used when a key is set |
| `ALLOW_HOSTS` | empty | Hostnames exempt from the private-network block (local dev only) |
| `MAX_PAGES_CAP` | `50` | Hard upper bound on pages per scan |
| `MAX_CONCURRENT_SCANS` | `2` | Parallel scans accepted before HTTP 429 |

To scan a site on your own machine (e.g. `http://localhost:8080`) set `ALLOW_HOSTS=localhost` (and use `127.0.0.1` the same way). Leave it empty otherwise.

## API
- `POST /api/scans` body `{ url, mode: "full"|"single", maxPages?, concurrency?, timeoutMs?, browserChecks? }` → `202 { id, status }`; `400 { error: { code, message } }` for invalid/blocked input; `429` when busy.
- `GET /api/scans/:id` → `ScanReport` (poll for progress). `GET /api/scans/:id/export` → JSON file download. `GET /api/health`.
Types are shared in `shared/types.ts`.

## Architecture
```
web/ (React+Vite)  ──/api──►  server/src/app.ts (Express, in-memory store)
                                   └ scanner.ts  orchestrates a scan
                                      ├ security.ts   URL validation, SSRF guard, safeFetch (timeouts, redirects, size cap)
                                      ├ discovery.ts  sitemap.xml + URL normalisation
                                      ├ analyzers.ts  Cheerio checks → findings
                                      ├ browser.ts    Playwright checks (optional)
                                      └ ai.ts         AI adapter + deterministic fallback
```

## Safety limits (all enforced in code)
http/https only, no URL credentials; every request (and every redirect hop, max 5) is resolved and rejected if any address is private/loopback/link-local/reserved or the name is `localhost`/`.local`/`.internal`; browser requests are validated the same way; 10 s default timeout (1–30 s); 2 MB body cap; max pages 50; concurrency ≤ 5; ≤ 200 link/image targets checked per scan; ≤ 5 pages in the browser; request bodies ≤ 10 KB.

## Known limitations
See `FINAL-REPORT.md` §Limitations. Notably: spelling is a small word-list heuristic; accessibility is a static subset (not a full axe audit); robots.txt is not honoured; DNS-rebinding between check and connect is not fully closed; results live in memory only.

## Documents
`01-discovery.md` · `02-ai-research.md` · `03-plan.md` · `04-task-list.md` · `05-ai-usage.md` · `06-testing.md` · `07-execution-log.md` · `FINAL-REPORT.md`
