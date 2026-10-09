import { createApp } from './app';
import { loadConfig } from './config';

try {
  process.loadEnvFile(); // optional .env (Node >= 20.12)
} catch {
  /* no .env file: use defaults */
}

const config = loadConfig();
const { app } = createApp(config);
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '127.0.0.1';
app.listen(port, host, () => {
  console.log(`Smart Website QA Agent API on http://${host}:${port}  (AI: ${config.aiApiKey ? 'anthropic' : 'deterministic fallback'})`);
});
