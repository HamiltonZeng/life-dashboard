/// <reference lib="dom" />
import type {
  AiDraftScope,
  ConfigMutationKind,
  PendingConfigMutationEnvelope,
  PendingMutationEnvelope,
  PersistedAiDrafts,
  PersistedConfigDraft,
  PersistedProfileDraft,
  PersistedRecordDraft,
  PersistedUiPreferences,
  RecordInput
} from './types.js';

const STORAGE_PREFIX = 'life_dashboard_v0_1';
const PREFS_KEY = `${STORAGE_PREFIX}_prefs`;
const DRAFTS_KEY = `${STORAGE_PREFIX}_record_drafts`;
const PENDING_OPS_KEY = `${STORAGE_PREFIX}_pending_ops`;
const CONFIG_DRAFTS_KEY = `${STORAGE_PREFIX}_config_drafts`;
const PENDING_CONFIG_OPS_KEY = `${STORAGE_PREFIX}_pending_config_ops`;
const PROFILE_DRAFT_KEY = `${STORAGE_PREFIX}_profile_draft`;
const AI_DRAFTS_KEY = `${STORAGE_PREFIX}_ai_drafts`;

// Fallback in-memory store for non-browser test runners (Node / JSC)
const memoryFallback = new Map<string, string>();
let storageIssue: string | null = null;
let readFailed = false;
export function getStorageIssue(): string | null {
  return storageIssue;
}

function getStore(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  if (typeof window !== 'undefined') return window.localStorage;
  return {
    getItem: k => memoryFallback.get(k) ?? null,
    setItem: (k, v) => {
      memoryFallback.set(k, v);
    },
    removeItem: k => {
      memoryFallback.delete(k);
    }
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = getStore().getItem(key);
    readFailed = false;
    if (!raw) return fallback;
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw Error('Invalid local data');
    }
    return value as T;
  } catch {
    readFailed = true;
    storageIssue = '本机存储不可用或内容损坏，输入仅保留在当前页面，请复制后重试。';
    return fallback;
  }
}

/**
 * P1-02 Security & Business Field Boundary:
 * 1. Explicit credential/secret DTO keys (`login_secret`, `password`, `authorization`, `cookie`, `api_key`, etc.)
 *    are ALWAYS rejected at any structural level.
 * 2. Structural DTO keys outside user business value maps (`values`, `rawInputs`, `fieldValues`, `rawFieldInputs`)
 *    reject all auth/session-related keys including `session` and `token`.
 * 3. Inside a user business field value dictionary (`values`, `rawInputs`, `fieldValues`, `rawFieldInputs`),
 *    keys are user-defined template/profile field keys (e.g. `session` for study session). When their value is a
 *    primitive business value (`string | number | boolean | null`) and the key is not an explicit credential key
 *    like `login_secret`, it is allowed as legitimate business data.
 */
const STRUCTURAL_SENSITIVE_KEY =
  /^(login_secret|password|passwd|token|session|authorization|cookie|api_key|apikey|secret)$/i;
const ALWAYS_CREDENTIAL_KEY =
  /^(login_secret|password|passwd|authorization|cookie|api_key|apikey|client_secret|private_key|session_token|auth_token)$/i;
const BUSINESS_VALUE_MAP_KEYS = new Set([
  'values',
  'rawInputs',
  'fieldValues',
  'rawFieldInputs',
  'context_values',
  'contextValues'
]);

function isPrimitiveBusinessValue(val: unknown): boolean {
  return (
    val === null ||
    typeof val === 'string' ||
    typeof val === 'number' ||
    typeof val === 'boolean'
  );
}

export function hasSensitiveKey(
  value: unknown,
  depth = 0,
  inBusinessValueMap = false
): boolean {
  if (depth > 8 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some(item => hasSensitiveKey(item, depth + 1, false));
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (ALWAYS_CREDENTIAL_KEY.test(key)) return true;
    if (!inBusinessValueMap && STRUCTURAL_SENSITIVE_KEY.test(key)) return true;
    if (inBusinessValueMap && !isPrimitiveBusinessValue(child) && STRUCTURAL_SENSITIVE_KEY.test(key)) {
      return true;
    }
    const nextIsBusinessMap = BUSINESS_VALUE_MAP_KEYS.has(key);
    if (hasSensitiveKey(child, depth + 1, nextIsBusinessMap)) return true;
  }
  return false;
}

function writeJson(key: string, value: unknown): boolean {
  try {
    if (readFailed) {
      throw Error('Existing local data could not be read; refusing to overwrite it');
    }
    if (hasSensitiveKey(value)) {
      storageIssue = '拒绝写入本机存储：检测到认证凭据或受保护的会话配置字段。';
      return false;
    }
    getStore().setItem(key, JSON.stringify(value));
    storageIssue = null;
    return true;
  } catch {
    storageIssue = '未保存本机：浏览器存储不可用或空间不足。请复制输入，恢复存储后重试。';
    return false;
  }
}

export function buildRecordDraftKey(params: {
  mode: 'create' | 'edit';
  recordId?: string;
  moduleId: string;
  recordTypeId: string;
  fromTaskId?: string;
}): string {
  if (params.mode === 'edit' && params.recordId) {
    return `edit:${params.recordId}`;
  }
  return `create:${params.moduleId}:${params.recordTypeId}:${params.fromTaskId ?? 'direct'}`;
}

export function computePayloadSignature(input: {
  mode: 'create' | 'edit';
  module_id: string;
  record_type_id: string;
  schema_version: number;
  status: 'draft' | 'confirmed';
  values: Record<string, string | number | boolean | null>;
  task_ids: string[];
  base_version?: number;
  occurred_at?: string;
  timezone?: string;
}): string {
  const sortedValues: Record<string, unknown> = {};
  for (const k of Object.keys(input.values).sort()) {
    sortedValues[k] = input.values[k];
  }
  const sortedTasks = [...input.task_ids].sort();
  return JSON.stringify({
    mode: input.mode,
    module_id: input.module_id,
    record_type_id: input.record_type_id,
    schema_version: input.schema_version,
    status: input.status,
    values: sortedValues,
    task_ids: sortedTasks,
    base_version: input.base_version ?? null,
    occurred_at: input.occurred_at ?? null,
    timezone: input.timezone ?? null
  });
}

function canonicalizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalizeValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = canonicalizeValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function computeConfigPayloadSignature(
  kind: ConfigMutationKind,
  payload: unknown
): string {
  return JSON.stringify({
    kind,
    payload: canonicalizeValue(payload)
  });
}

export function loadAllRecordDrafts(): Record<string, PersistedRecordDraft> {
  return readJson<Record<string, PersistedRecordDraft>>(DRAFTS_KEY, {});
}

export function loadRecordDraft(draftKey: string): PersistedRecordDraft | null {
  const all = loadAllRecordDrafts();
  return all[draftKey] ?? null;
}

export function saveRecordDraft(draft: PersistedRecordDraft): boolean {
  const all = loadAllRecordDrafts();
  all[draft.draftKey] = draft;
  return writeJson(DRAFTS_KEY, all);
}

export function clearRecordDraft(draftKey: string): void {
  const all = loadAllRecordDrafts();
  if (Object.prototype.hasOwnProperty.call(all, draftKey)) {
    delete all[draftKey];
    writeJson(DRAFTS_KEY, all);
  }
}

export function loadAllPendingMutations(): Record<string, PendingMutationEnvelope> {
  return readJson<Record<string, PendingMutationEnvelope>>(PENDING_OPS_KEY, {});
}

export function getPendingMutation(draftKey: string): PendingMutationEnvelope | null {
  const all = loadAllPendingMutations();
  return all[draftKey] ?? null;
}

export function savePendingMutation(envelope: PendingMutationEnvelope): boolean {
  const all = loadAllPendingMutations();
  all[envelope.draftKey] = envelope;
  return writeJson(PENDING_OPS_KEY, all);
}

export function clearPendingMutation(draftKey: string): void {
  const all = loadAllPendingMutations();
  if (Object.prototype.hasOwnProperty.call(all, draftKey)) {
    delete all[draftKey];
    writeJson(PENDING_OPS_KEY, all);
  }
}

/**
 * S1 Core Rule:
 * When a previous attempt for the same draftKey had an unknown network result,
 * reuse the EXACT same `operationId` and `frozenPayload` (including `id` and `occurred_at`)
 * so the server's idempotency receipt prevents duplicate record creation.
 */
export function prepareRecordMutationEnvelope(params: {
  draftKey: string;
  mode: 'create' | 'edit';
  candidateRecordId: string;
  candidatePayload: RecordInput | (Omit<RecordInput, 'id'> & { base_version: number });
  signature: string;
  allocateUuid: () => string;
}): {
  operationId: string;
  recordId: string;
  payload: RecordInput | (Omit<RecordInput, 'id'> & { base_version: number });
  reusedPending: boolean;
  mode: 'create' | 'edit';
} {
  const existing = getPendingMutation(params.draftKey);
  if (existing) {
    return {
      operationId: existing.operationId,
      recordId: existing.recordId,
      payload: existing.frozenPayload,
      reusedPending: true,
      mode: existing.mode
    };
  }
  return {
    operationId: params.allocateUuid(),
    recordId: params.candidateRecordId,
    payload: params.candidatePayload,
    reusedPending: false,
    mode: params.mode
  };
}

// ---------------------------------------------------------------------------
// P1-03: Configuration Creation & Update Reliability
// Extends stable operation_id, entityId, frozenPayload, and confirmation
// state to configuration creation so dropped receipts, page refreshes, or
// subsequent input edits never duplicate configuration entities.
// ---------------------------------------------------------------------------

export function buildConfigDraftKey(kind: ConfigMutationKind): string {
  return `config:${kind}`;
}

export function loadAllConfigDrafts(): Record<string, PersistedConfigDraft> {
  return readJson<Record<string, PersistedConfigDraft>>(CONFIG_DRAFTS_KEY, {});
}

export function loadConfigDraft(draftKey: string): PersistedConfigDraft | null {
  const all = loadAllConfigDrafts();
  return all[draftKey] ?? null;
}

export function saveConfigDraft(draft: PersistedConfigDraft): boolean {
  const all = loadAllConfigDrafts();
  all[draft.draftKey] = draft;
  return writeJson(CONFIG_DRAFTS_KEY, all);
}

export function clearConfigDraft(draftKey: string): void {
  const all = loadAllConfigDrafts();
  if (Object.prototype.hasOwnProperty.call(all, draftKey)) {
    delete all[draftKey];
    writeJson(CONFIG_DRAFTS_KEY, all);
  }
}

export function loadAllPendingConfigMutations(): Record<string, PendingConfigMutationEnvelope> {
  return readJson<Record<string, PendingConfigMutationEnvelope>>(PENDING_CONFIG_OPS_KEY, {});
}

export function getPendingConfigMutation<TPayload = Record<string, unknown>>(
  draftKey: string
): PendingConfigMutationEnvelope<TPayload> | null {
  const all = loadAllPendingConfigMutations();
  return (all[draftKey] as PendingConfigMutationEnvelope<TPayload> | undefined) ?? null;
}

export function savePendingConfigMutation<TPayload = Record<string, unknown>>(
  envelope: PendingConfigMutationEnvelope<TPayload>
): boolean {
  const all = loadAllPendingConfigMutations();
  all[envelope.draftKey] = envelope as PendingConfigMutationEnvelope;
  return writeJson(PENDING_CONFIG_OPS_KEY, all);
}

export function clearPendingConfigMutation(draftKey: string): void {
  const all = loadAllPendingConfigMutations();
  if (Object.prototype.hasOwnProperty.call(all, draftKey)) {
    delete all[draftKey];
    writeJson(PENDING_CONFIG_OPS_KEY, all);
  }
}

export function prepareConfigMutationEnvelope<TPayload = Record<string, unknown>>(params: {
  draftKey: string;
  kind: ConfigMutationKind;
  candidateEntityId: string;
  candidatePayload: TPayload;
  signature: string;
  allocateUuid: () => string;
}): {
  operationId: string;
  entityId: string;
  payload: TPayload;
  reusedPending: boolean;
  kind: ConfigMutationKind;
} {
  const existing = getPendingConfigMutation<TPayload>(params.draftKey);
  if (existing) {
    return {
      operationId: existing.operationId,
      entityId: existing.entityId,
      payload: existing.frozenPayload,
      reusedPending: true,
      kind: existing.kind
    };
  }
  return {
    operationId: params.allocateUuid(),
    entityId: params.candidateEntityId,
    payload: params.candidatePayload,
    reusedPending: false,
    kind: params.kind
  };
}

// ---------------------------------------------------------------------------
// v0.2 Phase 1: Profile Working Draft & Disabled AI Container Local Drafts
// ---------------------------------------------------------------------------

export function saveProfileDraft(draft: PersistedProfileDraft): boolean {
  return writeJson(PROFILE_DRAFT_KEY, draft);
}

export function loadProfileDraft(): PersistedProfileDraft | null {
  return readJson<PersistedProfileDraft | null>(PROFILE_DRAFT_KEY, null);
}

export function clearProfileDraft(): void {
  getStore().removeItem(PROFILE_DRAFT_KEY);
}

export function loadAllAiDrafts(): PersistedAiDrafts {
  return readJson<PersistedAiDrafts>(AI_DRAFTS_KEY, {
    home: '',
    records: '',
    updatedAt: ''
  });
}

export function loadAiDraft(scope: AiDraftScope): string {
  const all = loadAllAiDrafts();
  return typeof all[scope] === 'string' ? all[scope] : '';
}

export function saveAiDraft(scope: AiDraftScope, text: string): boolean {
  const all = loadAllAiDrafts();
  const next: PersistedAiDrafts = {
    home: scope === 'home' ? text : (all.home ?? ''),
    records: scope === 'records' ? text : (all.records ?? ''),
    updatedAt: new Date().toISOString()
  };
  return writeJson(AI_DRAFTS_KEY, next);
}

export function clearAiDraft(scope: AiDraftScope): boolean {
  return saveAiDraft(scope, '');
}

export function saveUiPreferences(prefs: PersistedUiPreferences): void {
  writeJson(PREFS_KEY, prefs);
}

export function loadUiPreferences(): PersistedUiPreferences | null {
  return readJson<PersistedUiPreferences | null>(PREFS_KEY, null);
}

export function clearAllBrowserStorageForTest(): void {
  const store = getStore();
  readFailed = false;
  storageIssue = null;
  store.removeItem(PREFS_KEY);
  store.removeItem(DRAFTS_KEY);
  store.removeItem(PENDING_OPS_KEY);
  store.removeItem(CONFIG_DRAFTS_KEY);
  store.removeItem(PENDING_CONFIG_OPS_KEY);
  store.removeItem(PROFILE_DRAFT_KEY);
  store.removeItem(AI_DRAFTS_KEY);
}
