import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';
import type { Field, MetricInput, TaskInput } from '../../contracts/src/index.js';

Decimal.set({precision:40});

export class DomainError extends Error {
  constructor(public code: string, message: string, public status = 422, public details?: unknown) { super(message); }
}
export function requireThat(condition: unknown, code: string, message: string, status = 422): asserts condition {
  if (!condition) throw new DomainError(code, message, status);
}
export function assertTaskCompletion(status: string, mode: TaskInput['completion_mode']) {
  requireThat(!['cancelled','skipped'].includes(status),'INVALID_TASK_TRANSITION','Cancelled or skipped tasks cannot be completed',409);
  requireThat(mode!=='record_required','RECORD_REQUIRED','This task requires a qualifying record');
  requireThat(['pending','in_progress','partial','completed'].includes(status),'INVALID_TASK_TRANSITION','Task cannot transition to completed',409);
}
export function canRecomputeTask(status: string) {return !['cancelled','skipped'].includes(status);}
export function validateFields(fields: Field[]) {
  requireThat(new Set(fields.map(f=>f.key)).size === fields.length, 'INVALID_FIELDS', 'Field keys must be unique');
  for (const f of fields) {
    requireThat(f.minimum === null || f.maximum === null || f.minimum <= f.maximum, 'INVALID_FIELDS', 'Invalid numeric bounds');
    requireThat(f.type === 'single_select' ? f.options.length > 0 && new Set(f.options).size === f.options.length : f.options.length === 0, 'INVALID_FIELDS', 'Invalid field options');
    requireThat(['integer','decimal'].includes(f.type) || (f.minimum === null && f.maximum === null), 'INVALID_FIELDS', 'Bounds require a numeric field');
  }
}
export function validateValues(fields: Field[], values: Record<string, unknown>, confirmed: boolean) {
  requireThat(Object.keys(values).every(k => fields.some(f=>f.key === k)), 'UNKNOWN_FIELD', 'Record contains unknown fields');
  for (const f of fields) {
    const v = Object.hasOwn(values,f.key) ? values[f.key] : undefined;
    if (v === undefined || v === null || v === '') {
      requireThat(!confirmed || !f.required, 'REQUIRED_FIELD', `${f.label} is required`); continue;
    }
    let valid = false;
    switch (f.type) {
      case 'text': case 'textarea': valid = typeof v === 'string'; break;
      case 'integer': valid = typeof v === 'number' && Number.isSafeInteger(v); break;
      case 'decimal': valid = typeof v === 'string' && /^-?(0|[1-9]\d{0,11})(\.\d{1,6})?$/.test(v); break;
      case 'boolean': valid = typeof v === 'boolean'; break;
      case 'date': valid = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid; break;
      case 'single_select': valid = typeof v === 'string' && f.options.includes(v); break;
    }
    requireThat(valid, 'INVALID_FIELD', `${f.label} has an invalid value`);
    if (f.type === 'integer' || f.type === 'decimal') {
      const n = new Decimal(v as string | number);
      requireThat((f.minimum === null || n.gte(f.minimum)) && (f.maximum === null || n.lte(f.maximum)), 'FIELD_BOUNDS', `${f.label} is outside allowed bounds`);
    }
  }
}
export type Fact = {id: string; record_type_id: string; occurred_at: string; values: Record<string, unknown>; task_ids: string[]};
export function windowBounds(window: MetricInput['window'], zone: string, now: Date) {
  const t = DateTime.fromJSDate(now, {zone});
  if (window === 'all_time') return {start: null, end: null, period: 'all_time'};
  const start = t.startOf(window);
  return { start: start.toUTC().toISO()!, end: start.plus({[window+'s']: 1}).toUTC().toISO()!, period: start.toISODate()! };
}
export function calculateMetric(def: MetricInput, facts: Fact[], now = new Date(), activation?: string) {
  const bounds = windowBounds(def.window, def.timezone, now);
  let selected = facts.filter(r => r.record_type_id === def.record_type_id &&
    (!bounds.start || Date.parse(r.occurred_at) >= Date.parse(bounds.start)) &&
    (!bounds.end || Date.parse(r.occurred_at) < Date.parse(bounds.end)) &&
    (!activation || Date.parse(r.occurred_at) >= Date.parse(activation)));
  if (def.aggregation !== 'count') selected = selected.filter(r=> Object.hasOwn(r.values,def.field_key!) && r.values[def.field_key!] !== null && r.values[def.field_key!] !== undefined && r.values[def.field_key!] !== '');
  selected.sort((a,b)=>Date.parse(a.occurred_at)-Date.parse(b.occurred_at) || a.id.localeCompare(b.id));
  let value: string | null = null;
  if (selected.length) {
    const nums = selected.map(r=> new Decimal(def.aggregation === 'count' ? 1 : r.values[def.field_key!] as string | number));
    const sum = nums.reduce((a,b)=>a.plus(b), new Decimal(0));
    value = (def.aggregation === 'latest' ? nums.at(-1)! : def.aggregation === 'avg' ? sum.div(nums.length) : sum).toString();
  }
  return {value, sample_count: selected.length, source_record_ids: selected.map(r=>r.id), ...bounds, evaluated_at: now.toISOString(), calculation_version: 1};
}
export function taskProgress(task: TaskInput, facts: Fact[]) {
  const linked = facts.filter(r => r.task_ids.includes(task.id));
  const satisfied = linked.some(r => task.acceptance?.kind === 'exists' || (task.acceptance?.kind === 'field_gte' && Object.hasOwn(r.values,task.acceptance.field_key) && r.values[task.acceptance.field_key] != null && r.values[task.acceptance.field_key] !== '' && new Decimal(r.values[task.acceptance.field_key] as string | number).gte(task.acceptance.threshold)));
  return {satisfied, status: satisfied ? 'completed' : linked.length ? 'partial' : 'pending', source_record_ids: linked.map(r=>r.id)};
}
