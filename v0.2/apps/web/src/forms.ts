/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { escapeHtml } from '../../../packages/ui/src/index.js';
import { generateUuid } from './api.js';
import type { AppState } from './state.js';
import {
  buildConfigDraftKey,
  computePayloadSignature,
  getPendingConfigMutation,
  getPendingMutation,
  getStorageIssue,
  loadConfigDraft,
  loadRecordDraft,
  saveAiDraft,
  saveConfigDraft,
  saveProfileDraft,
  saveRecordDraft
} from './storage.js';
import type {
  BootstrapData,
  ConfigMutationKind,
  PersistedConfigDraft,
  PersistedRecordDraft,
  ProfileFieldRow,
  ProfileFieldType
} from './types.js';

export interface ActiveFormDomSnapshot {
  formId: string;
  valuesBySelector: Array<{ key: string; value: string; checked?: boolean }>;
  activeElementName: string | null;
}

export function captureActiveFormSnapshot(): ActiveFormDomSnapshot | null {
  if (typeof document === 'undefined') return null;
  const targetForm =
    (document.querySelector('.ld-modal-backdrop form') as HTMLFormElement | null) ??
    (document.getElementById('ld-form-profile') as HTMLFormElement | null);
  if (!targetForm || !targetForm.id) return null;

  const valuesBySelector: Array<{ key: string; value: string; checked?: boolean }> = [];
  const inputs = targetForm.querySelectorAll('input, select, textarea');
  inputs.forEach((el, idx) => {
    const fieldKey = el.getAttribute('data-field-key');
    const name = el.getAttribute('name');
    const id = el.id;
    const key = fieldKey
      ? `field:${fieldKey}`
      : id
        ? `id:${id}`
        : name
          ? `name:${name}:${idx}`
          : `idx:${idx}`;

    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      valuesBySelector.push({
        key: `${name ?? id ?? 'check'}:${el.value}:${idx}`,
        value: el.value,
        checked: el.checked
      });
    } else if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      valuesBySelector.push({ key, value: el.value });
    }
  });

  const activeEl = document.activeElement as HTMLElement | null;
  const activeElementName = activeEl
    ? activeEl.getAttribute('data-field-key') ?? activeEl.getAttribute('name') ?? activeEl.id ?? null
    : null;

  return {
    formId: targetForm.id,
    valuesBySelector,
    activeElementName
  };
}

export function restoreActiveFormSnapshot(snapshot: ActiveFormDomSnapshot | null): void {
  if (!snapshot || typeof document === 'undefined') return;
  const targetForm = document.getElementById(snapshot.formId) as HTMLFormElement | null;
  if (!targetForm) return;

  const map = new Map<string, { value: string; checked?: boolean }>();
  for (const item of snapshot.valuesBySelector) {
    map.set(item.key, item);
  }

  const inputs = targetForm.querySelectorAll('input, select, textarea');
  inputs.forEach((el, idx) => {
    const fieldKey = el.getAttribute('data-field-key');
    const name = el.getAttribute('name');
    const id = el.id;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const k = `${name ?? id ?? 'check'}:${el.value}:${idx}`;
      const saved = map.get(k);
      if (saved && typeof saved.checked === 'boolean') {
        el.checked = saved.checked;
      }
      return;
    }
    const key = fieldKey
      ? `field:${fieldKey}`
      : id
        ? `id:${id}`
        : name
          ? `name:${name}:${idx}`
          : `idx:${idx}`;
    const saved = map.get(key);
    if (
      saved &&
      (el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement)
    ) {
      el.value = saved.value;
    }
  });
}

export function extractRecordFormDraft(
  form: HTMLFormElement,
  state: AppState,
  data: BootstrapData
): PersistedRecordDraft | null {
  const mode = (form.getAttribute('data-mode') ?? 'create') as 'create' | 'edit';
  const draftKey = form.getAttribute('data-draft-key') ?? '';
  if (!draftKey) return null;

  const recordIdAttr = form.getAttribute('data-record-id') ?? '';
  const baseVersionAttr = Number(form.getAttribute('data-base-version') ?? '1');
  const existingDraft = loadRecordDraft(draftKey);
  const recordId =
    recordIdAttr || state.recordForm.recordId || existingDraft?.recordId || generateUuid();

  const fd = new FormData(form);
  const existingRecord = mode === 'edit' ? data.records.find(r => r.id === recordId) : undefined;
  const moduleId = existingRecord
    ? existingRecord.module_id
    : String(
        fd.get('module_id') ??
          (state.activeModal?.kind === 'record-form' ? state.activeModal.defaultModuleId : '')
      );
  const recordTypeId = existingRecord
    ? existingRecord.record_type_id
    : String(
        fd.get('record_type_id') ??
          (state.activeModal?.kind === 'record-form' ? state.activeModal.defaultRecordTypeId : '')
      );
  const tpl = data.record_types.find(rt => rt.id === recordTypeId);
  const schemaVersion = existingRecord?.schema_version ?? tpl?.schema_version ?? 1;
  const occurredAt = String(fd.get('occurred_at') ?? '').trim();
  const timezone = String(fd.get('timezone') ?? 'Asia/Shanghai').trim();
  const status = String(fd.get('status') ?? 'confirmed') as 'draft' | 'confirmed';
  const taskIds = fd.getAll('task_id').map(v => String(v));

  const values: Record<string, string | number | boolean | null> = {};
  const rawInputs: Record<string, string> = {};
  const fieldElements = form.querySelectorAll('[data-field-key]');
  fieldElements.forEach(el => {
    const key = el.getAttribute('data-field-key')!;
    const fType = el.getAttribute('data-field-type')!;
    const raw = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value.trim();
    rawInputs[key] = raw;
    if (raw === '') {
      values[key] = null;
    } else if (fType === 'integer') {
      const parsed = Number.parseInt(raw, 10);
      values[key] = Number.isNaN(parsed) ? raw : parsed;
    } else if (fType === 'boolean') {
      values[key] = raw === 'true';
    } else {
      values[key] = raw;
    }
  });

  return {
    draftKey,
    mode,
    recordId,
    baseVersion: mode === 'edit' ? baseVersionAttr : null,
    moduleId,
    recordTypeId,
    schemaVersion,
    occurredAt,
    timezone,
    status,
    values,
    rawInputs,
    taskIds,
    fromTaskId:
      state.activeModal?.kind === 'record-form' ? state.activeModal.fromTaskId : undefined,
    updatedAt: new Date().toISOString()
  };
}

export function extractConfigFormDraft(
  form: HTMLFormElement,
  state: AppState
): PersistedConfigDraft | null {
  const kind = form.getAttribute('data-config-kind') as ConfigMutationKind | null;
  if (!kind) return null;
  const draftKey = form.getAttribute('data-draft-key') || buildConfigDraftKey(kind);
  const existingDraft = loadConfigDraft(draftKey);
  const pendingOp = getPendingConfigMutation(draftKey);
  const entityId =
    pendingOp?.entityId ||
    form.getAttribute('data-entity-id') ||
    state.configForm.entityId ||
    existingDraft?.entityId ||
    generateUuid();

  const rawInputs: Record<string, string> = {};
  const elements = form.querySelectorAll('input, select, textarea');
  elements.forEach(el => {
    const name = el.getAttribute('name');
    if (!name) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      rawInputs[name] = el.checked ? 'true' : 'false';
    } else if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      rawInputs[name] = el.value;
    }
  });

  return {
    draftKey,
    kind,
    entityId,
    confirmedEntityId: existingDraft?.confirmedEntityId,
    rawInputs,
    updatedAt: new Date().toISOString()
  };
}

export function extractProfileFormToState(form: HTMLFormElement, state: AppState): void {
  const nicknameInput = form.querySelector<HTMLInputElement>('input[name="nickname"]');
  const bioInput = form.querySelector<HTMLTextAreaElement>('textarea[name="bio"]');
  const bioNullCheck = form.querySelector<HTMLInputElement>('input[name="bio_is_null"]');
  const tzInput = form.querySelector<HTMLInputElement>('input[name="timezone"]');

  if (nicknameInput) state.profileForm.nickname = nicknameInput.value;
  if (bioInput) state.profileForm.bio = bioInput.value;
  if (bioNullCheck) state.profileForm.bioIsNull = bioNullCheck.checked;
  if (tzInput) state.profileForm.timezone = tzInput.value;

  const updatedFields: ProfileFieldRow[] = [];
  const rows = form.querySelectorAll<HTMLElement>('[data-profile-field-row]');
  rows.forEach(row => {
    const id = row.getAttribute('data-profile-field-row') ?? generateUuid();
    const modEl = row.querySelector<HTMLSelectElement | HTMLInputElement>('[data-pf-prop="module_id"]');
    const keyEl = row.querySelector<HTMLInputElement>('[data-pf-prop="key"]');
    const labelEl = row.querySelector<HTMLInputElement>('[data-pf-prop="label"]');
    const typeEl = row.querySelector<HTMLSelectElement | HTMLInputElement>('[data-pf-prop="type"]');
    const unitEl = row.querySelector<HTMLInputElement>('[data-pf-prop="unit"]');
    const optsEl = row.querySelector<HTMLInputElement>('[data-pf-prop="options"]');
    const valEl = row.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-pf-prop="value"]');
    const nullEl = row.querySelector<HTMLInputElement>('[data-pf-prop="is_null"]');

    const fType = (typeEl?.value ?? 'text') as ProfileFieldType;
    const isNull = nullEl ? nullEl.checked : false;
    const rawVal = valEl ? valEl.value : '';
    const options = (optsEl?.value ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    let parsedValue: string | number | boolean | null = null;
    if (!isNull) {
      if (fType === 'integer') {
        if (rawVal.trim() === '') parsedValue = null;
        else {
          const n = Number(rawVal.trim());
          parsedValue = Number.isNaN(n) ? (rawVal.trim() as any) : n;
        }
      } else if (fType === 'boolean') {
        if (rawVal === '' || rawVal === 'null') parsedValue = null;
        else parsedValue = rawVal === 'true';
      } else if (fType === 'decimal' || fType === 'date' || fType === 'single_select') {
        parsedValue = rawVal.trim() === '' ? null : rawVal.trim();
      } else {
        // text / textarea: allow empty string unless explicitly marked null
        parsedValue = rawVal;
      }
    }

    updatedFields.push({
      id,
      module_id: modEl?.value ?? '',
      key: (keyEl?.value ?? '').trim(),
      label: (labelEl?.value ?? '').trim(),
      type: fType,
      kind: 'profile',
      value: parsedValue,
      unit: (unitEl?.value ?? '').trim() || null,
      options
    });
  });

  if (rows.length > 0 || state.profileForm.fields.length === 0) {
    state.profileForm.fields = updatedFields;
  }

  const rawInputs: Record<string, string> = {};
  for (const f of state.profileForm.fields) {
    if (f.key) {
      rawInputs[f.key] = f.value === null ? '' : String(f.value);
    }
  }

  state.profileForm.dirty = true;
  state.profileForm.lastSavedMessage = null;
  const saved = saveProfileDraft({
    baseVersion: state.profileForm.baseVersion,
    nickname: state.profileForm.nickname,
    bio: state.profileForm.bioIsNull ? null : state.profileForm.bio,
    timezone: state.profileForm.timezone,
    upserts: state.profileForm.fields,
    removeIds: state.profileForm.removeIds,
    rawInputs,
    updatedAt: new Date().toISOString()
  });

  if (!saved) {
    state.profileForm.submissionStatus = 'validation_error';
    state.profileForm.validationError = {
      code: 'LOCAL_STORAGE_FAILED',
      message: getStorageIssue() ?? '未保存本机草稿'
    };
  } else if (state.profileForm.submissionStatus !== 'conflict_pending') {
    state.profileForm.validationError = null;
    const pending = getPendingConfigMutation(buildConfigDraftKey('profile'));
    state.profileForm.submissionStatus = pending ? 'unknown_network' : 'saved_local';
  }
}

export function bindDynamicModalControllers(
  state: AppState,
  onRerenderModalOnly: () => void,
  onUpdateStatusBarOnly: () => void,
  onUpdateConfigStatusBarOnly?: () => void,
  onUpdateProfileStatusBarOnly?: () => void
): void {
  const data = state.bootstrap;
  if (typeof document === 'undefined') return;

  // Bind live local draft persistence on Home & Records disabled AI boxes
  const aiInputs = document.querySelectorAll<HTMLTextAreaElement>('[data-ai-draft-input]');
  aiInputs.forEach(textarea => {
    const scope = (textarea.getAttribute('data-ai-draft-input') ?? 'home') as 'home' | 'records';
    const handleAiInput = () => {
      const ok = saveAiDraft(scope, textarea.value);
      const badge = document.querySelector<HTMLElement>(`[data-ai-draft-status="${scope}"]`);
      if (badge) {
        if (!ok) {
          badge.textContent = getStorageIssue() ?? '未保存本机';
          badge.className = 'ld-badge ld-badge-danger';
        } else if (textarea.value.trim().length > 0) {
          badge.textContent = '已保存本机待发送草稿';
          badge.className = 'ld-badge ld-badge-info';
        } else {
          badge.textContent = '草稿为空';
          badge.className = 'ld-badge';
        }
      }
    };
    textarea.addEventListener('input', handleAiInput);
    textarea.addEventListener('change', handleAiInput);
  });

  // Bind live local draft tracking on #ld-form-profile
  const profileForm = document.getElementById('ld-form-profile') as HTMLFormElement | null;
  if (profileForm) {
    const handleProfileInput = () => {
      extractProfileFormToState(profileForm, state);
      onUpdateProfileStatusBarOnly?.();
    };
    profileForm.addEventListener('input', handleProfileInput);
    profileForm.addEventListener('change', handleProfileInput);
  }

  if (!data) return;

  // Bind live local draft persistence on #ld-form-record
  const recordForm = document.getElementById('ld-form-record') as HTMLFormElement | null;
  if (recordForm) {
    if (state.submittingModal) {
      recordForm
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea'
        )
        .forEach(el => {
          el.disabled = true;
        });
    }
    const handleInput = () => {
      const draft = extractRecordFormDraft(recordForm, state, data);
      if (!draft) return;
      const saved = saveRecordDraft(draft);
      state.recordForm.draftKey = draft.draftKey;
      state.recordForm.recordId = draft.recordId;
      state.recordForm.lastSavedLocalAt = saved ? draft.updatedAt : null;
      if (!saved) {
        state.recordForm.submissionStatus = 'validation_error';
        state.recordForm.validationError = {
          code: 'LOCAL_STORAGE_FAILED',
          message: getStorageIssue() ?? '未保存本机'
        };
        onUpdateStatusBarOnly();
        return;
      }
      state.recordForm.validationError = null;

      // An unknown operation stays frozen even while its working draft is edited.
      const pending = getPendingMutation(draft.draftKey);
      if (pending) {
        const sig = computePayloadSignature({
          mode: draft.mode,
          module_id: draft.moduleId,
          record_type_id: draft.recordTypeId,
          schema_version: draft.schemaVersion,
          status: draft.status,
          values: draft.values,
          task_ids: draft.taskIds,
          base_version: draft.baseVersion ?? undefined,
          occurred_at: draft.occurredAt,
          timezone: draft.timezone
        });
        if (sig !== pending.payloadSignature) {
          state.recordForm.submissionStatus = 'unknown_network';
        }
      } else if (state.recordForm.submissionStatus !== 'conflict_pending') {
        state.recordForm.submissionStatus = 'saved_local';
      }
      onUpdateStatusBarOnly();
    };
    recordForm.addEventListener('input', handleInput);
    recordForm.addEventListener('change', handleInput);
  }

  // Bind live local draft persistence on configuration creation forms (P1-03)
  const configForm = document.querySelector<HTMLFormElement>('form[data-config-kind]');
  if (configForm) {
    if (state.submittingModal) {
      configForm
        .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
          'input,select,textarea'
        )
        .forEach(el => {
          el.disabled = true;
        });
    }
    const handleConfigInput = () => {
      const draft = extractConfigFormDraft(configForm, state);
      if (!draft) return;
      const saved = saveConfigDraft(draft);
      state.configForm.draftKey = draft.draftKey;
      state.configForm.kind = draft.kind;
      state.configForm.entityId = draft.entityId;
      state.configForm.lastSavedLocalAt = saved ? draft.updatedAt : null;
      if (!saved) {
        state.configForm.submissionStatus = 'validation_error';
        state.configForm.validationError = {
          code: 'LOCAL_STORAGE_FAILED',
          message: getStorageIssue() ?? '未保存本机'
        };
        onUpdateConfigStatusBarOnly?.();
        return;
      }
      state.configForm.validationError = null;
      const pending = getPendingConfigMutation(draft.draftKey);
      if (pending) {
        state.configForm.submissionStatus = 'unknown_network';
        state.configForm.operationId = pending.operationId;
        state.configForm.entityId = pending.entityId;
      } else if (draft.confirmedEntityId) {
        state.configForm.submissionStatus = 'confirmed_server';
      } else if (state.configForm.submissionStatus !== 'conflict_pending') {
        state.configForm.submissionStatus = 'saved_local';
      }
      onUpdateConfigStatusBarOnly?.();
    };
    configForm.addEventListener('input', handleConfigInput);
    configForm.addEventListener('change', handleConfigInput);
  }

  // Create Task modal dynamic interactions
  const taskModSelect = document.getElementById('ld-task-module-select') as HTMLSelectElement | null;
  const taskModeSelect = document.getElementById('ld-task-mode-select') as HTMLSelectElement | null;
  const taskTplSelect = document.getElementById('ld-task-template-select') as HTMLSelectElement | null;
  const taskAccKind = document.getElementById('ld-task-acceptance-kind') as HTMLSelectElement | null;
  const taskFieldSelect = document.getElementById('ld-task-field-select') as HTMLSelectElement | null;
  const taskBindingGroup = document.getElementById('ld-task-binding-group');
  const taskThresholdGroup = document.getElementById('ld-task-threshold-group');

  const syncTaskFormVisibility = () => {
    if (!taskModeSelect || !taskBindingGroup || !taskAccKind || !taskThresholdGroup) return;
    const isManual = taskModeSelect.value === 'manual';
    taskBindingGroup.style.display = isManual ? 'none' : 'flex';
    taskThresholdGroup.style.display =
      !isManual && taskAccKind.value === 'field_gte' ? 'grid' : 'none';
  };

  const syncTaskNumericFields = (tplId: string) => {
    if (!taskFieldSelect || !taskAccKind) return;
    const tpl = data.record_types.find(rt => rt.id === tplId);
    const numFields = (tpl?.fields ?? []).filter(f => ['integer', 'decimal'].includes(f.type));
    taskFieldSelect.innerHTML = numFields
      .map(
        f =>
          `<option value="${escapeHtml(f.key)}">${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / ${escapeHtml(f.unit)}` : ''})</option>`
      )
      .join('');
    const fieldGteOpt = taskAccKind.querySelector('option[value="field_gte"]') as HTMLOptionElement | null;
    if (fieldGteOpt) {
      fieldGteOpt.disabled = numFields.length === 0;
      if (numFields.length === 0 && taskAccKind.value === 'field_gte') {
        taskAccKind.value = 'exists';
      }
    }
    syncTaskFormVisibility();
  };

  if (taskModSelect && taskTplSelect) {
    taskModSelect.onchange = () => {
      const templates = data.record_types.filter(rt => rt.module_id === taskModSelect.value);
      taskTplSelect.innerHTML = templates
        .map(rt => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`)
        .join('');
      syncTaskNumericFields(templates[0]?.id ?? '');
    };
  }
  if (taskTplSelect) {
    taskTplSelect.onchange = () => syncTaskNumericFields(taskTplSelect.value);
  }
  if (taskModeSelect) taskModeSelect.onchange = syncTaskFormVisibility;
  if (taskAccKind) taskAccKind.onchange = syncTaskFormVisibility;

  // Record Form modal module/template switch
  const recModSelect = document.getElementById('ld-record-module-select') as HTMLSelectElement | null;
  const recTplSelect = document.getElementById('ld-record-template-select') as HTMLSelectElement | null;
  if (recModSelect && state.activeModal?.kind === 'record-form' && state.activeModal.mode === 'create') {
    recModSelect.onchange = () => {
      if (state.activeModal?.kind !== 'record-form') return;
      const firstTpl = data.record_types.find(rt => rt.module_id === recModSelect.value);
      state.activeModal.defaultModuleId = recModSelect.value;
      state.activeModal.defaultRecordTypeId = firstTpl?.id ?? '';
      state.activeModal.defaultTaskIds = [];
      onRerenderModalOnly();
    };
  }
  if (recTplSelect && state.activeModal?.kind === 'record-form' && state.activeModal.mode === 'create') {
    recTplSelect.onchange = () => {
      if (state.activeModal?.kind !== 'record-form') return;
      state.activeModal.defaultRecordTypeId = recTplSelect.value;
      state.activeModal.defaultTaskIds = [];
      onRerenderModalOnly();
    };
  }

  // Create Metric modal dynamic interactions
  const metricModSelect = document.getElementById('ld-metric-module-select') as HTMLSelectElement | null;
  const metricTplSelect = document.getElementById('ld-metric-template-select') as HTMLSelectElement | null;
  const metricAggSelect = document.getElementById('ld-metric-agg-select') as HTMLSelectElement | null;
  const metricFieldGroup = document.getElementById('ld-metric-field-group');
  const metricFieldSelect = document.getElementById('ld-metric-field-select') as HTMLSelectElement | null;
  const metricUnitInput = document.getElementById('ld-metric-unit-input') as HTMLInputElement | null;

  const syncMetricFields = () => {
    if (!metricTplSelect || !metricAggSelect || !metricFieldGroup || !metricFieldSelect || !metricUnitInput) return;
    const tpl = data.record_types.find(rt => rt.id === metricTplSelect.value);
    const numFields = (tpl?.fields ?? []).filter(f => ['integer', 'decimal'].includes(f.type));
    const isCount = metricAggSelect.value === 'count';
    metricFieldGroup.style.display = isCount ? 'none' : 'flex';
    if (!isCount && numFields.length > 0) {
      const selectedField = numFields.find(f => f.key === metricFieldSelect.value) ?? numFields[0];
      if (selectedField?.unit) {
        metricUnitInput.value = selectedField.unit;
      }
    } else if (isCount && (!metricUnitInput.value || metricUnitInput.value === '分钟')) {
      metricUnitInput.value = '次';
    }
  };

  if (metricModSelect && metricTplSelect && metricFieldSelect && metricAggSelect) {
    metricModSelect.onchange = () => {
      const templates = data.record_types.filter(rt => rt.module_id === metricModSelect.value);
      metricTplSelect.innerHTML = templates
        .map(rt => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`)
        .join('');
      const firstTpl = templates[0];
      const numFields = (firstTpl?.fields ?? []).filter(f => ['integer', 'decimal'].includes(f.type));
      metricFieldSelect.innerHTML = numFields
        .map(
          f =>
            `<option value="${escapeHtml(f.key)}" data-unit="${escapeHtml(f.unit ?? '')}">${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / 单位:${escapeHtml(f.unit)}` : ''})</option>`
        )
        .join('');
      for (const agg of ['sum', 'avg', 'latest']) {
        const opt = metricAggSelect.querySelector(`option[value="${agg}"]`) as HTMLOptionElement | null;
        if (opt) opt.disabled = numFields.length === 0;
      }
      if (numFields.length === 0) metricAggSelect.value = 'count';
      syncMetricFields();
    };
  }
  if (metricTplSelect) metricTplSelect.onchange = syncMetricFields;
  if (metricAggSelect) metricAggSelect.onchange = syncMetricFields;
  if (metricFieldSelect) metricFieldSelect.onchange = syncMetricFields;

  // Create Achievement modal module -> metric cascade
  const achModSelect = document.getElementById('ld-ach-module-select') as HTMLSelectElement | null;
  const achMetricSelect = document.getElementById('ld-ach-metric-select') as HTMLSelectElement | null;
  if (achModSelect && achMetricSelect) {
    const syncAchievementMetrics = () => {
      const selected = achMetricSelect.value;
      const metrics = data.metrics.filter(m => m.module_id === achModSelect.value);
      achMetricSelect.innerHTML =
        metrics.length === 0
          ? `<option value="">当前模块暂无活动数值定义，请先创建数值</option>`
          : metrics
              .map(
                m =>
                  `<option value="${escapeHtml(m.id)}">${escapeHtml(m.definition.name)} (${escapeHtml(m.definition.unit)})</option>`
              )
              .join('');
      if (metrics.some(m => m.id === selected)) achMetricSelect.value = selected;
      const submit = document.querySelector<HTMLButtonElement>(
        '#ld-form-create-achievement button[type=submit]'
      );
      if (submit) submit.disabled = state.submittingModal || metrics.length === 0;
    };
    achModSelect.onchange = syncAchievementMetrics;
    syncAchievementMetrics();
  }

  // AI generation modal mode-dependent groups
  if (state.activeModal?.kind === 'ai-generate') {
    const aiModeSelect = document.getElementById('ld-ai-mode-select') as HTMLSelectElement | null;
    const aiCreateFields = document.getElementById('ld-ai-create-fields');
    const aiExtendFields = document.getElementById('ld-ai-extend-fields');
    const syncAiModeFields = () => {
      if (!aiModeSelect || !aiCreateFields || !aiExtendFields) return;
      const isCreate = aiModeSelect.value === 'create';
      aiCreateFields.style.display = isCreate ? 'grid' : 'none';
      aiExtendFields.style.display = isCreate ? 'none' : 'grid';
    };
    if (aiModeSelect) aiModeSelect.onchange = syncAiModeFields;
    syncAiModeFields();

    const aiModSelect = document.getElementById('ld-ai-module-select') as HTMLSelectElement | null;
    const aiRefRecordTypes = document.getElementById('ai-ref-record-types') as HTMLSelectElement | null;
    const aiRefMetrics = document.getElementById('ai-ref-metrics') as HTMLSelectElement | null;
    if (aiModSelect) {
      aiModSelect.onchange = () => {
        const templates = data.record_types.filter(rt => rt.module_id === aiModSelect.value);
        const metrics = data.metrics.filter(m => m.module_id === aiModSelect.value);
        if (aiRefRecordTypes) {
          aiRefRecordTypes.innerHTML =
            templates.length === 0
              ? '<option value="" disabled>当前模块暂无可引用对象</option>'
              : templates
                  .map(rt => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`)
                  .join('');
          aiRefRecordTypes.disabled = templates.length === 0;
        }
        if (aiRefMetrics) {
          aiRefMetrics.innerHTML =
            metrics.length === 0
              ? '<option value="" disabled>当前模块暂无可引用对象</option>'
              : metrics
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}">${escapeHtml(m.definition.name)} (${escapeHtml(m.definition.unit)})</option>`
                  )
                  .join('');
          aiRefMetrics.disabled = metrics.length === 0;
        }
      };
    }
  }
}
