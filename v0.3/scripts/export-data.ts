import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { createPool } from '../packages/db/src/client.js';
import { exportUserData } from '../packages/db/src/backup.js';
import { LOCAL_USER_ID } from '../packages/db/src/seed.js';

// Manual S1 export. Read-only against the configured database; the file contains the
// user's own records and configuration, so it is written with 0600 permissions and is
// never printed to stdout.
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const directory = '.runtime/backups';
mkdirSync(directory, { recursive: true });
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = flag('--out') ?? `${directory}/life-dashboard-${timestamp}.json`;
const pool = createPool();
try {
  const backup = await exportUserData(pool, LOCAL_USER_ID);
  const text = JSON.stringify(backup, null, 2) + '\n';
  writeFileSync(out, text, { mode: 0o600 });
  // writeFileSync keeps an existing file's mode; enforce 0600 on overwrite too.
  chmodSync(out, 0o600);
  const counts = Object.entries(backup.counts).filter(([, n]) => n > 0).map(([table, n]) => `${table}=${n}`).join(', ');
  console.log(`Exported user data to ${out} (${Buffer.byteLength(text)} bytes, cursor=${backup.cursor}).`);
  console.log(`Non-empty tables: ${counts || 'none'}`);
  console.log('Sessions and credentials are not included. Keep this file private; it contains personal records.');
} catch (error) {
  console.error('Export failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
