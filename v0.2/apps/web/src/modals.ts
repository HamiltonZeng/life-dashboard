import {
  escapeHtml,
  FIELD_TYPE_META,
  METRIC_AGGREGATION_META,
  METRIC_WINDOW_META,
  MODULE_COLORS,
  MODULE_ICON_LABELS,
  renderModuleBadge,
  SUBMISSION_STATE_META,
  TASK_STATUS_META,
  type ModuleIconName
} from '../../../packages/ui/src/index.js';
import { generateUuid } from './api.js';
import { renderAiGenerateModal, renderAiResultModal } from './ai-views.js';
import {
  describeTaskAcceptance,
  diagnosePartialTask,
  formatDateTime,
  getLocalIsoWithOffset
} from './panels.js';
import type { AppState } from './state.js';
import {
  buildConfigDraftKey,
  buildRecordDraftKey,
  getPendingConfigMutation,
  getPendingMutation,
  loadConfigDraft,
  loadRecordDraft
} from './storage.js';
import type {
  AchievementAwardRow,
  BootstrapData,
  ConfigMutationKind,
  MetricRow,
  ModuleRow,
  RecordTypeRow
} from './types.js';

function findModule(data: BootstrapData, id: string): ModuleRow | undefined {
  return data.modules.find(m => m.id === id);
}

function findTemplate(data: BootstrapData, id: string | null | undefined): RecordTypeRow | undefined {
  if (!id) return undefined;
  return data.record_types.find(rt => rt.id === id);
}

function findMetric(data: BootstrapData, id: string): MetricRow | undefined {
  return data.metrics.find(m => m.id === id);
}

function findAward(data: BootstrapData, achievementId: string): AchievementAwardRow | undefined {
  return data.achievement_awards.find(a => a.achievement_id === achievementId);
}

export function renderSubmissionStatusPill(state: AppState): string {
  const rf = state.recordForm;
  const meta = SUBMISSION_STATE_META[rf.submissionStatus] ?? SUBMISSION_STATE_META.idle;
  const badgeClass =
    meta.tone === 'success'
      ? 'ld-badge-success'
      : meta.tone === 'warning'
        ? 'ld-badge-warning'
        : meta.tone === 'danger'
          ? 'ld-badge-danger'
          : meta.tone === 'info'
            ? 'ld-badge-info'
            : '';

  return `<div class="ld-draft-status-bar" data-submission-status="${escapeHtml(rf.submissionStatus)}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="ld-badge ${badgeClass}">${escapeHtml(rf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? '未保存本机' : meta.label)}</span>
      <span style="color:var(--ld-text-secondary);">${escapeHtml(rf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? rf.validationError.message : meta.description)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      ${
        rf.operationId
          ? `<details><summary>提交诊断</summary><code style="font-size:11px;color:var(--ld-text-muted);">operation_id: ${escapeHtml(rf.operationId.slice(0, 12))}…</code></details>`
          : ''
      }
      ${
        rf.restoredFromStorage || rf.submissionStatus === 'saved_local' || rf.submissionStatus === 'unknown_network'
          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="discard-record-draft">丢弃本地草稿</button>`
          : ''
      }
    </div>
  </div>`;
}

export function renderConfigSubmissionStatusPill(state: AppState): string {
  const cf = state.configForm;
  const meta = SUBMISSION_STATE_META[cf.submissionStatus] ?? SUBMISSION_STATE_META.idle;
  const badgeClass =
    meta.tone === 'success'
      ? 'ld-badge-success'
      : meta.tone === 'warning'
        ? 'ld-badge-warning'
        : meta.tone === 'danger'
          ? 'ld-badge-danger'
          : meta.tone === 'info'
            ? 'ld-badge-info'
            : '';

  return `<div class="ld-draft-status-bar" data-config-submission-status="${escapeHtml(cf.submissionStatus)}" data-submission-status="${escapeHtml(cf.submissionStatus)}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="ld-badge ${badgeClass}">${escapeHtml(cf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? '未保存本机' : meta.label)}</span>
      <span style="color:var(--ld-text-secondary);">${escapeHtml(cf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? cf.validationError.message : meta.description)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      ${
        cf.operationId || cf.entityId
          ? `<details><summary>提交诊断</summary><code style="font-size:11px;color:var(--ld-text-muted);">${cf.operationId ? `operation_id: ${escapeHtml(cf.operationId.slice(0, 12))}… ` : ''}${cf.entityId ? `entity_id: ${escapeHtml(cf.entityId.slice(0, 12))}…` : ''}</code></details>`
          : ''
      }
      ${
        cf.restoredFromStorage || cf.submissionStatus === 'saved_local' || cf.submissionStatus === 'unknown_network'
          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="discard-config-draft">丢弃本地草稿</button>`
          : ''
      }
    </div>
  </div>`;
}

function renderModalConflictPanel(state: AppState): string {
  const rfConflict = state.recordForm.conflictError;
  const cfConflict = state.configForm.conflictError;
  const modalErr = state.modalError;
  const conflict = rfConflict ?? cfConflict ?? modalErr;
  if (!conflict) return '';

  const serverRec = state.recordForm.conflictServerRecord;
  return `<div class="ld-conflict-panel" role="alert" data-conflict-code="${escapeHtml(conflict.code)}">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
      <div>
        <strong>⚠ 冲突待处理 (${escapeHtml(conflict.code)})：</strong>${escapeHtml(conflict.message)}
      </div>
      <div style="display:flex;gap:6px;">
        <button type="button" class="ld-btn ld-btn-sm" data-action="conflict-pull-latest">拉取服务器最新版本</button>
        ${serverRec ? '<button type="button" class="ld-btn ld-btn-sm" data-action="conflict-adopt-version">采用此版本作为编辑基线</button>' : ''}
      </div>
    </div>
    <div style="color:var(--ld-text-secondary);font-size:12px;">
      已完整保留你当前在表单中填写的本地输入，不会用旧版本覆盖服务器数据，也不会清空你的未保存输入。
      ${
        serverRec
          ? `服务器当前版本：<code>v${serverRec.version}</code>，服务器值：<code>${escapeHtml(JSON.stringify(serverRec.values))}</code>`
          : ''
      }
    </div>
  </div>`;
}

function resolveConfigModalContext(state: AppState, kind: ConfigMutationKind) {
  const draftKey = buildConfigDraftKey(kind);
  const savedDraft = loadConfigDraft(draftKey);
  const pendingOp = getPendingConfigMutation(draftKey);
  const entityId =
    pendingOp?.entityId ??
    (state.configForm.kind === kind && state.configForm.entityId ? state.configForm.entityId : null) ??
    savedDraft?.entityId ??
    generateUuid();

  if (state.configForm.kind !== kind || state.configForm.draftKey !== draftKey) {
    state.configForm = {
      draftKey,
      kind,
      submissionStatus: pendingOp ? 'unknown_network' : savedDraft ? 'saved_local' : 'idle',
      operationId: pendingOp ? pendingOp.operationId : null,
      entityId,
      restoredFromStorage: Boolean(savedDraft || pendingOp),
      lastSavedLocalAt: savedDraft?.updatedAt ?? null,
      conflictError: null,
      validationError: null
    };
  } else {
    state.configForm.entityId = entityId;
    if (pendingOp) {
      state.configForm.submissionStatus = 'unknown_network';
      state.configForm.operationId = pendingOp.operationId;
    }
  }

  const pendingBanner = pendingOp
    ? `<div class="ld-return-banner" style="background:var(--ld-warning-soft);border-color:rgba(245,158,11,0.5);" data-config-pending-banner="${escapeHtml(kind)}">
        <div>
          <strong>上次配置创建结果待确认：</strong>请先确认上次提交；直接点击确认将沿用原 <code>operation_id</code> 与实体 ID (<code>${escapeHtml(entityId.slice(0, 8))}…</code>)，不会复制出重复配置。
        </div>
      </div>`
    : '';

  const valError = state.configForm.validationError;
  const valBanner = valError
    ? `<div class="ld-error-banner" role="alert"><span><strong>${escapeHtml(valError.code)}</strong>：${escapeHtml(valError.message)}（已保留你当前填写的输入）</span></div>`
    : '';

  return {
    draftKey,
    savedDraft,
    pendingOp,
    entityId,
    pendingBanner,
    valBanner
  };
}

export function renderActiveModal(state: AppState, data: BootstrapData): string {
  const modal = state.activeModal;
  if (!modal) return '';

  const enabledModules = data.modules.filter(m => m.status === 'enabled');
  const userTz = state.user?.timezone ?? 'Asia/Shanghai';

  if (modal.kind === 'create-task') {
    const ctx = resolveConfigModalContext(state, 'create-task');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const selectedMode = raw.completion_mode ?? 'record_required';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const selectedTplId = raw.record_type_id ?? templates[0]?.id ?? '';
    const activeTpl = templates.find(rt => rt.id === selectedTplId) ?? templates[0];
    const numericFields = (activeTpl?.fields ?? []).filter(f =>
      ['integer', 'decimal'].includes(f.type)
    );
    const selectedAccKind = raw.acceptance_kind ?? 'exists';
    const selectedFieldKey = raw.field_key ?? numericFields[0]?.key ?? '';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-task" data-config-kind="create-task" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建任务实例</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-task-module-select" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">完成方式 *</span>
              <select class="ld-select" name="completion_mode" id="ld-task-mode-select" required>
                <option value="record_required" ${selectedMode === 'record_required' ? 'selected' : ''}>必须关联记录 (record_required)</option>
                <option value="record_optional" ${selectedMode === 'record_optional' ? 'selected' : ''}>记录可选 (record_optional)</option>
                <option value="manual" ${selectedMode === 'manual' ? 'selected' : ''}>手动完成 (manual)</option>
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">任务标题 * <span class="ld-label-hint">1~100 字符，如「完成一次 Python 练习」</span></span>
            <input class="ld-input" type="text" name="title" maxlength="100" value="${escapeHtml(raw.title ?? '')}" required placeholder="输入任务标题" />
          </label>
          <div id="ld-task-binding-group" class="ld-form-grid" style="display:${selectedMode === 'manual' ? 'none' : 'flex'};padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">关联记录模板 *</span>
                <select class="ld-select" name="record_type_id" id="ld-task-template-select">
                  ${templates
                    .map(
                      rt =>
                        `<option value="${escapeHtml(rt.id)}" ${rt.id === selectedTplId ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">验收规则类型 *</span>
                <select class="ld-select" name="acceptance_kind" id="ld-task-acceptance-kind">
                  <option value="exists" ${selectedAccKind === 'exists' ? 'selected' : ''}>存在有效关联记录 (exists)</option>
                  <option value="field_gte" ${numericFields.length === 0 ? 'disabled' : ''} ${selectedAccKind === 'field_gte' ? 'selected' : ''}>指定数值字段达到门槛 (field_gte)</option>
                </select>
              </label>
            </div>
            <div id="ld-task-threshold-group" class="ld-form-row" style="display:${selectedMode !== 'manual' && selectedAccKind === 'field_gte' ? 'grid' : 'none'};">
              <label class="ld-field">
                <span class="ld-label">目标数值字段 *</span>
                <select class="ld-select" name="field_key" id="ld-task-field-select">
                  ${numericFields
                    .map(
                      f =>
                        `<option value="${escapeHtml(f.key)}" ${f.key === selectedFieldKey ? 'selected' : ''}>${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / ${escapeHtml(f.unit)}` : ''})</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">单条记录达标门槛 * <span class="ld-label-hint">十进制数字，如 10</span></span>
                <input class="ld-input" type="text" name="threshold" value="${escapeHtml(raw.threshold ?? '10')}" placeholder="例如 10" />
              </label>
            </div>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">计划业务日期 <span class="ld-label-hint">可留空表示不限日期</span></span>
              <input class="ld-input" type="date" name="business_date" value="${escapeHtml(raw.business_date ?? '')}" />
            </label>
            <label class="ld-field">
              <span class="ld-label">时区 (IANA) *</span>
              <input class="ld-input" type="text" name="timezone" value="${escapeHtml(raw.timezone ?? userTz)}" required />
            </label>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-config-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建任务'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'task-detail') {
    const task = data.tasks.find(t => t.id === modal.taskId);
    if (!task) return '';
    const mod = findModule(data, task.module_id);
    const linked = data.records.filter(r => r.task_ids.includes(task.id));
    const partialDiag = diagnosePartialTask(data, task);
    const isClosedTask = task.status === 'cancelled' || task.status === 'skipped';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">任务详情与完成依据</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge">${escapeHtml(TASK_STATUS_META[task.status]?.label ?? task.status)}</span>
            ${task.needs_review ? `<span class="ld-badge ld-badge-warning">⚠ 完成依据变化，待复核</span>` : ''}
            ${isClosedTask ? `<span class="ld-badge ld-badge-danger">已关闭状态（不可再完成）</span>` : ''}
          </div>
          <h3 style="margin:0;font-size:18px;">${escapeHtml(task.definition.title)}</h3>
          <div class="ld-card-meta" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <div><strong>验收条件：</strong>${escapeHtml(describeTaskAcceptance(data, task))}</div>
            <div><strong>计划日期：</strong>${escapeHtml(task.definition.business_date ?? '不限日期')} · <strong>时区：</strong>${escapeHtml(task.definition.timezone)}</div>
            <div><strong>规则版本：</strong>v${task.rule_version} · <strong>实例版本：</strong>v${task.version} · <strong>实例 ID：</strong><code>${escapeHtml(task.id)}</code></div>
          </div>
          ${partialDiag ? `<div class="ld-badge ld-badge-warning" style="padding:8px 12px;">${escapeHtml(partialDiag)}</div>` : ''}
          <div>
            <h4 style="margin:6px 0 8px;">关联的完成依据记录 (${linked.length})</h4>
            ${
              linked.length === 0
                ? `<div class="ld-card-meta">尚未关联任何记录。</div>`
                : `<div class="ld-card-list">
                    ${linked
                      .map(r => {
                        const tpl = findTemplate(data, r.record_type_id);
                        return `<div class="ld-card" style="padding:10px 12px;">
                          <div class="ld-card-top">
                            <strong>${escapeHtml(tpl?.name ?? '记录')} (${r.status === 'confirmed' ? '已确认' : '草稿'})</strong>
                            <button type="button" class="ld-btn ld-btn-sm" data-action="task-jump-record-detail" data-task-id="${escapeHtml(task.id)}" data-record-id="${escapeHtml(r.id)}">查看精确记录 →</button>
                          </div>
                          <div class="ld-card-meta">${escapeHtml(formatDateTime(r.occurred_at))} · <code>${escapeHtml(JSON.stringify(r.values))}</code></div>
                        </div>`;
                      })
                      .join('')}
                  </div>`
            }
          </div>
        </div>
        <div class="ld-modal-footer">
          ${
            !isClosedTask && task.definition.completion_mode !== 'manual'
              ? `<button type="button" class="ld-btn ld-btn-primary" data-action="task-go-record" data-task-id="${escapeHtml(task.id)}">去记录</button>`
              : ''
          }
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'record-form') {
    const editingRecord =
      modal.mode === 'edit' && modal.recordId
        ? data.records.find(r => r.id === modal.recordId)
        : undefined;
    const modId = editingRecord ? editingRecord.module_id : modal.defaultModuleId;
    const tplId = editingRecord ? editingRecord.record_type_id : modal.defaultRecordTypeId;
    const tpl = findTemplate(data, tplId) ?? data.record_types.find(rt => rt.module_id === modId);
    const actualModId = tpl?.module_id ?? modId;
    const actualTplId = tpl?.id ?? tplId;

    const draftKey = buildRecordDraftKey({
      mode: modal.mode,
      recordId: editingRecord?.id ?? modal.recordId,
      moduleId: actualModId,
      recordTypeId: actualTplId,
      fromTaskId: modal.fromTaskId
    });
    const savedDraft = loadRecordDraft(draftKey);
    const pendingOp = getPendingMutation(draftKey);

    const compatibleTasks = data.tasks.filter(
      t =>
        t.module_id === actualModId &&
        t.definition.record_type_id === actualTplId &&
        t.definition.completion_mode !== 'manual' &&
        t.status !== 'cancelled' &&
        t.status !== 'skipped'
    );
    const selectedTaskIds = new Set(
      savedDraft
        ? savedDraft.taskIds
        : editingRecord
          ? editingRecord.task_ids
          : modal.defaultTaskIds
    );
    const fromTask = modal.fromTaskId ? data.tasks.find(t => t.id === modal.fromTaskId) : undefined;
    const effectiveOccurredAt = savedDraft
      ? savedDraft.occurredAt
      : editingRecord
        ? editingRecord.occurred_at
        : getLocalIsoWithOffset();
    const effectiveTz = savedDraft
      ? savedDraft.timezone
      : editingRecord
        ? editingRecord.timezone
        : userTz;
    const effectiveStatus = savedDraft
      ? savedDraft.status
      : editingRecord
        ? editingRecord.status
        : 'confirmed';

    const valError = state.recordForm.validationError;

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-record" data-mode="${modal.mode}" data-record-id="${escapeHtml(editingRecord?.id ?? modal.recordId ?? '')}" data-draft-key="${escapeHtml(draftKey)}" data-base-version="${escapeHtml(String(state.recordForm.baseVersion ?? savedDraft?.baseVersion ?? editingRecord?.version ?? 1))}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">${modal.mode === 'edit' ? '编辑真实记录' : '新建真实记录'}</h2>
            <div class="ld-card-meta">先保存本机草稿，再向服务器确认；未确认的内容请保留。</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${
            valError
              ? `<div class="ld-error-banner" role="alert"><span><strong>${escapeHtml(valError.code)}</strong>：${escapeHtml(valError.message)}（已保留你当前填写的输入）</span></div>`
              : ''
          }
          ${
            pendingOp
              ? `<div class="ld-return-banner" style="background:var(--ld-warning-soft);border-color:rgba(245,158,11,0.5);">
                  <div>
                    <strong>上次提交结果待确认：</strong>请先确认上次提交；当前修改会保留，确认后可保存到同一条记录。
                  </div>
                </div>`
              : ''
          }
          ${
            fromTask
              ? `<div class="ld-return-banner">
                  <div>
                    <strong>来自任务：</strong>「${escapeHtml(fromTask.definition.title)}」
                    <div style="font-size:12px;color:var(--ld-text-secondary);">已自动携带模块、记录模板与任务实例关联；实际内容与时长请如实填写（绝不预填目标值）。</div>
                  </div>
                </div>`
              : ''
          }
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-record-module-select" ${modal.mode === 'edit' || pendingOp ? 'disabled' : ''} required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === actualModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">记录模板 *</span>
              <select class="ld-select" name="record_type_id" id="ld-record-template-select" ${modal.mode === 'edit' || pendingOp ? 'disabled' : ''} required>
                ${data.record_types
                  .filter(rt => rt.module_id === actualModId)
                  .map(
                    rt =>
                      `<option value="${escapeHtml(rt.id)}" ${rt.id === actualTplId ? 'selected' : ''}>${escapeHtml(rt.name)} (v${rt.schema_version})</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">实际发生时间 (ISO 8601 含偏移) *</span>
              <input class="ld-input" type="text" name="occurred_at" value="${escapeHtml(effectiveOccurredAt)}" required />
            </label>
            <label class="ld-field">
              <span class="ld-label">时区 (IANA) *</span>
              <input class="ld-input" type="text" name="timezone" value="${escapeHtml(effectiveTz)}" required />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">记录状态 *</span>
            <select class="ld-select" name="status" required>
              <option value="confirmed" ${effectiveStatus === 'confirmed' ? 'selected' : ''}>已确认 (confirmed) — 立即参与任务验收、数值聚合与成就解锁</option>
              <option value="draft" ${effectiveStatus === 'draft' ? 'selected' : ''}>草稿 (draft) — 仅保存服务端草稿，不计入事实统计</option>
            </select>
          </label>
          <div class="ld-form-grid" style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div style="font-weight:600;font-size:13px;">模板字段（未知项可留空，不会伪装为 0）</div>
            ${(tpl?.fields ?? [])
              .map(f => {
                const draftRaw = savedDraft?.rawInputs?.[f.key];
                const existingVal =
                  draftRaw !== undefined
                    ? draftRaw
                    : editingRecord
                      ? editingRecord.values[f.key]
                      : undefined;
                const valStr =
                  existingVal === null || existingVal === undefined ? '' : String(existingVal);
                const hintParts: string[] = [FIELD_TYPE_META[f.type]?.label ?? f.type];
                if (f.unit) hintParts.push(`单位: ${f.unit}`);
                if (f.minimum !== null) hintParts.push(`min: ${f.minimum}`);
                if (f.maximum !== null) hintParts.push(`max: ${f.maximum}`);
                if (!f.required) hintParts.push('选填，可空');

                let controlHtml = '';
                if (f.type === 'textarea') {
                  controlHtml = `<textarea class="ld-textarea" data-field-key="${escapeHtml(f.key)}" data-field-type="${f.type}" placeholder="${f.required ? '必填，请输入真实内容' : '选填，未知可留空'}">${escapeHtml(valStr)}</textarea>`;
                } else if (f.type === 'boolean') {
                  controlHtml = `<select class="ld-select" data-field-key="${escapeHtml(f.key)}" data-field-type="${f.type}">
                    <option value="" ${valStr === '' ? 'selected' : ''}>未知 (null)</option>
                    <option value="true" ${valStr === 'true' ? 'selected' : ''}>是 (true)</option>
                    <option value="false" ${valStr === 'false' ? 'selected' : ''}>否 (false)</option>
                  </select>`;
                } else if (f.type === 'single_select') {
                  controlHtml = `<select class="ld-select" data-field-key="${escapeHtml(f.key)}" data-field-type="${f.type}">
                    <option value="">-- 请选择 --</option>
                    ${f.options
                      .map(
                        opt =>
                          `<option value="${escapeHtml(opt)}" ${valStr === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`
                      )
                      .join('')}
                  </select>`;
                } else {
                  const inputType =
                    f.type === 'integer' || f.type === 'decimal'
                      ? 'number'
                      : f.type === 'date'
                        ? 'date'
                        : 'text';
                  const stepAttr = f.type === 'decimal' ? 'step="any"' : f.type === 'integer' ? 'step="1"' : '';
                  const minAttr = f.minimum !== null ? `min="${f.minimum}"` : '';
                  const maxAttr = f.maximum !== null ? `max="${f.maximum}"` : '';
                  controlHtml = `<input class="ld-input" type="${inputType}" ${stepAttr} ${minAttr} ${maxAttr} data-field-key="${escapeHtml(f.key)}" data-field-type="${f.type}" value="${escapeHtml(valStr)}" placeholder="${f.required ? '必填（已确认记录需填写）' : '未知可留空 (null)'}" />`;
                }

                return `<label class="ld-field">
                  <span class="ld-label">
                    <span>${escapeHtml(f.label)} ${f.required ? '<span style="color:var(--ld-danger);">*</span>' : ''}</span>
                    <span class="ld-label-hint">${escapeHtml(hintParts.join(' · '))}</span>
                  </span>
                  ${controlHtml}
                </label>`;
              })
              .join('')}
          </div>
          <div class="ld-field">
            <span class="ld-label">
              <span>关联当前模块下的适用任务（可多选，同一记录在统计中只计一次）</span>
              <span class="ld-label-hint">共 ${compatibleTasks.length} 项可匹配任务</span>
            </span>
            ${
              compatibleTasks.length === 0
                ? `<div class="ld-card-meta">当前模块与模板下暂无需要关联记录的活动任务实例。</div>`
                : `<div style="display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:var(--ld-radius-sm);background:var(--ld-bg-input);border:1px solid var(--ld-border);">
                    ${compatibleTasks
                      .map(t => {
                        const checked = selectedTaskIds.has(t.id);
                        return `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;">
                          <input type="checkbox" name="task_id" value="${escapeHtml(t.id)}" ${checked ? 'checked' : ''} />
                          <span><strong>${escapeHtml(t.definition.title)}</strong> (${escapeHtml(describeTaskAcceptance(data, t))}${t.definition.business_date ? ` · 限 ${escapeHtml(t.definition.business_date)}` : ''})</span>
                        </label>`;
                      })
                      .join('')}
                  </div>`
            }
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-record-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${
              state.submittingModal
                ? '等待服务器确认…'
                : pendingOp
                  ? '确认上次提交'
                  : modal.mode === 'edit'
                    ? '保存修改并重算'
                    : '保存记录'
            }
          </button>
          <button type="button" class="ld-btn" data-action="copy-record-draft">复制输入</button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'record-detail') {
    const r = data.records.find(x => x.id === modal.recordId);
    if (!r) return '';
    const mod = findModule(data, r.module_id);
    const tpl = findTemplate(data, r.record_type_id);
    const linkedTasks = data.tasks.filter(t => r.task_ids.includes(t.id));

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">记录详情与修订审计</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderModalConflictPanel(state)}
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge">${escapeHtml(tpl?.name ?? '模板')} (schema v${r.schema_version})</span>
            <span class="ld-badge ${r.status === 'confirmed' ? 'ld-badge-success' : 'ld-badge-warning'}">${r.status === 'confirmed' ? '已确认（服务器已确认）' : '草稿（不计入统计）'}</span>
            <span class="ld-badge">记录版本 v${r.version}</span>
          </div>
          <div class="ld-card-meta" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <div><strong>实际发生时间 (occurred_at)：</strong>${escapeHtml(formatDateTime(r.occurred_at))} (${escapeHtml(r.timezone)})</div>
            <div><strong>录入创建时间 (created_at)：</strong>${escapeHtml(formatDateTime(r.created_at))}</div>
            <div><strong>唯一记录 ID：</strong><code>${escapeHtml(r.id)}</code></div>
          </div>
          <div style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div style="font-weight:600;margin-bottom:8px;">字段值明细</div>
            ${(tpl?.fields ?? [])
              .map(f => {
                const v = r.values[f.key];
                return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--ld-border);">
                  <span>${escapeHtml(f.label)} (<code>${escapeHtml(f.key)}</code>)</span>
                  <strong>${v === null || v === undefined ? 'null (未知)' : `${escapeHtml(v)}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}`}</strong>
                </div>`;
              })
              .join('')}
          </div>
          <div>
            <strong>已关联任务 (${linkedTasks.length})：</strong>
            ${
              linkedTasks.length === 0
                ? '<span class="ld-card-meta">无关联任务</span>'
                : linkedTasks.map(t => `<span class="ld-badge" style="margin:2px;">${escapeHtml(t.definition.title)}</span>`).join(' ')
            }
          </div>
          <div class="ld-card-meta" style="color:var(--ld-warning);">
            提示：软删除该记录后，服务端会在同一事务内保留历史审计快照，并重新计算关联任务、统计数值与已授予成就（若失去唯一完成依据将标记为「待复核」）。
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn ld-btn-danger" data-action="delete-record" data-record-id="${escapeHtml(r.id)}" ${state.submittingModal ? 'disabled' : ''}>软删除记录</button>
          <button type="button" class="ld-btn ld-btn-primary" data-action="open-edit-record" data-record-id="${escapeHtml(r.id)}">编辑记录</button>
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'create-metric') {
    const ctx = resolveConfigModalContext(state, 'create-metric');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const selectedTplId = raw.record_type_id ?? templates[0]?.id ?? '';
    const activeTpl = templates.find(rt => rt.id === selectedTplId) ?? templates[0];
    const numericFields = (activeTpl?.fields ?? []).filter(f =>
      ['integer', 'decimal'].includes(f.type)
    );
    const selectedAgg = raw.aggregation ?? 'count';
    const selectedWin = raw.window ?? 'week';
    const selectedFieldKey = raw.field_key ?? numericFields[0]?.key ?? '';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-metric" data-config-kind="create-metric" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建数值定义</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-metric-module-select" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">来源记录模板 *</span>
              <select class="ld-select" name="record_type_id" id="ld-metric-template-select" required>
                ${templates
                  .map(
                    rt =>
                      `<option value="${escapeHtml(rt.id)}" ${rt.id === selectedTplId ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">数值名称 * <span class="ld-label-hint">如「本周学习时长」或「累计学习次数」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="80" value="${escapeHtml(raw.name ?? '')}" required placeholder="输入数值指标名称" />
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">聚合方式 *</span>
              <select class="ld-select" name="aggregation" id="ld-metric-agg-select" required>
                <option value="count" ${selectedAgg === 'count' ? 'selected' : ''}>计数 (count) — 统计唯一已确认记录条数</option>
                <option value="sum" ${numericFields.length === 0 ? 'disabled' : ''} ${selectedAgg === 'sum' ? 'selected' : ''}>求和 (sum) — 需选择数值字段</option>
                <option value="avg" ${numericFields.length === 0 ? 'disabled' : ''} ${selectedAgg === 'avg' ? 'selected' : ''}>均值 (avg) — 需选择数值字段</option>
                <option value="latest" ${numericFields.length === 0 ? 'disabled' : ''} ${selectedAgg === 'latest' ? 'selected' : ''}>最新值 (latest) — 需选择数值字段</option>
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">时间窗口 *</span>
              <select class="ld-select" name="window" required>
                <option value="week" ${selectedWin === 'week' ? 'selected' : ''}>本周 (week，周一起)</option>
                <option value="day" ${selectedWin === 'day' ? 'selected' : ''}>今日 (day，自然日)</option>
                <option value="month" ${selectedWin === 'month' ? 'selected' : ''}>本月 (month，自然月)</option>
                <option value="all_time" ${selectedWin === 'all_time' ? 'selected' : ''}>累计 (all_time)</option>
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field" id="ld-metric-field-group" style="display:${selectedAgg === 'count' ? 'none' : 'flex'};">
              <span class="ld-label">聚合数值字段 *</span>
              <select class="ld-select" name="field_key" id="ld-metric-field-select">
                ${numericFields
                  .map(
                    f =>
                      `<option value="${escapeHtml(f.key)}" data-unit="${escapeHtml(f.unit ?? '')}" ${f.key === selectedFieldKey ? 'selected' : ''}>${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / 单位:${escapeHtml(f.unit)}` : ''})</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">单位 * <span class="ld-label-hint">sum/avg/latest 必须与字段单位一致</span></span>
              <input class="ld-input" type="text" name="unit" id="ld-metric-unit-input" value="${escapeHtml(raw.unit ?? '次')}" maxlength="30" required />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">统计时区 (IANA) *</span>
            <input class="ld-input" type="text" name="timezone" value="${escapeHtml(raw.timezone ?? userTz)}" required />
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-config-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建数值定义'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'metric-detail') {
    const m = findMetric(data, modal.metricId);
    if (!m) return '';
    const mod = findModule(data, m.module_id);
    const tpl = findTemplate(data, m.record_type_id);
    const sourceRecords = data.records.filter(r => m.computed.source_record_ids.includes(r.id));

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">数值详情与来源核查</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge ld-badge-info">${escapeHtml(METRIC_WINDOW_META[m.definition.window]?.label ?? m.definition.window)}</span>
            <span class="ld-badge">${escapeHtml(METRIC_AGGREGATION_META[m.definition.aggregation]?.label ?? m.definition.aggregation)}</span>
          </div>
          <h3 style="margin:0;font-size:18px;">${escapeHtml(m.definition.name)}</h3>
          <div class="ld-metric-value-box">
            ${
              m.computed.value !== null
                ? `<span class="ld-metric-number">${escapeHtml(m.computed.value)}</span><span class="ld-metric-unit">${escapeHtml(m.definition.unit)}</span>`
                : `<span class="ld-metric-number is-null">暂无数据 (null)</span>`
            }
          </div>
          <div class="ld-card-meta" style="flex-direction:column;align-items:flex-start;gap:4px;">
            <div><strong>有效样本数：</strong>${m.computed.sample_count} 条唯一已确认记录</div>
            <div><strong>统计周期标识 (period)：</strong><code>${escapeHtml(m.computed.period)}</code></div>
            <div><strong>窗口起止 (UTC)：</strong>${escapeHtml(m.computed.start ?? '无下界')} ~ ${escapeHtml(m.computed.end ?? '无上界')}</div>
            <div><strong>评估时间：</strong>${escapeHtml(formatDateTime(m.computed.evaluated_at))} (算法 v${m.computed.calculation_version})</div>
            <div><strong>来源模板：</strong>${escapeHtml(tpl?.name ?? '')} ${m.definition.field_key ? `· 字段 <code>${escapeHtml(m.definition.field_key)}</code>` : '· 记录条数计数'}</div>
          </div>
          <div>
            <h4 style="margin:6px 0 8px;">参与本次计算的来源记录 (${sourceRecords.length})</h4>
            ${
              sourceRecords.length === 0
                ? `<div class="ld-card-meta">当前窗口内尚无有效样本记录。</div>`
                : `<div class="ld-card-list">
                    ${sourceRecords
                      .map(
                        r => `<div class="ld-card" style="padding:10px 12px;">
                          <div class="ld-card-top">
                            <span>${escapeHtml(formatDateTime(r.occurred_at))}</span>
                            <button type="button" class="ld-btn ld-btn-sm" data-action="metric-jump-record-detail" data-metric-id="${escapeHtml(m.id)}" data-record-id="${escapeHtml(r.id)}">查看记录详情 →</button>
                          </div>
                          <div class="ld-card-meta"><code>${escapeHtml(JSON.stringify(r.values))}</code></div>
                        </div>`
                      )
                      .join('')}
                  </div>`
            }
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="metric-view-sources" data-metric-id="${escapeHtml(m.id)}">在记录面板筛选来源</button>
          <button type="button" class="ld-btn ld-btn-primary" data-action="metric-add-record" data-metric-id="${escapeHtml(m.id)}">＋ 添加观测记录</button>
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'create-achievement') {
    const ctx = resolveConfigModalContext(state, 'create-achievement');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const modMetrics = data.metrics.filter(m => m.module_id === selectedModId);
    const selectedMetricId = raw.metric_id ?? modMetrics[0]?.id ?? '';
    const selectedOp = raw.operator ?? 'gte';
    const selectedPolicy = raw.history_policy ?? 'include_existing';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-achievement" data-config-kind="create-achievement" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建成就定义</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-ach-module-select" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">关联活动数值定义 *</span>
              <select class="ld-select" name="metric_id" id="ld-ach-metric-select" required>
                ${
                  modMetrics.length === 0
                    ? `<option value="">当前模块暂无活动数值定义，请先创建数值</option>`
                    : modMetrics
                        .map(
                          m =>
                            `<option value="${escapeHtml(m.id)}" ${m.id === selectedMetricId ? 'selected' : ''}>${escapeHtml(m.definition.name)} (${escapeHtml(m.definition.unit)})</option>`
                        )
                        .join('')
                }
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">成就名称 * <span class="ld-label-hint">如「迈出第一步」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="80" value="${escapeHtml(raw.name ?? '')}" required placeholder="输入成就名称" />
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">比较运算符 *</span>
              <select class="ld-select" name="operator" required>
                <option value="gte" ${selectedOp === 'gte' ? 'selected' : ''}>大于等于 (≥ gte)</option>
                <option value="lte" ${selectedOp === 'lte' ? 'selected' : ''}>小于等于 (≤ lte)</option>
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">目标门槛 (十进制字符串) *</span>
              <input class="ld-input" type="text" name="threshold" value="${escapeHtml(raw.threshold ?? '1')}" required placeholder="例如 1" />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">历史记录范围策略 (history_policy) *</span>
            <select class="ld-select" name="history_policy" required>
              <option value="include_existing" ${selectedPolicy === 'include_existing' ? 'selected' : ''}>允许基于已确认、未删除的历史记录计算进度 (include_existing)</option>
              <option value="from_activation" ${selectedPolicy === 'from_activation' ? 'selected' : ''}>仅统计本成就创建之后发生的记录 (from_activation)</option>
            </select>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-config-submit-btn" ${(modMetrics.length === 0 && !ctx.pendingOp) || state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建成就定义'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'achievement-detail') {
    const a = data.achievement_definitions.find(x => x.id === modal.achievementId);
    if (!a) return '';
    const mod = findModule(data, a.module_id);
    const metric = findMetric(data, a.metric_id);
    const award = findAward(data, a.id);

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">成就定义与解锁依据核查</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge">${a.definition.history_policy === 'include_existing' ? '可追溯历史记录' : '仅限创建后记录'}</span>
            <span class="ld-badge">定义版本 v${a.version}</span>
          </div>
          <h3 style="margin:0;font-size:18px;">${escapeHtml(a.definition.name)}</h3>
          <div class="ld-card-meta">
            解锁条件：当数值 <strong>「${escapeHtml(metric?.definition.name ?? '')}」</strong> ${a.definition.operator === 'gte' ? '≥' : '≤'} <strong>${escapeHtml(a.definition.threshold)} ${escapeHtml(metric?.definition.unit ?? '')}</strong>
          </div>
          ${
            !award
              ? `<div class="ld-card-meta">当前尚未达成解锁条件。</div>`
              : `<div style="display:flex;flex-direction:column;gap:10px;padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
                  <div><strong>授予状态：</strong>${award.state === 'unlocked' ? '🏆 已解锁 (unlocked)' : '⚠ 完成依据变化，待复核 (needs_review)'}</div>
                  <div><strong>首次解锁评估时间：</strong>${escapeHtml(formatDateTime(award.unlocked_at))}（规则版本 v${award.rule_version}）</div>
                  <div><strong>原始解锁依据 (original_evidence)：</strong>值 = <code>${escapeHtml(award.original_evidence.value ?? 'null')}</code>，样本数 = ${award.original_evidence.sample_count} 条</div>
                  <div><strong>最新复核依据 (evidence)：</strong>值 = <code>${escapeHtml(award.evidence.value ?? 'null')}</code>，样本数 = ${award.evidence.sample_count} 条（复核于 ${escapeHtml(formatDateTime(award.evaluated_at))}）</div>
                </div>`
          }
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="achievement-jump-metric" data-metric-id="${escapeHtml(a.metric_id)}">查看关联数值</button>
          ${
            award
              ? `<button type="button" class="ld-btn ld-btn-primary" data-action="achievement-view-evidence" data-achievement-id="${escapeHtml(a.id)}">查看解锁依据记录</button>`
              : ''
          }
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'create-module') {
    const ctx = resolveConfigModalContext(state, 'create-module');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const iconOptions = Object.entries(MODULE_ICON_LABELS) as Array<[ModuleIconName, string]>;
    const colorOptions = Object.values(MODULE_COLORS);
    const selectedIcon = raw.icon ?? 'book';
    const selectedColor = raw.color ?? 'blue';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-module" data-config-kind="create-module" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建自定义模块</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <label class="ld-field">
            <span class="ld-label">模块名称 * <span class="ld-label-hint">如「语言学习」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="60" value="${escapeHtml(raw.name ?? '')}" required placeholder="输入新模块名称" />
          </label>
          <label class="ld-field">
            <span class="ld-label">模块说明</span>
            <textarea class="ld-textarea" name="description" maxlength="1000" placeholder="描述该模块关注的日常记录、任务与成果">${escapeHtml(raw.description ?? '')}</textarea>
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">图标 *</span>
              <select class="ld-select" name="icon" required>
                ${iconOptions
                  .map(
                    ([k, label]) =>
                      `<option value="${k}" ${k === selectedIcon ? 'selected' : ''}>${escapeHtml(label)} (${k})</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">主题色 *</span>
              <select class="ld-select" name="color" required>
                ${colorOptions
                  .map(
                    c =>
                      `<option value="${c.key}" ${c.key === selectedColor ? 'selected' : ''}>${escapeHtml(c.label)} (${c.key})</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-config-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建模块'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'edit-module') {
    const m = findModule(data, modal.moduleId);
    if (!m) return '';
    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-edit-module" data-module-id="${escapeHtml(m.id)}" data-base-version="${m.version}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">编辑模块：${escapeHtml(m.name)} (v${m.version})</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderModalConflictPanel(state)}
          <label class="ld-field">
            <span class="ld-label">模块名称 * <span class="ld-label-hint">修改名称不会改变模块稳定 UUID 或历史关联</span></span>
            <input class="ld-input" type="text" name="name" value="${escapeHtml(m.name)}" maxlength="60" required />
          </label>
          <label class="ld-field">
            <span class="ld-label">生命周期状态 (status) *</span>
            <select class="ld-select" name="status" required>
              <option value="enabled" ${m.status === 'enabled' ? 'selected' : ''}>启用中 (enabled) — 正常展示并允许新增记录与配置</option>
              <option value="disabled" ${m.status === 'disabled' ? 'selected' : ''}>已停用 (disabled) — 减少入口展示但保留全部历史数据</option>
              <option value="archived" ${m.status === 'archived' ? 'selected' : ''}>已归档 (archived) — 停止新增写入，完整保留历史记录供查询</option>
            </select>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" ${state.submittingModal ? 'disabled' : ''}>保存模块修改</button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'create-template') {
    const ctx = resolveConfigModalContext(state, 'create-template');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const f1Type = raw.f1_type ?? 'text';
    const includeF2 = raw.include_f2 !== 'false';
    const f2Type = raw.f2_type ?? 'integer';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-template" data-config-kind="create-template" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建通用记录模板</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${renderModalConflictPanel(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">模板名称 * <span class="ld-label-hint">如「阅读笔记」或「语言练习」</span></span>
              <input class="ld-input" type="text" name="name" maxlength="60" value="${escapeHtml(raw.name ?? '')}" required placeholder="输入记录模板名称" />
            </label>
          </div>
          <div style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);" class="ld-form-grid">
            <div style="font-weight:600;">字段 1（主内容字段，必填，支持合法业务字段名如 session）</div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">字段 key * <span class="ld-label-hint">小写字母开头，如 topic 或 session</span></span>
                <input class="ld-input" type="text" name="f1_key" value="${escapeHtml(raw.f1_key ?? 'topic')}" required pattern="^[a-z][a-z0-9_]{0,63}$" />
              </label>
              <label class="ld-field">
                <span class="ld-label">显示名称 (label) *</span>
                <input class="ld-input" type="text" name="f1_label" value="${escapeHtml(raw.f1_label ?? '实际内容')}" required />
              </label>
              <label class="ld-field">
                <span class="ld-label">类型 *</span>
                <select class="ld-select" name="f1_type">
                  <option value="text" ${f1Type === 'text' ? 'selected' : ''}>短文本 (text)</option>
                  <option value="textarea" ${f1Type === 'textarea' ? 'selected' : ''}>长文本 (textarea)</option>
                </select>
              </label>
            </div>
          </div>
          <div style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);" class="ld-form-grid">
            <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
              <input type="checkbox" name="include_f2" ${includeF2 ? 'checked' : ''} />
              <span>同时添加字段 2（可选数值字段，供任务门槛与数值聚合引用）</span>
            </label>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">字段 key</span>
                <input class="ld-input" type="text" name="f2_key" value="${escapeHtml(raw.f2_key ?? 'duration_minutes')}" pattern="^[a-z][a-z0-9_]{0,63}$" />
              </label>
              <label class="ld-field">
                <span class="ld-label">显示名称 (label)</span>
                <input class="ld-input" type="text" name="f2_label" value="${escapeHtml(raw.f2_label ?? '实际分钟数')}" />
              </label>
            </div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">数值类型</span>
                <select class="ld-select" name="f2_type">
                  <option value="integer" ${f2Type === 'integer' ? 'selected' : ''}>整数 (integer)</option>
                  <option value="decimal" ${f2Type === 'decimal' ? 'selected' : ''}>精确小数 (decimal)</option>
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">单位 (unit)</span>
                <input class="ld-input" type="text" name="f2_unit" value="${escapeHtml(raw.f2_unit ?? '分钟')}" />
              </label>
            </div>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-config-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建记录模板'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'ai-generate') {
    return renderAiGenerateModal(state, data);
  }

  if (modal.kind === 'ai-result') {
    return renderAiResultModal(state, data);
  }

  return '';
}
