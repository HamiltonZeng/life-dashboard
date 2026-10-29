import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const dir of ['.secrets', '.runtime/tmp', '.runtime/data/postgres', '.runtime/data/uploads', '.runtime/backups', '.runtime/logs', '.runtime/test-artifacts', '.runtime/cache']) mkdirSync(dir, { recursive: true });
chmodSync('.secrets', 0o700);
const path = '.secrets/development.env';
if (!existsSync(path)) writeFileSync(path, `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nLOCAL_LOGIN_SECRET=${randomBytes(32).toString('hex')}\n# AI provider: mock (default, no network) or deepseek (requires DEEPSEEK_API_KEY)\nAI_PROVIDER=mock\n# DEEPSEEK_API_KEY=\n# DEEPSEEK_MODEL=\n# v0.3 planning is explicitly enabled only after server configuration and UI authorization.\nV03_AI_ENABLED=0\nV03_AI_DAILY_JOBS=20\nV03_AI_DAILY_INPUT_TOKENS=100000\nV03_AI_DAILY_OUTPUT_TOKENS=20000\nV03_AI_MAX_INPUT_TOKENS=32000\nV03_AI_MAX_OUTPUT_TOKENS=4000\n`, { mode: 0o600 });
console.log('Version-local directories and private configuration ready; existing credentials preserved.');
