# 02 – AI-assisted research notes

**Honesty note:** no web search or external sources were consulted while building this project (the build sandbox had no network). The notes below record design knowledge the AI assistant (Claude) applied from training; they contain **no citations and no verified links**. Verify anything you intend to cite.

## Topics considered and decisions taken
| Topic | What was considered | Decision in code |
|---|---|---|
| SSRF | Typical defences: scheme allow-list, resolve the host and reject private/loopback/link-local/metadata addresses, re-validate every redirect, limit size/time | `server/src/security.ts`: `parseHttpUrl`, `assertPublicUrl`, `safeFetch` (manual redirects, max 5, validation each hop) |
| IP forms | WHATWG `URL` normalises decimal/hex/octal IPv4 (e.g. `http://2130706433/` → `127.0.0.1`) so checking `hostname` after parsing covers them; IPv4-mapped IPv6 must be unwrapped | `isPrivateIp` handles `::ffff:` forms (dotted and hex); test `http://2130706433/` |
| DNS rebinding | A host can resolve to a public IP at check time and a private IP at connect time | **Not fully mitigated** (we validate then call `fetch`). Documented limitation; a pinned-IP agent would be the fix |
| Browser SSRF | Playwright follows redirects/subresources on its own | Context-level `route('**/*')` validates every request with the same guard |
| Crawl bounds | Page cap, queue cap, same-origin, skip static asset extensions | `maxPages` (cap 50), `SEEN_SLACK`, `isAssetUrl`, same-origin check |
| Link checking | HEAD is cheap; some servers reject HEAD (405/501) | HEAD, fall back to GET (body discarded) on 405/501; 401/403/429/999 reported as "could not be verified" (low) instead of "broken" |
| AI without hallucination | Give the model only structured findings, ask for JSON referencing finding IDs, validate IDs, treat page text as untrusted (prompt injection) | `ai.ts`: system prompt rules, ID filtering, deterministic fallback |
| Spelling | A real checker needs a dictionary dependency | Small explicit misspelling map; documented as heuristic |
| Accessibility | axe-core would be thorough but adds a dependency and injection complexity | Static Cheerio subset + two browser measurements (tap target size, mobile overflow); explicitly *partial* |

## Alternatives rejected
- Database/queue: forbidden by brief.
- WebSockets for progress: polling every second is simpler and enough.
- Compiling the server with `tsc`: ESM extension rules add friction; `tsx` runs it directly.
