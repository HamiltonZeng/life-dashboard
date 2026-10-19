import { createHash } from 'node:crypto';
import type pg from 'pg';
import { CONTRACT_VERSION } from '../../contracts/src/index.js';

// Minimal, explicit user-data export/restore used by S1.
// Only whitelisted tables/columns leave the server. Sessions/credentials and AI audit
// artifacts are intentionally excluded; idempotency receipts are included so a restored
// environment cannot silently replay an old write into a duplicate fact.

export const BACKUP_FORMAT = 'life-dashboard-user-export';
export const BACKUP_SCHEMA_VERSION = 1;

export const BACKUP_TABLES = [
  {
    name: 'users', columns: ['id', 'name', 'timezone', 'created_at'], json: [] as string[],
    where: 'id=$1', order: 'id', countWhere: 'id=$1'
  },
  {
    name: 'user_sync_clock', columns: ['user_id', 'seq'], json: [] as string[],
    where: 'user_id=$1', order: 'user_id', countWhere: 'user_id=$1'
  },
  {
    name: 'modules',
    columns: ['id', 'user_id', 'name', 'description', 'icon', 'color', 'sort_order', 'status', 'source', 'version', 'created_at', 'updated_at'],
    json: [], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'record_types', columns: ['id', 'user_id', 'module_id', 'name', 'fields', 'schema_version', 'created_at'],
    json: ['fields'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'task_templates', columns: ['id', 'user_id', 'module_id', 'definition', 'version', 'created_at'],
    json: ['definition'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'tasks',
    columns: ['id', 'user_id', 'module_id', 'template_id', 'rule_version', 'definition', 'status', 'needs_review', 'completed_at', 'completion_origin', 'version', 'created_at', 'updated_at'],
    json: ['definition'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'records',
    columns: ['id', 'user_id', 'module_id', 'record_type_id', 'schema_version', 'occurred_at', 'timezone', 'status', 'values', 'version', 'created_at', 'updated_at', 'deleted_at'],
    json: ['values'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'record_tasks', columns: ['user_id', 'record_id', 'task_id'], json: [],
    where: 'user_id=$1', order: 'record_id,task_id', countWhere: 'user_id=$1'
  },
  {
    name: 'record_revisions', columns: ['user_id', 'record_id', 'version', 'snapshot', 'saved_at'], json: ['snapshot'],
    where: 'user_id=$1', order: 'record_id,version', countWhere: 'user_id=$1'
  },
  {
    name: 'metric_definitions', columns: ['id', 'user_id', 'module_id', 'record_type_id', 'definition', 'version', 'created_at', 'archived_at'],
    json: ['definition'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'achievement_definitions', columns: ['id', 'user_id', 'module_id', 'metric_id', 'definition', 'version', 'created_at', 'archived_at'],
    json: ['definition'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'achievement_awards',
    columns: ['id', 'user_id', 'achievement_id', 'rule_version', 'period_key', 'state', 'unlocked_at', 'evaluated_at', 'evidence', 'original_evidence', 'version'],
    json: ['evidence', 'original_evidence'], where: 'user_id=$1', order: 'unlocked_at,id', countWhere: 'user_id=$1'
  },
  {name:'user_profiles',columns:['user_id', 'version', 'bio', 'updated_at'],json:[],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
  {name:'profile_fields',columns:['id', 'user_id', 'module_id', 'key', 'label', 'type', 'kind', 'value', 'unit', 'options'],json:['value', 'options'],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
  {name:'home_preferences',columns:['user_id', 'version', 'minimal_mode', 'pinned_metric_ids', 'pinned_task_ids', 'updated_at'],json:['pinned_metric_ids', 'pinned_task_ids'],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
  {name:'configuration_revisions',columns:['user_id', 'entity_type', 'version', 'snapshot', 'saved_at'],json:['snapshot'],where:'user_id=$1',order:'entity_type,version',countWhere:'user_id=$1'},
  {
    name: 'change_log', columns: ['user_id', 'seq', 'entity_type', 'entity_id', 'version', 'payload', 'created_at'],
    json: ['payload'], where: 'user_id=$1', order: 'seq', countWhere: 'user_id=$1'
  },
  {
    name: 'mutation_receipts', columns: ['user_id', 'operation_id', 'request_hash', 'response', 'created_at'],
    json: ['response'], where: 'user_id=$1', order: 'operation_id', countWhere: 'user_id=$1'
  }
] as const;

export interface BackupTableSpec {
  name: string;
  columns: readonly string[];
  json: readonly string[];
  where: string;
  order: string;
  countWhere: string;
}

export interface UserDataBackup {
  format: typeof BACKUP_FORMAT;
  schema_version: number;
  contract_version: string;
  exported_at: string;
  user: Record<string, unknown> | null;
  cursor: number;
  migrations: { name: string; checksum: string }[];
  counts: Record<string, number>;
  data: Record<string, Record<string, unknown>[]>;
  checksum: string;
}

export class BackupError extends Error {
  constructor(public readonly code: string, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'BackupError';
  }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

export function backupChecksum(backup: Omit<UserDataBackup, 'checksum'>): string {
  return createHash('sha256').update(canonicalJson(backup)).digest('hex');
}

const SELECT_LIST = (spec: BackupTableSpec) => spec.columns.join(',');

/** Convert driver values into stable JSON values before checksumming/serialising. */
function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) clean[key] = value.toISOString();
    else if (typeof value === 'bigint') clean[key] = value.toString();
    else clean[key] = value;
  }
  return clean;
}

export async function exportUserData(pool: pg.Pool, userId: string): Promise<UserDataBackup> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const data: Record<string, Record<string, unknown>[]> = {};
    for (const spec of BACKUP_TABLES) {
      data[spec.name] = (await c.query(
        `SELECT ${SELECT_LIST(spec)} FROM ${spec.name} WHERE ${spec.where} ORDER BY ${spec.order}`,
        [userId]
      )).rows.map(serializeRow);
    }
    const migrations = (await c.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
    await c.query('COMMIT');
    if (!data.users.length) throw new BackupError('UNKNOWN_USER', 'No data exists for this user', { user_id: userId });
    const counts = Object.fromEntries(BACKUP_TABLES.map(spec => [spec.name, data[spec.name].length]));
    const base = {
      format: BACKUP_FORMAT as typeof BACKUP_FORMAT,
      schema_version: BACKUP_SCHEMA_VERSION,
      contract_version: CONTRACT_VERSION,
      exported_at: new Date().toISOString(),
      user: data.users[0] ?? null,
      cursor: Number((data.user_sync_clock[0] as { seq?: number } | undefined)?.seq ?? 0),
      migrations,
      counts,
      data
    };
    return { ...base, checksum: backupChecksum(base) };
  } catch (error) {
    try { await c.query('ROLLBACK'); } catch { /* read-only transaction */ }
    throw error;
  } finally { c.release(); }
}

export function validateBackup(raw: unknown): UserDataBackup {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BackupError('INVALID_BACKUP', 'Backup must be a JSON object');
  }
  const backup = raw as Record<string, unknown>;
  if (backup.format !== BACKUP_FORMAT) throw new BackupError('INVALID_FORMAT', `Unsupported backup format: ${String(backup.format)}`);
  if (backup.schema_version !== BACKUP_SCHEMA_VERSION) throw new BackupError('UNSUPPORTED_VERSION', `Unsupported backup schema version: ${String(backup.schema_version)}`);
  if (typeof backup.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(backup.checksum)) throw new BackupError('INVALID_BACKUP', 'Backup checksum is missing or invalid');
  if (!Array.isArray(backup.migrations)) throw new BackupError('INVALID_BACKUP', 'Backup migration list is missing');
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) throw new BackupError('INVALID_BACKUP', 'Backup data payload is missing');
  const data = backup.data as Record<string, unknown>;
  for (const spec of BACKUP_TABLES) {
    if (!Array.isArray(data[spec.name])) throw new BackupError('INVALID_BACKUP', `Backup table ${spec.name} is missing`);
  }
  const { checksum, ...unsigned } = backup;
  const expected = backupChecksum(unsigned as Omit<UserDataBackup, 'checksum'>);
  if (expected !== checksum) throw new BackupError('CHECKSUM_MISMATCH', 'Backup checksum does not match its payload; the file was modified or corrupted');
  const typed = backup as unknown as UserDataBackup;
  const counts = Object.fromEntries(BACKUP_TABLES.map(spec => [spec.name, (typed.data[spec.name] ?? []).length]));
  for (const spec of BACKUP_TABLES) {
    if (typed.counts?.[spec.name] !== undefined && typed.counts[spec.name] !== counts[spec.name]) {
      throw new BackupError('COUNT_MISMATCH', `Backup count mismatch for ${spec.name}`);
    }
  }
  if (typed.data.users.length !== 1) throw new BackupError('INVALID_BACKUP', 'Backup must contain exactly one user row');
  if (!typed.user || typed.user.id !== typed.data.users[0].id) throw new BackupError('INVALID_BACKUP', 'Backup user metadata does not match the user row');
  return typed;
}

export interface RestoreResult {
  user_id: string;
  cursor: number;
  counts: Record<string, number>;
}

/**
 * Restore a validated backup into an empty, migrated database in one transaction.
 * A checksum/migration/count/FK failure rolls everything back.
 */
export async function restoreUserData(pool: pg.Pool, raw: unknown): Promise<RestoreResult> {
  const backup = validateBackup(raw);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(11201803)');
    const targetMigrations = (await c.query('SELECT name,checksum FROM schema_migrations ORDER BY name')).rows;
    const expectedMigrations = backup.migrations.map(m => `${m.name}:${m.checksum}`).join('|');
    const actualMigrations = targetMigrations.map(m => `${m.name}:${m.checksum}`).join('|');
    if (expectedMigrations !== actualMigrations) {
      throw new BackupError('MIGRATION_MISMATCH', 'Target database schema migrations do not match the backup; run migrations from the same version before restoring');
    }
    const existing = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n as number;
    if (existing !== 0) {
      throw new BackupError('NON_EMPTY_TARGET', 'Restore requires an empty target database; refusing to merge or overwrite existing user data');
    }
    const userId = String(backup.data.users[0].id);
    for (const spec of BACKUP_TABLES) {
      for (const row of backup.data[spec.name]) {
        const values = spec.columns.map(col => {
          const value = row[col];
          return (spec.json as readonly string[]).includes(col) && value !== null && value !== undefined ? JSON.stringify(value) : value;
        });
        const placeholders = spec.columns.map((_, i) => `$${i + 1}`).join(',');
        await c.query(`INSERT INTO ${spec.name}(${spec.columns.join(',')}) VALUES(${placeholders})`, values);
      }
    }
    const counts: Record<string, number> = {};
    for (const spec of BACKUP_TABLES) {
      counts[spec.name] = (await c.query(`SELECT count(*)::int AS n FROM ${spec.name} WHERE ${spec.countWhere}`, [userId])).rows[0].n;
      if (counts[spec.name] !== backup.counts[spec.name]) {
        throw new BackupError('COUNT_MISMATCH', `Restored row count mismatch for ${spec.name}: expected ${backup.counts[spec.name]}, got ${counts[spec.name]}`);
      }
    }
    await c.query('COMMIT');
    return { user_id: userId, cursor: backup.cursor, counts };
  } catch (error) {
    try { await c.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  } finally { c.release(); }
}
