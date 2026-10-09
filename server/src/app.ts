import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ApiError, ScanReport } from '../../shared/types';
import { createAiProvider, type AiProvider } from './ai';
import type { AppConfig } from './config';
import { normalizeRequest, RequestError } from './request';
import { createReport, runScan } from './scanner';
import { assertPublicUrl, parseHttpUrl, UrlSecurityError } from './security';
import type { BrowserRunner } from './browser';

const MAX_STORED = 50;

export function createApp(config: AppConfig, overrides: { ai?: AiProvider; runBrowser?: BrowserRunner } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));
  const store = new Map<string, ScanReport>();
  const policy = { allowedHosts: config.allowedHosts };
  const ai = overrides.ai ?? createAiProvider({ apiKey: config.aiApiKey, model: config.aiModel });
  const fail = (res: Response, status: number, code: ApiError['error']['code'], message: string) =>
    res.status(status).json({ error: { code, message } } satisfies ApiError);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, ai: ai.name });
  });

  app.post('/api/scans', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const request = normalizeRequest(req.body, config.maxPagesCap);
      await assertPublicUrl(parseHttpUrl(request.url), policy); // early, user-visible SSRF rejection
      const running = [...store.values()].filter((r) => r.status === 'queued' || r.status === 'running').length;
      if (running >= config.maxConcurrentScans) return fail(res, 429, 'busy', 'Too many scans are running. Try again shortly.');
      const report = createReport(randomUUID(), request);
      store.set(report.id, report);
      for (const [id, r] of store) { // bounded memory: evict oldest finished scans
        if (store.size <= MAX_STORED) break;
        if (r.status === 'completed' || r.status === 'failed') store.delete(id);
      }
      void runScan(report, { policy, ai, runBrowser: overrides.runBrowser });
      return res.status(202).json({ id: report.id, status: report.status });
    } catch (e) {
      if (e instanceof UrlSecurityError) return fail(res, 400, 'url_blocked', e.message);
      if (e instanceof RequestError) return fail(res, 400, 'invalid_request', e.message);
      return next(e);
    }
  });

  app.get('/api/scans/:id', (req, res) => {
    const report = store.get(req.params.id);
    if (!report) return fail(res, 404, 'not_found', 'Scan not found.');
    return res.json(report);
  });

  app.get('/api/scans/:id/export', (req, res) => {
    const report = store.get(req.params.id);
    if (!report) return fail(res, 404, 'not_found', 'Scan not found.');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qa-report-${report.id}.json"`);
    return res.send(JSON.stringify(report, null, 2));
  });

  const dist = fileURLToPath(new URL('../../web/dist', import.meta.url));
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.parse.failed') return fail(res, 400, 'invalid_request', 'Request body is not valid JSON.');
    if (e?.type === 'entity.too.large') return fail(res, 400, 'invalid_request', 'Request body too large.');
    console.error(err);
    return fail(res, 500, 'internal', 'Internal server error.');
  });

  return { app, store };
}
