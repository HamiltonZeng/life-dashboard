import {guardSynthetic} from '../v02-phase3/guard.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { buildApp } from '../../apps/api/src/app.js';
import { createPool } from '../../packages/db/src/client.js';
import { seed, DEFAULT_MODULE_IDS, DEFAULT_TEMPLATE_IDS } from '../../packages/db/src/seed.js';
import { stubAdapter, AiProviderError } from '../../packages/ai/src/adapter.js';
import { loadAiConfig } from '../../packages/ai/src/config.js';
import { exampleBlueprint, extendBlueprint, clone, ALL_CONTENT } from '../ai/fixtures.js';

test('T2/T3 AI generation acceptance (PostgreSQL)', async t => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.DATABASE_NAME, 'life_dashboard_v03_test', 'Refuse to touch a non-test database');
  assert.equal(process.env.DATABASE_HOST, 'postgres-test');
  const pool = createPool();
  (guardSynthetic(),await pool.query('TRUNCATE users CASCADE'));
  await seed(pool);
  const origin = 'http://localhost:18380';
  let cookie = '';
  const app = await buildApp(pool);
  const req = (target: any, method: string, path: string, payload?: unknown, key: string = randomUUID(), headers: Record<string, string> = {}) =>
    target.inject({ method: method as any, url: '/api/v1/' + path, headers: { origin, cookie, 'idempotency-key': key, ...headers }, payload });
  const ok = async (target: any, method: string, path: string, payload?: unknown, key: string = randomUUID()) => {
    const response = await req(target, method, path, payload, key);
    assert.equal(response.statusCode, 200, `${method} ${path}: ${response.body}`);
    return response.json().data;
  };
  const bootstrap = async (target: any = app) => ok(target, 'GET', 'bootstrap');
  const page = async (target: any, path: string) => (await req(target, 'GET', path)).json();
  const counts = async (target: any = app) => {
    const b = await bootstrap(target);
    return { modules: b.modules.length, record_types: b.record_types.length, tasks: b.tasks.length, records: b.records.length, metrics: b.metrics.length, achievements: b.achievement_definitions.length, awards: b.achievement_awards.length };
  };
  const createBody = {
    mode: 'create', module_id: null, prompt: '设计一个编程练习模块',
    content_types: ALL_CONTENT, apply_mode: 'preview', timezone: 'Asia/Shanghai',
    reference: { record_type_ids: [], metric_ids: [] }
  };
  const createKey = randomUUID();
  let batch1: any = null;
  let job1: any = null;
  let mockRecordId = '';

  try {
    await t.test('AI endpoints require a session and reject cross-origin writes', async () => {
      assert.equal((await app.inject({ method: 'GET', url: '/api/v1/ai/config' })).statusCode, 401);
      const login = await app.inject({ method: 'POST', url: '/api/v1/session', headers: { origin }, payload: { login_secret: process.env.LOCAL_LOGIN_SECRET } });
      assert.equal(login.statusCode, 200, login.body);
      cookie = String(login.headers['set-cookie']).split(';')[0];
      const noOrigin = await app.inject({ method: 'POST', url: '/api/v1/ai/generations', headers: { cookie, 'idempotency-key': randomUUID() }, payload: createBody });
      assert.equal(noOrigin.statusCode, 403);
      const noKey = await app.inject({ method: 'POST', url: '/api/v1/ai/generations', headers: { origin, cookie }, payload: createBody });
      assert.equal(noKey.statusCode, 400);
      assert.equal((await ok(app, 'GET', 'ai/config')).provider, 'mock');
    });

    await t.test('config and capabilities are honest about the mock provider', async () => {
      const config = (await ok(app, 'GET', 'ai/config'));
      assert.equal(config.provider, 'mock');
      assert.equal(config.cloud_ai, false);
      assert.equal(config.configured, true);
      assert.equal(config.schema_version, '1.0');
      assert.deepEqual(config.supported_content_types, ALL_CONTENT);
      assert.ok(!JSON.stringify(config).includes('apiKey'));
      assert.ok(!JSON.stringify(config).includes('sk-'));
      const capabilities = (await ok(app, 'GET', 'capabilities'));
      assert.equal(capabilities.contract_version, '0.2.0');
      assert.equal(capabilities.stage, 'T2/T3-ai');
      assert.equal(capabilities.ai_generation, true);
      assert.equal(capabilities.ai_provider, 'mock');
      assert.equal(capabilities.ai_schema_version, '1.0');
      assert.equal(capabilities.cloud_ai, false);
      assert.equal(capabilities.recurring_tasks, true);
    });

    await t.test('preview keeps a candidate without writing configuration (P12/P13 boundary)', async () => {
      const before = await counts();
      const env = await ok(app, 'POST', 'ai/generations', createBody, createKey);
      job1 = env.job;
      assert.equal(env.job.status, 'preview_ready');
      assert.equal(env.job.candidate.module.name, '设计一个编程练习模块');
      assert.equal(env.batch, null);
      assert.equal(env.already_applied, false);
      const detail = await ok(app, 'GET', `ai/generations/${job1.id}`);
      assert.equal(detail.job.status, 'preview_ready');
      assert.ok(detail.job.validation.valid);
      assert.equal(detail.job.provider, 'mock');
      assert.equal((await counts()).modules, before.modules);
      assert.equal((await counts()).records, 0);
      const list = await page(app, 'ai/generations?limit=10');
      assert.ok(Array.isArray(list.data));
      assert.ok(list.page.total >= 1);
      assert.equal(list.data[0].candidate, null);
    });

    await t.test('duplicate generation requests reuse the same job and reject payload reuse', async () => {
      const replay = await ok(app, 'POST', 'ai/generations', createBody, createKey);
      assert.equal(replay.job.id, job1.id);
      assert.equal((await page(app, 'ai/generations?limit=50')).page.total, 1);
      const conflict = await req(app, 'POST', 'ai/generations', { ...createBody, prompt: '另一个需求' }, createKey);
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, 'IDEMPOTENCY_MISMATCH');
      assert.equal((await app.inject({ method: 'POST', url: '/api/v1/ai/generations', headers: { origin, cookie, 'idempotency-key': randomUUID() }, payload: { ...createBody, model: 'attacker-model' } })).statusCode, 400);
    });

    await t.test('apply creates the whole blueprint atomically with correct references (P12/P21)', async () => {
      const before = await counts();
      const env = await ok(app, 'POST', `ai/generations/${job1.id}/apply`, { base_module_version: null });
      assert.equal(env.job.status, 'applied');
      assert.equal(env.already_applied, false);
      batch1 = env.batch;
      assert.equal(batch1.module_created, true);
      assert.equal(batch1.status, 'applied');
      assert.equal(batch1.summary.module, 1);
      assert.equal(batch1.summary.record_type, 1);
      assert.equal(batch1.summary.metric, 2);
      assert.equal(batch1.summary.task, 1);
      assert.equal(batch1.summary.achievement, 2);
      const after = await counts();
      assert.equal(after.modules, before.modules + 1);
      assert.equal(after.record_types, before.record_types + 1);
      assert.equal(after.metrics, before.metrics + 2);
      assert.equal(after.tasks, before.tasks + 1);
      assert.equal(after.achievements, before.achievements + 2);
      assert.equal(after.records, 0, 'AI apply must not create factual records');
      const b = await bootstrap();
      const module = b.modules.find((m: any) => m.id === batch1.module_id);
      assert.equal(module.source, 'ai');
      const task = b.tasks.find((t: any) => t.module_id === batch1.module_id);
      assert.equal(task.definition.completion_mode, 'record_required');
      assert.equal(task.definition.acceptance.kind, 'field_gte');
      assert.equal(task.definition.acceptance.threshold, '10');
      assert.equal(task.definition.record_type_id, batch1.objects.find((o: any) => o.kind === 'record_type').id);
      const metrics = b.metrics.filter((m: any) => m.module_id === batch1.module_id);
      assert.equal(metrics.find((m: any) => m.definition.aggregation === 'sum').computed.value, null);
      const localRefs = batch1.objects.map((o: any) => o.local_ref);
      assert.equal(new Set(localRefs).size, localRefs.length);
      const rtObject = batch1.objects.find((o: any) => o.kind === 'record_type');
      assert.equal(batch1.id_map[rtObject.local_ref].id, rtObject.id);
      assert.equal(rtObject.id, task.definition.record_type_id);
    });

    await t.test('records drive periodic achievements and task completion after apply', async () => {
      const task = (await bootstrap()).tasks.find((t: any) => t.module_id === batch1.module_id);
      const recordTypeId = batch1.objects.find((o: any) => o.kind === 'record_type').id;
      const occurred = new Date().toISOString();
      const record = await ok(app, 'POST', 'records', {
        id: randomUUID(), module_id: batch1.module_id, record_type_id: recordTypeId, schema_version: 1,
        occurred_at: occurred, timezone: 'Asia/Shanghai', status: 'confirmed',
        values: { topic: '实际练习', duration_minutes: 30, reflection: null }, task_ids: [task.id]
      });
      assert.equal(record.id.length, 36);
      mockRecordId = record.id;
      const b = await bootstrap();
      assert.equal(b.records.length, 1);
      assert.equal(b.records[0].module_id, batch1.module_id, 'record stays in the AI-created module');
      const refreshed = b.tasks.find((t: any) => t.id === task.id);
      assert.equal(refreshed.status, 'completed');
      const weekly = b.metrics.find((m: any) => m.module_id === batch1.module_id && m.definition.aggregation === 'sum');
      assert.equal(weekly.computed.value, '30');
      const awards = b.achievement_awards.filter((a: any) => a.period_key !== 'once');
      assert.ok(awards.length >= 1, 'per_period achievement should create a period-scoped award');
      assert.match(awards[0].period_key, /^\d{4}-\d{2}-\d{2}$/);
      const once = b.achievement_awards.find((a: any) => a.period_key === 'once');
      assert.ok(once, 'once achievement should still be awarded');
    });

    await t.test('repeated apply is idempotent: one batch, no duplicate configuration (P15)', async () => {
      const before = await counts();
      const env = await ok(app, 'POST', `ai/generations/${job1.id}/apply`, { base_module_version: null });
      assert.equal(env.already_applied, true);
      assert.equal(env.batch.id, batch1.id);
      assert.deepEqual(await counts(), before);
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM ai_generation_batches WHERE user_id=(SELECT user_id FROM ai_generation_jobs WHERE id=$1) AND job_id=$1', [job1.id])).rows[0].n, 1);
    });

    await t.test('deleting evidence re-evaluates past-period achievements (P08/D1)', async () => {
      const perPeriod = (await pool.query("SELECT id FROM achievement_definitions WHERE module_id=$1 AND definition->>'repeat_policy'='per_period'", [batch1.module_id])).rows[0];
      assert.ok(perPeriod, 'mock blueprint should create a per_period achievement');
      const moved = await pool.query(
        "UPDATE achievement_awards SET period_key=to_char(date_trunc('week', now() - interval '7 days'),'YYYY-MM-DD'), original_evidence=jsonb_set(original_evidence,'{evaluated_at}',to_jsonb((date_trunc('week', now() - interval '7 days') + interval '2 days')::text)) WHERE achievement_id=$1 RETURNING *",
        [perPeriod.id]
      );
      assert.equal(moved.rowCount, 1, 'current-period award moved to a past period for the test');
      const deleted = await ok(app, 'DELETE', `records/${mockRecordId}`, { base_version: 1 });
      assert.ok(deleted.deleted_at);
      const award = (await pool.query('SELECT state,evidence FROM achievement_awards WHERE achievement_id=$1', [perPeriod.id])).rows[0];
      assert.equal(award.state, 'needs_review', 'past-period award must be re-evaluated after its evidence is deleted');
      assert.equal(award.evidence.value, null);
    });

    await t.test('module version changes keep the candidate and refuse a stale apply (P16)', async () => {
      const targetModule = DEFAULT_MODULE_IDS[0];
      const stub = await buildApp(pool, { aiAdapter: stubAdapter([JSON.stringify(extendBlueprint())]) });
      const env = await ok(stub, 'POST', 'ai/generations', {
        mode: 'extend', module_id: targetModule, prompt: '给学习模块加一个记录模板与周期成就',
        content_types: ALL_CONTENT, apply_mode: 'preview', timezone: 'Asia/Shanghai',
        reference: { record_type_ids: [DEFAULT_TEMPLATE_IDS[0]], metric_ids: [] }
      });
      assert.equal(env.job.status, 'preview_ready');
      assert.equal(env.job.target_base_version, 1);
      const before = await counts();
      const patched = await ok(app, 'PATCH', `modules/${targetModule}`, { base_version: 1, name: '学习与发展（已改名）' });
      assert.equal(patched.version, 2);
      const conflict = await req(app, 'POST', `ai/generations/${env.job.id}/apply`, { base_module_version: 1 });
      assert.equal(conflict.statusCode, 409);
      assert.equal(conflict.json().error.code, 'MODULE_CONFLICT');
      assert.equal(conflict.json().error.details.expected_version, 1);
      assert.equal(conflict.json().error.details.current_version, 2);
      assert.deepEqual(await counts(), before);
      const detail = await ok(app, 'GET', `ai/generations/${env.job.id}`);
      assert.equal(detail.job.status, 'needs_fix');
      assert.equal(detail.job.error.code, 'MODULE_CONFLICT');
      assert.ok(detail.job.candidate, 'candidate is retained for inspection');
      const archivedModule = await ok(app, 'PATCH', `modules/${targetModule}`, { base_version: 2, status: 'archived' });
      assert.equal(archivedModule.status, 'archived');
      const archivedConflict = await req(app, 'POST', `ai/generations/${env.job.id}/apply`, { base_module_version: 1 });
      assert.equal(archivedConflict.statusCode, 409);
      assert.equal(archivedConflict.json().error.code, 'MODULE_CONFLICT');
      assert.ok((await counts()).modules >= 5, 'archived module is retained, not deleted');
    });

    await t.test('model output with unknown references is rejected without partial writes (P13)', async () => {
      const bad = clone();
      bad.achievements[0].condition.metric_ref = `id:${randomUUID()}`;
      const stub = await buildApp(pool, { aiAdapter: stubAdapter([JSON.stringify(bad)]) });
      const before = await counts();
      const response = await req(stub, 'POST', 'ai/generations', { ...createBody, apply_mode: 'apply' });
      assert.equal(response.statusCode, 422, response.body);
      const error = response.json().error;
      assert.equal(error.code, 'BLUEPRINT_NOT_ALLOWED');
      assert.ok(error.details.job_id);
      assert.ok(error.details.errors.some((i: any) => i.code === 'UNKNOWN_METRIC_REF'));
      assert.deepEqual(await counts(), before);
      const detail = await ok(app, 'GET', `ai/generations/${error.details.job_id}`);
      assert.equal(detail.job.status, 'needs_fix');
      assert.equal(detail.job.validation.valid, false);
    });

    await t.test('model output with factual or privileged fields is rejected (P14)', async () => {
      const forbidden = { ...clone(), records: [{ id: randomUUID(), module_id: batch1.module_id }] };
      const stub = await buildApp(pool, { aiAdapter: stubAdapter([JSON.stringify(forbidden)]) });
      const before = await counts();
      const response = await req(stub, 'POST', 'ai/generations', { ...createBody, apply_mode: 'apply' });
      assert.equal(response.statusCode, 422, response.body);
      assert.equal(response.json().error.code, 'BLUEPRINT_INVALID');
      assert.deepEqual(await counts(), before);

      const unlocked = clone();
      (unlocked.achievements[0] as any).unlocked = true;
      const stub2 = await buildApp(pool, { aiAdapter: stubAdapter([JSON.stringify(unlocked)]) });
      const response2 = await req(stub2, 'POST', 'ai/generations', { ...createBody, apply_mode: 'apply' });
      assert.equal(response2.statusCode, 422, response2.body);
      assert.deepEqual(await counts(), before);
    });

    await t.test('provider failures are explicit and manual features keep working (P18)', async () => {
      const stub = await buildApp(pool, { aiAdapter: stubAdapter([new AiProviderError('AI_QUOTA', 'DeepSeek account balance is insufficient', false)]) });
      const response = await req(stub, 'POST', 'ai/generations', { ...createBody, apply_mode: 'apply' });
      assert.equal(response.statusCode, 503, response.body);
      assert.equal(response.json().error.code, 'AI_QUOTA');
      assert.equal(response.json().error.details.retryable, false);
      const job = await ok(app, 'GET', `ai/generations/${response.json().error.details.job_id}`);
      assert.equal(job.job.status, 'failed');
      const manual = await ok(app, 'POST', 'records', {
        id: randomUUID(), module_id: DEFAULT_MODULE_IDS[1], record_type_id: DEFAULT_TEMPLATE_IDS[1], schema_version: 1,
        occurred_at: new Date().toISOString(), timezone: 'Asia/Shanghai', status: 'confirmed',
        values: { topic: '手动记录仍然可用' }, task_ids: []
      });
      assert.equal(manual.status, 'confirmed');
      assert.equal((await counts()).records, 1);
    });

    await t.test('failed validation can be retried with the same job and attempt accounting', async () => {
      const stub = await buildApp(pool, {
        aiAdapter: stubAdapter(['Not JSON at all', JSON.stringify(exampleBlueprint)])
      });
      const first = await req(stub, 'POST', 'ai/generations', { ...createBody, apply_mode: 'apply' });
      assert.equal(first.statusCode, 422);
      const jobId = first.json().error.details.job_id;
      const before = await counts();
      const retried = await ok(app, 'POST', `ai/generations/${jobId}/retry`);
      assert.equal(retried.job.status, 'applied');
      assert.equal(retried.job.attempts, 2);
      assert.equal(retried.batch.status, 'applied');
      assert.equal((await counts()).modules, before.modules + 1);
      const batchId = retried.batch.id;
      const revoke = await ok(app, 'POST', `ai/batches/${batchId}/revoke`);
      assert.equal(revoke.revoke.mode, 'deleted');
      assert.equal(revoke.batch.status, 'revoked');
      assert.deepEqual(await counts(), before);
      const again = await ok(app, 'POST', `ai/batches/${batchId}/revoke`);
      assert.equal(again.revoke.mode, 'deleted');
    });

    await t.test('revoking a referenced batch archives configuration but keeps real records (P17)', async () => {
      const aiMetricId = batch1.objects.find((o: any) => o.kind === 'metric').id;
      const external = await ok(app, 'POST', 'achievements', {
        id: randomUUID(), module_id: batch1.module_id, metric_id: aiMetricId, name: '外部依赖成就',
        operator: 'gte', threshold: '1', history_policy: 'include_existing'
      });
      const batchTask = (await bootstrap()).tasks.find((t: any) => t.module_id === batch1.module_id);
      const batchRecordType = batch1.objects.find((o: any) => o.kind === 'record_type').id;
      const restored = await ok(app, 'POST', 'records', {
        id: randomUUID(), module_id: batch1.module_id, record_type_id: batchRecordType, schema_version: 1,
        occurred_at: new Date().toISOString(), timezone: 'Asia/Shanghai', status: 'confirmed',
        values: { topic: '复核后重新记录', duration_minutes: 30, reflection: null }, task_ids: [batchTask.id]
      });
      const before = await counts();
      assert.ok(before.records >= 1);
      const revoke = await ok(app, 'POST', `ai/batches/${batch1.id}/revoke`);
      assert.equal(revoke.revoke.mode, 'archived');
      assert.equal(revoke.batch.status, 'revoked');
      assert.ok(revoke.batch.revoke_mode === 'archived');
      const b = await bootstrap();
      assert.equal(b.records.length, before.records, 'real records are never cascade deleted');
      const module = b.modules.find((m: any) => m.id === batch1.module_id);
      assert.equal(module.status, 'archived');
      const task = b.tasks.find((t: any) => t.module_id === batch1.module_id);
      assert.equal(task.status, 'cancelled');
      assert.equal(b.metrics.filter((m: any) => m.module_id === batch1.module_id).length, 0);
      assert.equal(b.achievement_definitions.filter((a: any) => a.module_id === batch1.module_id).length, 0);
      assert.ok(b.achievement_awards.length >= 2, 'history of awards is retained');
      const dependent = (await pool.query('SELECT archived_at FROM achievement_definitions WHERE id=$1', [external.id])).rows[0];
      assert.ok(dependent.archived_at, 'an external achievement on an AI metric is archived with the batch');
      assert.ok(!b.achievement_definitions.some((a: any) => a.id === external.id));
      const keptRecord = b.records.find((r: any) => r.id === restored.id);
      assert.equal((await ok(app, 'GET', `records/${keptRecord.id}`)).module_id, batch1.module_id);
      assert.equal((await ok(app, 'GET', 'records')).find((r: any) => r.id === restored.id).id, restored.id);
    });

    await t.test('daily job budget is enforced without affecting manual use', async () => {
      const budgetConfig = { ...loadAiConfig(), dailyJobLimit: 1 };
      const stub = await buildApp(pool, { aiConfig: budgetConfig, aiAdapter: stubAdapter([JSON.stringify(exampleBlueprint)]) });
      const response = await req(stub, 'POST', 'ai/generations', { ...createBody, apply_mode: 'preview' });
      assert.equal(response.statusCode, 429, response.body);
      assert.equal(response.json().error.code, 'AI_BUDGET_EXCEEDED');
      assert.equal((await app.inject('/health/ready')).statusCode, 200);
    });

    await t.test('AI tables are isolated per user and expose no cross-user rows', async () => {
      const outsider = randomUUID();
      await pool.query("INSERT INTO users(id,name) VALUES($1,'other')", [outsider]);
      const otherToken = 'a'.repeat(64);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [createHash('sha256').update(otherToken).digest('hex'), outsider]);
      const otherCookie = 'life_session=' + otherToken;
      const other = await app.inject({ method: 'GET', url: '/api/v1/ai/generations', headers: { cookie: otherCookie } });
      assert.equal(other.statusCode, 200);
      assert.equal(other.json().data.length, 0);
      const otherConfig = await app.inject({ method: 'GET', url: '/api/v1/ai/batches', headers: { cookie: otherCookie } });
      assert.equal(otherConfig.json().data.length, 0);
      const jobAccess = await app.inject({ method: 'GET', url: `/api/v1/ai/generations/${job1.id}`, headers: { cookie: otherCookie } });
      assert.equal(jobAccess.statusCode, 404);
    });
  } finally {
    await pool.end();
  }
});
