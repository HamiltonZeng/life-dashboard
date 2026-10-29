import { readFileSync } from 'node:fs';
import { createPool } from '../packages/db/src/client.js';
import { restoreUserData, BackupError } from '../packages/db/src/backup.js';

// Manual S1 restore into an EMPTY, freshly migrated database. It refuses the development
// database unless the operator passes --allow-development, and never merges over data.
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const file = flag('--file') ?? args.filter(arg => !arg.startsWith('--'))[0];
if (!file) {
  console.error('Usage: corepack pnpm restore:data --file <backup.json> [--allow-development]');
  process.exit(2);
}
const databaseName = process.env.DATABASE_NAME ?? 'life_dashboard';
if (!/(test|restore|verify)/i.test(databaseName) && !args.includes('--allow-development')) {
  console.error(`Refusing to restore into "${databaseName}": use an isolated/test database name, or pass --allow-development deliberately.`);
  process.exit(2);
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Cannot read backup file ${file}:`, error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const pool = createPool();
try {
  const result = await restoreUserData(pool, raw);
  console.log(`Restored user ${result.user_id} into ${databaseName} (cursor=${result.cursor}).`);
  console.log(`Restored tables: ${Object.entries(result.counts).filter(([, n]) => n > 0).map(([table, n]) => `${table}=${n}`).join(', ')}`);
  console.log('Sessions are not restored; log in again with the local development secret after restarting the API if needed.');
} catch (error) {
  if (error instanceof BackupError) {
    console.error(`Restore refused (${error.code}): ${error.message}`);
  } else {
    console.error('Restore failed:', error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}
