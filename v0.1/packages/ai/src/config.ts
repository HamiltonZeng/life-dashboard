export type AiProvider = 'mock' | 'deepseek';

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string | null;
  timeoutMs: number;
  taskTimeoutMs: number;
  maxAttempts: number;
  dailyJobLimit: number;
  maxOutputTokens: number;
  maxInputChars: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, Math.trunc(value)));

function intEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = value === undefined || value === '' ? fallback : Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}

/** Server-side AI configuration. The API key is never returned to clients or written to logs. */
export function loadAiConfig(env: NodeJS.ProcessEnv = process.env): AiConfig {
  const provider: AiProvider = env.AI_PROVIDER === 'deepseek' ? 'deepseek' : 'mock';
  const baseUrl = env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com';
  let parsed: URL;
  try { parsed = new URL(baseUrl); } catch { throw new Error('DEEPSEEK_BASE_URL must be an absolute http(s) URL'); }
  const allowInsecure = env.AI_ALLOW_INSECURE_BASE_URL === '1';
  if (parsed.protocol !== 'https:' && !(allowInsecure && parsed.protocol === 'http:')) {
    throw new Error('DEEPSEEK_BASE_URL must use https (set AI_ALLOW_INSECURE_BASE_URL=1 only for local testing)');
  }
  if (parsed.username || parsed.password) throw new Error('DEEPSEEK_BASE_URL must not contain credentials');
  return {
    provider,
    model: provider === 'deepseek' ? (env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat') : 'mock-blueprint-1',
    baseUrl,
    apiKey: provider === 'deepseek' ? (env.DEEPSEEK_API_KEY?.trim() || null) : null,
    // Model attempt and model-run (attempts + backoff) budgets are independent.
    // Fastify requestTimeout is not a deadline for application handler completion.
    timeoutMs: intEnv(env.AI_TIMEOUT_MS, 6000, 1000, 10000),
    taskTimeoutMs: intEnv(env.AI_TASK_TIMEOUT_MS, 12500, 1000, 13000),
    maxAttempts: intEnv(env.AI_MAX_ATTEMPTS, 2, 1, 3),
    dailyJobLimit: intEnv(env.AI_DAILY_JOB_LIMIT, 100, 1, 1000),
    maxOutputTokens: intEnv(env.AI_MAX_OUTPUT_TOKENS, 4096, 256, 8192),
    maxInputChars: intEnv(env.AI_MAX_INPUT_CHARS, 16000, 1000, 30000)
  };
}
