export interface AppConfig {
  allowedHosts: string[];
  aiApiKey?: string;
  aiModel: string;
  maxPagesCap: number;
  maxConcurrentScans: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const int = (v: string | undefined, d: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : d;
  };
  return {
    allowedHosts: (env.ALLOW_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
    aiApiKey: env.ANTHROPIC_API_KEY?.trim() || undefined,
    aiModel: env.AI_MODEL?.trim() || 'claude-sonnet-5-5',
    maxPagesCap: int(env.MAX_PAGES_CAP, 50),
    maxConcurrentScans: int(env.MAX_CONCURRENT_SCANS, 2),
  };
}
