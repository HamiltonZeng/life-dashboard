import type { Field } from '../../contracts/src/index.js';
import type { Blueprint } from './blueprint.js';
import type { PromptContext } from './prompt.js';

export type AiErrorCode =
  | 'AI_NOT_CONFIGURED' | 'AI_AUTH' | 'AI_QUOTA' | 'AI_RATE_LIMIT' | 'AI_TIMEOUT'
  | 'AI_UNAVAILABLE' | 'AI_BAD_REQUEST' | 'AI_INVALID_OUTPUT' | 'AI_OUTPUT_TRUNCATED';

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly details: Record<string, unknown> = {}
  ) { super(message); this.name = 'AiProviderError'; }
}

/** Bound the full async operation, including transports that ignore cancellation. */
export async function withAiDeadline<T>(timeoutMs:number,run:(signal:AbortSignal)=>Promise<T>,parent?:AbortSignal):Promise<T> {
  const controller=new AbortController();
  const deadline=performance.now()+timeoutMs;
  let rejectDeadline!:(reason:unknown)=>void;
  const expired=new Promise<never>((_resolve,reject)=>{rejectDeadline=reject;});
  const abort=()=>{controller.abort();rejectDeadline(new AiProviderError('AI_TIMEOUT','AI operation deadline exceeded',true));};
  const timer=setTimeout(abort,Math.max(0,timeoutMs));
  parent?.addEventListener('abort',abort,{once:true});
  try {
    if(parent?.aborted) abort();
    return await Promise.race([Promise.resolve().then(async()=>{
      if(controller.signal.aborted)throw new AiProviderError('AI_TIMEOUT','AI operation deadline exceeded',true);
      const result=await run(controller.signal);
      if(controller.signal.aborted || performance.now()>=deadline)throw new AiProviderError('AI_TIMEOUT','AI operation deadline exceeded',true);
      return result;
    }),expired]);
  } finally {clearTimeout(timer);parent?.removeEventListener('abort',abort);}
}

export interface AdapterUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number; }

export interface AdapterInput {
  system: string;
  user: string;
  context: PromptContext;
  maxOutputTokens: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AdapterResult {
  text: string;
  usage: AdapterUsage;
  finish_reason: string | null;
  model: string;
  attempts: number;
}

export interface ModelAdapter {
  readonly provider: string;
  readonly model: string;
  readonly cloud: boolean;
  generate(input: AdapterInput): Promise<AdapterResult>;
}

export interface DeepSeekOptions { apiKey: string; model: string; baseUrl: string; }

function normalizeUsage(raw: any): AdapterUsage {
  const usage = raw && typeof raw === 'object' ? raw : {};
  const prompt = Number(usage.prompt_tokens ?? 0) || 0;
  const completion = Number(usage.completion_tokens ?? 0) || 0;
  const total = Number(usage.total_tokens ?? prompt + completion) || 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

export class DeepSeekAdapter implements ModelAdapter {
  readonly provider = 'deepseek';
  readonly cloud = true;
  constructor(readonly options: DeepSeekOptions, private readonly fetchImpl: typeof fetch = fetch) {}
  get model(): string { return this.options.model; }

  async generate(input: AdapterInput): Promise<AdapterResult> {
    if (!this.options.apiKey) throw new AiProviderError('AI_NOT_CONFIGURED', 'DeepSeek API key is not configured on the server');
    const url = this.options.baseUrl.replace(/\/+$/, '') + '/chat/completions';
    return withAiDeadline(input.timeoutMs,async signal=>{
      let response:Response;
      try {response = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.options.apiKey}` },
        body: JSON.stringify({
          model: this.options.model,
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.user }],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: input.maxOutputTokens,
          stream: false
        }),
        signal
      });} catch {
        if(signal.aborted) throw new AiProviderError('AI_TIMEOUT','DeepSeek request timed out',true);
        throw new AiProviderError('AI_UNAVAILABLE','Could not reach DeepSeek API',true);
      }

    const cancelBody=()=>{void response.body?.cancel().catch(()=>{});};
    signal.addEventListener('abort',cancelBody,{once:true});
    if(signal.aborted) {cancelBody();throw new AiProviderError('AI_TIMEOUT','DeepSeek request timed out',true);}
    try {
    let text:string;
    try {text=await response.text();} catch {
      if(signal.aborted) throw new AiProviderError('AI_TIMEOUT','DeepSeek response body timed out',true);
      throw new AiProviderError('AI_UNAVAILABLE','DeepSeek response body was interrupted',true);
    }
    if(signal.aborted)throw new AiProviderError('AI_TIMEOUT','DeepSeek response body timed out',true);

    if (!response.ok) {
      // Never include headers, request bodies or keys in error details.
      const status = response.status;
      if (status === 401 || status === 403) throw new AiProviderError('AI_AUTH', 'DeepSeek rejected the configured server API key', false, { http_status: status });
      if (status === 402) throw new AiProviderError('AI_QUOTA', 'DeepSeek account balance is insufficient', false, { http_status: status });
      if (status === 429) throw new AiProviderError('AI_RATE_LIMIT', 'DeepSeek rate limit reached', true, { http_status: status });
      if (status === 400 || status === 422) throw new AiProviderError('AI_BAD_REQUEST', 'DeepSeek rejected the request format or selected model', false, { http_status: status });
      if (status >= 500) throw new AiProviderError('AI_UNAVAILABLE', 'DeepSeek is temporarily unavailable', true, { http_status: status });
      throw new AiProviderError('AI_UNAVAILABLE', `DeepSeek request failed with HTTP ${status}`, false, { http_status: status });
    }

    let payload: any;
    try { payload = JSON.parse(text); } catch { throw new AiProviderError('AI_INVALID_OUTPUT', 'DeepSeek returned a non-JSON response envelope', false); }
    const choice = payload?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) throw new AiProviderError('AI_INVALID_OUTPUT', 'DeepSeek returned no structured content', false);
    if (choice?.finish_reason === 'length') throw new AiProviderError('AI_OUTPUT_TRUNCATED', 'DeepSeek output was truncated before the JSON object completed', true);
    return {
      text: content,
      usage: normalizeUsage(payload?.usage),
      finish_reason: choice?.finish_reason ?? null,
      model: typeof payload?.model === 'string' ? payload.model : this.options.model,
      attempts: 1
    };
    } finally {signal.removeEventListener('abort',cancelBody);}
    },input.signal);
  }
}

function textField(key: string, label: string, type: Field['type'], required: boolean, extra: Partial<Field> = {}): Field {
  return { key, label, type, required, unit: null, options: [], minimum: null, maximum: null, ...extra };
}

/** Deterministic local provider used for development and tests; it never leaves the machine. */
export class MockAdapter implements ModelAdapter {
  readonly provider = 'mock';
  readonly model = 'mock-blueprint-1';
  readonly cloud = false;

  async generate(input: AdapterInput): Promise<AdapterResult> {
    const blueprint = mockBlueprint(input.context);
    const text = JSON.stringify(blueprint);
    const promptTokens = Math.ceil((input.system.length + input.user.length) / 4);
    return {
      text,
      usage: { prompt_tokens: promptTokens, completion_tokens: Math.ceil(text.length / 4), total_tokens: promptTokens + Math.ceil(text.length / 4) },
      finish_reason: 'stop',
      model: this.model,
      attempts: 1
    };
  }
}

export function mockBlueprint(ctx: PromptContext): Blueprint {
  const content = new Set(ctx.contentTypes);
  const warnings = ['这是本地模拟供应商返回的确定性示例配置，没有调用 DeepSeek，也没有生成任何真实记录。'];
  const refs = new Set<string>();
  const local = (key: string) => { refs.add(`local:${key}`); return `local:${key}`; };

  const moduleLocal = local('ai_module');
  const moduleName = (ctx.prompt.split('\n')[0].trim().slice(0, 20) || 'AI 练习模块');
  const moduleIcon = ctx.mode === 'extend' ? (ctx.targetModuleIcon as any) : 'sparkles';
  const moduleColor = ctx.mode === 'extend' ? (ctx.targetModuleColor as any) : 'violet';

  let recordType: Blueprint['record_types'][number] | null = null;
  let numericField: Field | null = null;
  if (content.has('record_types')) {
    const fields = [
      textField('topic', '内容', 'text', true),
      textField('duration_minutes', '实际分钟数', 'integer', false, { unit: '分钟', minimum: 0, maximum: 1440 }),
      textField('reflection', '感受或发现', 'textarea', false)
    ];
    recordType = {
      local_ref: local('ai_practice_log'), name: 'AI 练习记录', description: '本地模拟生成的通用练习记录模板。',
      renderer_kind: 'generic', fields: fields.map(f => ({ key: f.key, label: f.label, type: f.type, required: f.required, unit: f.unit, options: f.options, minimum: f.minimum, maximum: f.maximum }))
    };
    numericField = fields[1];
  }

  if (content.has('metrics') && !content.has('record_types') && ctx.allowedRecordTypes.length === 0) {
    warnings.push('模拟供应商在新建模块且未生成记录模板时无法生成数值定义；请同时选择记录模板。');
  }
  if (content.has('achievements') && ctx.allowedMetrics.length === 0 && !content.has('metrics')) {
    warnings.push('模拟供应商需要已有数值或本次生成的数值才能创建成就；请同时选择数值。');
  }
  const existingType = ctx.allowedRecordTypes[0] ?? null;
  const sourceTypeRef = recordType ? recordType.local_ref : existingType ? `id:${existingType.id}` : null;
  const sourceField = recordType
    ? numericField
    : existingType?.fields.find(f => f.type === 'integer' || f.type === 'decimal') ?? null;

  const metrics: Blueprint['metrics'] = [];
  let localMetricRef: string | null = null;
  if (content.has('metrics') && sourceTypeRef) {
    if (sourceField && sourceField.unit) {
      const ref = local('ai_weekly_minutes');
      metrics.push({
        local_ref: ref, name: '本周练习分钟数', description: '按已确认记录求和。', unit: sourceField.unit ?? '分钟',
        source: { record_type_ref: sourceTypeRef, aggregation: 'sum', field_key: sourceField.key, window: 'week' },
        proposed_target: { operator: 'gte', value: 30 }
      });
      localMetricRef ??= ref;
    }
    const countRef = local('ai_practice_count');
    metrics.push({
      local_ref: countRef, name: '累计练习次数', description: '按唯一有效记录计数。', unit: '次',
      source: { record_type_ref: sourceTypeRef, aggregation: 'count', field_key: null, window: 'all_time' },
      proposed_target: null
    });
    localMetricRef ??= countRef;
  }

  const tasks: Blueprint['tasks'] = [];
  if (content.has('tasks')) {
    const target = recordType ? recordType.local_ref : existingType ? `id:${existingType.id}` : null;
    const taskFields = recordType ? recordType.fields : existingType?.fields ?? [];
    const thresholdField = target ? taskFields.find(f => f.type === 'integer' || f.type === 'decimal') ?? null : null;
    tasks.push({
      local_ref: local('ai_first_practice'),
      title: target ? '完成一次练习并记录' : '完成一次练习',
      description: '选择一段内容练习，并如实记录结果。',
      priority: 'normal',
      estimated_minutes: 10,
      schedule: { kind: 'unscheduled', weekdays: [], local_time: null, start_date: null, end_date: null, timezone: ctx.timezone },
      completion_mode: target ? 'record_required' : 'manual',
      record_binding: target ? {
        record_type_ref: target,
        acceptance: thresholdField
          ? { kind: 'field_gte', field_key: thresholdField.key, threshold: Math.min(Math.max(10, Number(thresholdField.minimum ?? 0)), thresholdField.maximum === null ? Number.POSITIVE_INFINITY : Number(thresholdField.maximum)) }
          : { kind: 'exists', field_key: null, threshold: null }
      } : null
    });
  }

  const achievements: Blueprint['achievements'] = [];
  const existingMetric = ctx.allowedMetrics[0] ?? null;
  const achievementMetricRef = localMetricRef ?? (existingMetric ? `id:${existingMetric.id}` : null);
  const achievementMetricWindow = localMetricRef ? metrics[0]?.source.window ?? 'once' : existingMetric?.window ?? 'all_time';
  if (content.has('achievements') && achievementMetricRef) {
    achievements.push({
      local_ref: local('ai_first_step'), name: '迈出第一步', description: '积累第一条有效练习记录。', icon: 'flag',
      condition: { kind: 'metric_threshold', metric_ref: achievementMetricRef, operator: 'gte', threshold: 1 },
      repeat_policy: 'once', history_policy: 'include_existing'
    });
  }
  if (content.has('achievements') && metrics.length > 0 && achievementMetricWindow !== 'all_time') {
    achievements.push({
      local_ref: local('ai_weekly_goal'), name: '每周坚持', description: '本周练习达到建议目标。', icon: 'trophy',
      condition: { kind: 'metric_threshold', metric_ref: metrics[0].local_ref, operator: 'gte', threshold: 30 },
      repeat_policy: 'per_period', history_policy: 'include_existing'
    });
  }

  return {
    schema_version: '1.0',
    kind: 'module_blueprint',
    module: {
      mode: ctx.mode,
      target_module_id: ctx.mode === 'extend' ? ctx.targetModuleId : null,
      local_ref: moduleLocal,
      name: ctx.mode === 'extend' ? (ctx.targetModuleName ?? '现有模块') : moduleName,
      description: ctx.mode === 'extend' ? '扩展现有模块的模拟配置。' : '本地模拟生成的练习模块。',
      icon: moduleIcon ?? 'sparkles',
      color: moduleColor ?? 'violet'
    },
    record_types: recordType ? [recordType] : [],
    metrics,
    tasks,
    achievements,
    warnings
  };
}

/** Test helper: a provider that returns queued outputs (or throws queued errors) in order. */
export function stubAdapter(
  outputs: Array<string | Error>,
  options: { provider?: string; model?: string } = {}
): ModelAdapter & { calls: number } {
  let calls = 0;
  return {
    provider: options.provider ?? 'stub',
    model: options.model ?? 'stub-model',
    cloud: false,
    get calls() { return calls; },
    async generate(input: AdapterInput): Promise<AdapterResult> {
      const item = outputs[Math.min(calls, outputs.length - 1)];
      calls += 1;
      if (item instanceof Error) throw item;
      return {
        text: item,
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        finish_reason: 'stop', model: this.model, attempts: 1
      };
    }
  } as ModelAdapter & { calls: number };
}
