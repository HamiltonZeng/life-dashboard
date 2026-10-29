import { randomUUID } from 'node:crypto';
import type { AchievementInput, AiContentType, Field, MetricInput, TaskInput } from '../../contracts/src/index.js';
import { refId, type Blueprint } from './blueprint.js';
import { decimalString, blueprintToField, type ValidationContext } from './validate.js';

export type GeneratedKind = 'module' | 'record_type' | 'metric' | 'task' | 'achievement';

export interface GeneratedObject { kind: GeneratedKind; local_ref: string; id: string; }

export interface AppliedAchievementDefinition extends AchievementInput {
  description: string;
  icon: string;
  repeat_policy: 'once' | 'per_period';
}

export interface ApplyPlan {
  target_module_id: string;
  module_created: boolean;
  module: { id: string; name: string; description: string; icon: string; color: string } | null;
  base_module_version: number | null;
  record_types: { id: string; module_id: string; name: string; fields: Field[] }[];
  metrics: { id: string; module_id: string; record_type_id: string; definition: MetricInput }[];
  tasks: { id: string; template_id: string; module_id: string; definition: TaskInput }[];
  achievements: { id: string; module_id: string; metric_id: string; definition: AppliedAchievementDefinition }[];
  objects: GeneratedObject[];
  summary: Record<GeneratedKind, number>;
  warnings: string[];
}

function decimal(value: number, path: string): string {
  const text = decimalString(value);
  if (text === null) throw new Error(`Invalid decimal at ${path}`);
  return text;
}

/**
 * Turn a semantically validated blueprint into deterministic insert records.
 * Pure: no database access. The service allocates ids through the injected allocator so
 * tests can assert stable mappings.
 */
export function buildApplyPlan(
  blueprint: Blueprint,
  ctx: ValidationContext,
  alloc: () => string = randomUUID
): ApplyPlan {
  const warnings: string[] = [...blueprint.warnings];
  const objectIds = new Map<string, string>();
  const moduleId = ctx.mode === 'create' ? alloc() : ctx.targetModuleId!;
  if (ctx.mode === 'create') objectIds.set(blueprint.module.local_ref, moduleId);

  const recordTypeIds = new Map<string, string>();
  const recordTypes = blueprint.record_types.map(rt => {
    const id = alloc();
    recordTypeIds.set(rt.local_ref, id);
    return { id, module_id: moduleId, name: rt.name, fields: rt.fields.map(blueprintToField) };
  });

  const resolveRecordType = (ref: string): string => {
    const existing = refId(ref);
    if (existing) return existing;
    const id = recordTypeIds.get(ref);
    if (!id) throw new Error(`Unresolved record type reference ${ref}`);
    return id;
  };

  const metricIds = new Map<string, string>();
  const metrics = blueprint.metrics.map(metric => {
    const id = alloc();
    metricIds.set(metric.local_ref, id);
    const definition: MetricInput = {
      id, module_id: moduleId, record_type_id: resolveRecordType(metric.source.record_type_ref),
      name: metric.name, unit: metric.unit, aggregation: metric.source.aggregation,
      field_key: metric.source.field_key, window: metric.source.window, timezone: ctx.timezone
    };
    return { id, module_id: moduleId, record_type_id: definition.record_type_id, definition };
  });

  const resolveMetric = (ref: string): string => {
    const existing = refId(ref);
    if (existing) return existing;
    const id = metricIds.get(ref);
    if (!id) throw new Error(`Unresolved metric reference ${ref}`);
    return id;
  };

  const tasks = blueprint.tasks.map(task => {
    const id = alloc();
    const binding = task.record_binding;
    const definition: TaskInput = {
      id, module_id: moduleId, title: task.title,
      completion_mode: task.completion_mode,
      record_type_id: binding ? resolveRecordType(binding.record_type_ref) : null,
      acceptance: !binding ? null : binding.acceptance.kind === 'exists'
        ? { kind: 'exists' }
        : { kind: 'field_gte', field_key: binding.acceptance.field_key!, threshold: decimal(binding.acceptance.threshold!, '$.tasks[].record_binding.acceptance.threshold') },
      business_date: task.schedule.kind === 'once' ? task.schedule.start_date : null,
      timezone: task.schedule.timezone
    };
    return { id, template_id: alloc(), module_id: moduleId, definition };
  });

  const achievements = blueprint.achievements.map(achievement => {
    const id = alloc();
    const definition: AppliedAchievementDefinition = {
      id, module_id: moduleId, metric_id: resolveMetric(achievement.condition.metric_ref),
      name: achievement.name, operator: achievement.condition.operator,
      threshold: decimal(achievement.condition.threshold, '$.achievements[].condition.threshold'),
      history_policy: achievement.history_policy,
      description: achievement.description, icon: achievement.icon,
      repeat_policy: achievement.repeat_policy
    };
    return { id, module_id: moduleId, metric_id: definition.metric_id, definition };
  });

  for (const rt of blueprint.record_types) {
    if (rt.description.length > 0) warnings.push(`模板「${rt.name}」的说明未写入数据库（当前记录模板契约不保存 description）。`);
  }
  for (const task of blueprint.tasks) {
    if (task.description || task.priority !== 'normal' || task.estimated_minutes !== null) {
      warnings.push(`任务「${task.title}」的描述、优先级与预计时长属于生成参考，未写入任务定义。`);
    }
    if (task.schedule.kind === 'once') warnings.push(`任务「${task.title}」将按 once 生成 ${task.schedule.start_date} 的单日任务实例。`);
  }

  const objects: GeneratedObject[] = [];
  if (ctx.mode === 'create') objects.push({ kind: 'module', local_ref: blueprint.module.local_ref, id: moduleId });
  blueprint.record_types.forEach((rt, i) => objects.push({ kind: 'record_type', local_ref: rt.local_ref, id: recordTypes[i].id }));
  blueprint.metrics.forEach((m, i) => objects.push({ kind: 'metric', local_ref: m.local_ref, id: metrics[i].id }));
  blueprint.tasks.forEach((t, i) => objects.push({ kind: 'task', local_ref: t.local_ref, id: tasks[i].id }));
  blueprint.achievements.forEach((a, i) => objects.push({ kind: 'achievement', local_ref: a.local_ref, id: achievements[i].id }));

  return {
    target_module_id: moduleId,
    module_created: ctx.mode === 'create',
    module: ctx.mode === 'create'
      ? { id: moduleId, name: blueprint.module.name, description: blueprint.module.description, icon: blueprint.module.icon, color: blueprint.module.color }
      : null,
    base_module_version: ctx.targetModule?.version ?? null,
    record_types: recordTypes,
    metrics,
    tasks,
    achievements,
    objects,
    summary: {
      module: ctx.mode === 'create' ? 1 : 0,
      record_type: recordTypes.length,
      metric: metrics.length,
      task: tasks.length,
      achievement: achievements.length
    },
    warnings: [...new Set(warnings)]
  };
}
