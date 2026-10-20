import { z } from 'zod';
import {uuid,timezone,decimal,fieldSchema} from './primitives.js';
export {uuid,timezone,decimal,fieldSchema} from './primitives.js';
export const recordTypeInput = z.strictObject({ id: uuid, module_id: uuid, name: z.string().min(1).max(60), fields: z.array(fieldSchema).min(1).max(30) });
export const moduleInput = z.strictObject({ id: uuid, name: z.string().min(1).max(60), description: z.string().max(1000).default(''), icon: z.enum(['book','dumbbell','wallet','sparkles','trophy','flag','leaf','music','chat','star']), color: z.enum(['blue','green','amber','violet','rose','cyan','slate']) });
export const recordInput = z.strictObject({
  id: uuid, module_id: uuid, record_type_id: uuid, schema_version: z.int().positive(),
  occurred_at: z.iso.datetime({ offset: true }), timezone,
  status: z.enum(['draft', 'confirmed']),
  values: z.record(z.string(), z.union([z.string().max(20000), z.number().finite(), z.boolean(), z.null()])).refine(v => Object.keys(v).length <= 30),
  task_ids: z.array(uuid).max(20).default([])
});
export const recordUpdate = recordInput.omit({id: true}).extend({base_version: z.int().positive()});
export const acceptance = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('exists')}),
  z.strictObject({kind: z.literal('field_gte'), field_key: z.string(), threshold: decimal})
]);
export const taskInput = z.strictObject({
  id: uuid, module_id: uuid, title: z.string().min(1).max(100),
  completion_mode: z.enum(['manual','record_optional','record_required']),
  record_type_id: uuid.nullable(), acceptance: acceptance.nullable(),
  business_date: z.iso.date().nullable().default(null), timezone,
});
export const metricInput = z.strictObject({
  id: uuid, module_id: uuid, record_type_id: uuid, name: z.string().min(1).max(80), unit: z.string().min(1).max(30),
  aggregation: z.enum(['count','sum','avg','latest']), field_key: z.string().nullable(),
  window: z.enum(['day','week','month','all_time']), timezone
});
export const achievementInput = z.strictObject({
  id: uuid, module_id: uuid, metric_id: uuid, name: z.string().min(1).max(80),
  operator: z.enum(['gte','lte']), threshold: decimal,
  history_policy: z.enum(['include_existing','from_activation']).default('include_existing')
});
export const pageQuery = z.strictObject({module_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0)});

// T2/T3 AI generation contract. The canonical model output is the module blueprint 1.0
// (design/人生面板_AI模块蓝图.schema.json); these schemas describe only the server API boundary.
export const aiMode = z.enum(['create', 'extend']);
export const aiApplyMode = z.enum(['apply', 'preview']);
export const aiContentType = z.enum(['record_types', 'metrics', 'tasks', 'achievements']);
export const aiReference = z.strictObject({
  record_type_ids: z.array(uuid).max(20).default([]),
  metric_ids: z.array(uuid).max(20).default([])
});
export const aiGenerationInput = z.strictObject({
  mode: aiMode,
  module_id: uuid.nullable().default(null),
  prompt: z.string().min(1).max(4000),
  content_types: z.array(aiContentType).min(1).max(4).refine(v => new Set(v).size === v.length, 'Content types must be unique'),
  apply_mode: aiApplyMode.default('apply'),
  timezone,
  reference: aiReference.default({ record_type_ids: [], metric_ids: [] })
});
export const aiApplyInput = z.strictObject({ base_module_version: z.int().positive().nullable().default(null) });
export const aiEmptyInput = z.strictObject({});

export type Field = z.infer<typeof fieldSchema>;
export type RecordInput = z.infer<typeof recordInput>;
export type TaskInput = z.infer<typeof taskInput>;
export type MetricInput = z.infer<typeof metricInput>;
export type AchievementInput = z.infer<typeof achievementInput>;
export type AiGenerationInput = z.infer<typeof aiGenerationInput>;
export type AiApplyInput = z.infer<typeof aiApplyInput>;
export type AiMode = z.infer<typeof aiMode>;
export type AiApplyMode = z.infer<typeof aiApplyMode>;
export type AiContentType = z.infer<typeof aiContentType>;
export const AI_BLUEPRINT_SCHEMA_VERSION = '1.0';
export const CONTRACT_VERSION = '0.2.0';

// v0.2 phase one: business field names are data, never credential configuration.
export const profileFieldInput = fieldSchema.omit({required:true,minimum:true,maximum:true}).extend({
  id:uuid,module_id:uuid,kind:z.literal('profile'),
  value:z.union([z.string().max(20000),z.number().finite(),z.boolean(),z.null()])
});
export const profileInput = z.strictObject({
  base_version:z.int().positive(), nickname:z.string().trim().min(1).max(60).optional(),
  bio:z.string().max(1000).nullable().optional(),timezone:timezone.optional(),
  field_upserts:z.array(profileFieldInput).max(120).optional(),field_remove_ids:z.array(uuid).max(120).optional()
});
const uniqueIds=(max:number)=>z.array(uuid).max(max).refine(v=>new Set(v).size===v.length,'IDs must be unique');
export const homePreferencesInput=z.strictObject({
  base_version:z.int().positive(),minimal_mode:z.boolean().optional(),
  pinned_metric_ids:uniqueIds(4).optional(),pinned_task_ids:uniqueIds(5).optional()
});
export type ProfileInput=z.infer<typeof profileInput>;
export type HomePreferencesInput=z.infer<typeof homePreferencesInput>;

export * from './phase2.js';
