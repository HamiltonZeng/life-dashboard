import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BlueprintError, extractJsonObject, parseBlueprint, type Blueprint } from '../../packages/ai/src/blueprint.js';
import { validateBlueprint, type ValidationContext } from '../../packages/ai/src/validate.js';
import { buildApplyPlan } from '../../packages/ai/src/plan.js';
import { MockAdapter, stubAdapter, AiProviderError } from '../../packages/ai/src/adapter.js';
import { buildGenerationPrompt } from '../../packages/ai/src/prompt.js';
import { loadAiConfig } from '../../packages/ai/src/config.js';
import {
  ALL_CONTENT, clone, createContext, exampleBlueprint, extendBlueprint, extendContext, field, issueCodes
} from './fixtures.js';
import type { PromptContext } from '../../packages/ai/src/prompt.js';

function expectIssue(fn: () => unknown, code: string) {
  const codes = issueCodes(fn);
  assert.ok(codes.includes(code), `expected ${code}, got ${codes.join(',')}`);
}

test('module blueprint 1.0 example validates and plans every supported content kind', () => {
  const blueprint = parseBlueprint(exampleBlueprint);
  const validated = validateBlueprint(blueprint, createContext());
  assert.ok(validated.warnings.length > 0);
  let n = 0;
  const plan = buildApplyPlan(blueprint, createContext(), () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  });
  assert.equal(plan.module_created, true);
  assert.equal(plan.summary.module, 1);
  assert.equal(plan.summary.record_type, 1);
  assert.equal(plan.summary.metric, 2);
  assert.equal(plan.summary.task, 1);
  assert.equal(plan.summary.achievement, 1);
  assert.equal(new Set(plan.objects.map(o => o.id)).size, plan.objects.length);
  const sum = plan.metrics[0];
  assert.equal(sum.definition.aggregation, 'sum');
  assert.equal(sum.definition.field_key, 'duration_minutes');
  assert.equal(sum.definition.unit, '分钟');
  assert.equal(sum.definition.timezone, 'Asia/Shanghai');
  const count = plan.metrics[1];
  assert.equal(count.definition.field_key, null);
  assert.equal(plan.record_types[0].module_id, plan.target_module_id);
  assert.equal(plan.tasks[0].definition.acceptance?.kind, 'field_gte');
  assert.equal((plan.tasks[0].definition.acceptance as any).threshold, '10');
  assert.equal(plan.tasks[0].definition.business_date, null);
  assert.equal(plan.achievements[0].definition.threshold, '1');
  assert.equal(plan.achievements[0].definition.repeat_policy, 'once');
});

test('the shipped design example (checksum-pinned copy) validates and plans end to end (P21)', () => {
  const text = readFileSync(new URL('./design-example.json', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(text).digest('hex'), 'dfec5a8b62c3cf26f69f73b3a2a269a17804dd09f2fc22f6ce9952972d224e58');
  const blueprint = parseBlueprint(JSON.parse(text));
  validateBlueprint(blueprint, createContext());
  const plan = buildApplyPlan(blueprint, createContext());
  assert.equal(plan.summary.record_type, 1);
  assert.equal(plan.summary.metric, 2);
  assert.equal(plan.summary.task, 1);
  assert.equal(plan.summary.achievement, 1);
  assert.equal((plan.tasks[0].definition.acceptance as any).threshold, '10');
});

test('local mock stays valid for unitless and minimum-bounded numeric fields (D2)', async () => {
  const run = async (scoreMinimum: number, scoreMaximum: number | null, expectedThreshold: number) => {
    const recordTypeId = '20000000-0000-4000-8000-000000000009';
    const recordType = {
      id: recordTypeId, name: '无单位模板',
      fields: [field('topic', 'text'), field('score', 'decimal', { unit: null, minimum: scoreMinimum, maximum: scoreMaximum })]
    };
    const context: ValidationContext = {
      mode: 'extend', targetModuleId: '10000000-0000-4000-8000-000000000001',
      targetModule: { id: '10000000-0000-4000-8000-000000000001', name: '学习与发展', version: 1, status: 'enabled', icon: 'book', color: 'blue' },
      recordTypes: new Map([[recordTypeId, recordType]]), metrics: new Map(),
      allowedRecordTypeIds: new Set([recordTypeId]), allowedMetricIds: new Set(),
      contentTypes: new Set(['metrics', 'tasks']), timezone: 'Asia/Shanghai'
    };
    const promptContext: PromptContext = {
      mode: 'extend', targetModuleId: context.targetModuleId, targetModuleName: '学习与发展',
      targetModuleIcon: 'book', targetModuleColor: 'blue', timezone: 'Asia/Shanghai',
      contentTypes: ['metrics', 'tasks'], prompt: '练习记录',
      allowedRecordTypes: [recordType], allowedMetrics: []
    };
    const result = await new MockAdapter().generate({ system: 's', user: 'u', context: promptContext, maxOutputTokens: 10, timeoutMs: 10 });
    const blueprint = parseBlueprint(extractJsonObject(result.text));
    validateBlueprint(blueprint, context);
    assert.ok(blueprint.metrics.every(m => m.source.aggregation === 'count'), 'unitless numeric field cannot be a sum source');
    assert.equal(blueprint.tasks[0].record_binding!.acceptance.threshold, expectedThreshold);
  };
  await run(20, 40, 20);
  await run(20, null, 20);
  await run(100, null, 100);
});

test('extend mode maps existing references, once scheduling and periodic achievements', () => {
  const blueprint = parseBlueprint(extendBlueprint());
  const validated = validateBlueprint(blueprint, extendContext());
  assert.ok(validated.blueprint.tasks[0].schedule.start_date);
  const plan = buildApplyPlan(blueprint, extendContext());
  assert.equal(plan.module_created, false);
  assert.equal(plan.module, null);
  assert.equal(plan.base_module_version, 1);
  assert.equal(plan.record_types.length, 0);
  assert.equal(plan.metrics[0].record_type_id, '20000000-0000-4000-8000-000000000001');
  assert.equal(plan.tasks[0].definition.business_date, '2026-10-20');
  assert.equal((plan.tasks[0].definition.acceptance as any).threshold, '15');
  assert.equal(plan.achievements[0].definition.repeat_policy, 'per_period');
  assert.equal(plan.achievements[0].definition.metric_id, plan.metrics[0].id);
});

test('structure layer rejects unknown fields and forbidden factual fields', () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ ...exampleBlueprint, records: [] }, 'UNRECOGNIZED_KEYS'],
    [{ ...exampleBlueprint, schema_version: '2.0' }, 'INVALID_VALUE'],
    [{ ...exampleBlueprint, kind: 'fact_extraction' }, 'INVALID_VALUE'],
    [{ ...exampleBlueprint, module: { ...(exampleBlueprint.module as any), completed: true } }, 'UNRECOGNIZED_KEYS'],
    [{ ...exampleBlueprint, tasks: [{ ...(exampleBlueprint.tasks[0] as any), completed: true }] }, 'UNRECOGNIZED_KEYS'],
    [{ ...exampleBlueprint, achievements: [{ ...(exampleBlueprint.achievements[0] as any), unlocked: true }] }, 'UNRECOGNIZED_KEYS'],
    [{ ...exampleBlueprint, user_id: randomUUID() }, 'UNRECOGNIZED_KEYS'],
    [{ ...exampleBlueprint, module: { ...(exampleBlueprint.module as any), local_ref: 'lesson' } }, 'INVALID_FORMAT']
  ];
  for (const [raw, code] of cases) {
    const codes = issueCodes(() => parseBlueprint(raw));
    assert.ok(codes.includes(code), `expected ${code}, got ${codes.join(',')}`);
  }
  expectIssue(() => parseBlueprint('not an object'), 'INVALID_JSON_OBJECT');
  expectIssue(() => parseBlueprint([exampleBlueprint]), 'INVALID_JSON_OBJECT');
});

test('semantic layer rejects invalid references, units, bindings, schedules and periods', () => {
  const mutate = (fn: (b: Blueprint) => void, ctx = createContext()) => {
    const b = clone();
    fn(b);
    return () => {
      const parsed = parseBlueprint(b);
      validateBlueprint(parsed, ctx);
    };
  };
  expectIssue(mutate(b => { b.metrics[1].local_ref = b.record_types[0].local_ref; }), 'DUPLICATE_LOCAL_REF');
  expectIssue(mutate(b => { b.metrics[1].source.field_key = 'topic'; }), 'COUNT_REQUIRES_NULL_FIELD');
  expectIssue(mutate(b => { b.metrics[0].source.field_key = null; }), 'MISSING_METRIC_FIELD');
  expectIssue(mutate(b => { b.metrics[0].source.field_key = 'topic'; }), 'NON_NUMERIC_METRIC_FIELD');
  expectIssue(mutate(b => { b.metrics[0].unit = '次'; }), 'UNIT_MISMATCH');
  expectIssue(mutate(b => { b.metrics[0].source.record_type_ref = 'local:missing'; }), 'UNKNOWN_LOCAL_RECORD_TYPE_REF');
  expectIssue(mutate(b => { b.tasks[0].completion_mode = 'manual'; }), 'MANUAL_HAS_BINDING');
  expectIssue(mutate(b => { b.tasks[0].record_binding = null; }), 'MISSING_RECORD_BINDING');
  expectIssue(mutate(b => { (b.tasks[0].record_binding!.acceptance as any).threshold = 5000; }), 'THRESHOLD_OUT_OF_BOUNDS');
  expectIssue(mutate(b => { (b.tasks[0].record_binding!.acceptance as any).kind = 'exists'; }), 'EXISTS_HAS_THRESHOLD');
  expectIssue(mutate(b => { b.record_types[0].fields[0].options = ['x']; }), 'UNEXPECTED_FIELD_OPTIONS');
  expectIssue(mutate(b => {
    b.record_types[0].fields[0] = { key: 'topic', label: '内容', type: 'single_select', required: true, unit: null, options: [], minimum: null, maximum: null };
  }), 'MISSING_FIELD_OPTIONS');
  expectIssue(mutate(b => { b.record_types[0].fields[1].minimum = 100; b.record_types[0].fields[1].maximum = 10; }), 'INVALID_FIELD_BOUNDS');
  expectIssue(mutate(b => { b.record_types[0].fields.push({ ...b.record_types[0].fields[0] }); }), 'DUPLICATE_FIELD_KEY');
  expectIssue(mutate(b => { b.achievements[0].condition.metric_ref = b.metrics[1].local_ref; b.achievements[0].repeat_policy = 'per_period'; }), 'PERIOD_ON_ALL_TIME_METRIC');
  expectIssue(mutate(b => { b.tasks[0].schedule.kind = 'weekly'; b.tasks[0].schedule.weekdays = [1, 3]; }), 'UNSUPPORTED_SCHEDULE');
  expectIssue(mutate(b => { b.tasks[0].schedule.kind = 'once'; }), 'MISSING_ONCE_DATE');
  expectIssue(mutate(b => { b.module.mode = 'extend'; b.module.target_module_id = randomUUID(); }), 'MODE_MISMATCH');
  expectIssue(mutate(b => { b.tasks[0].record_binding!.record_type_ref = `id:${randomUUID()}`; }), 'UNKNOWN_RECORD_TYPE_REF');
  expectIssue(mutate(b => { b.achievements[0].condition.metric_ref = `id:${randomUUID()}`; }), 'UNKNOWN_METRIC_REF');
});

test('content scope and extend target permissions are enforced', () => {
  const onlyTasks = createContext(['tasks']);
  expectIssue(() => validateBlueprint(parseBlueprint(clone()), onlyTasks), 'CONTENT_TYPE_NOT_ALLOWED');
  const ctx = extendContext();
  const b = parseBlueprint(extendBlueprint());
  b.module.target_module_id = randomUUID();
  expectIssue(() => validateBlueprint(b, ctx), 'TARGET_MISMATCH');
  const empty = parseBlueprint({ ...extendBlueprint(), metrics: [], tasks: [], achievements: [], record_types: [] });
  expectIssue(() => validateBlueprint(empty, ctx), 'EMPTY_BLUEPRINT');
});

test('model text parser accepts one JSON object or a fenced block, rejects prose and truncation', () => {
  assert.deepEqual(extractJsonObject(JSON.stringify({ a: 1 })), { a: 1 });
  assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  expectIssue(() => extractJsonObject('Here is your JSON: {"a":1}'), 'INVALID_JSON');
  expectIssue(() => extractJsonObject('{"a":'), 'INVALID_JSON');
});

test('local mock adapter produces a valid blueprint without network access', async () => {
  const promptContext: PromptContext = {
    mode: 'create', targetModuleId: null, targetModuleName: null, targetModuleIcon: null, targetModuleColor: null,
    timezone: 'Asia/Shanghai', contentTypes: ALL_CONTENT, prompt: '帮我设计一个编程练习模块',
    allowedRecordTypes: [], allowedMetrics: []
  };
  const prompt = buildGenerationPrompt(promptContext);
  const adapter = new MockAdapter();
  const result = await adapter.generate({ ...prompt, context: promptContext, maxOutputTokens: 4096, timeoutMs: 1000 });
  assert.equal(adapter.cloud, false);
  const blueprint = parseBlueprint(extractJsonObject(result.text));
  const validated = validateBlueprint(blueprint, createContext());
  assert.match(validated.warnings.join(' '), /本地模拟/);
  const plan = buildApplyPlan(blueprint, createContext());
  assert.equal(plan.summary.module, 1);
  assert.ok(plan.summary.record_type >= 1);
  assert.ok(plan.summary.metric >= 1);
  assert.equal(plan.summary.task, 1);
  assert.ok(plan.summary.achievement >= 1);
});

test('stub adapter returns queued outputs and errors for deterministic tests', async () => {
  const input = {
    system: 's', user: 'u', maxOutputTokens: 10, timeoutMs: 10,
    context: { mode: 'create' } as PromptContext
  };
  const adapter = stubAdapter(['{"a":1}', '{"b":2}']);
  assert.equal((await adapter.generate(input)).text, '{"a":1}');
  assert.equal((await adapter.generate(input)).text, '{"b":2}');
  assert.equal((await adapter.generate(input)).text, '{"b":2}');
  const failing = stubAdapter([new AiProviderError('AI_QUOTA', 'no balance', false)]);
  await assert.rejects(() => failing.generate(input), (error: any) => error.code === 'AI_QUOTA');
});

test('provider configuration defaults to local mock and refuses insecure or keyed URLs', () => {
  const config = loadAiConfig({});
  assert.equal(config.provider, 'mock');
  assert.equal(config.apiKey, null);
  const deepseek = loadAiConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'x', DEEPSEEK_MODEL: 'deepseek-chat' });
  assert.equal(deepseek.provider, 'deepseek');
  assert.equal(deepseek.apiKey, 'x');
  assert.throws(() => loadAiConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_BASE_URL: 'http://api.deepseek.com' }));
  assert.equal(loadAiConfig({ AI_PROVIDER: 'deepseek', DEEPSEEK_BASE_URL: 'http://127.0.0.1:9999', AI_ALLOW_INSECURE_BASE_URL: '1' }).baseUrl, 'http://127.0.0.1:9999');
});
