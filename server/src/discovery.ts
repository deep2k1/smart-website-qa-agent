import * as cheerio from 'cheerio';
import { classifyError, safeFetch, type SecurityPolicy } from './security';

const ASSET_EXT = /\.(?:png|jpe?g|gif|svg|webp|ico|avif|css|js|mjs|json|xml|pdf|zip|gz|mp[34]|webm|woff2?|ttf|eot|map|txt)$/i;

/** Normalizes to an absolute http(s) URL without fragment; returns null if unusable. */
export function normalizeUrl(href: string, base?: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}
export const isAssetUrl = (url: string): boolean => ASSET_EXT.test(new URL(url).pathname);

/** Reads /sitemap.xml (and up to 3 child sitemaps of a sitemap index). Same-origin only. */
export async function fetchSitemapUrls(origin: string, policy: SecurityPolicy, timeoutMs: number, notes: string[]): Promise<string[]> {
  const out: string[] = [];
  const queue = [`${origin}/sitemap.xml`];
  const seen = new Set<string>();
  let fetched = 0;
  while (queue.length && fetched < 4) {
    const mapUrl = queue.shift()!;
    if (seen.has(mapUrl)) continue;
    seen.add(mapUrl);
    fetched++;
    try {
      const res = await safeFetch(mapUrl, { method: 'GET', timeoutMs, policy });
      if (res.status !== 200) {
        if (fetched === 1) notes.push(`No sitemap.xml found (HTTP ${res.status}); discovery relies on link crawling only.`);
        continue;
      }
      const $ = cheerio.load(res.body, { xmlMode: true });
      $('sitemapindex > sitemap > loc').each((_, e) => {
        const u = normalizeUrl($(e).text().trim());
        if (u && new URL(u).origin === origin) queue.push(u);
      });
      $('urlset > url > loc').each((_, e) => {
        const u = normalizeUrl($(e).text().trim());
        if (u && new URL(u).origin === origin) out.push(u);
      });
    } catch (e) {
      notes.push(`Sitemap fetch failed (${mapUrl}): ${classifyError(e).message}`);
    }
  }
  return out.slice(0, 500);
}
