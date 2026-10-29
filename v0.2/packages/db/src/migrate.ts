import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createPool } from './client.js';
export async function migrate(pool = createPool()) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(11201801)");
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const root = new URL('../migrations/', import.meta.url);
    for (const name of (await readdir(root)).filter(n=>n.endsWith('.sql')).sort()) {
      const sql = await readFile(new URL(name, root), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = await c.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
      if (existing.rows.length) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Migration changed after application: ${name}`);
        continue;
      }
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
    }
    await c.query('COMMIT');
  } catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
if (process.argv[1]?.endsWith('/migrate.ts')) { const pool = createPool(); try {await migrate(pool); console.log('Migrations applied.');} finally {await pool.end();} }
