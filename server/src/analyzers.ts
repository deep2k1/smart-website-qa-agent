import * as cheerio from 'cheerio';
import type { Finding } from '../../shared/types';

export type RawFinding = Omit<Finding, 'id'>;
export interface LinkRef { url: string; text: string; isCta: boolean }
export interface ImageRef { url: string; alt: string | null }
export interface Cta { text: string; href: string | null; kind: 'link' | 'button' }
export interface PageAnalysis {
  title: string | null;
  findings: RawFinding[];
  links: LinkRef[];
  images: ImageRef[];
  ctas: Cta[];
}

// Small, explicit heuristic list. This is NOT a full spell checker (see docs/limitations).
export const MISSPELLINGS: Record<string, string> = {
  teh: 'the', recieve: 'receive', definately: 'definitely', seperate: 'separate', occured: 'occurred',
  accomodate: 'accommodate', wich: 'which', adress: 'address', untill: 'until', goverment: 'government',
  enviroment: 'environment', begining: 'beginning', becuase: 'because', thier: 'their', alot: 'a lot',
  wierd: 'weird', tommorow: 'tomorrow', neccessary: 'necessary', sucess: 'success', langauge: 'language',
  buisness: 'business', comming: 'coming', writting: 'writing', freind: 'friend', beleive: 'believe',
};
const CTA_RE = /\b(buy|shop|order|sign\s?up|sign\s?in|log\s?in|register|get started|get a quote|contact|subscribe|book|reserve|try|download|learn more|start|demo|free trial|join|apply|donate)\b/i;
const NON_REPEAT = new Set(['had', 'that', 'is', 'very', 'bye', 'no']);

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n)}…` : s);
const abs = (href: string, base: string): string | null => {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

export function analyzeHtml(html: string, pageUrl: string): PageAnalysis {
  const $ = cheerio.load(html);
  const findings: RawFinding[] = [];
  const add = (f: Omit<RawFinding, 'url'>) => findings.push({ ...f, url: pageUrl });

  // ---- SEO: title & meta description -------------------------------------------------------
  const title = $('title').first().text().trim() || null;
  if (!title) {
    add({ category: 'seo', severity: 'medium', title: 'Missing or empty <title>', evidence: 'No non-empty <title> element found.', recommendation: 'Add a unique, descriptive <title> (about 30–60 characters).' });
  } else if (title.length > 70) {
    add({ category: 'seo', severity: 'low', title: 'Title is very long', evidence: `Title has ${title.length} characters: "${clip(title, 80)}"`, recommendation: 'Shorten the title to roughly 60 characters so search engines do not truncate it.' });
  }
  const metaDesc = $('meta').filter((_, e) => ($(e).attr('name') ?? '').toLowerCase() === 'description').first().attr('content')?.trim();
  if (!metaDesc) {
    add({ category: 'seo', severity: 'medium', title: 'Missing meta description', evidence: 'No <meta name="description"> with content found.', recommendation: 'Add a meta description of about 70–160 characters summarising the page.' });
  } else if (metaDesc.length > 200) {
    add({ category: 'seo', severity: 'low', title: 'Meta description is very long', evidence: `Meta description has ${metaDesc.length} characters.`, recommendation: 'Keep the meta description under about 160 characters.' });
  }

  // ---- Headings ----------------------------------------------------------------------------
  const h1s = $('h1').filter((_, e) => $(e).text().trim().length > 0);
  if (h1s.length === 0) {
    add({ category: 'headings', severity: 'medium', title: 'Missing H1 heading', evidence: `Found ${$('h1').length} empty/absent <h1> elements.`, recommendation: 'Add exactly one descriptive <h1> that states the page topic.' });
  } else if (h1s.length > 1) {
    add({ category: 'headings', severity: 'low', title: 'Multiple H1 headings', evidence: `Found ${h1s.length} <h1> elements: ${h1s.toArray().slice(0, 3).map((e) => `"${clip($(e).text().trim(), 40)}"`).join(', ')}`, recommendation: 'Use a single <h1> and demote the others to <h2>/<h3>.' });
  }
  let prev = 0;
  let skip: string | null = null;
  const emptyHeadings: string[] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    const level = Number(String($(el).prop('tagName')).slice(1));
    if (!$(el).text().trim()) emptyHeadings.push(`h${level}`);
    if (!skip && prev && level > prev + 1) skip = `<h${prev}> followed by <h${level}>`;
    prev = level;
  });
  if (skip) add({ category: 'headings', severity: 'low', title: 'Heading level skipped', evidence: `Heading order jumps: ${skip}.`, recommendation: 'Keep heading levels sequential (h2 → h3, not h2 → h4).' });
  if (emptyHeadings.length) add({ category: 'headings', severity: 'low', title: 'Empty heading elements', evidence: `${emptyHeadings.length} empty heading(s): ${emptyHeadings.slice(0, 5).join(', ')}`, recommendation: 'Remove empty headings or give them meaningful text.' });

  // ---- Images ------------------------------------------------------------------------------
  const images: ImageRef[] = [];
  const missingAlt: string[] = [];
  let noSrc = 0;
  $('img').each((_, el) => {
    const src = ($(el).attr('src') ?? $(el).attr('data-src') ?? '').trim();
    const alt = $(el).attr('alt') ?? null;
    if (!src) { noSrc++; return; }
    const decorative = ['presentation', 'none'].includes(($(el).attr('role') ?? '').toLowerCase()) || $(el).attr('aria-hidden') === 'true';
    if (alt === null && !decorative) missingAlt.push(clip(src, 60));
    if (!src.startsWith('data:')) {
      const u = abs(src, pageUrl);
      if (u) images.push({ url: u, alt });
    }
  });
  if (missingAlt.length) add({ category: 'images', severity: 'medium', title: `${missingAlt.length} image(s) missing alt text`, evidence: `<img> without alt attribute: ${missingAlt.slice(0, 5).join(', ')}`, recommendation: 'Add descriptive alt text, or alt="" for purely decorative images.' });
  if (noSrc) add({ category: 'images', severity: 'low', title: 'Image without src', evidence: `${noSrc} <img> element(s) have no src.`, recommendation: 'Remove the element or set a valid src.' });

  // ---- Links & CTAs ------------------------------------------------------------------------
  const links: LinkRef[] = [];
  const ctas: Cta[] = [];
  const emptyCta: string[] = [];
  const unnamedLinks: string[] = [];
  $('a[href]').each((_, el) => {
    const rawHref = ($(el).attr('href') ?? '').trim();
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    const name = text || $(el).attr('aria-label') || $(el).attr('title') || $(el).find('img').attr('alt') || '';
    if (!name.trim()) unnamedLinks.push(clip(rawHref, 40));
    const isCta = !!text && text.length <= 40 && CTA_RE.test(text);
    const placeholder = rawHref === '' || rawHref === '#' || /^javascript:/i.test(rawHref);
    if (isCta) {
      ctas.push({ text, href: placeholder ? null : abs(rawHref, pageUrl) ?? rawHref, kind: 'link' });
      if (placeholder) emptyCta.push(`"${text}" → href="${rawHref}"`);
    }
    if (!placeholder && !rawHref.startsWith('#')) {
      const u = abs(rawHref, pageUrl);
      if (u) links.push({ url: u, text: clip(text || name, 60), isCta });
    }
  });
  $('button, [role="button"], input[type="submit"]').each((_, el) => {
    const text = ($(el).text() || $(el).attr('value') || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length > 40 || !CTA_RE.test(text)) return;
    const inForm = $(el).closest('form').length > 0;
    const hasHandler = !!($(el).attr('onclick') ?? $(el).attr('formaction'));
    ctas.push({ text, href: $(el).closest('form').attr('action') ?? null, kind: 'button' });
    if (!inForm && !hasHandler && $(el).prop('tagName')?.toString().toLowerCase() === 'button') {
      add({ category: 'cta', severity: 'info', title: 'CTA button destination not detectable', evidence: `Button "${text}" is outside a <form> and has no inline handler; its action may be set by JavaScript.`, recommendation: 'Verify manually that this button performs the intended action.' });
    }
  });
  if (emptyCta.length) add({ category: 'cta', severity: 'medium', title: 'Call-to-action has no destination', evidence: emptyCta.slice(0, 5).join('; '), recommendation: 'Point the CTA at a real URL (e.g. signup or contact page).' });
  if (unnamedLinks.length) add({ category: 'accessibility', severity: 'medium', title: `${unnamedLinks.length} link(s) without an accessible name`, evidence: `Links with no text, aria-label, title or image alt: ${unnamedLinks.slice(0, 5).join(', ')}`, recommendation: 'Give each link visible text or an aria-label describing its destination.' });

  // ---- Accessibility & responsive basics (static) ------------------------------------------
  if (!($('html').attr('lang') ?? '').trim()) add({ category: 'accessibility', severity: 'medium', title: 'Missing lang attribute on <html>', evidence: '<html> has no lang attribute.', recommendation: 'Add lang="en" (or the correct language) so screen readers pick the right voice.' });
  const unlabeled: string[] = [];
  $('input, select, textarea').each((_, el) => {
    const type = ($(el).attr('type') ?? 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type)) return;
    const id = $(el).attr('id');
    const labelled = $(el).attr('aria-label') || $(el).attr('aria-labelledby') || $(el).attr('title') ||
      $(el).closest('label').length > 0 || (id && $(`label[for="${id}"]`).length > 0);
    if (!labelled) unlabeled.push(`<${$(el).prop('tagName')?.toString().toLowerCase()} name="${$(el).attr('name') ?? ''}">`);
  });
  if (unlabeled.length) add({ category: 'accessibility', severity: 'medium', title: `${unlabeled.length} form field(s) without a label`, evidence: unlabeled.slice(0, 5).join(', '), recommendation: 'Associate each field with a <label for> or add aria-label. Placeholders are not labels.' });
  const unnamedButtons: number[] = [];
  $('button, [role="button"]').each((i, el) => {
    if (!($(el).text().trim() || $(el).attr('aria-label') || $(el).attr('title') || $(el).attr('value'))) unnamedButtons.push(i);
  });
  if (unnamedButtons.length) add({ category: 'accessibility', severity: 'medium', title: `${unnamedButtons.length} button(s) without an accessible name`, evidence: `${unnamedButtons.length} <button> element(s) have no text, aria-label or title.`, recommendation: 'Add visible text or aria-label to every button.' });
  if ($('meta[name="viewport"]').length === 0) add({ category: 'responsive', severity: 'medium', title: 'Missing viewport meta tag', evidence: 'No <meta name="viewport"> found.', recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> for mobile rendering.' });
  if (pageUrl.startsWith('https:')) {
    const mixed = $('img[src^="http://"], script[src^="http://"], iframe[src^="http://"]').length;
    if (mixed) add({ category: 'security', severity: 'medium', title: 'Mixed content on HTTPS page', evidence: `${mixed} subresource(s) are loaded over http://.`, recommendation: 'Load all subresources over https://.' });
  }

  // ---- Content heuristics ------------------------------------------------------------------
  const body = $('body').clone();
  body.find('script,style,noscript,template').remove();
  const text = body.text().replace(/\s+/g, ' ').trim();
  const found = new Map<string, string>();
  for (const w of text.toLowerCase().match(/[a-z']+/g) ?? []) if (MISSPELLINGS[w]) found.set(w, MISSPELLINGS[w]);
  if (found.size) add({ category: 'content', severity: 'low', title: `Likely spelling mistake(s): ${[...found.keys()].slice(0, 3).join(', ')}`, evidence: [...found].slice(0, 5).map(([w, s]) => `"${w}" → "${s}"`).join('; '), recommendation: 'Correct the spelling and run a full proofreading pass (this check only covers a small word list).' });
  const rep = text.match(/\b([a-z]{2,})\s+\1\b/i);
  if (rep && !NON_REPEAT.has(rep[1].toLowerCase())) add({ category: 'content', severity: 'low', title: 'Repeated word', evidence: `"${rep[0]}"`, recommendation: 'Remove the duplicated word.' });
  if (/lorem ipsum|dolor sit amet/i.test(text)) add({ category: 'content', severity: 'medium', title: 'Placeholder text (lorem ipsum)', evidence: 'Page contains lorem ipsum filler text.', recommendation: 'Replace placeholder text with real content before launch.' });
  const todo = text.match(/\b(TODO|TBD|FIXME)\b|\[object Object\]/);
  if (todo) add({ category: 'content', severity: 'low', title: 'Unfinished content marker', evidence: `Found "${todo[0]}" in visible text.`, recommendation: 'Resolve or remove unfinished markers.' });
  const words = text ? text.split(' ').length : 0;
  if (words < 20) add({ category: 'content', severity: 'low', title: 'Page has very little text', evidence: `Only ${words} word(s) of visible text.`, recommendation: 'Confirm the page is not blank or failing to render content.' });

  return { title, findings, links, images, ctas };
}
