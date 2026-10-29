import {guardSynthetic} from '../v02-phase3/guard.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { createPool } from '../../packages/db/src/client.js';
import { seed, LOCAL_USER_ID } from '../../packages/db/src/seed.js';
import {
  backupChecksum, BackupError, exportUserData, restoreUserData, validateBackup,
  type UserDataBackup
} from '../../packages/db/src/backup.js';

const stripMeta = (backup: UserDataBackup) => {
  const { exported_at, checksum, ...rest } = backup;
  void exported_at; void checksum;
  return rest;
};

test('S1 minimal export/restore acceptance', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_NAME, 'life_dashboard_test', 'Refuse to reset a non-test database');
  assert.equal(process.env.DATABASE_HOST, 'postgres-test');
  const pool = createPool();
  (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));
  await seed(pool);
  const app = await buildApp(pool);
  const origin = 'http://localhost:18080';
  let cookie = '';
  const req = (method: string, path: string, payload?: any, key: string = randomUUID()): any =>
    app.inject({ method: method as any, url: '/api/v1/' + path, headers: { origin, cookie, 'idempotency-key': key }, payload });
  const ok = async (method: string, path: string, payload?: unknown) => {
    const response = await req(method, path, payload);
    assert.equal(response.statusCode, 200, `${method} ${path}: ${response.body}`);
    return response.json().data;
  };
  const login = async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { origin }, payload: { login_secret: process.env.LOCAL_LOGIN_SECRET } });
    assert.equal(response.statusCode, 200, response.body);
    cookie = String(response.headers['set-cookie']).split(';')[0];
  };

  let moduleId = '', recordTypeId = '', taskId = '', confirmedId = '', draftId = '', deletedId = '';
  let backup: UserDataBackup;

  try {
    await login();

    await t.test('prepare a mixed fact/definition fixture through the public API', async () => {
      const module = await ok('POST', 'modules', { id: randomUUID(), name: '导出测试模块', description: 'S1 导出恢复夹具', icon: 'book', color: 'blue' });
      moduleId = module.id;
      const recordType = await ok('POST', 'record-types', {
        id: randomUUID(), module_id: moduleId, name: '导出测试模板', fields: [
          { key: 'topic', label: '内容', type: 'text', required: true, unit: null, options: [], minimum: null, maximum: null },
          { key: 'duration_minutes', label: '实际分钟数', type: 'integer', required: true, unit: '分钟', options: [], minimum: 0, maximum: 600 }
        ]
      });
      recordTypeId = recordType.id;
      const task = await ok('POST', 'tasks', {
        id: randomUUID(), module_id: moduleId, title: '导出测试任务', completion_mode: 'record_required',
        record_type_id: recordTypeId, acceptance: { kind: 'field_gte', field_key: 'duration_minutes', threshold: '10' },
        business_date: null, timezone: 'Asia/Shanghai'
      });
      taskId = task.id;
      const metric = await ok('POST', 'metrics', {
        id: randomUUID(), module_id: moduleId, record_type_id: recordTypeId, name: '导出累计次数', unit: '次',
        aggregation: 'count', field_key: null, window: 'all_time', timezone: 'Asia/Shanghai'
      });
      await ok('POST', 'achievements', {
        id: randomUUID(), module_id: moduleId, metric_id: metric.id, name: '导出成就', operator: 'gte',
        threshold: '1', history_policy: 'include_existing'
      });
      const occurredAt = new Date().toISOString();
      const confirmed = await ok('POST', 'records', {
        id: randomUUID(), module_id: moduleId, record_type_id: recordTypeId, schema_version: 1, occurred_at: occurredAt,
        timezone: 'Asia/Shanghai', status: 'confirmed', values: { topic: '已确认记录', duration_minutes: 20 }, task_ids: [taskId]
      });
      confirmedId = confirmed.id;
      const draft = await ok('POST', 'records', {
        id: randomUUID(), module_id: moduleId, record_type_id: recordTypeId, schema_version: 1, occurred_at: occurredAt,
        timezone: 'Asia/Shanghai', status: 'draft', values: { topic: '未确认草稿', duration_minutes: null }, task_ids: []
      });
      draftId = draft.id;
      const doomed = await ok('POST', 'records', {
        id: randomUUID(), module_id: moduleId, record_type_id: recordTypeId, schema_version: 1, occurred_at: occurredAt,
        timezone: 'Asia/Shanghai', status: 'confirmed', values: { topic: '将被软删除', duration_minutes: 5 }, task_ids: []
      });
      deletedId = doomed.id;
      await ok('DELETE', `records/${deletedId}`, { base_version: 1 });
      const bootstrap = await ok('GET', 'bootstrap');
      assert.equal(bootstrap.tasks.find((task: any) => task.id === taskId).status, 'completed');
      assert.equal(bootstrap.achievement_awards.length, 1);
      assert.equal(bootstrap.metrics.find((metric: any) => metric.definition.name === '导出累计次数').computed.value, '1');
    });

    await t.test('export is versioned, checksummed and contains no session/credential material', async () => {
      backup = await ok('GET', 'export');
      assert.equal(backup.format, 'life-dashboard-user-export');
      assert.equal(backup.schema_version, 1);
      assert.equal(backup.contract_version, '0.2.0');
      assert.equal((backup.user as any).id, LOCAL_USER_ID);
      assert.match(backup.checksum, /^[a-f0-9]{64}$/);
      assert.ok(backup.migrations.length >= 2);
      assert.equal(backup.counts.modules, 5);
      assert.equal(backup.counts.records, 3, 'confirmed + draft + soft-deleted records are exported');
      assert.ok(backup.counts.mutation_receipts >= 7, 'idempotency receipts are preserved for replay safety');
      assert.equal(backup.counts.change_log > 0, true);
      validateBackup(backup);
      const text = JSON.stringify(backup);
      assert.ok(!text.includes('life_session'));
      assert.ok(!('sessions' in backup.data));
      assert.ok(!('ai_generation_jobs' in backup.data));
      assert.ok(!/login_secret/i.test(text));
      assert.deepEqual(backup.migrations.map((m: any) => m.name), ['0001_core.sql', '0002_ai.sql', '0003_v02_phase1.sql', '0004_v02_phase2.sql']);
    });

    await t.test('export only contains the authenticated user rows', async () => {
      const other = randomUUID();
      await pool.query("INSERT INTO users(id,name) VALUES($1,'other')", [other]);
      await pool.query("INSERT INTO modules(id,user_id,name,icon,color) VALUES($1,$2,'其他用户模块','book','blue')", [randomUUID(), other]);
      const again = await ok('GET', 'export');
      for (const table of ['modules', 'record_types', 'tasks', 'records', 'metric_definitions', 'achievement_definitions', 'achievement_awards', 'change_log']) {
        for (const row of again.data[table]) {
          if (table === 'users') continue;
          assert.ok(!('user_id' in row) || row.user_id === LOCAL_USER_ID, `${table} leaked another user`);
        }
      }
      assert.equal(again.counts.modules, backup.counts.modules);
      assert.equal(again.data.users.length, 1);
      const otherBackup = await exportUserData(pool, other);
      assert.equal((otherBackup.user as any).id, other);
      assert.equal(otherBackup.counts.modules, 1);
    });

    await t.test('isolated restore reproduces facts, derived state and receipts', async () => {
      (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));
      const result = await restoreUserData(pool, backup);
      assert.equal(result.user_id, LOCAL_USER_ID);
      assert.equal(result.cursor, backup.cursor);
      assert.deepEqual(result.counts, backup.counts);
      await login();
      const bootstrap = await ok('GET', 'bootstrap');
      assert.equal(bootstrap.modules.length, 5);
      assert.equal(bootstrap.record_types.length, 5);
      assert.equal(bootstrap.tasks.length, 1);
      assert.equal(bootstrap.tasks[0].status, 'completed');
      assert.equal(bootstrap.records.length, 2, 'soft-deleted record stays deleted after restore');
      assert.ok(bootstrap.records.some((record: any) => record.id === confirmedId));
      assert.ok(bootstrap.records.some((record: any) => record.id === draftId));
      const metric = bootstrap.metrics.find((row: any) => row.definition.name === '导出累计次数');
      assert.equal(metric.computed.value, '1');
      assert.equal(bootstrap.achievement_awards.length, 1);
      assert.equal(bootstrap.achievement_awards[0].state, 'unlocked');
      const deleted = await pool.query('SELECT deleted_at FROM records WHERE id=$1', [deletedId]);
      assert.ok(deleted.rows[0].deleted_at, 'tombstone is preserved for sync safety');
      const revisions = await pool.query('SELECT count(*)::int AS n FROM record_revisions WHERE user_id=$1', [LOCAL_USER_ID]);
      assert.ok(revisions.rows[0].n >= 1);
      const receipts = await pool.query('SELECT count(*)::int AS n FROM mutation_receipts WHERE user_id=$1', [LOCAL_USER_ID]);
      assert.equal(receipts.rows[0].n, backup.counts.mutation_receipts);
      const reExported = await ok('GET', 'export');
      assert.deepEqual(stripMeta(reExported), stripMeta(backup), 'restored data must re-export identically');
    });

    await t.test('restore refuses non-empty targets, tampered files and mismatched migrations', async () => {
      await assert.rejects(() => restoreUserData(pool, backup), (error: any) => error instanceof BackupError && error.code === 'NON_EMPTY_TARGET');
      const tampered = JSON.parse(JSON.stringify(backup));
      tampered.data.modules[0].name = '被篡改';
      await assert.rejects(() => restoreUserData(pool, tampered), (error: any) => error instanceof BackupError && error.code === 'CHECKSUM_MISMATCH');
      const wrongSchema = JSON.parse(JSON.stringify(backup));
      wrongSchema.migrations.push({ name: '9999_fake.sql', checksum: '0'.repeat(64) });
      delete wrongSchema.checksum;
      wrongSchema.checksum = backupChecksum(wrongSchema as any);
      await assert.rejects(() => restoreUserData(pool, wrongSchema), (error: any) => error instanceof BackupError && error.code === 'MIGRATION_MISMATCH');
    });

    await t.test('a failed restore rolls back completely', async () => {
      const broken = JSON.parse(JSON.stringify(backup)) as UserDataBackup;
      broken.data.records[0].module_id = randomUUID();
      delete (broken as any).checksum;
      (broken as any).checksum = backupChecksum(broken as any);
      (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));
      await assert.rejects(() => restoreUserData(pool, broken));
      const users = await pool.query('SELECT count(*)::int AS n FROM users');
      assert.equal(users.rows[0].n, 0, 'failed restore must leave the target empty');
      const restored = await restoreUserData(pool, backup);
      assert.equal(restored.user_id, LOCAL_USER_ID);
    });
  } finally {
    await pool.end();
  }
});
