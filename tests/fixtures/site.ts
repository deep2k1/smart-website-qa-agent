import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface Fixture {
  baseUrl: string;
  requests: { method: string; path: string }[];
  reset(): void;
  close(): Promise<void>;
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const page = (head: string, body: string, lang = ' lang="en"') =>
  `<!doctype html><html${lang}><head><meta name="viewport" content="width=device-width, initial-scale=1">${head}</head><body>${body}</body></html>`;

/** Deterministic local site with known defects. Used by tests and the sample report. */
export async function startFixture(): Promise<Fixture> {
  const requests: Fixture['requests'] = [];
  let baseUrl = '';
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    requests.push({ method: req.method ?? 'GET', path });
    const html = (status: number, body: string) => { res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); };
    switch (path) {
      case '/':
        return html(200, page(
          '<title>Fixture Home</title><meta name="description" content="Home page of the QA fixture site.">',
          `<h1>Welcome</h1><p>We definately care about teh quality of your site, and we keep every page well maintained for our visitors.</p>
           <a href="/about">About</a> <a href="/missing-page">Broken link</a> <a href="/signup">Get started</a> <a href="#">Buy now</a>
           <a href="http://10.0.0.5/admin">Internal admin</a> <a href="/redirect-private">Redirecting link</a>
           <img src="/img/ok.png" alt="Logo"><img src="/img/missing.png" alt="Missing"><img src="/img/ok.png">`));
      case '/about':
        return html(200, page('', '<h2>About us</h2><p>Lorem ipsum dolor sit amet.</p><a href="/deep">Deep page</a>', ''));
      case '/deep':
        return html(200, page('<title>Deep</title><meta name="description" content="Deep page.">', '<h1>Deep page</h1><p>This page is only reachable through the About page, so it proves that crawling follows links beyond the first level of the site.</p>'));
      case '/signup':
        return html(200, page('<title>Sign up</title><meta name="description" content="Sign up.">', '<h1>Sign up</h1><form><input name="email"><button>Join now</button></form><p>Create your account in a minute using only an email address and a password.</p>'));
      case '/orphan':
        return html(200, page('<title>Orphan</title><meta name="description" content="Only in sitemap.">', '<h1>Orphan</h1><p>This page is not linked from anywhere and is only discoverable through sitemap.xml on the fixture site.</p>'));
      case '/private-unlinked':
        return html(200, page('<title>Hidden</title>', '<h1>Hidden</h1>'));
      case '/sitemap.xml':
        res.writeHead(200, { 'content-type': 'application/xml' });
        return res.end(`<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${baseUrl}/</loc></url><url><loc>${baseUrl}/about</loc></url><url><loc>${baseUrl}/orphan</loc></url><url><loc>https://other.example/x</loc></url></urlset>`);
      case '/img/ok.png':
        res.writeHead(200, { 'content-type': 'image/png' });
        return res.end(PNG);
      case '/redirect-private':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        return res.end();
      case '/redirect-loop':
        res.writeHead(302, { location: '/redirect-loop' });
        return res.end();
      case '/slow':
        return void setTimeout(() => html(200, '<html><body>slow</body></html>'), 2500);
      case '/js-error':
        return html(200, page('<title>JS error</title><meta name="description" content="x">', '<h1>JS error</h1><p>Page with a deliberate console error and uncaught exception for browser tests.</p><script>console.error("fixture console error"); setTimeout(function(){ throw new Error("fixture uncaught"); }, 10);</script>'));
      default:
        return html(404, '<html><body>Not found</body></html>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    baseUrl, requests,
    reset: () => { requests.length = 0; },
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}
