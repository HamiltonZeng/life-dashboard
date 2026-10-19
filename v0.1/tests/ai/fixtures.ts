import type { AiContentType, Field } from '../../packages/contracts/src/index.js';
import type { Blueprint } from '../../packages/ai/src/blueprint.js';
import type { ExistingMetric, ExistingRecordType, ValidationContext } from '../../packages/ai/src/validate.js';

export const ALL_CONTENT: AiContentType[] = ['record_types', 'metrics', 'tasks', 'achievements'];

export function field(key: string, type: Field['type'], overrides: Partial<Field> = {}): Field {
  return { key, label: key, type, required: false, unit: null, options: [], minimum: null, maximum: null, ...overrides };
}

/** A create-mode blueprint equivalent to the shipped example; tests/ai/design-example.json is the checksum-pinned authoritative copy (design/ is outside the Docker bind mount). */
export const exampleBlueprint: Blueprint = {
  schema_version: '1.0',
  kind: 'module_blueprint',
  module: {
    mode: 'create', target_module_id: null, local_ref: 'local:language',
    name: '语言学习', description: '通过短时练习积累可核对的语言实践。', icon: 'book', color: 'blue'
  },
  record_types: [{
    local_ref: 'local:practice_log', name: '语言练习记录', description: '记录实际发生的练习。', renderer_kind: 'generic',
    fields: [
      { key: 'topic', label: '练习内容', type: 'text', required: true, unit: null, options: [], minimum: null, maximum: null },
      { key: 'duration_minutes', label: '实际分钟数', type: 'integer', required: true, unit: '分钟', options: [], minimum: 1, maximum: 1440 },
      { key: 'reflection', label: '感受或发现', type: 'textarea', required: false, unit: null, options: [], minimum: null, maximum: null }
    ]
  }],
  metrics: [
    {
      local_ref: 'local:weekly_minutes', name: '本周练习分钟数', description: '按发生日期聚合已确认且未删除的有效练习记录。', unit: '分钟',
      source: { record_type_ref: 'local:practice_log', aggregation: 'sum', field_key: 'duration_minutes', window: 'week' },
      proposed_target: { operator: 'gte', value: 30 }
    },
    {
      local_ref: 'local:practice_count', name: '累计练习次数', description: '按唯一有效记录计数。', unit: '次',
      source: { record_type_ref: 'local:practice_log', aggregation: 'count', field_key: null, window: 'all_time' },
      proposed_target: null
    }
  ],
  tasks: [{
    local_ref: 'local:first_practice', title: '完成一次语言练习', description: '选择一段内容练习，并如实记录结果。',
    priority: 'normal', estimated_minutes: 10,
    schedule: { kind: 'unscheduled', weekdays: [], local_time: null, start_date: null, end_date: null, timezone: 'Asia/Shanghai' },
    completion_mode: 'record_required',
    record_binding: {
      record_type_ref: 'local:practice_log',
      acceptance: { kind: 'field_gte', field_key: 'duration_minutes', threshold: 10 }
    }
  }],
  achievements: [{
    local_ref: 'local:first_step', name: '迈出第一步', description: '留下第一条有效语言练习记录。', icon: 'flag',
    condition: { kind: 'metric_threshold', metric_ref: 'local:practice_count', operator: 'gte', threshold: 1 },
    repeat_policy: 'once', history_policy: 'include_existing'
  }],
  warnings: ['这是内容配置示例，未生成真实学习记录；30 分钟是可编辑建议目标。']
};

export function clone(): Blueprint {
  return JSON.parse(JSON.stringify(exampleBlueprint)) as Blueprint;
}

export function createContext(contentTypes: AiContentType[] = ALL_CONTENT): ValidationContext {
  return {
    mode: 'create', targetModuleId: null, targetModule: null,
    recordTypes: new Map(), metrics: new Map(),
    allowedRecordTypeIds: new Set(), allowedMetricIds: new Set(),
    contentTypes: new Set(contentTypes), timezone: 'Asia/Shanghai'
  };
}

export const existingRecordType: ExistingRecordType = {
  id: '20000000-0000-4000-8000-000000000001', name: '学习记录',
  fields: [
    field('topic', 'text', { label: '实际内容', required: true }),
    field('duration_minutes', 'integer', { label: '实际分钟数', unit: '分钟', minimum: 0, maximum: 1440 })
  ]
};

export const existingMetric: ExistingMetric = {
  id: '50000000-0000-4000-8000-000000000001', name: '累计学习次数', unit: '次',
  aggregation: 'count', field_key: null, window: 'all_time', record_type_id: existingRecordType.id
};

export function extendContext(contentTypes: AiContentType[] = ALL_CONTENT): ValidationContext {
  const recordTypes = new Map([[existingRecordType.id, existingRecordType]]);
  const metrics = new Map([[existingMetric.id, existingMetric]]);
  return {
    mode: 'extend', targetModuleId: '10000000-0000-4000-8000-000000000001',
    targetModule: { id: '10000000-0000-4000-8000-000000000001', name: '学习与发展', version: 1, status: 'enabled', icon: 'book', color: 'blue' },
    recordTypes, metrics,
    allowedRecordTypeIds: new Set(recordTypes.keys()), allowedMetricIds: new Set(metrics.keys()),
    contentTypes: new Set(contentTypes), timezone: 'Asia/Shanghai'
  };
}

/** Extend the built-in learning module; references the existing template so no new template is needed. */
export function extendBlueprint(): Blueprint {
  const bp = clone();
  bp.module = {
    mode: 'extend', target_module_id: '10000000-0000-4000-8000-000000000001', local_ref: 'local:language',
    name: '学习与发展', description: '扩展现有模块。', icon: 'book', color: 'blue'
  };
  bp.record_types = [];
  bp.metrics = [{
    local_ref: 'local:weekly_minutes', name: '本周学习分钟数', description: '', unit: '分钟',
    source: { record_type_ref: `id:${existingRecordType.id}`, aggregation: 'sum', field_key: 'duration_minutes', window: 'week' },
    proposed_target: { operator: 'gte', value: 60 }
  }];
  bp.tasks = [{
    local_ref: 'local:first_practice', title: '完成一次学习', description: '', priority: 'normal', estimated_minutes: null,
    schedule: { kind: 'once', weekdays: [], local_time: null, start_date: '2026-10-20', end_date: null, timezone: 'Asia/Shanghai' },
    completion_mode: 'record_required',
    record_binding: { record_type_ref: `id:${existingRecordType.id}`, acceptance: { kind: 'field_gte', field_key: 'duration_minutes', threshold: 15 } }
  }];
  bp.achievements = [{
    local_ref: 'local:first_step', name: '本周学习入门', description: '', icon: 'flag',
    condition: { kind: 'metric_threshold', metric_ref: 'local:weekly_minutes', operator: 'gte', threshold: 30 },
    repeat_policy: 'per_period', history_policy: 'include_existing'
  }];
  bp.warnings = [];
  return bp;
}

export function issueCodes(fn: () => unknown): string[] {
  try { fn(); return []; }
  catch (error: any) {
    if (Array.isArray(error?.issues)) return error.issues.map((i: any) => i.code);
    return ['UNEXPECTED:' + (error?.message ?? String(error))];
  }
}
