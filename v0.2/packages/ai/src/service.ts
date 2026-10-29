import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import type pg from 'pg';
import type { Client } from '../../db/src/client.js';
import { DomainError } from '../../domain/src/index.js';
import type { AiContentType, AiGenerationInput } from '../../contracts/src/index.js';
import { AI_BLUEPRINT_SCHEMA_VERSION } from '../../contracts/src/index.js';
import type { AiConfig } from './config.js';
import type { ModelAdapter, AdapterResult, AdapterUsage } from './adapter.js';
import { AiProviderError, withAiDeadline } from './adapter.js';
import { buildGenerationPrompt, type PromptContext } from './prompt.js';
import { BlueprintError, extractJsonObject, parseBlueprint, type Blueprint, type BlueprintIssue } from './blueprint.js';
import { loadValidationContext, validateBlueprint, type ValidationContext } from './validate.js';
import { buildApplyPlan, type ApplyPlan, type GeneratedKind, type GeneratedObject } from './plan.js';

const json = JSON.stringify;
const EMPTY_USAGE: AdapterUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export interface AiServiceHooks {
  event?: (c: Client, user: string, kind: string, id: string, version: number, payload: unknown) => Promise<void>;
  recompute?: (c: Client, user: string) => Promise<void>;
}

export interface AiEnvelope {
  job: Record<string, unknown>;
  batch: Record<string, unknown> | null;
  already_applied: boolean;
}

export interface RevokeResult {
  batch: Record<string, unknown>;
  revoke: { mode: 'deleted' | 'archived'; deleted_objects: unknown[]; retained_objects: unknown[]; reason: string };
}

export class AiService {
  constructor(
    private readonly pool: pg.Pool,
    readonly config: AiConfig,
    private readonly adapter: ModelAdapter,
    private readonly hooks: AiServiceHooks = {}
  ) {}

  configView() {
    const real = this.config.provider === 'deepseek';
    const configured = real ? Boolean(this.config.apiKey) : true;
    return {
      provider: this.config.provider,
      cloud_ai: real && configured,
      configured,
      model: this.config.model,
      schema_version: AI_BLUEPRINT_SCHEMA_VERSION,
      max_attempts: this.config.maxAttempts,
      timeout_ms: this.config.timeoutMs,
      task_timeout_ms: this.config.taskTimeoutMs,
      daily_job_limit: this.config.dailyJobLimit,
      quota_window_hours: 24,
      quota_unit: 'generation_jobs',
      quota_refund_policy: 'reserved_jobs_count_until_window_expiry',
      monetary_budget_enforced: false,
      max_output_tokens: this.config.maxOutputTokens,
      supported_content_types: ['record_types', 'metrics', 'tasks', 'achievements'] as AiContentType[],
      supported_tasks: { schedules: ['unscheduled', 'once'], completion_modes: ['manual', 'record_optional', 'record_required'] },
      supported_achievements: { repeat_policy: ['once', 'per_period'], history_policy: ['include_existing', 'from_activation'] },
      notes: real
        ? (configured ? ['服务端已配置 DeepSeek；只有用户主动触发生成时才会调用付费接口。'] : ['服务端未配置 DEEPSEEK_API_KEY，生成会明确失败，不影响手动记录。'])
        : ['当前为本地确定性模拟供应商，不会访问 DeepSeek，也不产生 API 费用。']
    };
  }

  configSummary() {
    const v = this.configView();
    return { provider: v.provider, cloud_ai: v.cloud_ai, model: v.model, schema_version: v.schema_version, configured: v.configured };
  }

  // ---- generation ------------------------------------------------------------

  async createGeneration(user: string, input: AiGenerationInput, operationId: string): Promise<AiEnvelope> {
    const requestHash = sha256(canonical(input));
    const c=await this.pool.connect();
    let job: any;
    let ctx: ValidationContext|undefined;
    let replay=false;
    try {
      await c.query('BEGIN');
      const clock=await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE',[user]);
      if(!clock.rowCount) throw new DomainError('ACCOUNT_NOT_READY','Account is not initialized',409);
      const existing=(await c.query('SELECT * FROM ai_generation_jobs WHERE user_id=$1 AND operation_id=$2',[user,operationId])).rows[0];
      if(existing) {
        if(existing.request_hash!==requestHash) throw new DomainError('IDEMPOTENCY_MISMATCH','Operation ID was already used for another generation request',409);
        job=existing;replay=true;
      } else {
      const budget=(await c.query("SELECT count(*)::int AS n FROM ai_generation_jobs WHERE user_id=$1 AND created_at > now() - interval '24 hours'",[user])).rows[0].n as number;
      if(budget>=this.config.dailyJobLimit) throw new DomainError('AI_BUDGET_EXCEEDED','Rolling 24-hour AI generation limit reached; manual features remain available',429,{daily_job_limit:this.config.dailyJobLimit});
      ctx=await this.loadContext(user,input,(text,values)=>c.query(text,values));
      const prompt=buildGenerationPrompt(this.promptContext(input,ctx));
      if(prompt.system.length+prompt.user.length>this.config.maxInputChars) throw new DomainError('AI_INPUT_TOO_LARGE','Generation input is too large for this stage',422);
      // The inserted job reserves one slot. No network I/O occurs while holding this lock.
      job = (await c.query(
        `INSERT INTO ai_generation_jobs(id,user_id,operation_id,request_hash,status,mode,module_id,target_base_version,apply_mode,provider,model,request)
         VALUES($1,$2,$3,$4,'queued',$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
        [randomUUID(), user, operationId, requestHash, input.mode, input.module_id, ctx.targetModule?.version ?? null, input.apply_mode, this.config.provider, this.config.model, json(input)]
      )).rows[0];
      }
      await c.query('COMMIT');
    } catch (error) {
      await c.query('ROLLBACK');
      throw error;
    } finally {c.release();}
    if(replay) return this.envelope(job,true,job.status==='applied');
    return this.runGeneration(user, input, job, ctx!);
  }

  private promptContext(input: AiGenerationInput, ctx: ValidationContext): PromptContext {
    return {
      mode: input.mode,
      targetModuleId: ctx.targetModuleId,
      targetModuleName: ctx.targetModule?.name ?? null,
      targetModuleIcon: ctx.targetModule?.icon ?? null,
      targetModuleColor: ctx.targetModule?.color ?? null,
      timezone: input.timezone,
      contentTypes: input.content_types,
      prompt: input.prompt,
      allowedRecordTypes: [...ctx.recordTypes.values()].map(r => ({ id: r.id, name: r.name, fields: r.fields })),
      allowedMetrics: [...ctx.metrics.values()].map(m => ({ id: m.id, name: m.name, unit: m.unit, aggregation: m.aggregation, field_key: m.field_key, window: m.window }))
    };
  }

  private async loadContext(user: string, input: AiGenerationInput, query=(text:string,values:unknown[])=>this.pool.query(text,values)): Promise<ValidationContext> {
    try {
      return await loadValidationContext(query, user, input);
    } catch (error) {
      if (error instanceof BlueprintError) {
        throw new DomainError(error.issues[0]?.code ?? 'BLUEPRINT_NOT_ALLOWED', error.issues[0]?.message ?? 'Generation target is not accessible', 422, { errors: error.issues });
      }
      throw error;
    }
  }

  private async runGeneration(user: string, input: AiGenerationInput, job: any, ctx: ValidationContext): Promise<AiEnvelope> {
    const prompt = buildGenerationPrompt(this.promptContext(input, ctx));
    if (prompt.system.length + prompt.user.length > this.config.maxInputChars) {
      await this.fail(user, job.id, Number(job.attempts ?? 0), EMPTY_USAGE, 'AI_INPUT_TOO_LARGE', 'Generation input is too large for this stage');
      throw new DomainError('AI_INPUT_TOO_LARGE', 'Generation input is too large for this stage', 422, { job_id: job.id });
    }
    await this.pool.query("UPDATE ai_generation_jobs SET status='generating', updated_at=now() WHERE user_id=$1 AND id=$2", [user, job.id]);

    let attempts = Number(job.attempts ?? 0);
    let usage: AdapterUsage = { ...EMPTY_USAGE, ...job.usage };
    let model = this.adapter.model;
    let result: AdapterResult | null = null;
    let lastProviderError: AiProviderError | null = null;
    const deadline=performance.now()+this.config.taskTimeoutMs;

    while (attempts < this.config.maxAttempts) {
      attempts += 1;
      try {
        const remaining=deadline-performance.now();
        if(remaining<=0) throw new AiProviderError('AI_TIMEOUT','AI model-run total deadline exceeded',true);
        const timeoutMs=Math.min(this.config.timeoutMs,remaining);
        result = await withAiDeadline(timeoutMs,signal=>this.adapter.generate({
          system: prompt.system, user: prompt.user, context: this.promptContext(input, ctx),
          maxOutputTokens: this.config.maxOutputTokens, timeoutMs, signal
        }));
        usage = {
          prompt_tokens: usage.prompt_tokens + result.usage.prompt_tokens,
          completion_tokens: usage.completion_tokens + result.usage.completion_tokens,
          total_tokens: usage.total_tokens + result.usage.total_tokens
        };
        model = result.model;
        break;
      } catch (error) {
        const providerError = error instanceof AiProviderError ? error : new AiProviderError('AI_UNAVAILABLE', 'AI provider call failed', false);
        lastProviderError = providerError;
        if (providerError.retryable && attempts < this.config.maxAttempts) {
          const backoff=250*attempts;
          const remaining=deadline-performance.now();
          if(remaining<=backoff) {
            const timeout=new AiProviderError('AI_TIMEOUT','AI model-run deadline leaves no time for another attempt',true);
            await this.fail(user,job.id,attempts,usage,timeout.code,timeout.message);
            throw this.providerDomainError(timeout,job.id,attempts);
          }
          await sleep(backoff);
          continue;
        }
        await this.fail(user, job.id, attempts, usage, providerError.code, providerError.message);
        throw this.providerDomainError(providerError, job.id, attempts);
      }
    }
    if (!result) {
      const message = lastProviderError?.message ?? 'AI provider returned no result';
      await this.fail(user, job.id, attempts, usage, lastProviderError?.code ?? 'AI_UNAVAILABLE', message);
      throw new DomainError(lastProviderError?.code ?? 'AI_UNAVAILABLE', message, 503, { job_id: job.id, attempts });
    }

    await this.pool.query("UPDATE ai_generation_jobs SET status='validating', attempts=$3, usage=$4, model=$5, updated_at=now() WHERE user_id=$1 AND id=$2", [user, job.id, attempts, json(usage), model]);

    let blueprint: Blueprint;
    let warnings: string[];
    try {
      const raw = extractJsonObject(result.text);
      blueprint = parseBlueprint(raw);
      warnings = validateBlueprint(blueprint, ctx).warnings;
    } catch (error) {
      if (error instanceof BlueprintError) {
        await this.needsFix(user, job.id, error, result.text, attempts, usage, model);
        throw this.validationDomainError(error, job.id);
      }
      throw error;
    }

    if (input.apply_mode === 'preview') {
      const updated = (await this.pool.query(
        "UPDATE ai_generation_jobs SET status='preview_ready', candidate=$3, validation=$4, warnings=$5, error_code=NULL, error_message=NULL, attempts=$6, usage=$7, model=$8, finished_at=now(), updated_at=now(), version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
        [user, job.id, json(blueprint), json({ valid: true, errors: [], warnings }), json(warnings), attempts, json(usage), model]
      )).rows[0];
      return this.envelope(updated, true);
    }
    return this.applyValidated(user, job.id, input, blueprint, warnings);
  }

  private async applyValidated(user: string, jobId: string, input: AiGenerationInput, blueprint: Blueprint, warnings: string[]): Promise<AiEnvelope> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE', [user]);
      const job = (await c.query('SELECT * FROM ai_generation_jobs WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, jobId])).rows[0];
      if (!job) throw new DomainError('JOB_NOT_FOUND', 'Generation job not found', 404);
      const existingBatch = (await c.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND job_id=$2', [user, jobId])).rows[0];
      if (existingBatch) { await c.query('COMMIT'); return this.envelope(job, true, true); }

      let ctx: ValidationContext;
      try { ctx = await loadValidationContext((text, values) => c.query(text, values), user, input); }
      catch (error) {
        await c.query('ROLLBACK');
        if (error instanceof BlueprintError) {
          await this.markJobNeedsFix(user, jobId, 'MODULE_CONFLICT', error.issues[0]?.message ?? 'Target module changed', error.issues);
          throw new DomainError('MODULE_CONFLICT', error.issues[0]?.message ?? 'Target module changed', 409, { job_id: jobId, errors: error.issues });
        }
        throw error;
      }
      if (input.mode === 'extend' && (!ctx.targetModule || ctx.targetModule.version !== job.target_base_version)) {
        await c.query('ROLLBACK');
        const current = ctx.targetModule?.version ?? 0;
        await this.markJobNeedsFix(user, jobId, 'MODULE_CONFLICT', 'Target module version changed while generating; candidate was kept', []);
        throw new DomainError('MODULE_CONFLICT', 'Target module version changed while generating; candidate was kept', 409, { job_id: jobId, expected_version: job.target_base_version, current_version: current });
      }

      let validatedWarnings = warnings;
      try { validatedWarnings = validateBlueprint(blueprint, ctx).warnings; }
      catch (error) {
        if (error instanceof BlueprintError) {
          await c.query('ROLLBACK');
          await this.markJobNeedsFix(user, jobId, 'BLUEPRINT_NOT_APPLICABLE', error.issues[0]?.message ?? 'Candidate no longer applies', error.issues);
          throw this.validationDomainError(error, jobId);
        }
        throw error;
      }

      const plan = buildApplyPlan(blueprint, ctx);
      validatedWarnings = [...new Set([...validatedWarnings, ...plan.warnings])];
      await this.insertPlan(c, user, plan);
      const batchId = randomUUID();
      await c.query(
        "INSERT INTO ai_generation_batches(id,user_id,job_id,module_id,module_created,status,base_module_version,id_map,objects) VALUES($1,$2,$3,$4,$5,'applied',$6,$7,$8)",
        [batchId, user, jobId, plan.target_module_id, plan.module_created, plan.base_module_version,
          json(Object.fromEntries(plan.objects.map(o => [o.local_ref, { kind: o.kind, id: o.id }]))), json(plan.objects)]
      );
      const validation = { valid: true, errors: [], warnings: validatedWarnings };
      const updated = (await c.query(
        "UPDATE ai_generation_jobs SET status='applied', candidate=$3, validation=$4, warnings=$5, error_code=NULL, error_message=NULL, finished_at=now(), updated_at=now(), version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *",
        [user, jobId, json(blueprint), json(validation), json(validatedWarnings)]
      )).rows[0];
      const batch = (await c.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND id=$2', [user, batchId])).rows[0];
      if (this.hooks.recompute) await this.hooks.recompute(c, user);
      await c.query('COMMIT');
      return { job: this.jobView(updated, batch, true), batch: this.batchView(batch), already_applied: false };
    } catch (error) {
      try { await c.query('ROLLBACK'); } catch { /* already rolled back */ }
      if (error instanceof DomainError) throw error;
      if ((error as { code?: string }).code === '23505') {
        const job = await this.jobRow(user, jobId);
        const batch = job ? await this.batchRow(user, jobId) : null;
        if (job && batch) return { job: this.jobView(job, batch, true), batch: this.batchView(batch), already_applied: true };
      }
      throw error;
    } finally { c.release(); }
  }

  private async insertPlan(c: Client, user: string, plan: ApplyPlan) {
    const emit = async (kind: string, id: string, version: number, row: unknown) => {
      if (this.hooks.event) await this.hooks.event(c, user, kind, id, version, row);
    };
    if (plan.module) {
      const row = (await c.query(
        "INSERT INTO modules(id,user_id,name,description,icon,color,source,sort_order) VALUES($1,$2,$3,$4,$5,$6,'ai',(SELECT COALESCE(max(sort_order),-1)+1 FROM modules WHERE user_id=$2)) RETURNING *",
        [plan.module.id, user, plan.module.name, plan.module.description, plan.module.icon, plan.module.color]
      )).rows[0];
      await emit('module', row.id, row.version, row);
    }
    for (const rt of plan.record_types) {
      const row = (await c.query('INSERT INTO record_types(id,user_id,module_id,name,fields) VALUES($1,$2,$3,$4,$5) RETURNING *', [rt.id, user, rt.module_id, rt.name, json(rt.fields)])).rows[0];
      await emit('record_type', row.id, 1, row);
    }
    for (const metric of plan.metrics) {
      const row = (await c.query('INSERT INTO metric_definitions(id,user_id,module_id,record_type_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *', [metric.id, user, metric.module_id, metric.record_type_id, json(metric.definition)])).rows[0];
      await emit('metric', row.id, 1, row);
    }
    for (const task of plan.tasks) {
      await c.query('INSERT INTO task_templates(id,user_id,module_id,definition) VALUES($1,$2,$3,$4)', [task.template_id, user, task.module_id, json(task.definition)]);
      const row = (await c.query('INSERT INTO tasks(id,user_id,module_id,template_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *', [task.id, user, task.module_id, task.template_id, json(task.definition)])).rows[0];
      await emit('task', row.id, 1, row);
    }
    for (const achievement of plan.achievements) {
      const row = (await c.query('INSERT INTO achievement_definitions(id,user_id,module_id,metric_id,definition) VALUES($1,$2,$3,$4,$5) RETURNING *', [achievement.id, user, achievement.module_id, achievement.metric_id, json(achievement.definition)])).rows[0];
      await emit('achievement', row.id, 1, row);
    }
  }

  // ---- job queries -----------------------------------------------------------

  private async jobRow(user: string, id: string): Promise<any | null> {
    return (await this.pool.query('SELECT * FROM ai_generation_jobs WHERE user_id=$1 AND id=$2', [user, id])).rows[0] ?? null;
  }

  private async batchRow(user: string, jobId: string): Promise<any | null> {
    return (await this.pool.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND job_id=$2', [user, jobId])).rows[0] ?? null;
  }

  async getGeneration(user: string, id: string): Promise<AiEnvelope> {
    const job = await this.jobRow(user, id);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Generation job not found', 404);
    return this.envelope(job, true);
  }

  async listGenerations(user: string, query: { limit: number; offset: number; module_id?: string }) {
    const filter = query.module_id ? ' AND j.module_id=$4' : '';
    const values: unknown[] = [user, query.limit, query.offset];
    if (query.module_id) values.push(query.module_id);
    const rows = (await this.pool.query(
      `SELECT j.*, b.id AS batch_pk FROM ai_generation_jobs j LEFT JOIN ai_generation_batches b ON b.user_id=j.user_id AND b.job_id=j.id
       WHERE j.user_id=$1${filter} ORDER BY j.created_at DESC, j.id DESC LIMIT $2 OFFSET $3`, values
    )).rows;
    const total = (await this.pool.query(
      `SELECT count(*)::int AS n FROM ai_generation_jobs j WHERE j.user_id=$1${query.module_id ? ' AND j.module_id=$2' : ''}`,
      query.module_id ? [user, query.module_id] : [user]
    )).rows[0].n;
    const data = [];
    for (const row of rows) {
      const batch = row.batch_pk ? (await this.pool.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND id=$2', [user, row.batch_pk])).rows[0] : null;
      data.push(this.jobView(row, batch, false));
    }
    return { data, page: { limit: query.limit, offset: query.offset, total } };
  }

  async applyGeneration(user: string, id: string, baseModuleVersion: number | null): Promise<AiEnvelope> {
    const job = await this.jobRow(user, id);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Generation job not found', 404);
    const batch = await this.batchRow(user, id);
    if (batch || job.status === 'applied') return this.envelope(job, true, true);
    if (job.status !== 'preview_ready' && job.status !== 'needs_fix') throw new DomainError('NOT_APPLICABLE', 'Only a preview candidate can be applied', 409, { status: job.status });
    if (!job.candidate) throw new DomainError('NO_CANDIDATE', 'This job has no retained candidate to apply', 409);
    if (baseModuleVersion !== null && baseModuleVersion !== job.target_base_version) {
      throw new DomainError('VERSION_CONFLICT', 'Module version changed since the candidate was generated', 409, { job_id: id, expected_version: job.target_base_version, current_version: baseModuleVersion });
    }
    const input: AiGenerationInput = job.request;
    let blueprint: Blueprint;
    try { blueprint = parseBlueprint(job.candidate); }
    catch (error) { if (error instanceof BlueprintError) throw this.validationDomainError(error, id); throw error; }
    return this.applyValidated(user, id, input, blueprint, job.warnings ?? []);
  }

  async retryGeneration(user: string, id: string): Promise<AiEnvelope> {
    const claimed = (await this.pool.query(
      `UPDATE ai_generation_jobs SET status='generating', error_code=NULL, error_message=NULL, updated_at=now()
       WHERE user_id=$1 AND id=$2 AND attempts < $3
         AND (status IN ('needs_fix','failed') OR (status='generating' AND updated_at < now() - interval '2 minutes'))
       RETURNING *`, [user, id, this.config.maxAttempts]
    )).rows[0];
    if (!claimed) {
      const job = await this.jobRow(user, id);
      if (!job) throw new DomainError('JOB_NOT_FOUND', 'Generation job not found', 404);
      if (job.status === 'applied') return this.envelope(job, true, true);
      throw new DomainError('NOT_RETRYABLE', 'This generation cannot be retried (already running, exhausted attempts, or cancelled)', 409, { status: job.status, attempts: job.attempts });
    }
    const input: AiGenerationInput = claimed.request;
    let ctx: ValidationContext;
    try { ctx = await this.loadContext(user, input); }
    catch (error) {
      if (error instanceof DomainError) {
        await this.fail(user, id, Number(claimed.attempts ?? 0), EMPTY_USAGE, error.code, error.message);
      }
      throw error;
    }
    return this.runGeneration(user, input, claimed, ctx);
  }

  async cancelGeneration(user: string, id: string): Promise<AiEnvelope> {
    const job = await this.jobRow(user, id);
    if (!job) throw new DomainError('JOB_NOT_FOUND', 'Generation job not found', 404);
    if (job.status === 'cancelled') return this.envelope(job, true);
    if (job.status !== 'preview_ready' && job.status !== 'needs_fix') throw new DomainError('NOT_APPLICABLE', 'Only an unapplied candidate can be cancelled', 409, { status: job.status });
    const updated = (await this.pool.query("UPDATE ai_generation_jobs SET status='cancelled', finished_at=now(), updated_at=now(), version=version+1 WHERE user_id=$1 AND id=$2 RETURNING *", [user, id])).rows[0];
    return this.envelope(updated, true);
  }

  // ---- batches ---------------------------------------------------------------

  async listBatches(user: string, query: { limit: number; offset: number; module_id?: string }) {
    const filter = query.module_id ? ' AND module_id=$4' : '';
    const values: unknown[] = [user, query.limit, query.offset];
    if (query.module_id) values.push(query.module_id);
    const rows = (await this.pool.query(`SELECT * FROM ai_generation_batches WHERE user_id=$1${filter} ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, values)).rows;
    const countFilter=query.module_id?' AND module_id=$2':'';
    const total = (await this.pool.query(`SELECT count(*)::int AS n FROM ai_generation_batches WHERE user_id=$1${countFilter}`, query.module_id ? [user, query.module_id] : [user])).rows[0].n;
    return { data: rows.map(b => this.batchView(b)), page: { limit: query.limit, offset: query.offset, total } };
  }

  async getBatch(user: string, id: string) {
    const batch = (await this.pool.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND id=$2', [user, id])).rows[0];
    if (!batch) throw new DomainError('BATCH_NOT_FOUND', 'Generation batch not found', 404);
    return { batch: this.batchView(batch) };
  }

  async revokeBatch(user: string, id: string): Promise<RevokeResult> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT seq FROM user_sync_clock WHERE user_id=$1 FOR UPDATE', [user]);
      const batch = (await c.query('SELECT * FROM ai_generation_batches WHERE user_id=$1 AND id=$2 FOR UPDATE', [user, id])).rows[0];
      if (!batch) throw new DomainError('BATCH_NOT_FOUND', 'Generation batch not found', 404);
      if (batch.status === 'revoked') {
        await c.query('COMMIT');
        return { batch: this.batchView(batch), revoke: { mode: batch.revoke_mode ?? 'archived', deleted_objects: [], retained_objects: batch.objects, reason: 'Batch was already revoked' } };
      }
      const objects = (batch.objects as GeneratedObject[]) ?? [];
      const refs = await this.batchReferences(c, user, objects);
      const referenced = refs.records + refs.record_tasks + refs.awards + refs.external_metrics + refs.external_achievements + refs.external_tasks > 0;
      const byKind = (kind: GeneratedKind) => objects.filter(o => o.kind === kind).map(o => o.id);
      const recordTypeIds = byKind('record_type'), metricIds = byKind('metric'), taskIds = byKind('task'), achievementIds = byKind('achievement');
      const emit = async (kind: string, objectId: string, version: number, row: unknown) => {
        if (this.hooks.event) await this.hooks.event(c, user, kind, objectId, version, row);
      };
      let mode: 'deleted' | 'archived';
      const deleted: unknown[] = [];
      const retained: unknown[] = [];
      if (referenced) {
        mode = 'archived';
        if (batch.module_created) {
          const row = (await c.query("UPDATE modules SET status='archived', version=version+1, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *", [user, batch.module_id])).rows[0];
          if (row) await emit('module', row.id, row.version, row);
          retained.push({ kind: 'module', id: batch.module_id, action: 'archived' });
        }
        for (const taskId of taskIds) {
          const row = (await c.query("UPDATE tasks SET status='cancelled', version=version+1, updated_at=now() WHERE user_id=$1 AND id=$2 RETURNING *", [user, taskId])).rows[0];
          if (row) await emit('task', row.id, row.version, row);
          retained.push({ kind: 'task', id: taskId, action: 'cancelled' });
        }
        for (const metricId of metricIds) {
          const row = (await c.query('UPDATE metric_definitions SET archived_at=now(), version=version+1 WHERE user_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *', [user, metricId])).rows[0];
          if (row) await emit('metric', row.id, row.version, row);
          retained.push({ kind: 'metric', id: metricId, action: 'archived' });
        }
        for (const achievementId of achievementIds) {
          const row = (await c.query('UPDATE achievement_definitions SET archived_at=now(), version=version+1 WHERE user_id=$1 AND id=$2 AND archived_at IS NULL RETURNING *', [user, achievementId])).rows[0];
          if (row) await emit('achievement', row.id, row.version, row);
          retained.push({ kind: 'achievement', id: achievementId, action: 'archived' });
        }
        if (metricIds.length) {
          // An achievement created outside the batch cannot stay active while its only metric is archived.
          const dependents = (await c.query(
            'UPDATE achievement_definitions SET archived_at=now(), version=version+1 WHERE user_id=$1 AND archived_at IS NULL AND metric_id = ANY($2::uuid[]) AND id <> ALL($3::uuid[]) RETURNING *',
            [user, metricIds, achievementIds]
          )).rows;
          for (const row of dependents) {
            await emit('achievement', row.id, row.version, row);
            retained.push({ kind: 'achievement', id: row.id, action: 'archived' });
          }
        }
        for (const objectId of recordTypeIds) retained.push({ kind: 'record_type', id: objectId, action: 'retained' });
      } else {
        mode = 'deleted';
        const templateIds = taskIds.length
          ? (await c.query('SELECT template_id FROM tasks WHERE user_id=$1 AND id = ANY($2::uuid[])', [user, taskIds])).rows.map((r: any) => r.template_id)
          : [];
        for (const taskId of taskIds) {
          await c.query('DELETE FROM tasks WHERE user_id=$1 AND id=$2', [user, taskId]);
          await emit('task', taskId, 1, { id: taskId, deleted: true });
          deleted.push({ kind: 'task', id: taskId, action: 'deleted' });
        }
        if (templateIds.length) await c.query('DELETE FROM task_templates WHERE user_id=$1 AND id = ANY($2::uuid[])', [user, templateIds]);
        for (const achievementId of achievementIds) {
          await c.query('DELETE FROM achievement_definitions WHERE user_id=$1 AND id=$2', [user, achievementId]);
          await emit('achievement', achievementId, 1, { id: achievementId, deleted: true });
          deleted.push({ kind: 'achievement', id: achievementId, action: 'deleted' });
        }
        for (const metricId of metricIds) {
          await c.query('DELETE FROM metric_definitions WHERE user_id=$1 AND id=$2', [user, metricId]);
          await emit('metric', metricId, 1, { id: metricId, deleted: true });
          deleted.push({ kind: 'metric', id: metricId, action: 'deleted' });
        }
        for (const recordTypeId of recordTypeIds) {
          await c.query('DELETE FROM record_types WHERE user_id=$1 AND id=$2', [user, recordTypeId]);
          await emit('record_type', recordTypeId, 1, { id: recordTypeId, deleted: true });
          deleted.push({ kind: 'record_type', id: recordTypeId, action: 'deleted' });
        }
        if (batch.module_created) {
          await c.query("DELETE FROM modules WHERE user_id=$1 AND id=$2 AND source='ai'", [user, batch.module_id]);
          await emit('module', batch.module_id, 1, { id: batch.module_id, deleted: true });
          deleted.push({ kind: 'module', id: batch.module_id, action: 'deleted' });
        }
      }
      const updated = (await c.query("UPDATE ai_generation_batches SET status='revoked', revoked_at=now(), revoke_mode=$3 WHERE user_id=$1 AND id=$2 RETURNING *", [user, id, mode])).rows[0];
      if (this.hooks.recompute) await this.hooks.recompute(c, user);
      await c.query('COMMIT');
      return {
        batch: this.batchView(updated),
        revoke: {
          mode, deleted_objects: deleted, retained_objects: retained,
          reason: referenced
            ? 'Batch objects are referenced by real records, awards or other configuration; they were archived/cancelled and no factual data was deleted.'
            : 'Batch had no real records or external references; the definitions created by this batch were removed.'
        }
      };
    } catch (error) {
      try { await c.query('ROLLBACK'); } catch { /* already rolled back */ }
      throw error;
    } finally { c.release(); }
  }

  private async batchReferences(c: Client, user: string, objects: GeneratedObject[]) {
    const ids = (kind: GeneratedKind) => objects.filter(o => o.kind === kind).map(o => o.id);
    const recordTypeIds = ids('record_type'), metricIds = ids('metric'), taskIds = ids('task'), achievementIds = ids('achievement');
    const row = (await c.query(
      `SELECT
        (SELECT count(*)::int FROM records WHERE user_id=$1 AND record_type_id = ANY($2::uuid[])) AS records,
        (SELECT count(*)::int FROM record_tasks WHERE user_id=$1 AND task_id = ANY($3::uuid[])) AS record_tasks,
        (SELECT count(*)::int FROM achievement_awards WHERE user_id=$1 AND achievement_id = ANY($4::uuid[])) AS awards,
        (SELECT count(*)::int FROM metric_definitions WHERE user_id=$1 AND archived_at IS NULL AND id <> ALL($5::uuid[]) AND definition->>'record_type_id' = ANY($6::text[])) AS external_metrics,
        (SELECT count(*)::int FROM achievement_definitions WHERE user_id=$1 AND archived_at IS NULL AND id <> ALL($4::uuid[]) AND metric_id = ANY($5::uuid[])) AS external_achievements,
        (SELECT count(*)::int FROM tasks WHERE user_id=$1 AND id <> ALL($3::uuid[]) AND definition->>'record_type_id' = ANY($6::text[])) AS external_tasks`,
      [user, recordTypeIds, taskIds, achievementIds, metricIds, recordTypeIds.map(String)]
    )).rows[0];
    return { records: row.records, record_tasks: row.record_tasks, awards: row.awards, external_metrics: row.external_metrics, external_achievements: row.external_achievements, external_tasks: row.external_tasks };
  }

  // ---- views -----------------------------------------------------------------

  private async envelope(job: any, includeCandidate: boolean, alreadyApplied = false): Promise<AiEnvelope> {
    const batch = await this.batchRow(job.user_id, job.id);
    return { job: this.jobView(job, batch, includeCandidate), batch: batch ? this.batchView(batch) : null, already_applied: alreadyApplied };
  }

  private jobView(job: any, batch: any | null, includeCandidate: boolean) {
    const candidate = job.candidate as Blueprint | null;
    const warnings = Array.isArray(job.warnings) ? job.warnings : [];
    const summary = candidate
      ? { module: candidate.module.mode === 'create' ? 1 : 0, record_types: candidate.record_types.length, metrics: candidate.metrics.length, tasks: candidate.tasks.length, achievements: candidate.achievements.length }
      : batch ? this.summaryFromObjects(batch.objects) : { module: 0, record_types: 0, metrics: 0, tasks: 0, achievements: 0 };
    return {
      id: job.id,
      status: job.status,
      mode: job.mode,
      module_id: job.module_id,
      target_base_version: job.target_base_version,
      apply_mode: job.apply_mode,
      provider: job.provider,
      model: job.model,
      attempts: job.attempts,
      usage: job.usage ?? {},
      error: job.error_code ? { code: job.error_code, message: job.error_message ?? '' } : null,
      warnings,
      validation: job.validation ?? { valid: false, errors: [], warnings: [] },
      candidate: includeCandidate ? candidate : null,
      summary,
      batch_id: batch?.id ?? null,
      created_at: iso(job.created_at),
      updated_at: iso(job.updated_at),
      finished_at: iso(job.finished_at)
    };
  }

  private batchView(batch: any) {
    const objects = batch.objects ?? [];
    return {
      id: batch.id,
      job_id: batch.job_id,
      module_id: batch.module_id,
      module_created: batch.module_created,
      status: batch.status,
      base_module_version: batch.base_module_version,
      id_map: batch.id_map ?? {},
      objects,
      summary: this.summaryFromObjects(objects),
      applied_at: iso(batch.created_at),
      revoked_at: iso(batch.revoked_at),
      revoke_mode: batch.revoke_mode ?? null
    };
  }

  private summaryFromObjects(objects: GeneratedObject[]) {
    const summary: Record<GeneratedKind, number> = { module: 0, record_type: 0, metric: 0, task: 0, achievement: 0 };
    for (const object of objects) summary[object.kind] = (summary[object.kind] ?? 0) + 1;
    return summary;
  }

  // ---- failure helpers --------------------------------------------------------

  private async fail(user: string, jobId: string, attempts: number, usage: AdapterUsage, code: string, message: string) {
    await this.pool.query(
      "UPDATE ai_generation_jobs SET status='failed', error_code=$3, error_message=$4, attempts=$5, usage=$6, finished_at=now(), updated_at=now(), version=version+1 WHERE user_id=$1 AND id=$2",
      [user, jobId, code, message.slice(0, 500), attempts, json(usage)]
    );
  }

  private async markJobNeedsFix(user: string, jobId: string, code: string, message: string, errors: BlueprintIssue[]) {
    const current = await this.jobRow(user, jobId);
    await this.pool.query(
      "UPDATE ai_generation_jobs SET status='needs_fix', error_code=$3, error_message=$4, validation=$5, finished_at=now(), updated_at=now(), version=version+1 WHERE user_id=$1 AND id=$2",
      [user, jobId, code, message.slice(0, 500), json({ valid: false, errors, warnings: current?.warnings ?? [] })]
    );
  }

  private async needsFix(user: string, jobId: string, error: BlueprintError, rawText: string, attempts: number, usage: AdapterUsage, model: string) {
    const issues = error.issues;
    const code = issues.some(i => i.layer === 'parse' || i.layer === 'structure') ? 'BLUEPRINT_INVALID' : issues.some(i => i.layer === 'permission') ? 'BLUEPRINT_NOT_ALLOWED' : 'BLUEPRINT_SEMANTIC_ERROR';
    await this.pool.query(
      `UPDATE ai_generation_jobs SET status='needs_fix', candidate=$3, validation=$4, warnings=$5, error_code=$6, error_message=$7,
         attempts=$8, usage=$9, model=$10, finished_at=now(), updated_at=now(), version=version+1
       WHERE user_id=$1 AND id=$2`,
      [user, jobId, error.candidate === null ? null : json(error.candidate), json({ valid: false, errors: issues, warnings: [] }),
        json([]), code, (issues[0]?.message ?? 'Blueprint failed validation').slice(0, 500), attempts, json(usage), model]
    );
    void rawText;
  }

  private validationDomainError(error: BlueprintError, jobId: string): DomainError {
    const issues = error.issues;
    const code = issues.some(i => i.layer === 'parse' || i.layer === 'structure') ? 'BLUEPRINT_INVALID' : issues.some(i => i.layer === 'permission') ? 'BLUEPRINT_NOT_ALLOWED' : 'BLUEPRINT_SEMANTIC_ERROR';
    const status = 422;
    return new DomainError(code, issues[0]?.message ?? 'Blueprint failed server validation', status, { job_id: jobId, errors: issues });
  }

  private providerDomainError(error: AiProviderError, jobId: string, attempts: number): DomainError {
    const status = error.code === 'AI_TIMEOUT' ? 504
      : error.code === 'AI_INVALID_OUTPUT' || error.code === 'AI_OUTPUT_TRUNCATED' ? 502
        : 503;
    return new DomainError(error.code, error.message, status, { job_id: jobId, attempts, retryable: error.retryable, ...error.details });
  }
}

const iso = (value: unknown): string | null => value instanceof Date ? value.toISOString() : value ? String(value) : null;
