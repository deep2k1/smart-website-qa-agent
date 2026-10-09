// Generates a REAL sample QA report by scanning the local test fixture with the actual scanner.
import fs from 'node:fs';
import path from 'node:path';
import { deterministicProvider } from '../server/src/ai';
import { renderMarkdown } from '../server/src/report';
import { createReport, runScan } from '../server/src/scanner';
import { startFixture } from '../tests/fixtures/site';

const outDir = path.resolve('sample-report');
fs.mkdirSync(outDir, { recursive: true });
const fx = await startFixture();
try {
  for (const mode of ['full', 'single'] as const) {
    const report = createReport(`sample-${mode}`, {
      url: `${fx.baseUrl}/`, mode, maxPages: mode === 'single' ? 1 : 20, concurrency: 3, timeoutMs: 5000, browserChecks: process.env.SAMPLE_BROWSER === '1',
    });
    await runScan(report, { policy: { allowedHosts: ['127.0.0.1'] }, ai: deterministicProvider });
    fs.writeFileSync(path.join(outDir, `sample-${mode}.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outDir, `sample-${mode}.md`), renderMarkdown(report));
    console.log(`${mode}: status=${report.status} pages=${report.pages.length} findings=${report.counts.total}`);
  }
} finally {
  await fx.close();
}
