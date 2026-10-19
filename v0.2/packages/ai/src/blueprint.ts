import { z } from 'zod';

// Module blueprint 1.0, mirroring design/人生面板_AI模块蓝图.schema.json.
// This is the server-side canonical contract for model output. It contains definitions only:
// no records, current metric values, completion flags, award states, credentials or executable code.

export const LOCAL_REF_PATTERN = /^local:[a-z][a-z0-9_]{0,63}$/;
const REF_PATTERN = /^(local:[a-z][a-z0-9_]{0,63}|id:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

export const localRef = z.string().regex(LOCAL_REF_PATTERN, 'Use local:lower_snake_case references');
export const objectRef = z.string().regex(REF_PATTERN, 'Use local:* references for new objects or id:<uuid> for allowed existing objects');
export const refId = (ref: string) => ref.startsWith('id:') ? ref.slice(3).toLowerCase() : null;

export const blueprintField = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().min(1).max(60),
  type: z.enum(['text', 'textarea', 'integer', 'decimal', 'date', 'boolean', 'single_select']),
  required: z.boolean(),
  unit: z.string().min(1).max(30).nullable(),
  options: z.array(z.string().min(1).max(80)).max(30),
  minimum: z.number().finite().nullable(),
  maximum: z.number().finite().nullable()
});

export const blueprintModule = z.strictObject({
  mode: z.enum(['create', 'extend']),
  target_module_id: z.uuid().nullable(),
  local_ref: localRef,
  name: z.string().min(1).max(60),
  description: z.string().min(0).max(1000),
  icon: z.enum(['book', 'dumbbell', 'wallet', 'sparkles', 'trophy', 'flag', 'leaf', 'music', 'chat', 'star']),
  color: z.enum(['blue', 'green', 'amber', 'violet', 'rose', 'cyan', 'slate'])
});

export const blueprintRecordType = z.strictObject({
  local_ref: localRef,
  name: z.string().min(1).max(60),
  description: z.string().min(0).max(1000),
  renderer_kind: z.literal('generic'),
  fields: z.array(blueprintField).min(1).max(30)
});

export const blueprintMetricSource = z.strictObject({
  record_type_ref: objectRef,
  aggregation: z.enum(['count', 'sum', 'avg', 'latest']),
  field_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).nullable(),
  window: z.enum(['day', 'week', 'month', 'all_time'])
});

export const blueprintTarget = z.strictObject({
  operator: z.enum(['gte', 'lte']),
  value: z.number().finite().min(-1e12).max(1e12)
});

export const blueprintMetric = z.strictObject({
  local_ref: localRef,
  name: z.string().min(1).max(80),
  description: z.string().min(0).max(1000),
  unit: z.string().min(1).max(30),
  source: blueprintMetricSource,
  proposed_target: blueprintTarget.nullable()
});

export const blueprintAcceptance = z.strictObject({
  kind: z.enum(['exists', 'field_gte']),
  field_key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).nullable(),
  threshold: z.number().finite().min(-1e12).max(1e12).nullable()
});

export const blueprintRecordBinding = z.strictObject({
  record_type_ref: objectRef,
  acceptance: blueprintAcceptance
});

export const blueprintSchedule = z.strictObject({
  kind: z.enum(['unscheduled', 'once', 'daily', 'weekly']),
  weekdays: z.array(z.int().min(1).max(7)).max(7).refine(v => new Set(v).size === v.length, 'Weekdays must be unique'),
  local_time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).nullable(),
  start_date: z.iso.date().nullable(),
  end_date: z.iso.date().nullable(),
  timezone: z.string().min(1).max(80)
});

export const blueprintTask = z.strictObject({
  local_ref: localRef,
  title: z.string().min(1).max(100),
  description: z.string().min(0).max(2000),
  priority: z.enum(['low', 'normal', 'high']),
  estimated_minutes: z.int().min(0).max(1440).nullable(),
  schedule: blueprintSchedule,
  completion_mode: z.enum(['manual', 'record_optional', 'record_required']),
  record_binding: blueprintRecordBinding.nullable()
});

export const blueprintAchievementCondition = z.strictObject({
  kind: z.literal('metric_threshold'),
  metric_ref: objectRef,
  operator: z.enum(['gte', 'lte']),
  threshold: z.number().finite().min(-1e12).max(1e12)
});

export const blueprintAchievement = z.strictObject({
  local_ref: localRef,
  name: z.string().min(1).max(80),
  description: z.string().min(0).max(1000),
  icon: z.enum(['book', 'dumbbell', 'wallet', 'sparkles', 'trophy', 'flag', 'leaf', 'music', 'chat', 'star']),
  condition: blueprintAchievementCondition,
  repeat_policy: z.enum(['once', 'per_period']),
  history_policy: z.enum(['include_existing', 'from_activation'])
});

export const blueprintSchema = z.strictObject({
  schema_version: z.literal('1.0'),
  kind: z.literal('module_blueprint'),
  module: blueprintModule,
  record_types: z.array(blueprintRecordType).max(12),
  metrics: z.array(blueprintMetric).max(20),
  tasks: z.array(blueprintTask).max(30),
  achievements: z.array(blueprintAchievement).max(20),
  warnings: z.array(z.string().min(1).max(500)).max(20)
});

export type Blueprint = z.infer<typeof blueprintSchema>;
export type BlueprintField = z.infer<typeof blueprintField>;
export type BlueprintRecordType = z.infer<typeof blueprintRecordType>;
export type BlueprintMetric = z.infer<typeof blueprintMetric>;
export type BlueprintTask = z.infer<typeof blueprintTask>;
export type BlueprintAchievement = z.infer<typeof blueprintAchievement>;

export interface BlueprintIssue {
  layer: 'parse' | 'structure' | 'semantic' | 'permission' | 'business';
  code: string;
  path: string;
  message: string;
}

export class BlueprintError extends Error {
  constructor(public readonly issues: BlueprintIssue[], public readonly candidate: unknown = null) {
    super(issues[0]?.message ?? 'Blueprint failed validation');
    this.name = 'BlueprintError';
  }
}

/** Layer 1/2: strict JSON object and full structural validation. */
export function parseBlueprint(raw: unknown): Blueprint {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BlueprintError([{ layer: 'parse', code: 'INVALID_JSON_OBJECT', path: '$', message: 'Model output must be one complete JSON object' }]);
  }
  const parsed = blueprintSchema.safeParse(raw);
  if (!parsed.success) {
    throw new BlueprintError(parsed.error.issues.map(i => ({
      layer: 'structure' as const,
      code: i.code.toUpperCase(),
      path: '$' + (i.path.length ? '.' + i.path.join('.') : ''),
      message: i.message
    })), raw);
  }
  return parsed.data;
}

/** Extract exactly one JSON object from model text; fenced code blocks are tolerated, prose is not. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const body = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    throw new BlueprintError([{ layer: 'parse', code: 'INVALID_JSON', path: '$', message: 'Model output is not complete, parseable JSON' }]);
  }
}
