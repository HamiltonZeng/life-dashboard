/// <reference lib="dom" />
import type {
  AchievementDefinitionRow,
  AchievementInput,
  AiBatchRow,
  AiConfigData,
  AiGenerationEnvelope,
  AiGenerationRequest,
  AiJobRow,
  AiRevokeResult,
  ApiErrorShape,
  BootstrapData,
  CapabilitiesData,
  MetricInput,
  MetricRow,
  ModuleRow,
  RecordInput,
  RecordRow,
  RecordTypeRow,
  TaskInput,
  TaskRow,
  UserExportPayload,
  UserProfile
} from './types.js';
import type { Field } from '../../../packages/contracts/src/index.js';
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
    err.status === 502 ||
    err.status === 503 ||
    err.status === 504 ||
    err.code === 'NETWORK_ERROR' ||
    err.code === 'BAD_GATEWAY'
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

  const payload = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: ApiErrorShape;
  };

  if (!res.ok) {
    throw new ApiClientError(
      res.status,
      payload.error ?? {
        code: `HTTP_${res.status}`,
        message: res.statusText || '请求失败'
      }
    );
  }

  return payload.data as T;
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

  /**
   * S1 minimal export: reads the authenticated user's complete server-side
   * data snapshot. Read-only GET; the server attaches format/schema/checksum
   * metadata. Credentials/session material are not part of the payload.
   */
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

  createTask(input: Omit<TaskInput, 'id'> & { id?: string }, idempotencyKey?: string): Promise<TaskRow> {
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

  createRecord(input: Omit<RecordInput, 'id'> & { id?: string }, idempotencyKey?: string): Promise<RecordRow> {
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

  createMetric(input: Omit<MetricInput, 'id'> & { id?: string }, idempotencyKey?: string): Promise<MetricRow> {
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

  createAiGeneration(input: AiGenerationRequest, idempotencyKey?: string): Promise<AiGenerationEnvelope> {
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
  }
};
