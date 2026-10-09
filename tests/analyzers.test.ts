import { describe, expect, it } from 'vitest';
import { analyzeHtml } from '../server/src/analyzers';

const U = 'https://site.test/page';
const titles = (html: string) => analyzeHtml(html, U).findings.map((f) => f.title);

describe('analyzeHtml', () => {
  it('flags missing title, meta description, H1, lang and viewport', () => {
    const t = titles('<html><body><p>hi</p></body></html>');
    expect(t).toContain('Missing or empty <title>');
    expect(t).toContain('Missing meta description');
    expect(t).toContain('Missing H1 heading');
    expect(t).toContain('Missing lang attribute on <html>');
    expect(t).toContain('Missing viewport meta tag');
  });
  it('flags multiple H1 and skipped heading levels', () => {
    const t = titles('<html lang="en"><body><h1>a</h1><h1>b</h1><h4>c</h4></body></html>');
    expect(t).toContain('Multiple H1 headings');
    expect(t).toContain('Heading level skipped');
  });
  it('flags images without alt but accepts alt="" and decorative roles', () => {
    const f = analyzeHtml('<html><body><img src="/a.png"><img src="/b.png" alt=""><img src="/c.png" role="presentation"></body></html>', U).findings.find((x) => x.category === 'images');
    expect(f?.title).toContain('1 image(s) missing alt text');
    expect(f?.evidence).toContain('/a.png');
    expect(f?.evidence).not.toContain('/b.png');
  });
  it('detects CTAs and their destinations; placeholder hrefs are findings', () => {
    const a = analyzeHtml('<html><body><a href="/signup">Get started</a><a href="#">Buy now</a><a href="/x">Read this long article about gardening</a></body></html>', U);
    expect(a.ctas.map((c) => [c.text, c.href])).toEqual([['Get started', 'https://site.test/signup'], ['Buy now', null]]);
    expect(a.findings.some((f) => f.title === 'Call-to-action has no destination' && f.evidence.includes('Buy now'))).toBe(true);
    expect(a.links.map((l) => l.url)).toEqual(['https://site.test/signup', 'https://site.test/x']);
  });
  it('flags likely misspellings, lorem ipsum and unlabeled inputs', () => {
    const t = titles('<html lang="en"><body><h1>x</h1><p>We definately recieve teh mail. Lorem ipsum dolor sit amet.</p><input name="q"><label>Ok <input name="ok"></label></body></html>');
    expect(t.some((x) => x.startsWith('Likely spelling mistake'))).toBe(true);
    expect(t).toContain('Placeholder text (lorem ipsum)');
    expect(t).toContain('1 form field(s) without a label');
  });
  it('does not flag a clean page for the checked categories', () => {
    const html = `<html lang="en"><head><title>Clean page</title><meta name="description" content="A clean page."><meta name="viewport" content="width=device-width"></head><body><h1>Clean</h1><p>${'Words that read well. '.repeat(10)}</p><img src="/a.png" alt="A"></body></html>`;
    expect(analyzeHtml(html, U).findings).toEqual([]);
  });
  it('every finding has the required structured fields', () => {
    for (const f of analyzeHtml('<html><body><img src="/a.png"></body></html>', U).findings) {
      expect(f.category && f.severity && f.title && f.url && f.evidence && f.recommendation).toBeTruthy();
      expect(f.url).toBe(U);
    }
  });
});
