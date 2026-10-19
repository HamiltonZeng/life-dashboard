/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import { escapeHtml } from '../../../packages/ui/src/index.js';
import { generateUuid } from './api.js';
import type { AppState } from './state.js';
import {
  clearPendingMutation,
  computePayloadSignature,
  getPendingMutation,
  loadRecordDraft,
  saveRecordDraft
  ,getStorageIssue
} from './storage.js';
import type { BootstrapData, PersistedRecordDraft } from './types.js';

export interface ActiveFormDomSnapshot {
  formId: string;
  valuesBySelector: Array<{ key: string; value: string; checked?: boolean }>;
  activeElementName: string | null;
}

export function captureActiveFormSnapshot(): ActiveFormDomSnapshot | null {
  if (typeof document === 'undefined') return null;
  const modalForm = document.querySelector('.ld-modal-backdrop form') as HTMLFormElement | null;
  if (!modalForm || !modalForm.id) return null;

  const valuesBySelector: Array<{ key: string; value: string; checked?: boolean }> = [];
  const inputs = modalForm.querySelectorAll('input, select, textarea');
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
        key: `${name ?? 'check'}:${el.value}`,
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
    formId: modalForm.id,
    valuesBySelector,
    activeElementName
  };
}

export function restoreActiveFormSnapshot(snapshot: ActiveFormDomSnapshot | null): void {
  if (!snapshot || typeof document === 'undefined') return;
  const modalForm = document.getElementById(snapshot.formId) as HTMLFormElement | null;
  if (!modalForm) return;

  const map = new Map<string, { value: string; checked?: boolean }>();
  for (const item of snapshot.valuesBySelector) {
    map.set(item.key, item);
  }

  const inputs = modalForm.querySelectorAll('input, select, textarea');
  inputs.forEach((el, idx) => {
    const fieldKey = el.getAttribute('data-field-key');
    const name = el.getAttribute('name');
    const id = el.id;
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      const k = `${name ?? 'check'}:${el.value}`;
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

export function bindDynamicModalControllers(
  state: AppState,
  onRerenderModalOnly: () => void,
  onUpdateStatusBarOnly: () => void
): void {
  const data = state.bootstrap;
  if (!data || typeof document === 'undefined') return;

  // Bind live local draft persistence on #ld-form-record
  const recordForm = document.getElementById('ld-form-record') as HTMLFormElement | null;
  if (recordForm) {
    if(state.submittingModal)recordForm.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input,select,textarea').forEach(el=>{el.disabled=true;});
    const handleInput = () => {
      const draft = extractRecordFormDraft(recordForm, state, data);
      if (!draft) return;
      const saved=saveRecordDraft(draft);
      state.recordForm.draftKey = draft.draftKey;
      state.recordForm.recordId = draft.recordId;
      state.recordForm.lastSavedLocalAt = saved?draft.updatedAt:null;
      if(!saved){state.recordForm.submissionStatus='validation_error';state.recordForm.validationError={code:'LOCAL_STORAGE_FAILED',message:getStorageIssue()??'未保存本机'};onUpdateStatusBarOnly();return;}
      state.recordForm.validationError=null;

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
          base_version: draft.baseVersion ?? undefined
          ,occurred_at:draft.occurredAt,timezone:draft.timezone
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
      const selected=achMetricSelect.value;
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
      if(metrics.some(m=>m.id===selected))achMetricSelect.value=selected;
      const submit=document.querySelector<HTMLButtonElement>('#ld-form-create-achievement button[type=submit]');
      if(submit)submit.disabled=state.submittingModal||metrics.length===0;
    };
    achModSelect.onchange=syncAchievementMetrics;
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
