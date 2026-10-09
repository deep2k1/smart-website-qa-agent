import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../server/src/app';
import type { ScanReport } from '../shared/types';
import { startFixture, type Fixture } from './fixtures/site';

// Response.json() returns `unknown` with current @types/node; this gives it a type.
const json = async <T = any>(res: Response): Promise<T> => (await res.json()) as T;

let fx: Fixture; let server: Server; let api = '';
const post = (body: unknown, raw?: string) => fetch(`${api}/api/scans`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify(body) });
async function waitDone(id: string): Promise<ScanReport> {
  for (let i = 0; i < 100; i++) {
    const r = await json<ScanReport>(await fetch(`${api}/api/scans/${id}`));
    if (r.status === 'completed' || r.status === 'failed') return r;
    await new Promise((s) => setTimeout(s, 100));
  }
  throw new Error('scan did not finish');
}

beforeAll(async () => {
  fx = await startFixture();
  const { app } = createApp({ allowedHosts: ['127.0.0.1'], aiModel: 'm', maxPagesCap: 10, maxConcurrentScans: 2 });
  await new Promise<void>((r) => { server = app.listen(0, '127.0.0.1', r); });
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await fx.close(); await new Promise((r) => server.close(r)); });

describe('HTTP API', () => {
  it('rejects invalid input with 400 and a structured error', async () => {
    for (const body of [{}, { url: 'ftp://x.test' }, { url: 'not a url' }, { url: 'https://a.test', mode: 'weird' }, { url: 'https://a.test', maxPages: 'abc' }]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect((await json(res)).error.message).toBeTruthy();
    }
    expect((await post(null, '{bad json')).status).toBe(400);
  });
  it('blocks private/local targets at submission (SSRF)', async () => {
    for (const url of ['http://169.254.169.254/', 'http://10.0.0.1/', 'http://localhost:3001/', 'http://[::1]/']) {
      const res = await post({ url });
      expect(res.status).toBe(400);
      expect((await json(res)).error.code).toBe('url_blocked');
    }
  });
  it('404s unknown scans', async () => {
    expect((await fetch(`${api}/api/scans/nope`)).status).toBe(404);
    expect((await fetch(`${api}/api/scans/nope/export`)).status).toBe(404);
  });
  it('runs a full scan end to end and exports valid JSON', async () => {
    const res = await post({ url: fx.baseUrl + '/', mode: 'full', browserChecks: false });
    expect(res.status).toBe(202);
    const { id } = await json<{ id: string }>(res);
    const report = await waitDone(id);
    expect(report.status).toBe('completed');
    expect(report.pages.length).toBeGreaterThan(3);
    const exp = await fetch(`${api}/api/scans/${id}/export`);
    expect(exp.headers.get('content-disposition')).toContain('attachment');
    expect((await json(exp)).id).toBe(id);
  });
  it('runs single-page mode through the API without crawling', async () => {
    fx.reset();
    const { id } = await json<{ id: string }>(await post({ url: fx.baseUrl + '/', mode: 'single', maxPages: 30, browserChecks: false }));
    const report = await waitDone(id);
    expect(report.request.maxPages).toBe(1);
    expect(report.pages).toHaveLength(1);
    expect(fx.requests.filter((q) => q.method === 'GET').map((q) => q.path)).toEqual(['/']);
  });
  it('clamps maxPages to the server cap', async () => {
    const { id } = await json<{ id: string }>(await post({ url: fx.baseUrl + '/', maxPages: 999, browserChecks: false }));
    expect((await waitDone(id)).request.maxPages).toBe(10);
  });
});
