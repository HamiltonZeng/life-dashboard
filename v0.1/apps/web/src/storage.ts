/// <reference lib="dom" />
import type {
  PendingMutationEnvelope,
  PersistedRecordDraft,
  PersistedUiPreferences,
  RecordInput
} from './types.js';

const STORAGE_PREFIX = 'life_dashboard_v0_1';
const PREFS_KEY = `${STORAGE_PREFIX}_prefs`;
const DRAFTS_KEY = `${STORAGE_PREFIX}_record_drafts`;
const PENDING_OPS_KEY = `${STORAGE_PREFIX}_pending_ops`;

// Fallback in-memory store for non-browser test runners (Node / JSC)
const memoryFallback = new Map<string, string>();

function getStore(): {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
} {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Fallback to memory store if localStorage is blocked
  }
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
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const SENSITIVE_KEY = /^(login_secret|password|passwd|token|session|authorization|cookie|api_key|apikey|secret)$/i;

/** Only structural keys are sensitive; business text may legitimately contain these words. */
function hasSensitiveKey(value: unknown, depth = 0): boolean {
  if (depth > 6 || value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(item => hasSensitiveKey(item, depth + 1));
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) return true;
    if (hasSensitiveKey(child, depth + 1)) return true;
  }
  return false;
}

function writeJson(key: string, value: unknown): void {
  try {
    // Security guard: credentials/session keys must never enter browser storage.
    // A record note that merely contains the word "login_secret" is ordinary user text.
    if (hasSensitiveKey(value)) throw new Error('Refusing to persist sensitive keys in browser storage');
    getStore().setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota or serialisation errors; the caller keeps the in-memory form state.
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
    base_version: input.base_version ?? null
  });
}

export function loadAllRecordDrafts(): Record<string, PersistedRecordDraft> {
  return readJson<Record<string, PersistedRecordDraft>>(DRAFTS_KEY, {});
}

export function loadRecordDraft(draftKey: string): PersistedRecordDraft | null {
  const all = loadAllRecordDrafts();
  return all[draftKey] ?? null;
}

export function saveRecordDraft(draft: PersistedRecordDraft): void {
  const all = loadAllRecordDrafts();
  all[draft.draftKey] = draft;
  writeJson(DRAFTS_KEY, all);
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

export function savePendingMutation(envelope: PendingMutationEnvelope): void {
  const all = loadAllPendingMutations();
  all[envelope.draftKey] = envelope;
  writeJson(PENDING_OPS_KEY, all);
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
 * and the user retries WITHOUT changing the semantic form inputs (`payloadSignature` matches),
 * reuse the EXACT same `operationId` and `frozenPayload` (including `id` and `occurred_at`)
 * so the server's idempotency receipt prevents duplicate record creation.
 * If the user modified any form field, discard the old pending envelope and allocate a new operationId.
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
} {
  const existing = getPendingMutation(params.draftKey);
  if (existing && existing.mode === params.mode && existing.payloadSignature === params.signature) {
    return {
      operationId: existing.operationId,
      recordId: existing.recordId,
      payload: existing.frozenPayload,
      reusedPending: true
    };
  }
  if (existing) {
    clearPendingMutation(params.draftKey);
  }
  return {
    operationId: params.allocateUuid(),
    recordId: params.candidateRecordId,
    payload: params.candidatePayload,
    reusedPending: false
  };
}

export function saveUiPreferences(prefs: PersistedUiPreferences): void {
  writeJson(PREFS_KEY, prefs);
}

export function loadUiPreferences(): PersistedUiPreferences | null {
  return readJson<PersistedUiPreferences | null>(PREFS_KEY, null);
}

export function clearAllBrowserStorageForTest(): void {
  const store = getStore();
  store.removeItem(PREFS_KEY);
  store.removeItem(DRAFTS_KEY);
  store.removeItem(PENDING_OPS_KEY);
}
