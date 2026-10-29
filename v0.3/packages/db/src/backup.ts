import { createHash } from 'node:crypto';
import type pg from 'pg';
import { CONTRACT_VERSION } from '../../contracts/src/index.js';

// Minimal, explicit user-data export/restore used by S1.
// Only whitelisted tables/columns leave the server. Sessions/credentials and AI audit
// artifacts are intentionally excluded; idempotency receipts are included so a restored
// environment cannot silently replay an old write into a duplicate fact.

export const BACKUP_FORMAT = 'life-dashboard-user-export';
export const BACKUP_SCHEMA_VERSION = 3;

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
    name: 'record_types', columns: ['id', 'user_id', 'module_id', 'name', 'fields', 'schema_version', 'created_at','archived_at'],
    json: ['fields'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
  },
  {
    name: 'task_templates', columns: ['id', 'user_id', 'module_id', 'definition', 'version', 'created_at','phase2','status','next_definition','effective_at','schedule_timezone','generation_cursor'],
    json: ['definition','next_definition'], where: 'user_id=$1', order: 'id', countWhere: 'user_id=$1'
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
  {name:'profile_fields',columns:['id', 'user_id', 'module_id', 'key', 'label', 'type', 'kind', 'value', 'unit', 'options','binding'],json:['value', 'options','binding'],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
  {name:'home_preferences',columns:['user_id', 'version', 'minimal_mode', 'pinned_metric_ids', 'pinned_task_ids', 'updated_at','task_pins','pinned_trends'],json:['pinned_metric_ids', 'pinned_task_ids','task_pins','pinned_trends'],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
  {name:'configuration_revisions',columns:['user_id', 'entity_type', 'version', 'snapshot', 'saved_at'],json:['snapshot'],where:'user_id=$1',order:'entity_type,version',countWhere:'user_id=$1'},
  {name:'reward_accounts',columns:['user_id', 'timezone', 'version', 'created_at'],json:[],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
  {name:'task_instance_details',columns:['user_id', 'task_id', 'template_id', 'template_version', 'category', 'period_key', 'period_start', 'period_end', 'snapshot', 'progress', 'reward_policy_version', 'reward_candidate', 'quota_period', 'reward_deadline', 'manual_revoked'],json:['snapshot', 'progress'],where:'user_id=$1',order:'task_id',countWhere:'user_id=$1'},
  {name:'task_history',columns:['id', 'user_id', 'task_id', 'version', 'event', 'reason', 'snapshot', 'created_at'],json:['snapshot'],where:'user_id=$1',order:'task_id,version',countWhere:'user_id=$1'},
  {name:'achievement_series',columns:['id', 'user_id', 'module_id', 'record_type_id', 'definition', 'version', 'created_at','archived_at'],json:['definition'],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
  {name:'series_milestones',columns:['id', 'user_id', 'series_id', 'threshold', 'label'],json:[],where:'user_id=$1',order:'series_id,threshold,id',countWhere:'user_id=$1'},
  {name:'series_awards',columns:['id', 'user_id', 'series_id', 'milestone_id', 'period_key', 'state', 'version', 'unlocked_at', 'evaluated_at', 'evidence', 'original_evidence'],json:['evidence', 'original_evidence'],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
  {name:'reward_qualifications',columns:['id', 'user_id', 'task_id', 'category', 'quota_period', 'policy_version', 'amount', 'eligible', 'denial_reason', 'original_grant_id', 'created_at'],json:[],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
  {name:'wallet_ledger',columns:['id', 'user_id', 'task_id', 'qualification_id', 'ordinal', 'kind', 'amount', 'policy_version', 'root_entry_id', 'previous_entry_id', 'reason', 'created_at'],json:[],where:'user_id=$1',order:'qualification_id,ordinal',countWhere:'user_id=$1'},
  {
    name: 'change_log', columns: ['user_id', 'seq', 'entity_type', 'entity_id', 'version', 'payload', 'created_at'],
    json: ['payload'], where: 'user_id=$1', order: 'seq', countWhere: 'user_id=$1'
  },
  {
    name: 'mutation_receipts', columns: ['user_id', 'operation_id', 'request_hash', 'response', 'created_at'],
    json: ['response'], where: 'user_id=$1', order: 'operation_id', countWhere: 'user_id=$1'
  },
{name:'ai_preferences',columns:["user_id", "version", "automatic_mode", "readable_module_ids", "auto_config_objects_limit", "auto_record_count_limit"],json:["readable_module_ids"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_conversations',columns:["user_id", "id", "version", "entrypoint", "title", "created_at"],json:[],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_messages',columns:["user_id", "id", "conversation_id", "client_message_id", "seq", "body", "created_at"],json:["body"],where:'user_id=$1',order:'seq',countWhere:'user_id=$1'},
{name:'ai_runs',columns:["user_id", "id", "conversation_id", "message_id", "operation_id", "status", "version", "attempts", "lease_until", "lease_owner", "cancel_requested", "received_at", "deadline_at", "detail"],json:["detail"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_run_events',columns:["user_id", "run_id", "event_id", "kind", "payload", "created_at"],json:["payload"],where:'user_id=$1',order:'event_id',countWhere:'user_id=$1'},
{name:'ai_context_snapshots',columns:["user_id", "id", "run_id", "context", "created_at"],json:["context"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_proposals',columns:["user_id", "id", "run_id", "version", "status", "content_hash", "decision", "compiled", "context_id", "confirmation_required", "token_hash", "expires_at"],json:["decision", "compiled"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'goals',columns:["user_id", "id", "module_id", "version", "definition", "source_message_id", "archived_at", "created_at"],json:["definition"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'goal_revisions',columns:["user_id", "goal_id", "version", "snapshot", "created_at"],json:["snapshot"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'plan_versions',columns:["user_id", "id", "goal_id", "source_run_id", "version", "created_at"],json:[],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'plan_objects',columns:["user_id", "plan_id", "entity_type", "entity_id", "reused"],json:[],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_applications',columns:["user_id", "id", "proposal_id", "receipt", "created_objects", "version", "undo_hash", "undo_expires_at", "undo_preview", "undone_at"],json:["receipt", "created_objects", "undo_preview"],where:'user_id=$1',order:'user_id',countWhere:'user_id=$1'},
{name:'ai_usage',columns:["user_id", "run_id", "attempt", "day", "reserved_input", "reserved_output", "input_tokens", "output_tokens", "status", "provider", "model", "created_at", "purpose", "parent_id", "schema_version", "prompt_version"],json:[],where:'user_id=$1',order:'run_id,attempt',countWhere:'user_id=$1'},
{name:'record_sources',columns:["user_id", "record_id", "version", "provenance", "estimated_values", "time_precision", "time_basis", "source_run_id", "received_at"],json:["provenance", "estimated_values"],where:'user_id=$1',order:'record_id,version',countWhere:'user_id=$1'},
{name:'reward_quotes',columns:["user_id", "template_id", "template_version", "rule_hash", "category", "amount", "source", "rationale", "parent_id", "created_at"],json:[],where:'user_id=$1',order:'template_id,template_version',countWhere:'user_id=$1'},
{name:'reports',columns:["user_id", "id", "identity_hash", "kind", "request", "version", "created_at"],json:["request"],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
{name:'report_revisions',columns:["user_id", "report_id", "revision", "status", "facts", "narrative", "error", "model", "prompt_version", "outdated", "created_at", "published_at"],json:["facts", "narrative", "error"],where:'user_id=$1',order:'report_id,revision',countWhere:'user_id=$1'},
{name:'report_schedules',columns:["id", "user_id", "kind", "version", "config", "next_run_at", "last_due_key", "pause_reason", "preview_hash", "preview_body_hash", "preview_expires_at"],json:["config"],where:'user_id=$1',order:'kind',countWhere:'user_id=$1'},
{name:'report_jobs',columns:["user_id", "id", "report_id", "revision", "parent_id", "status", "attempts", "lease_owner", "lease_until", "schedule_kind", "schedule_version", "logical_due_key", "cancel_requested", "created_at"],json:[],where:'user_id=$1',order:'id',countWhere:'user_id=$1'},
{name:'daily_statistics',columns:["user_id", "module_id", "day", "source_hash", "statistics", "updated_at"],json:["statistics"],where:'user_id=$1',order:'module_id,day',countWhere:'user_id=$1'},
{name:'report_summaries',columns:["user_id", "report_id", "revision", "module_ids", "source_hash", "summary", "outdated"],json:["module_ids"],where:'user_id=$1',order:'report_id,revision',countWhere:'user_id=$1'}
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
    for(const row of data.ai_runs??[])if(row.detail&&typeof row.detail==='object')delete (row.detail as any).gateway_result;
    for(const row of data.ai_proposals??[])row.token_hash=null;
    for(const row of data.report_schedules??[]){row.preview_hash=null;row.preview_body_hash=null;row.preview_expires_at=null;}
    for(const row of data.ai_applications??[]){row.undo_hash=null;row.undo_expires_at=null;}
    for(const row of data.mutation_receipts??[]){const response=row.response as any;if(response?.data?.confirmation_token)response.data.confirmation_token=null;if(response?.data?.preview_token)response.data.preview_token=null;}
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
  if (![1,2,BACKUP_SCHEMA_VERSION].includes(Number(backup.schema_version))) throw new BackupError('UNSUPPORTED_VERSION', `Unsupported backup schema version: ${String(backup.schema_version)}`);
  if (typeof backup.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(backup.checksum)) throw new BackupError('INVALID_BACKUP', 'Backup checksum is missing or invalid');
  if (!Array.isArray(backup.migrations)) throw new BackupError('INVALID_BACKUP', 'Backup migration list is missing');
  if (!backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) throw new BackupError('INVALID_BACKUP', 'Backup data payload is missing');
  const data = backup.data as Record<string, unknown>;
  for (const spec of BACKUP_TABLES) {
    if (backup.schema_version===1 && spec.name.startsWith('ai_') || backup.schema_version===1 && ['goals','goal_revisions','plan_versions','plan_objects'].includes(spec.name)) continue;
    if(Number(backup.schema_version)<3 && ["record_sources", "reward_quotes", "reports", "report_revisions", "report_schedules", "report_jobs", "daily_statistics", "report_summaries"].includes(spec.name))continue;
    if (!Array.isArray(data[spec.name])) throw new BackupError('INVALID_BACKUP', `Backup table ${spec.name} is missing`);
  }
  const { checksum, ...unsigned } = backup;
  const expected = backupChecksum(unsigned as Omit<UserDataBackup, 'checksum'>);
  if (expected !== checksum) throw new BackupError('CHECKSUM_MISMATCH', 'Backup checksum does not match its payload; the file was modified or corrupted');
  const typed = structuredClone(backup) as unknown as UserDataBackup;
  if(typed.schema_version<3){
    for(const name of ["record_sources", "reward_quotes", "reports", "report_revisions", "report_schedules", "report_jobs", "daily_statistics", "report_summaries"])if(!typed.data[name]){typed.data[name]=[];typed.counts[name]=0;}
    for(const row of typed.data.ai_usage??[]){row.purpose??='plan';row.parent_id??=row.run_id;row.schema_version??='ai-decision/1.0';row.prompt_version??='v03-p1';}
  }
  if(typed.schema_version===1){
    for(const spec of BACKUP_TABLES)if(!typed.data[spec.name]){typed.data[spec.name]=[];typed.counts[spec.name]=0;}
    for(const name of ['record_types','achievement_series'])for(const row of typed.data[name])row.archived_at??=null;
  }
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
    const compatible=backup.schema_version<3 && targetMigrations.slice(0,backup.migrations.length).map(m=>`${m.name}:${m.checksum}`).join('|')===expectedMigrations && targetMigrations.slice(backup.migrations.length).every(m=>['0005_v03_planning.sql','0006_v03_workflows.sql','0007_v03_schedule_identity.sql'].includes(m.name));
    if (expectedMigrations !== actualMigrations && !compatible) {
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
          return (spec.json as readonly string[]).includes(col) && (value !== null || (spec.name==='profile_fields' && col==='value')) && value !== undefined ? JSON.stringify(value) : value;
        });
        const placeholders = spec.columns.map((_, i) => `$${i + 1}`).join(',');
        await c.query(`INSERT INTO ${spec.name}(${spec.columns.join(',')}) OVERRIDING SYSTEM VALUE VALUES(${placeholders})`, values);
      }
    }
    const counts: Record<string, number> = {};
    for (const spec of BACKUP_TABLES) {
      counts[spec.name] = (await c.query(`SELECT count(*)::int AS n FROM ${spec.name} WHERE ${spec.countWhere}`, [userId])).rows[0].n;
      if (counts[spec.name] !== backup.counts[spec.name]) {
        throw new BackupError('COUNT_MISMATCH', `Restored row count mismatch for ${spec.name}: expected ${backup.counts[spec.name]}, got ${counts[spec.name]}`);
      }
    }
    // Restored jobs never silently reissue paid requests; discard all transient confirmations.
    await c.query("UPDATE ai_runs SET status='failed',lease_owner=NULL,lease_until=NULL,version=version+1,detail=(detail-'gateway_result')||jsonb_build_object('error',jsonb_build_object('code','RESTORE_PAUSED','message','恢复后作业已暂停；请明确发起新请求。','retryable',false,'retry_after_ms',null)) WHERE status IN ('queued','running','applying')");
    await c.query('UPDATE ai_proposals SET token_hash=NULL');
    await c.query('UPDATE ai_applications SET undo_hash=NULL,undo_expires_at=NULL');
    await c.query("UPDATE report_schedules SET config=jsonb_set(config,'{enabled}','false'),next_run_at=NULL,pause_reason='RESTORE_PAUSED',preview_hash=NULL,preview_body_hash=NULL,preview_expires_at=NULL");
    await c.query("UPDATE report_jobs SET status='failed',cancel_requested=true,lease_owner=NULL,lease_until=NULL WHERE status IN ('queued','generating')");
    await c.query("UPDATE report_revisions SET status='failed',error='{\"code\":\"RESTORE_PAUSED\",\"message\":\"恢复后收费作业暂停，请明确重新生成。\"}' WHERE status IN ('queued','generating')");
    for(const table of ['ai_messages','ai_run_events']){
      const column=table==='ai_messages'?'seq':'event_id';
      await c.query(`SELECT setval(pg_get_serial_sequence('${table}','${column}'), greatest(coalesce((SELECT max(${column}) FROM ${table}),0)+1,1),false)`);
    }
    await c.query('COMMIT');
    return { user_id: userId, cursor: backup.cursor, counts };
  } catch (error) {
    try { await c.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw error;
  } finally { c.release(); }
}
