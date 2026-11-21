import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const dir of ['.secrets', '.runtime/tmp', '.runtime/data/postgres', '.runtime/data/uploads', '.runtime/backups', '.runtime/logs', '.runtime/test-artifacts', '.runtime/cache']) mkdirSync(dir, { recursive: true });
chmodSync('.secrets', 0o700);
const path = '.secrets/development.env';
if (!existsSync(path)) writeFileSync(path, `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nLOCAL_LOGIN_SECRET=${randomBytes(32).toString('hex')}\n# AI provider: mock (default, no network) or deepseek (requires DEEPSEEK_API_KEY)\nAI_PROVIDER=mock\n# DEEPSEEK_API_KEY=\nDEEPSEEK_MODEL=deepseek-flash\nDEEPSEEK_BASE_URL=https://api.deepseek.com\n# v0.3 planning is explicitly enabled only after server configuration and UI authorization.\nV03_AI_ENABLED=0\nV03_AI_THINKING=enabled\nV03_AI_REASONING_EFFORT=high\nV03_AI_REWARD_PRICING=1\nV03_AI_DAILY_JOBS=30\nV03_AI_DAILY_INPUT_TOKENS=1000000\nV03_AI_DAILY_OUTPUT_TOKENS=200000\nV03_AI_MAX_INPUT_TOKENS=100000\nV03_AI_MAX_OUTPUT_TOKENS=12000\n`, { mode: 0o600 });
console.log('Version-local directories and private configuration ready; existing credentials preserved.');
