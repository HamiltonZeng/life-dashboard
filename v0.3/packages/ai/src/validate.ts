import { Decimal } from 'decimal.js';
import { activeMetrics } from '../../db/src/references.js';
import type { AiContentType, Field, MetricInput } from '../../contracts/src/index.js';
import {
  BlueprintError,
  refId,
  type Blueprint,
  type BlueprintIssue,
  type BlueprintMetric,
  type BlueprintRecordType
} from './blueprint.js';

export interface ExistingRecordType {
  id: string;
  name: string;
  fields: Field[];
}

export interface ExistingMetric {
  id: string;
  name: string;
  unit: string;
  aggregation: MetricInput['aggregation'];
  field_key: string | null;
  window: MetricInput['window'];
  record_type_id: string;
}

export interface ValidationContext {
  mode: 'create' | 'extend';
  targetModuleId: string | null;
  targetModule: { id: string; name: string; version: number; status: string; icon: string; color: string } | null;
  recordTypes: Map<string, ExistingRecordType>;
  metrics: Map<string, ExistingMetric>;
  allowedRecordTypeIds: Set<string>;
  allowedMetricIds: Set<string>;
  contentTypes: Set<AiContentType>;
  timezone: string;
}

export interface ValidatedBlueprint {
  blueprint: Blueprint;
  warnings: string[];
}

const NUMERIC = new Set(['integer', 'decimal']);

function ianaTimezone(value: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
}

export function decimalString(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const d = new Decimal(value);
  if (d.decimalPlaces() > 6) return null;
  if (d.abs().gt('999999999999.999999')) return null;
  return d.toString();
}

export function blueprintToField(field: BlueprintRecordType['fields'][number]): Field {
  return {
    key: field.key, label: field.label, type: field.type, required: field.required,
    unit: field.unit, options: [...field.options],
    minimum: field.minimum, maximum: field.maximum
  };
}

/**
 * Layers 3-5: semantic, permission/version and business validation.
 * Every issue is accumulated so the user/model can see all problems at once.
 */
export function validateBlueprint(blueprint: Blueprint, ctx: ValidationContext): ValidatedBlueprint {
  const issues: BlueprintIssue[] = [];
  const warnings: string[] = [...blueprint.warnings];
  const push = (layer: BlueprintIssue['layer'], code: string, path: string, message: string) => issues.push({ layer, code, path, message });

  // ---- module target and mode -------------------------------------------------
  const m = blueprint.module;
  if (m.mode !== ctx.mode) push('permission', 'MODE_MISMATCH', '$.module.mode', `Generation target is ${ctx.mode}, model returned ${m.mode}`);
  if (ctx.mode === 'create') {
    if (m.target_module_id !== null) push('permission', 'TARGET_MISMATCH', '$.module.target_module_id', 'create mode requires target_module_id=null');
  } else {
    if (!ctx.targetModuleId) push('permission', 'TARGET_MISSING', '$.module.target_module_id', 'extend mode requires a target module');
    else if (m.target_module_id !== ctx.targetModuleId) push('permission', 'TARGET_MISMATCH', '$.module.target_module_id', 'Model output cannot change the generation target module');
    if (ctx.targetModule && (m.name !== ctx.targetModule.name || m.icon !== ctx.targetModule.icon || m.color !== ctx.targetModule.color)) {
      warnings.push('扩展现有模块时不会修改模块名称、图标或颜色；蓝图中的模块属性仅用于核对。');
    }
  }

  // ---- local reference namespace ---------------------------------------------
  const seenRefs = new Map<string, string>();
  const registerRef = (ref: string, path: string) => {
    const previous = seenRefs.get(ref);
    if (previous) push('semantic', 'DUPLICATE_LOCAL_REF', path, `local_ref ${ref} is already used by ${previous}`);
    else seenRefs.set(ref, path);
  };
  registerRef(m.local_ref, '$.module.local_ref');
  blueprint.record_types.forEach((r, i) => registerRef(r.local_ref, `$.record_types[${i}].local_ref`));
  blueprint.metrics.forEach((r, i) => registerRef(r.local_ref, `$.metrics[${i}].local_ref`));
  blueprint.tasks.forEach((r, i) => registerRef(r.local_ref, `$.tasks[${i}].local_ref`));
  blueprint.achievements.forEach((r, i) => registerRef(r.local_ref, `$.achievements[${i}].local_ref`));

  // ---- content scope ----------------------------------------------------------
  const contentAllowed = (kind: AiContentType, count: number) => {
    if (count > 0 && !ctx.contentTypes.has(kind)) push('permission', 'CONTENT_TYPE_NOT_ALLOWED', `$.${kind}`, `Generation scope does not allow adding ${kind}`);
  };
  contentAllowed('record_types', blueprint.record_types.length);
  contentAllowed('metrics', blueprint.metrics.length);
  contentAllowed('tasks', blueprint.tasks.length);
  contentAllowed('achievements', blueprint.achievements.length);
  if (ctx.mode !== 'create' && blueprint.record_types.length + blueprint.metrics.length + blueprint.tasks.length + blueprint.achievements.length === 0) {
    push('business', 'EMPTY_BLUEPRINT', '$', 'Blueprint must add at least one object when extending an existing module');
  }

  // ---- record types and fields ------------------------------------------------
  const localRecordTypes = new Map<string, { name: string; fields: Field[] }>();
  for (const [i, rt] of blueprint.record_types.entries()) {
    const path = `$.record_types[${i}]`;
    const fields = rt.fields.map(blueprintToField);
    localRecordTypes.set(rt.local_ref, { name: rt.name, fields });
    if (rt.description.length > 500) warnings.push(`模板「${rt.name}」的说明较长，应用后仅保留名称与字段定义。`);
    const keys = new Set<string>();
    for (const [j, f] of rt.fields.entries()) {
      const fp = `${path}.fields[${j}]`;
      if (keys.has(f.key)) push('semantic', 'DUPLICATE_FIELD_KEY', fp, `Field key ${f.key} is duplicated`);
      keys.add(f.key);
      if ((f.minimum !== null || f.maximum !== null) && !NUMERIC.has(f.type)) push('semantic', 'INVALID_FIELD_BOUNDS', fp, 'Bounds are only allowed on integer/decimal fields');
      if (f.minimum !== null && f.maximum !== null && f.minimum > f.maximum) push('semantic', 'INVALID_FIELD_BOUNDS', fp, 'minimum must not exceed maximum');
      if (f.type === 'single_select') {
        if (f.options.length === 0) push('semantic', 'MISSING_FIELD_OPTIONS', fp, 'single_select fields require non-empty options');
        if (new Set(f.options).size !== f.options.length) push('semantic', 'DUPLICATE_FIELD_OPTIONS', fp, 'Options must be unique');
      } else if (f.options.length > 0) {
        push('semantic', 'UNEXPECTED_FIELD_OPTIONS', fp, 'Only single_select fields may carry options');
      }
      if (f.type === 'text' && f.label.length > 60) push('semantic', 'FIELD_LABEL_TOO_LONG', fp, 'Field label is too long');
      if (NUMERIC.has(f.type) && !f.unit) warnings.push(`字段「${f.label}」没有单位；数值定义将只能使用无单位的计数。`);
    }
    const existing = [...ctx.recordTypes.values()].find(r => r.name === rt.name);
    if (existing) warnings.push(`模板「${rt.name}」与现有模板同名，可能重复；应用后会创建新的模板。`);
  }

  interface ResolvedRecordType { fields: Field[]; name: string; id: string | null; }
  const resolveRecordType = (ref: string, path: string): ResolvedRecordType | null => {
    const id = refId(ref);
    if (id) {
      if (!ctx.allowedRecordTypeIds.has(id) || !ctx.recordTypes.has(id)) {
        push('permission', 'UNKNOWN_RECORD_TYPE_REF', path, `Record template ${ref} is not in the allowed reference list for this module`);
        return null;
      }
      const existing = ctx.recordTypes.get(id)!;
      return { fields: existing.fields, name: existing.name, id };
    }
    const local = localRecordTypes.get(ref);
    if (!local) {
      push('semantic', 'UNKNOWN_LOCAL_RECORD_TYPE_REF', path, `Record template ${ref} is not declared in this blueprint`);
      return null;
    }
    return { fields: local.fields, name: local.name, id: null };
  };

  // ---- metrics ----------------------------------------------------------------
  const localMetrics = new Map<string, { name: string; unit: string; aggregation: MetricInput['aggregation']; field_key: string | null; window: MetricInput['window']; recordTypeId: string | null }>();
  for (const [i, metric] of blueprint.metrics.entries()) {
    const path = `$.metrics[${i}]`;
    const source = metric.source;
    const rt = resolveRecordType(source.record_type_ref, `${path}.source.record_type_ref`);
    let field: Field | undefined;
    if (rt) {
      if (source.aggregation === 'count') {
        if (source.field_key !== null) push('semantic', 'COUNT_REQUIRES_NULL_FIELD', `${path}.source.field_key`, 'count metrics must not reference a numeric field');
      } else {
        if (source.field_key === null) push('semantic', 'MISSING_METRIC_FIELD', `${path}.source.field_key`, `${source.aggregation} requires a numeric field`);
        else {
          field = rt.fields.find(f => f.key === source.field_key);
          if (!field) push('semantic', 'UNKNOWN_METRIC_FIELD', `${path}.source.field_key`, `Field ${source.field_key} is not part of template ${rt.name}`);
          else if (!NUMERIC.has(field.type)) push('semantic', 'NON_NUMERIC_METRIC_FIELD', `${path}.source.field_key`, `Field ${source.field_key} is not numeric`);
          else if ((field.unit ?? '') !== metric.unit) push('semantic', 'UNIT_MISMATCH', `${path}.unit`, `Metric unit ${metric.unit} does not match field unit ${field.unit ?? 'none'}`);
        }
      }
    }
    if (source.window === 'all_time' && metric.proposed_target !== null) warnings.push(`数值「${metric.name}」是累计窗口，建议目标不会自动变成正式目标。`);
    if (metric.proposed_target !== null) {
      if (decimalString(metric.proposed_target.value) === null) push('semantic', 'TARGET_PRECISION', `${path}.proposed_target.value`, 'Target value must fit a decimal with up to 6 fractional digits');
      else warnings.push(`数值「${metric.name}」的建议目标只是建议，需用户采用后才进入正式目标进度。`);
    }
    localMetrics.set(metric.local_ref, {
      name: metric.name, unit: metric.unit, aggregation: source.aggregation,
      field_key: source.field_key, window: source.window,
      recordTypeId: rt ? rt.id : null
    });
    if ([...ctx.metrics.values()].some(x => x.name === metric.name)) warnings.push(`数值「${metric.name}」与现有数值同名，可能重复。`);
  }

  interface ResolvedMetric { unit: string; window: MetricInput['window']; aggregation: MetricInput['aggregation']; field_key: string | null; name: string; }
  const resolveMetric = (ref: string, path: string): ResolvedMetric | null => {
    const id = refId(ref);
    if (id) {
      if (!ctx.allowedMetricIds.has(id) || !ctx.metrics.has(id)) {
        push('permission', 'UNKNOWN_METRIC_REF', path, `Metric ${ref} is not in the allowed reference list for this module`);
        return null;
      }
      const existing = ctx.metrics.get(id)!;
      return { unit: existing.unit, window: existing.window, aggregation: existing.aggregation, field_key: existing.field_key, name: existing.name };
    }
    const local = localMetrics.get(ref);
    if (!local) {
      push('semantic', 'UNKNOWN_LOCAL_METRIC_REF', path, `Metric ${ref} is not declared in this blueprint`);
      return null;
    }
    return { unit: local.unit, window: local.window, aggregation: local.aggregation, field_key: local.field_key, name: local.name };
  };

  // ---- tasks -------------------------------------------------------------------
  for (const [i, task] of blueprint.tasks.entries()) {
    const path = `$.tasks[${i}]`;
    const schedule = task.schedule;
    if (!ianaTimezone(schedule.timezone)) push('semantic', 'INVALID_TIMEZONE', `${path}.schedule.timezone`, 'schedule.timezone must be a valid IANA timezone');
    if (schedule.start_date && schedule.end_date && schedule.start_date > schedule.end_date) push('semantic', 'INVALID_DATE_RANGE', `${path}.schedule`, 'start_date must not be after end_date');
    if (schedule.kind === 'unscheduled') {
      if (schedule.start_date || schedule.end_date) push('semantic', 'UNSCHEDULED_HAS_DATES', `${path}.schedule`, 'unscheduled tasks cannot carry start/end dates');
      if (schedule.weekdays.length || schedule.local_time) push('semantic', 'UNSCHEDULED_HAS_TIMING', `${path}.schedule`, 'unscheduled tasks cannot carry weekdays or time');
    } else if (schedule.kind === 'once') {
      if (!schedule.start_date) push('semantic', 'MISSING_ONCE_DATE', `${path}.schedule.start_date`, 'once tasks require start_date');
    } else if (schedule.kind === 'weekly') {
      if (schedule.weekdays.length === 0) push('semantic', 'MISSING_WEEKDAYS', `${path}.schedule.weekdays`, 'weekly tasks require at least one weekday');
    } else if (schedule.kind === 'daily' && schedule.weekdays.length) {
      push('semantic', 'UNEXPECTED_WEEKDAYS', `${path}.schedule.weekdays`, 'daily tasks do not use weekdays');
    }
    // Current task instances only support unscheduled/once (T2 recurring scheduler is not implemented yet).
    if (schedule.kind === 'daily' || schedule.kind === 'weekly') {
      push('permission', 'UNSUPPORTED_SCHEDULE', `${path}.schedule.kind`, `Recurring ${schedule.kind} tasks are not implemented in this stage; use unscheduled or once`);
    }

    if (task.completion_mode === 'manual') {
      if (task.record_binding !== null) push('semantic', 'MANUAL_HAS_BINDING', `${path}.record_binding`, 'manual tasks cannot carry a record binding');
    } else {
      if (task.record_binding === null) {
        push('semantic', 'MISSING_RECORD_BINDING', `${path}.record_binding`, `${task.completion_mode} tasks require a record binding`);
      } else {
        const binding = task.record_binding;
        const rt = resolveRecordType(binding.record_type_ref, `${path}.record_binding.record_type_ref`);
        if (binding.acceptance.kind === 'exists') {
          if (binding.acceptance.field_key !== null || binding.acceptance.threshold !== null) push('semantic', 'EXISTS_HAS_THRESHOLD', `${path}.record_binding.acceptance`, 'exists acceptance cannot carry field_key or threshold');
        } else {
          const acc = binding.acceptance;
          if (acc.field_key === null || acc.threshold === null) {
            push('semantic', 'MISSING_THRESHOLD', `${path}.record_binding.acceptance`, 'field_gte acceptance requires field_key and threshold');
          } else if (rt) {
            const field = rt.fields.find(f => f.key === acc.field_key);
            if (!field) push('semantic', 'UNKNOWN_ACCEPTANCE_FIELD', `${path}.record_binding.acceptance.field_key`, `Field ${acc.field_key} is not part of template ${rt.name}`);
            else if (!NUMERIC.has(field.type)) push('semantic', 'NON_NUMERIC_ACCEPTANCE_FIELD', `${path}.record_binding.acceptance.field_key`, 'Acceptance threshold must reference a numeric field');
            else {
              if ((field.minimum !== null && acc.threshold < field.minimum) || (field.maximum !== null && acc.threshold > field.maximum)) push('semantic', 'THRESHOLD_OUT_OF_BOUNDS', `${path}.record_binding.acceptance.threshold`, 'Threshold is outside the field bounds');
              if (decimalString(acc.threshold) === null) push('semantic', 'THRESHOLD_PRECISION', `${path}.record_binding.acceptance.threshold`, 'Threshold must fit a decimal with up to 6 fractional digits');
            }
          }
        }
      }
    }
    if (task.description) warnings.push(`任务「${task.title}」的说明、优先级与预计时长属于生成参考；应用后任务定义只保留当前契约支持的字段。`);
    if (task.estimated_minutes !== null) warnings.push(`任务「${task.title}」的预计 ${task.estimated_minutes} 分钟仅供参考，不是实际记录。`);
    if ([...ctx.recordTypes.values()].some(r => r.name === task.title)) warnings.push(`任务「${task.title}」与现有模板同名，请核对是否重复。`);
  }

  // ---- achievements ------------------------------------------------------------
  for (const [i, achievement] of blueprint.achievements.entries()) {
    const path = `$.achievements[${i}]`;
    const condition = achievement.condition;
    const metric = resolveMetric(condition.metric_ref, `${path}.condition.metric_ref`);
    if (metric) {
      if (achievement.repeat_policy === 'per_period' && metric.window === 'all_time') {
        push('semantic', 'PERIOD_ON_ALL_TIME_METRIC', `${path}.repeat_policy`, 'per_period achievements cannot reference an all_time metric');
      }
      if (decimalString(condition.threshold) === null) push('semantic', 'THRESHOLD_PRECISION', `${path}.condition.threshold`, 'Threshold must fit a decimal with up to 6 fractional digits');
      if (condition.operator === 'gte' && condition.threshold < 0) warnings.push(`成就「${achievement.name}」的阈值是负数，请确认这确实是想要的条件。`);
    }
    if ([...ctx.metrics.values()].some(x => x.name === achievement.name)) warnings.push(`成就「${achievement.name}」与现有数值同名，请核对是否重复。`);
  }

  if (warnings.length > 50) warnings.length = 50;
  if (issues.length) throw new BlueprintError(issues, blueprint);
  return { blueprint, warnings: [...new Set(warnings)] };
}

/** Resolve the target modules/templates/metrics that a request may reference. */
export async function loadValidationContext(
  query: (text: string, values: unknown[]) => Promise<{ rows: any[] }>,
  user: string,
  input: {
    mode: 'create' | 'extend';
    module_id: string | null;
    content_types: AiContentType[];
    timezone: string;
    reference: { record_type_ids: string[]; metric_ids: string[] };
  }
): Promise<ValidationContext> {
  let targetModule: ValidationContext['targetModule'] = null;
  const recordTypes = new Map<string, ExistingRecordType>();
  const metrics = new Map<string, ExistingMetric>();
  const allowedRecordTypeIds = new Set<string>();
  const allowedMetricIds = new Set<string>();

  if (input.mode === 'extend') {
    if (!input.module_id) {
      throw new BlueprintError([{ layer: 'permission', code: 'TARGET_MISSING', path: '$.module_id', message: 'extend mode requires module_id' }]);
    }
    const module = (await query('SELECT id,name,version,status,icon,color FROM modules WHERE user_id=$1 AND id=$2', [user, input.module_id])).rows[0];
    if (!module) throw new BlueprintError([{ layer: 'permission', code: 'TARGET_NOT_FOUND', path: '$.module_id', message: 'Target module is not accessible' }]);
    if (module.status !== 'enabled') throw new BlueprintError([{ layer: 'permission', code: 'MODULE_INACTIVE', path: '$.module_id', message: 'Target module is disabled or archived' }]);
    targetModule = { id: module.id, name: module.name, version: module.version, status: module.status, icon: module.icon, color: module.color };

    for (const row of (await query('SELECT id,name,fields FROM record_types WHERE user_id=$1 AND module_id=$2', [user, input.module_id])).rows) {
      recordTypes.set(row.id, { id: row.id, name: row.name, fields: row.fields });
      allowedRecordTypeIds.add(row.id);
    }
    for (const row of await activeMetrics(query,user,input.module_id)) {
      const def = row.definition as MetricInput;
      metrics.set(row.id, { id: row.id, name: def.name, unit: def.unit, aggregation: def.aggregation, field_key: def.field_key, window: def.window, record_type_id: def.record_type_id });
      allowedMetricIds.add(row.id);
    }
    for (const id of input.reference.record_type_ids) {
      if (!allowedRecordTypeIds.has(id)) throw new BlueprintError([{ layer: 'permission', code: 'REFERENCE_NOT_ALLOWED', path: '$.reference.record_type_ids', message: `Record template ${id} is not part of the target module` }]);
    }
    for (const id of input.reference.metric_ids) {
      if (!allowedMetricIds.has(id)) throw new BlueprintError([{ layer: 'permission', code: 'REFERENCE_NOT_ALLOWED', path: '$.reference.metric_ids', message: `Metric ${id} is not part of the target module` }]);
    }
  } else {
    if (input.module_id) throw new BlueprintError([{ layer: 'permission', code: 'TARGET_MISMATCH', path: '$.module_id', message: 'create mode requires module_id=null' }]);
    if (input.reference.record_type_ids.length || input.reference.metric_ids.length) throw new BlueprintError([{ layer: 'permission', code: 'REFERENCE_NOT_ALLOWED', path: '$.reference', message: 'A new module cannot reference other modules ids' }]);
  }

  return {
    mode: input.mode, targetModuleId: input.module_id, targetModule, recordTypes, metrics,
    allowedRecordTypeIds, allowedMetricIds, contentTypes: new Set(input.content_types), timezone: input.timezone
  };
}
