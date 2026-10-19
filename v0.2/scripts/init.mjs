import { mkdirSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
for (const dir of ['.secrets', '.runtime/tmp', '.runtime/data/postgres', '.runtime/data/uploads', '.runtime/backups', '.runtime/logs', '.runtime/test-artifacts', '.runtime/cache']) mkdirSync(dir, { recursive: true });
chmodSync('.secrets', 0o700);
const path = '.secrets/development.env';
if (!existsSync(path)) writeFileSync(path, `POSTGRES_PASSWORD=${randomBytes(32).toString('hex')}\nLOCAL_LOGIN_SECRET=${randomBytes(32).toString('hex')}\n# AI provider: mock (default, no network) or deepseek (requires DEEPSEEK_API_KEY)\nAI_PROVIDER=mock\n# DEEPSEEK_API_KEY=\n# DEEPSEEK_MODEL=deepseek-chat\n`, { mode: 0o600 });
console.log('Version-local directories and private configuration ready; existing credentials preserved.');
