# 01 – Discovery

## Source of requirements
The assignment ("Spreadme Digital – AI Software Engineer Practical Assignment") was **not available** in the build environment (no file was attached). Requirements below are taken verbatim from the author's written brief, not from the PDF. **Action for submitter:** compare this list against the PDF before submitting.

## Requirements (R1–R10)
| ID | Requirement |
|---|---|
| R1 | Validate HTTP/HTTPS URLs |
| R2 | Discover pages via sitemap.xml and bounded same-origin crawling |
| R3 | Full-website scanning |
| R4 | Single-page scanning that never crawls other pages (change request) |
| R5 | Detect broken links/images, missing alt, missing title/meta description, H1/heading issues, likely spelling/content problems, detectable CTA destinations |
| R6 | Capture console/page errors; basic responsive and accessibility issues |
| R7 | Structured findings: ID, category, severity, title, affected URL, evidence, recommendation |
| R8 | AI summaries/recommendations without inventing findings |
| R9 | Responsive dashboard: progress, counts, filters, details, error states, JSON export |
| R10 | Safe crawling: timeouts, page limits, concurrency limits, redirect validation, SSRF/private-network protection |

Constraints: React+Vite+TS, Node+Express+TS, Playwright, Cheerio, Vitest, no database, AI adapter with deterministic fallback, no paid API required, no secrets in the frontend.

## Assumptions
1. "Same-origin" = same scheme+host+port as the start page's *final* URL (after redirects, e.g. example.com → www.example.com).
2. Single-page mode may still send HEAD requests to link/image targets to check them; it does not fetch/parse any other page and does not read sitemap.xml. This is how "detect broken links" and "never crawl" are reconciled.
3. Browser checks are best-effort: if Chromium is missing, the scan completes and records a note (no fake findings).
4. Spelling detection is a heuristic word list; it is documented as such, not as a spell checker.
5. In-memory results are acceptable (no database allowed); results vanish on restart.
6. The scanner is intended for local/demo use; there is no authentication or per-user rate limiting.

## Out of scope
Authenticated pages, JavaScript-rendered link discovery (links are read from static HTML), full WCAG audit, visual regression, robots.txt policy, persistent storage.
