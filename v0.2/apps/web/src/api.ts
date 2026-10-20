/// <reference lib="dom" />
import type {
  AchievementDefinitionRow,
  AchievementInput,
  AchievementSeriesInput,
  AchievementSeriesView,
  AchievementSummaryData,
  AiBatchRow,
  AiConfigData,
  AiGenerationEnvelope,
  AiGenerationRequest,
  AiJobRow,
  AiRevokeResult,
  ApiErrorShape,
  BootstrapData,
  CapabilitiesData,
  Field,
  HomeData,
  HomePreferencesData,
  HomePreferencesInput,
  MetricInput,
  MetricRow,
  MetricTrendData,
  ModuleRow,
  ObservationWriteInput,
  ObservationWriteResult,
  ProfileData,
  ProfileInput,
  RecordInput,
  RecordRow,
  RecordTypeRow,
  TaskInput,
  TaskInstancesQuery,
  TaskRow,
  TaskTemplateInput,
  TaskTemplatePatch,
  TaskTemplateRow,
  TrendGrain,
  TrendRange,
  UserExportPayload,
  UserProfile,
  WalletData,
  WalletLedgerEntry,
  WalletLedgerPage
} from './types.js';
import type { ModuleColorName, ModuleIconName } from '../../../packages/ui/src/index.js';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, err: ApiErrorShape) {
    super(err.message || `API Error (${status})`);
    this.status = status;
    this.code = err.code || 'HTTP_ERROR';
    this.details = err.details;
    this.requestId = err.request_id;
  }
}

export function isUnknownNetworkError(err: unknown): boolean {
  if (!(err instanceof ApiClientError)) {
    return true;
  }
  return (
    err.status === 0 ||
    err.status >= 500 ||
    err.status === 502 ||
    err.status === 503 ||
    err.status === 504 ||
    err.code === 'NETWORK_ERROR' ||
    err.code === 'BAD_GATEWAY' ||
    err.code === 'BAD_RECEIPT'
  );
}

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  const isSessionEndpoint = path === '/session';
  if (method !== 'GET' && !isSessionEndpoint) {
    headers['Idempotency-Key'] = idempotencyKey ?? generateUuid();
  }

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } catch (networkErr) {
    throw new ApiClientError(0, {
      code: 'NETWORK_ERROR',
      message: networkErr instanceof Error ? networkErr.message : '网络连接中断，未收到服务器回执'
    });
  }

  let payload: {
    data?: T;
    error?: ApiErrorShape;
    operation_id?: string;
  };
  try {
    payload = await res.json();
  } catch {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '未收到可验证的服务器回执，请保留原操作后重试确认'
    });
  }

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      payload.error ?? {
        code: `HTTP_${res.status}`,
        message: res.statusText || '请求失败'
      }
    );
  }

  if (!payload || typeof payload !== 'object' || payload.data === undefined) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '服务器回执不完整，尚未确认保存'
    });
  }

  if (method !== 'GET' && !isSessionEndpoint && !path.startsWith('/ai/')) {
    validateMutationReceipt(method, path, body, payload, headers['Idempotency-Key']);
  }
  return payload.data as T;
}

/**
 * G0 Receipt Verification:
 * Verifies `operation_id === idempotencyKey` for ALL business writes, and
 * validates endpoint-specific composite response shapes (`/task-templates`,
 * `/task-instances/materialize`, `/profile/observations`) vs single-entity
 * writes (`/records`, `/tasks`, `/achievement-series`, `/profile`, `/home-preferences`, etc.)
 * so valid composite responses are never misclassified as `BAD_RECEIPT`.
 */
export function validateMutationReceipt(
  method: string,
  path: string,
  body: unknown,
  payload: { data?: unknown; operation_id?: string },
  expectedOperationId: string | undefined
): void {
  const cleanPath = path.split('?')[0];
  if (!payload || typeof payload !== 'object' || payload.data === undefined) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '服务器回执不完整，尚未确认保存'
    });
  }
  if (!expectedOperationId || payload.operation_id !== expectedOperationId) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '保存回执缺少匹配的 operation_id，尚未确认'
    });
  }

  const data = payload.data as any;

  const validInstance=(t:any,template?:string)=>t&&typeof t.id==='string'&&Number.isInteger(t.version)&&t.version>0&&typeof t.template_id==='string'&&(!template||t.template_id===template);
  // 1. Composite: POST /task-templates or PATCH /task-templates/:id -> { template, instance }
  if (cleanPath === '/task-templates' || cleanPath.startsWith('/task-templates/')) {
    const expectedTemplateId = (body as any)?.id ?? cleanPath.split('/')[2];
    const tpl = data?.template;
    const inst = data?.instance;
    if (
      !tpl ||
      typeof tpl.id !== 'string' ||
      !Number.isInteger(tpl.version) ||
      tpl.version < 1 ||
      (expectedTemplateId && tpl.id !== expectedTemplateId) ||
      (method==='POST'?!validInstance(inst,tpl?.id):inst!==null&&!validInstance(inst,tpl?.id))
    ) {
      throw new ApiClientError(0, {
        code: 'BAD_RECEIPT',
        message: '任务模板回执缺少有效的 template/version 或当前实例引用，尚未确认'
      });
    }
    return;
  }

  // 2. Composite: POST /task-instances/materialize -> { instances: Instance[], reused: boolean[] }
  if (cleanPath === '/task-instances/materialize') {
    if (
      !data ||
      !Array.isArray(data.instances) ||
      !Array.isArray(data.reused) ||
      data.instances.length !== data.reused.length ||
      data.instances.some((item: any) => !validInstance(item)) || data.reused.some((v:any)=>typeof v!=='boolean')
    ) {
      throw new ApiClientError(0, {
        code: 'BAD_RECEIPT',
        message: '周期任务物化回执结构不完整，尚未确认'
      });
    }
    return;
  }

  // 3. Composite: POST /profile/observations -> { record, profile, impact }
  if (cleanPath === '/profile/observations') {
    const rec = data?.record;
    const prof = data?.profile;
    const sent = body as any;
    const expectedRecordId = sent?.source_record_id ?? sent?.id;
    if (
      !rec ||
      typeof rec.id !== 'string' ||
      !Number.isInteger(rec.version) ||
      rec.version < 1 ||
      (expectedRecordId && rec.id !== expectedRecordId) ||
      !prof ||
      typeof prof.id !== 'string' ||
      !Array.isArray(prof.module_fields) || !Number.isInteger(prof.version) || prof.version<1 || !data.impact || !Array.isArray(data.impact.changes)
    ) {
      throw new ApiClientError(0, {
        code: 'BAD_RECEIPT',
        message: '个人观测写入回执缺少来源记录或最新资料投影，尚未确认'
      });
    }
    return;
  }

  // 4. Single-entity writes (/records, /tasks, /achievement-series, /profile, /home-preferences, /modules, etc.)
  const expectedId =
    cleanPath === '/profile' || cleanPath === '/home-preferences'
      ? undefined
      : (body as any)?.id ?? cleanPath.split('/')[2];
  const version = cleanPath === '/record-types' ? data?.schema_version : data?.version;
  if (
    !data ||
    typeof data.id !== 'string' ||
    !Number.isInteger(version) ||
    version < 1 ||
    (expectedId && data.id !== expectedId)
  ) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '保存回执缺少正确操作、记录与版本，尚未确认'
    });
  }
  if (cleanPath.startsWith('/records') && method !== 'DELETE') {
    const sent = body as any;
    if (
      data.module_id !== sent.module_id ||
      data.record_type_id !== sent.record_type_id ||
      data.schema_version !== sent.schema_version ||
      !data.values ||
      typeof data.values !== 'object' ||
      !Array.isArray(data.task_ids) ||
      Date.parse(data.occurred_at) !== Date.parse(sent.occurred_at) ||
      data.timezone !== sent.timezone ||
      data.status !== sent.status
    ) {
      throw new ApiClientError(0, {
        code: 'BAD_RECEIPT',
        message: '记录确认字段不完整，请保留原提交后重试确认'
      });
    }
  }
  if (
    cleanPath.startsWith('/records/') &&
    method === 'DELETE' &&
    (typeof data.deleted_at !== 'string' || !Number.isFinite(Date.parse(data.deleted_at)))
  ) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '删除回执不完整，请刷新核对记录状态'
    });
  }
  if (cleanPath === '/profile' && (!Array.isArray(data.module_fields) || typeof data.nickname !== 'string')) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '个人资料回执字段不完整，请保留原提交后重试确认'
    });
  }
  if (
    cleanPath === '/home-preferences' &&
    (typeof data.minimal_mode !== 'boolean' ||
      !Array.isArray(data.pinned_metric_ids) ||
      !Array.isArray(data.pinned_task_ids))
  ) {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '首页偏好回执字段不完整，请保留原提交后重试确认'
    });
  }
}

async function requestPaged<T>(
  path: string
): Promise<{ data: T[]; page: { total: number; limit: number; offset: number } }> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
  } catch (networkErr) {
    throw new ApiClientError(0, {
      code: 'NETWORK_ERROR',
      message: networkErr instanceof Error ? networkErr.message : '网络连接中断'
    });
  }
  let payload: any;
  try {
    payload = await res.json();
  } catch {
    throw new ApiClientError(0, {
      code: 'BAD_RECEIPT',
      message: '分页响应格式异常'
    });
  }
  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      payload?.error ?? {
        code: `HTTP_${res.status}`,
        message: res.statusText || '请求失败'
      }
    );
  }
  const list = Array.isArray(payload?.data) ? (payload.data as T[]) : [];
  const page = payload?.page ?? { total: list.length, limit: 50, offset: 0 };
  return { data: list, page };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function normalizeAiEnvelope(value: unknown): AiGenerationEnvelope {
  if (isRecord(value) && isRecord(value.job)) {
    return {
      job: value.job as unknown as AiJobRow,
      batch: (value.batch as AiBatchRow | null | undefined) ?? null,
      already_applied: Boolean(value.already_applied)
    };
  }
  const job = value as unknown as AiJobRow;
  return { job, batch: null, already_applied: job?.status === 'applied' };
}

export function normalizeAiJobList(value: unknown): AiJobRow[] {
  if (Array.isArray(value)) return value as AiJobRow[];
  if (isRecord(value) && Array.isArray(value.data)) return value.data as AiJobRow[];
  if (isRecord(value) && Array.isArray(value.jobs)) return value.jobs as AiJobRow[];
  return [];
}

export const api = {
  getCapabilities(): Promise<CapabilitiesData> {
    return request<CapabilitiesData>('GET', '/capabilities');
  },

  getMe(): Promise<UserProfile> {
    return request<UserProfile>('GET', '/me');
  },

  login(loginSecret: string): Promise<{ user_id: string; expires_in: number }> {
    return request<{ user_id: string; expires_in: number }>('POST', '/session', {
      login_secret: loginSecret
    });
  },

  logout(): Promise<{ signed_out: boolean }> {
    return request<{ signed_out: boolean }>('DELETE', '/session');
  },

  getBootstrap(): Promise<BootstrapData> {
    return request<BootstrapData>('GET', '/bootstrap');
  },

  getProfile(): Promise<ProfileData> {
    return request<ProfileData>('GET', '/profile');
  },

  updateProfile(input: ProfileInput, idempotencyKey?: string): Promise<ProfileData> {
    return request<ProfileData>('PATCH', '/profile', input, idempotencyKey);
  },

  getHomePreferences(): Promise<HomePreferencesData> {
    return request<HomePreferencesData>('GET', '/home-preferences');
  },

  updateHomePreferences(
    input: HomePreferencesInput,
    idempotencyKey?: string
  ): Promise<HomePreferencesData> {
    return request<HomePreferencesData>('PATCH', '/home-preferences', input, idempotencyKey);
  },

  getHome(): Promise<HomeData> {
    return request<HomeData>('GET', '/home');
  },

  exportUserData(): Promise<UserExportPayload> {
    return request<UserExportPayload>('GET', '/export');
  },

  createModule(
    input: {
      id?: string;
      name: string;
      description?: string;
      icon: ModuleIconName;
      color: ModuleColorName;
    },
    idempotencyKey?: string
  ): Promise<ModuleRow> {
    return request<ModuleRow>(
      'POST',
      '/modules',
      {
        id: input.id ?? generateUuid(),
        name: input.name,
        description: input.description ?? '',
        icon: input.icon,
        color: input.color
      },
      idempotencyKey
    );
  },

  updateModule(
    id: string,
    input: {
      base_version: number;
      name?: string;
      status?: 'enabled' | 'disabled' | 'archived';
    },
    idempotencyKey?: string
  ): Promise<ModuleRow> {
    return request<ModuleRow>('PATCH', `/modules/${id}`, input, idempotencyKey);
  },

  createRecordType(
    input: {
      id?: string;
      module_id: string;
      name: string;
      fields: Field[];
    },
    idempotencyKey?: string
  ): Promise<RecordTypeRow> {
    return request<RecordTypeRow>(
      'POST',
      '/record-types',
      {
        id: input.id ?? generateUuid(),
        module_id: input.module_id,
        name: input.name,
        fields: input.fields
      },
      idempotencyKey
    );
  },

  createTask(
    input: Omit<TaskInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<TaskRow> {
    return request<TaskRow>(
      'POST',
      '/tasks',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  completeTask(id: string, baseVersion: number, idempotencyKey?: string): Promise<TaskRow> {
    return request<TaskRow>(
      'POST',
      `/tasks/${id}/complete`,
      { base_version: baseVersion },
      idempotencyKey
    );
  },

  createRecord(
    input: Omit<RecordInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<RecordRow> {
    return request<RecordRow>(
      'POST',
      '/records',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  updateRecord(
    id: string,
    input: Omit<RecordInput, 'id'> & { base_version: number },
    idempotencyKey?: string
  ): Promise<RecordRow> {
    return request<RecordRow>('PUT', `/records/${id}`, input, idempotencyKey);
  },

  deleteRecord(
    id: string,
    baseVersion: number,
    idempotencyKey?: string
  ): Promise<{ id: string; version: number; deleted_at: string }> {
    return request<{ id: string; version: number; deleted_at: string }>(
      'DELETE',
      `/records/${id}`,
      { base_version: baseVersion },
      idempotencyKey
    );
  },

  createMetric(
    input: Omit<MetricInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<MetricRow> {
    return request<MetricRow>(
      'POST',
      '/metrics',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  createAchievement(
    input: Omit<AchievementInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<AchievementDefinitionRow> {
    return request<AchievementDefinitionRow>(
      'POST',
      '/achievements',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  getAiConfig(): Promise<AiConfigData> {
    return request<AiConfigData>('GET', '/ai/config');
  },

  listAiGenerations(query: { limit?: number; module_id?: string } = {}): Promise<AiJobRow[]> {
    const params = new URLSearchParams();
    params.set('limit', String(query.limit ?? 10));
    if (query.module_id) params.set('module_id', query.module_id);
    return request<unknown>('GET', `/ai/generations?${params.toString()}`).then(normalizeAiJobList);
  },

  getAiGeneration(id: string): Promise<AiGenerationEnvelope> {
    return request<unknown>('GET', `/ai/generations/${encodeURIComponent(id)}`).then(
      normalizeAiEnvelope
    );
  },

  createAiGeneration(
    input: AiGenerationRequest,
    idempotencyKey?: string
  ): Promise<AiGenerationEnvelope> {
    return request<unknown>('POST', '/ai/generations', input, idempotencyKey).then(
      normalizeAiEnvelope
    );
  },

  applyAiGeneration(
    id: string,
    baseModuleVersion: number | null,
    idempotencyKey?: string
  ): Promise<AiGenerationEnvelope> {
    return request<unknown>(
      'POST',
      `/ai/generations/${encodeURIComponent(id)}/apply`,
      { base_module_version: baseModuleVersion },
      idempotencyKey
    ).then(normalizeAiEnvelope);
  },

  retryAiGeneration(id: string, idempotencyKey?: string): Promise<AiGenerationEnvelope> {
    return request<unknown>(
      'POST',
      `/ai/generations/${encodeURIComponent(id)}/retry`,
      {},
      idempotencyKey
    ).then(normalizeAiEnvelope);
  },

  cancelAiGeneration(id: string, idempotencyKey?: string): Promise<AiGenerationEnvelope> {
    return request<unknown>(
      'POST',
      `/ai/generations/${encodeURIComponent(id)}/cancel`,
      {},
      idempotencyKey
    ).then(normalizeAiEnvelope);
  },

  revokeAiBatch(id: string, idempotencyKey?: string): Promise<AiRevokeResult> {
    return request<AiRevokeResult>(
      'POST',
      `/ai/batches/${encodeURIComponent(id)}/revoke`,
      {},
      idempotencyKey
    );
  },

  // -------------------------------------------------------------------------
  // v0.2 Phase 2: Periodic Tasks, Trends, Achievement Series, Wallet & Observations
  // -------------------------------------------------------------------------

  getTaskTemplates(): Promise<TaskTemplateRow[]> {
    return request<TaskTemplateRow[]>('GET', '/task-templates');
  },

  createTaskTemplate(
    input: Omit<TaskTemplateInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<{ template: TaskTemplateRow; instance: TaskRow }> {
    return request<{ template: TaskTemplateRow; instance: TaskRow }>(
      'POST',
      '/task-templates',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  updateTaskTemplate(
    id: string,
    input: TaskTemplatePatch,
    idempotencyKey?: string
  ): Promise<{ template: TaskTemplateRow; instance: TaskRow | null }> {
    return request<{ template: TaskTemplateRow; instance: TaskRow | null }>(
      'PATCH',
      `/task-templates/${encodeURIComponent(id)}`,
      input,
      idempotencyKey
    );
  },

  materializeTaskInstances(
    templateIds?: string[],
    idempotencyKey?: string
  ): Promise<{ instances: TaskRow[]; reused: boolean[] }> {
    return request<{ instances: TaskRow[]; reused: boolean[] }>(
      'POST',
      '/task-instances/materialize',
      templateIds ? { template_ids: templateIds } : {},
      idempotencyKey
    );
  },

  getTaskInstances(
    query: TaskInstancesQuery = {}
  ): Promise<{ data: TaskRow[]; page: { total: number; limit: number; offset: number } }> {
    const params = new URLSearchParams();
    if (query.module_id) params.set('module_id', query.module_id);
    if (query.category) params.set('category', query.category);
    if (query.status) params.set('status', query.status);
    if (query.color) params.set('color', query.color);
    if (query.pinned) params.set('pinned', query.pinned);
    if (query.period_start) params.set('period_start', query.period_start);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return requestPaged<TaskRow>(`/task-instances${qs ? `?${qs}` : ''}`);
  },

  revokeTask(
    id: string,
    baseVersion: number,
    reason: string,
    idempotencyKey?: string
  ): Promise<TaskRow> {
    return request<TaskRow>(
      'POST',
      `/tasks/${encodeURIComponent(id)}/revoke`,
      { base_version: baseVersion, reason },
      idempotencyKey
    );
  },

  cancelTask(
    id: string,
    baseVersion: number,
    reason: string,
    idempotencyKey?: string
  ): Promise<TaskRow> {
    return request<TaskRow>(
      'POST',
      `/tasks/${encodeURIComponent(id)}/cancel`,
      { base_version: baseVersion, reason },
      idempotencyKey
    );
  },

  getMetricTrend(
    metricId: string,
    query: {
      range?: TrendRange;
      grain?: TrendGrain;
      precision?: number;
      exclude_dates?: string[];
      variance_enabled?: boolean;
      variance_threshold?: number;
      minimum_days?: number;
      include_all?: boolean;
    } = {}
  ): Promise<MetricTrendData> {
    const params = new URLSearchParams();
    if (query.range) params.set('range', query.range);
    if (query.grain) params.set('grain', query.grain);
    if (query.precision !== undefined) params.set('precision', String(query.precision));
    if (query.exclude_dates && query.exclude_dates.length > 0) {
      params.set('exclude_dates', query.exclude_dates.join(','));
    }
    if (query.variance_enabled !== undefined) {
      params.set('variance_enabled', String(query.variance_enabled));
    }
    if (query.variance_threshold !== undefined) {
      params.set('variance_threshold', String(query.variance_threshold));
    }
    if (query.minimum_days !== undefined) {
      params.set('minimum_days', String(query.minimum_days));
    }
    if (query.include_all !== undefined) {
      params.set('include_all', String(query.include_all));
    }
    const qs = params.toString();
    return request<MetricTrendData>(
      'GET',
      `/metrics/${encodeURIComponent(metricId)}/trend${qs ? `?${qs}` : ''}`
    );
  },

  getAchievementSeries(
    query: {
      module_id?: string;
      id?: string;
      state?: 'unlocked' | 'needs_review' | 'unstarted';
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: AchievementSeriesView[]; page: { total: number; limit: number; offset: number } }> {
    const params = new URLSearchParams();
    if (query.module_id) params.set('module_id', query.module_id);
    if (query.id) params.set('id', query.id);
    if (query.state) params.set('state', query.state);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return requestPaged<AchievementSeriesView>(`/achievement-series${qs ? `?${qs}` : ''}`);
  },

  getAchievementSummary(): Promise<AchievementSummaryData> {
    return request<AchievementSummaryData>('GET', '/achievement-summary');
  },

  createAchievementSeries(
    input: Omit<AchievementSeriesInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<AchievementSeriesView> {
    return request<AchievementSeriesView>(
      'POST',
      '/achievement-series',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  },

  getWallet(): Promise<WalletData> {
    return request<WalletData>('GET', '/wallet');
  },

  getWalletLedger(
    query: { task_id?: string; limit?: number; offset?: number } = {}
  ): Promise<WalletLedgerPage> {
    const params = new URLSearchParams();
    if (query.task_id) params.set('task_id', query.task_id);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    const qs = params.toString();
    return requestPaged<WalletLedgerEntry>(`/wallet/ledger${qs ? `?${qs}` : ''}`);
  },

  writeProfileObservation(
    input: Omit<ObservationWriteInput, 'id'> & { id?: string },
    idempotencyKey?: string
  ): Promise<ObservationWriteResult> {
    return request<ObservationWriteResult>(
      'POST',
      '/profile/observations',
      {
        ...input,
        id: input.id ?? generateUuid()
      },
      idempotencyKey
    );
  }
};
