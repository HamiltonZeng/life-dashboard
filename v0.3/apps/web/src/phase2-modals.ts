import {planning} from './planning-ui.js';
function readBindingSnapshot(raw?:string){try{const v=JSON.parse(raw??'null');return v&&typeof v.binding?.record_type_id==='string'&&typeof v.binding?.field_key==='string'&&typeof v.type==='string'&&(v.unit===null||typeof v.unit==='string')?v:undefined;}catch{return undefined;}}
import {
  COMPLETION_MODE_META,
  escapeHtml,
  MODULE_COLORS,
  renderModuleBadge,
  SUBMISSION_STATE_META,
  TASK_CATEGORY_META,
  TASK_RULE_KIND_META
} from '../../../packages/ui/src/index.js';
import { generateUuid } from './api.js';
import { renderConfigSubmissionStatusPill } from './modals.js';
import { formatDateTime, getLocalIsoWithOffset } from './panels.js';
import { describePhase2Rule, renderWalletLedgerSection, renderWalletSummaryCard } from './phase2-views.js';
import type { AppState } from './state.js';
import {
  buildConfigDraftKey,
  getPendingConfigMutation,
  loadConfigDraft
} from './storage.js';
import type { BootstrapData, ConfigMutationKind } from './types.js';

function resolveModalConfigContext(state: AppState, kind: ConfigMutationKind) {
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
      submissionStatus: pendingOp
        ? 'unknown_network'
        : savedDraft?.confirmedEntityId
          ? 'confirmed_server'
          : savedDraft
            ? 'saved_local'
            : 'idle',
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

  const valError = state.configForm.validationError;
  const valBanner = valError
    ? `<div class="ld-error-banner" role="alert"><span><strong>${escapeHtml(valError.code)}</strong>：${escapeHtml(valError.message)}（已保留你当前填写的输入）</span></div>`
    : '';
  const pendingBanner = pendingOp
    ? `<div class="ld-return-banner" style="background:var(--ld-warning-soft);border-color:rgba(245,158,11,0.5);" data-config-pending-banner="${escapeHtml(kind)}">
        <div>
          <strong>上次提交结果待确认：</strong>直接点击提交将沿用原 <code>operation_id</code> (<code>${escapeHtml(pendingOp.operationId.slice(0, 10))}…</code>) 与冻结载荷确认结果，不会重复创建。
        </div>
      </div>`
    : '';

  return { draftKey, savedDraft, pendingOp, entityId, valBanner, pendingBanner };
}

export function renderPhase2Modal(state: AppState, data: BootstrapData): string | null {
  const modal = state.activeModal;
  if (!modal) return null;

  const enabledModules = data.modules.filter(m => m.status === 'enabled');
  const userTz = state.profile?.timezone ?? state.user?.timezone ?? 'Asia/Shanghai';

  if (modal.kind === 'create-task-template' && !planning.advanced && !getPendingConfigMutation(buildConfigDraftKey('create-task-template'))) return `<div class="ld-modal-backdrop"><div class="ld-modal"><h2>新建任务</h2>${planning.render('task_create')}<button type="button" class="ld-btn" data-action="planning-advanced">高级手动设置</button><button type="button" class="ld-btn" data-action="close-modal">关闭</button></div></div>`;
  if (modal.kind === 'create-task-template') {
    const ctx = resolveModalConfigContext(state, 'create-task-template');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const selectedCat = (raw.category ?? modal.defaultCategory ?? 'daily') as 'main' | 'daily' | 'weekly' | 'monthly';
    const selectedMode = raw.completion_mode ?? 'record_required';
    const selectedColor = raw.color ?? 'blue';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const selectedTplId = raw.record_type_id ?? templates[0]?.id ?? '';
    const activeTpl = templates.find(rt => rt.id === selectedTplId) ?? templates[0];
    const numFields = (activeTpl?.fields ?? []).filter(f => ['integer', 'decimal'].includes(f.type));
    const selectedRuleKind = raw.rule_kind ?? 'count';
    const selectedFieldKey = raw.field_key ?? numFields[0]?.key ?? '';
    const selectedUnit =
      raw.unit ?? numFields.find(f => f.key === selectedFieldKey)?.unit ?? numFields[0]?.unit ?? '分钟';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-task-template" data-config-kind="create-task-template" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">新建周期委托 / 主线任务模板</h2>
            <div class="ld-card-meta">创建模板将在同一事务内自动物化当期任务实例；奖励金额由服务端系统规则锁定，不可手改。</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">任务类别 (category) *</span>
              <select class="ld-select" name="category" id="ld-tt-category-select" required>
                ${(['main', 'daily', 'weekly', 'monthly'] as const)
                  .map(
                    cat =>
                      `<option value="${cat}" ${selectedCat === cat ? 'selected' : ''}>${escapeHtml(TASK_CATEGORY_META[cat].label)} — ${TASK_CATEGORY_META[cat].rewardAmount} 代币 (${escapeHtml(TASK_CATEGORY_META[cat].quotaWindow)})</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-tt-module-select" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">任务标题 (title) * <span class="ld-label-hint">1~100 字符</span></span>
              <input class="ld-input" type="text" name="title" maxlength="100" required value="${escapeHtml(raw.title ?? '')}" placeholder="例如：每周累计运动 3 天 / 每日编程 30 分钟" />
            </label>
            <label class="ld-field">
              <span class="ld-label">完成方式 (completion_mode) *</span>
              <select class="ld-select" name="completion_mode" id="ld-tt-mode-select" required>
                <option value="record_required" ${selectedMode === 'record_required' ? 'selected' : ''}>必须关联/匹配记录 (record_required)</option>
                <option value="record_optional" ${selectedMode === 'record_optional' ? 'selected' : ''}>记录可选 (record_optional)</option>
                <option value="manual" ${selectedMode === 'manual' ? 'selected' : ''}>手动完成 (manual)</option>
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">颜色标签 (color) * <span class="ld-label-hint">预设色板或严格 #RRGGBB（不影响奖励金额）</span></span>
              <input class="ld-input" type="text" name="color" list="ld-task-color-datalist" value="${escapeHtml(selectedColor)}" required placeholder="blue 或 #3B82F6" />
              <datalist id="ld-task-color-datalist">
                ${Object.values(MODULE_COLORS)
                  .map(c => `<option value="${c.key}">${escapeHtml(c.label)}</option>`)
                  .join('')}
                <option value="#3B82F6">自定义深海蓝 #3B82F6</option>
                <option value="#10B981">自定义翡翠绿 #10B981</option>
              </datalist>
            </label>
            <label class="ld-field">
              <span class="ld-label">周期结算时区 (timezone, IANA) *</span>
              <input class="ld-input" type="text" name="timezone" value="${escapeHtml(raw.timezone ?? userTz)}" required />
            </label>
          </div>
          <div id="ld-tt-due-group" class="ld-form-row" style="display:${selectedCat === 'main' ? 'grid' : 'none'};">
            <label class="ld-field">
              <span class="ld-label">主线截止时间 (due_at, ISO 8601 含偏移，仅主线可选)</span>
              <input class="ld-input" type="text" name="due_at" value="${escapeHtml(raw.due_at ?? '')}" placeholder="可留空，或如 2026-12-31T23:59:59+08:00" />
            </label>
          </div>
          <div id="ld-tt-rule-group" class="ld-form-grid" style="display:${selectedMode === 'manual' ? 'none' : 'flex'};padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div style="font-weight:600;font-size:13px;">周期累计与关联验收规则 (rule)</div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">关联记录模板 (record_type_id) *</span>
                <select class="ld-select" name="record_type_id" id="ld-tt-record-type-select">
                  ${templates
                    .map(
                      rt =>
                        `<option value="${escapeHtml(rt.id)}" ${rt.id === selectedTplId ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">规则类型 (rule.kind) *</span>
                <select class="ld-select" name="rule_kind" id="ld-tt-rule-kind-select">
                  ${(['count', 'distinct_days', 'sum', 'linked_exists', 'linked_field_gte'] as const)
                    .map(
                      k =>
                        `<option value="${k}" ${selectedRuleKind === k ? 'selected' : ''}>${escapeHtml(TASK_RULE_KIND_META[k].label)}</option>`
                    )
                    .join('')}
                </select>
              </label>
            </div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">达标门槛 (threshold) * <span class="ld-label-hint">正十进制数，linked_exists 忽略</span></span>
                <input class="ld-input" type="text" name="threshold" value="${escapeHtml(raw.threshold ?? '1')}" placeholder="例如 3 或 30" />
              </label>
              <label class="ld-field">
                <span class="ld-label">数值字段 (field_key，sum / linked_field_gte 必填)</span>
                <select class="ld-select" name="field_key" id="ld-tt-field-select">
                  ${numFields
                    .map(
                      f =>
                        `<option value="${escapeHtml(f.key)}" data-unit="${escapeHtml(f.unit ?? '')}" ${f.key === selectedFieldKey ? 'selected' : ''}>${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / ${escapeHtml(f.unit)}` : ''})</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">单位 (unit，sum 必填且须与字段一致)</span>
                <input class="ld-input" type="text" name="unit" id="ld-tt-unit-input" value="${escapeHtml(selectedUnit)}" placeholder="如 分钟、公里" />
              </label>
            </div>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-tt-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建模板并物化当期实例'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'edit-task-template') {
    const tpl = state.taskTemplates.find(t => t.id === modal.templateId);
    if (!tpl) return '';
    const def = tpl.next_definition ?? tpl.definition;
    const isMain = tpl.definition.category === 'main';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-edit-task-template" data-template-id="${escapeHtml(tpl.id)}" data-base-version="${tpl.version}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">${isMain ? '主线任务模板管理' : '编辑周期模板（自下一周期生效）'}</h2>
            <div class="ld-card-meta">模板版本 v${tpl.version} · 已生成的当期实例快照锁定不变，规则/时区变更仅在当前周期结束后对后续新实例生效。</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${
            state.modalError
              ? `<div class="ld-error-banner" role="alert"><strong>${escapeHtml(state.modalError.code)}：</strong>${escapeHtml(state.modalError.message)}${state.modalError.code==='VERSION_CONFLICT'?'<button type="button" class="ld-btn" data-action="template-adopt-baseline">核对并采用最新模板版本</button>':''}</div>`
              : ''
          }
          ${
            isMain
              ? `<div class="ld-return-banner">
                  <div><strong>主线任务快照保护：</strong>主线任务仅生成单个实例，禁止通过编辑模板静默篡改已生成实例的规则快照；仅支持将模板状态切换为归档或启用。</div>
                </div>`
              : `<div class="ld-form-row">
                  <label class="ld-field">
                    <span class="ld-label">下一周期任务标题 (title) *</span>
                    <input class="ld-input" type="text" name="title" maxlength="100" required value="${escapeHtml(def.title)}" />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">下一周期结算时区 (timezone) *</span>
                    <input class="ld-input" type="text" name="timezone" required value="${escapeHtml(def.timezone)}" />
                  </label>
                </div>
                <div class="ld-form-row">
                  <label class="ld-field">
                    <span class="ld-label">颜色标签 (color) *</span>
                    <input class="ld-input" type="text" name="color" required value="${escapeHtml(def.color ?? 'blue')}" />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">显式生效时间 (effective_from，可选，不得早于当期结束)</span>
                    <input class="ld-input" type="text" name="effective_from" value="${escapeHtml(tpl.effective_at ?? '')}" placeholder="留空默认自当前周期结束时刻生效" />
                  </label>
                </div>`
          }
          ${!isMain?`<fieldset class="ld-form-grid"><legend>后续周期验收规则</legend>
            <label class="ld-field">完成方式<select class="ld-select" name="completion_mode">${(['manual','record_optional','record_required'] as const).map(k=>`<option value="${k}" ${def.completion_mode===k?'selected':''}>${escapeHtml(COMPLETION_MODE_META[k].label)}</option>`).join('')}</select></label>
            <label class="ld-field">记录模板<select class="ld-select" name="record_type_id">${data.record_types.filter(t=>t.module_id===tpl.module_id).map(t=>`<option value="${t.id}" ${def.rule?.record_type_id===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>
            <label class="ld-field">验收口径<select class="ld-select" name="rule_kind">${(['count','distinct_days','sum','linked_exists','linked_field_gte'] as const).map(k=>`<option value="${k}" ${def.rule?.kind===k?'selected':''}>${escapeHtml(TASK_RULE_KIND_META[k].label)}</option>`).join('')}</select></label>
            <label class="ld-field">达标门槛<input class="ld-input" name="threshold" value="${escapeHtml(def.rule&&'threshold' in def.rule?def.rule.threshold:'1')}" /></label>
            <label class="ld-field">数值字段<select class="ld-select" name="field_key">${data.record_types.filter(t=>t.module_id===tpl.module_id).flatMap(t=>t.fields.filter(f=>['integer','decimal'].includes(f.type)).map(f=>`<option value="${escapeHtml(f.key)}" ${def.rule&&'field_key' in def.rule&&def.rule.field_key===f.key?'selected':''}>${escapeHtml(t.name+' · '+f.label)}</option>`)).join('')}</select></label>
            <label class="ld-field">累计单位<input class="ld-input" name="unit" value="${escapeHtml(def.rule&&'unit' in def.rule?def.rule.unit:data.record_types.find(t=>t.id===def.rule?.record_type_id)?.fields.find(f=>def.rule&&'field_key' in def.rule&&f.key===def.rule.field_key)?.unit??'')}" /></label>
            <div class="ld-card-meta">已保存的过滤条件随原规则保留；变更将在当前周期结束后生效。</div>
          </fieldset>`:''}
          <label class="ld-field">
            <span class="ld-label">模板状态 (status)</span>
            <select class="ld-select" name="status">
              <option value="enabled" ${tpl.status === 'enabled' ? 'selected' : ''}>启用中 (enabled)</option>
              <option value="archived" ${tpl.status === 'archived' ? 'selected' : ''}>归档停止生成新实例 (archived)</option>
            </select>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '保存中…' : '保存模板变更'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'revoke-task') {
    const allTasks = state.taskInstances.length > 0 ? state.taskInstances : data.tasks;
    const task = allTasks.find(t => t.id === modal.taskId) ?? data.tasks.find(t => t.id === modal.taskId);
    if (!task) return '';
    const isCancel = modal.mode === 'cancel';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-revoke-task" data-task-id="${escapeHtml(task.id)}" data-base-version="${task.version}" data-revoke-mode="${modal.mode}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">${isCancel ? '取消任务实例（终态不可恢复）' : '撤回手动完成状态'}</h2>
            <div class="ld-card-meta">任务：「${escapeHtml(task.definition.title)}」 (实例版本 v${task.version})</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${
            state.modalError
              ? `<div class="ld-error-banner" role="alert"><strong>${escapeHtml(state.modalError.code)}：</strong>${escapeHtml(state.modalError.message)}</div>`
              : ''
          }
          <div class="ld-return-banner" style="background:var(--ld-warning-soft);border-color:rgba(245,158,11,0.5);">
            <div>
              ${
                isCancel
                  ? '<strong>取消说明：</strong>取消后任务将进入 cancelled 终态，后续新增记录不再复活该实例；若该实例已发放系统代币，将在同一事务中写入 reversal 冲正流水。'
                  : '<strong>撤回说明：</strong>仅支持撤回手动完成 (completion_origin="manual") 的二阶段任务实例；撤回后若已发放奖励将自动生成 reversal 冲正流水，且原奖励名额不会释放给同周期其他任务重复领取。'
              }
            </div>
          </div>
          <label class="ld-field">
            <span class="ld-label">${isCancel ? '取消原因' : '撤回原因'} (reason) * <span class="ld-label-hint">必填，1~500 字符，记入任务历史审计</span></span>
            <textarea class="ld-textarea" name="reason" id="ld-revoke-task-reason" maxlength="500" required placeholder="请如实填写原因，例如：误点完成按钮，今天尚未实际执行"></textarea>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">返回</button>
          <button type="submit" class="ld-btn ld-btn-danger" id="ld-revoke-task-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '提交中…' : isCancel ? '确认取消任务' : '确认撤回手动完成'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'create-achievement-series') {
    const ctx = resolveModalConfigContext(state, 'create-achievement-series');
    const raw = ctx.savedDraft?.rawInputs ?? {};
    const selectedModId = raw.module_id ?? modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const selectedTplId = raw.record_type_id ?? templates[0]?.id ?? '';
    const activeTpl = templates.find(rt => rt.id === selectedTplId) ?? templates[0];
    const numFields = (activeTpl?.fields ?? []).filter(f => ['integer', 'decimal'].includes(f.type));
    const selectedAgg = raw.aggregation ?? 'distinct_days';
    const selectedFieldKey = raw.field_key ?? numFields[0]?.key ?? '';

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-achievement-series" data-config-kind="create-achievement-series" data-draft-key="${escapeHtml(ctx.draftKey)}" data-entity-id="${escapeHtml(ctx.entityId)}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">新建多门槛成就系列 (Achievement Series)</h2>
            <div class="ld-card-meta">支持同系列配置多个递增里程碑（如 1 / 3 / 10 天），跨级达标自动逐级授予，删除依据转待复核并保留原授予 ID。</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderConfigSubmissionStatusPill(state)}
          ${ctx.valBanner}
          ${ctx.pendingBanner}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-series-module-select" required>
                ${enabledModules
                  .map(
                    m =>
                      `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">关联记录模板 (record_type_id) *</span>
              <select class="ld-select" name="record_type_id" id="ld-series-template-select" required>
                ${templates
                  .map(
                    rt =>
                      `<option value="${escapeHtml(rt.id)}" ${rt.id === selectedTplId ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
                  )
                  .join('')}
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">系列名称 (name) * <span class="ld-label-hint">1~80 字符</span></span>
              <input class="ld-input" type="text" name="name" maxlength="80" required value="${escapeHtml(raw.name ?? '')}" placeholder="例如：跑步打卡天数里程碑" />
            </label>
            <label class="ld-field">
              <span class="ld-label">累计口径 (aggregation) *</span>
              <select class="ld-select" name="aggregation" id="ld-series-agg-select" required>
                <option value="distinct_days" ${selectedAgg === 'distinct_days' ? 'selected' : ''}>不同自然日天数去重 (distinct_days)</option>
                <option value="count" ${selectedAgg === 'count' ? 'selected' : ''}>有效记录总次数 (count)</option>
                <option value="sum" ${selectedAgg === 'sum' ? 'selected' : ''}>数值字段累计求和 (sum)</option>
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">数值字段 (field_key，仅 sum 使用)</span>
              <select class="ld-select" name="field_key" id="ld-series-field-select">
                <option value="">-- 非 sum 口径留空 --</option>
                ${numFields
                  .map(
                    f =>
                      `<option value="${escapeHtml(f.key)}" ${f.key === selectedFieldKey ? 'selected' : ''}>${escapeHtml(f.label)} (${escapeHtml(f.key)})</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">计量单位 (unit) *</span>
              <input class="ld-input" type="text" name="unit" required value="${escapeHtml(raw.unit ?? '天')}" placeholder="例如 天、次、分钟" />
            </label>
            <label class="ld-field">
              <span class="ld-label">自然日去重时区 (timezone) *</span>
              <input class="ld-input" type="text" name="timezone" required value="${escapeHtml(raw.timezone ?? userTz)}" />
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">多门槛阈值列表（逗号分隔正数，服务端自动升序且不可重复）*</span>
              <input class="ld-input" type="text" name="milestones_thresholds" required value="${escapeHtml(raw.milestones_thresholds ?? '1, 3, 10')}" placeholder="例如 1, 3, 10" />
            </label>
            <label class="ld-field">
              <span class="ld-label">对应里程碑名称（逗号分隔，可选）</span>
              <input class="ld-input" type="text" name="milestones_labels" value="${escapeHtml(raw.milestones_labels ?? '首日启程, 坚持三天, 十日习惯')}" placeholder="例如 首日启程, 坚持三天, 十日习惯" />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">历史记录计算策略 (history_policy) *</span>
            <select class="ld-select" name="history_policy">
              <option value="include_existing" ${(raw.history_policy ?? 'include_existing') === 'include_existing' ? 'selected' : ''}>包含已有历史确认记录 (include_existing)</option>
              <option value="from_activation" ${raw.history_policy === 'from_activation' ? 'selected' : ''}>仅计入本系列创建后的新记录 (from_activation)</option>
            </select>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-series-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '等待服务器确认…' : ctx.pendingOp ? '确认上次提交' : '创建成就系列'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'series-detail') {
    const s = state.achievementSeries.find(item => item.id === modal.seriesId);
    if (!s) return '';
    const mod = data.modules.find(m => m.id === s.module_id);
    const tpl = data.record_types.find(rt => rt.id === s.record_type_id);

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal" id="ld-modal-series-detail" data-series-detail="${escapeHtml(s.id)}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">成就系列详情 · ${escapeHtml(s.definition.name)}</h2>
            <div class="ld-card-meta">系列 ID: <code>${escapeHtml(s.id)}</code> · 版本 v${s.version}</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge">记录模板：${escapeHtml(tpl?.name ?? s.record_type_id)}</span>
            <span class="ld-badge">累计口径：<code>${escapeHtml(s.definition.aggregation)}</code></span>
            <span class="ld-badge">当前进度：<strong>${escapeHtml(s.progress.value)} ${escapeHtml(s.definition.unit)}</strong></span>
          </div>
          <div class="ld-card-meta">
            <span>有效来源记录：${s.progress.source_record_ids.length} 条 · 不同自然日 (${escapeHtml(s.definition.timezone)})：${escapeHtml(s.progress.distinct_dates.join(', ') || '无')}</span>
          </div>
          <div class="ld-series-milestone-track">
            ${s.milestones
              .map(m => {
                const aw = m.award;
                return `<div class="ld-milestone-node ${aw?.state === 'unlocked' ? 'is-unlocked' : aw?.state === 'needs_review' ? 'is-needs-review' : ''}">
                  <strong>门槛 ≥ ${escapeHtml(m.threshold)} ${escapeHtml(s.definition.unit)} ${m.label ? `· ${escapeHtml(m.label)}` : ''}</strong>
                  <div>状态：${aw ? (aw.state === 'unlocked' ? '🏆 已解锁 (unlocked)' : '⚠ 待复核 (needs_review)') : '🔒 未解锁'}</div>
                  ${
                    aw
                      ? `<div style="font-size:11px;color:var(--ld-text-secondary);">
                          <div>授予 ID：<code>${escapeHtml(aw.id)}</code> (v${aw.version})</div>
                          <div>首次解锁时间：${escapeHtml(formatDateTime(aw.unlocked_at))}</div>
                          <div>原解锁值：${escapeHtml(String(aw.original_evidence.value ?? '0'))} → 当前复核值：${escapeHtml(String(aw.evidence.value ?? '0'))}</div>
                        </div>`
                      : ''
                  }
                </div>`;
              })
              .join('')}
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn ld-btn-primary" data-action="series-view-sources" data-series-id="${escapeHtml(s.id)}">
            跳转记录面板查看全部来源证据 (${s.progress.source_record_ids.length})
          </button>
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'write-observation') {
    const field =
      state.profile?.module_fields.find(f => f.id === modal.fieldId) ??
      state.profileForm.fields.find(f => f.id === modal.fieldId);
    if (!field || field.kind !== 'observation') return '';

    const tpl = data.record_types.find(rt => rt.id === field.binding?.record_type_id);
    const sourceRecId = field.source_ref?.record_id ?? '';
    const sourceRec = sourceRecId ? data.records.find(r => r.id === sourceRecId) : undefined;
    const saved=loadConfigDraft('observation:'+field.id);
    const raw=saved?.rawInputs??{};
    const pending=getPendingConfigMutation<any>('phase2:observation:'+field.id);
    const obsForm: NonNullable<AppState['observationForm']> = state.observationForm ?? {
      fieldId: field.id,
      bindingFingerprint:raw.binding_fingerprint??field.binding_fingerprint,
      bindingSnapshot:readBindingSnapshot(raw.binding_snapshot)??{binding:field.binding!,type:field.type,unit:field.unit},
      mode: (modal.mode??raw.obs_mode??'new') as 'new'|'correct',
      occurredAt: raw.occurred_at??sourceRec?.occurred_at??getLocalIsoWithOffset(),
      timezone: raw.timezone??state.profile?.timezone??userTz,
      rawValue: raw.value??(field.value!==null&&field.value!==undefined?String(field.value):''),
      isNull: false,
      sourceRecordId: sourceRec?.id ?? sourceRecId,
      sourceBaseVersion: sourceRec?.version ?? field.source_ref?.version ?? 1,
      contextValues:Object.fromEntries(Object.entries(raw).filter(([k])=>k.startsWith('ctx_')).map(([k,v])=>[k.slice(4),v])),
      submissionStatus: pending?'unknown_network':'idle',
      operationId: pending?.operationId??null,
      entityId: pending?.entityId??saved?.entityId??generateUuid(),
      conflictError: null,
      validationError: null,
      lastImpactSummary: null
    };
    state.observationForm = obsForm;

    const otherRequiredFields = (tpl?.fields ?? []).filter(
      f => f.key !== field.binding?.field_key && f.required
    );
    const meta = SUBMISSION_STATE_META[obsForm.submissionStatus] ?? SUBMISSION_STATE_META.idle;

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-write-observation" data-config-kind="write-observation" data-draft-key="observation:${escapeHtml(field.id)}" data-field-id="${escapeHtml(field.id)}" data-entity-id="${escapeHtml(obsForm.entityId)}">
        <div class="ld-modal-header">
          <div>
            <h2 class="ld-modal-title">录入 / 纠错个人观测值 · ${escapeHtml(field.label)}</h2>
            <div class="ld-card-meta">绑定记录模板：<strong>${escapeHtml(tpl?.name ?? String(field.binding?.record_type_id))}</strong> · 字段 <code>${escapeHtml(String(field.binding?.field_key))}</code> (${escapeHtml(field.type)}${field.unit ? ` / ${escapeHtml(field.unit)}` : ''})</div>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <div class="ld-draft-status-bar" data-observation-status="${escapeHtml(obsForm.submissionStatus)}">
            <span class="ld-badge">${escapeHtml(meta.label)}</span>
            <span style="color:var(--ld-text-secondary);">${escapeHtml(obsForm.lastImpactSummary ?? meta.description)}</span>
          </div>
          ${
            obsForm.conflictError
              ? `<div class="ld-conflict-panel" role="alert" data-conflict-code="${escapeHtml(obsForm.conflictError.code)}">
                  <div><strong>⚠ 来源记录版本冲突 (${escapeHtml(obsForm.conflictError.code)})：</strong>${escapeHtml(obsForm.conflictError.message)}</div>
                  <div style="font-size:12px;color:var(--ld-text-secondary);">已保留输入；请先核对最新来源，再显式采用最新版本。<button type="button" class="ld-btn" data-action="observation-adopt-baseline">读取最新来源版本</button></div>
                </div>`
              : ''
          }
          ${
            obsForm.validationError
              ? `<div class="ld-error-banner" role="alert"><strong>${escapeHtml(obsForm.validationError.code)}：</strong>${escapeHtml(obsForm.validationError.message)}（已保留你当前填写的输入）</div>`
              : ''
          }
          ${obsForm.submissionStatus==='unknown_network'?'<div class="ld-error-banner">上次结果待确认；再次保存沿用原操作和冻结内容，不会重复新增。</div>':''}
          <div class="ld-obs-diff-box" data-observation-diff="true">
            <div><strong>当前最新合法观测值：</strong><code>${escapeHtml(String(field.value ?? 'null'))}${field.unit ? ` ${escapeHtml(field.unit)}` : ''}</code></div>
            ${
              field.source_ref?.record_id
                ? `<div><strong>当前来源记录：</strong>ID <code>${escapeHtml(field.source_ref.record_id)}</code> · 版本 <code>v${field.source_ref.version ?? 1}</code> · 发生于 <code>${escapeHtml(field.source_ref.occurred_at ?? '')}</code></div>`
                : `<div><strong>当前来源记录：</strong>暂无历史来源记录，本次将新建一条 confirmed 来源记录</div>`
            }
            <div><strong>联动影响说明：</strong>观测写入通过统一记录事实核心执行，提交成功后将在同一事务内重算关联周期任务、数值趋势、成就系列与首页摘要。</div>
          </div>

          <input type="hidden" name="binding_snapshot" value="${escapeHtml(JSON.stringify(obsForm.bindingSnapshot))}" />
          <input type="hidden" name="binding_fingerprint" value="${escapeHtml(obsForm.bindingFingerprint??'')}" />
          ${obsForm.bindingConflict?`<div class="ld-conflict-panel" role="alert">绑定已改变。原映射：${escapeHtml(String(obsForm.bindingSnapshot?.binding.record_type_id))} / ${escapeHtml(String(obsForm.bindingSnapshot?.binding.field_key))}，类型 ${escapeHtml(obsForm.bindingSnapshot?.type??'未知')}，单位 ${escapeHtml(obsForm.bindingSnapshot?.unit??'无')}；新映射：${escapeHtml(obsForm.bindingConflict.binding.record_type_id)} / ${escapeHtml(obsForm.bindingConflict.binding.field_key)}，类型 ${escapeHtml(obsForm.bindingConflict.type)}，单位 ${escapeHtml(obsForm.bindingConflict.unit??'无')}。当前输入尚未保存。<button class="ld-btn" type="button" data-action="observation-adopt-binding">确认使用最新绑定（保留当前输入）</button></div>`:''}
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">写入方式 (mode) *</span>
              <select class="ld-select" name="obs_mode" id="ld-obs-mode-select">
                <option value="new" ${obsForm.mode === 'new' ? 'selected' : ''}>新增一条带发生时间的观测记录 (new)</option>
                <option value="correct" ${!field.source_ref?.record_id ? 'disabled' : ''} ${obsForm.mode === 'correct' ? 'selected' : ''}>纠错既有最新来源记录 (correct · 校验 base_version)</option>
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">观测数值 (value) * (${escapeHtml(field.type)}${field.unit ? ` · ${escapeHtml(field.unit)}` : ''})</span>
              <input class="ld-input" type="number" step="${field.type === 'integer' ? '1' : 'any'}" name="value" id="ld-obs-value-input" required value="${escapeHtml(obsForm.rawValue)}" placeholder="输入真实观测数值" />
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">实际发生时间 (occurred_at, ISO 8601 含偏移，不可为未来时间) *</span>
              <input class="ld-input" type="text" name="occurred_at" id="ld-obs-occurred-at" required value="${escapeHtml(obsForm.occurredAt)}" />
            </label>
            <label class="ld-field">
              <span class="ld-label">时区 (timezone, IANA) *</span>
              <input class="ld-input" type="text" name="timezone" required value="${escapeHtml(obsForm.timezone)}" />
            </label>
          </div>
          ${
            obsForm.mode === 'correct' && field.source_ref?.record_id
              ? `<div class="ld-form-row">
                  <label class="ld-field">
                    <span class="ld-label">纠错目标来源记录 ID (source_record_id)</span>
                    <input class="ld-input" type="text" name="source_record_id" readonly value="${escapeHtml(field.source_ref.record_id)}" />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">纠错目标基线版本 (source_base_version)</span>
                    <input class="ld-input" type="number" name="source_base_version" readonly value="${escapeHtml(String(obsForm.sourceBaseVersion ?? field.source_ref.version ?? 1))}" />
                  </label>
                </div>`
              : ''
          }
          ${
            otherRequiredFields.length > 0
              ? `<div class="ld-form-grid" style="padding:10px;border-radius:var(--ld-radius-sm);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
                  <div style="font-size:12px;font-weight:600;">记录模板其他必填字段补充 (context_values)</div>
                  ${otherRequiredFields
                    .map(
                      rf => `<label class="ld-field">
                        <span class="ld-label">${escapeHtml(rf.label)} (<code>${escapeHtml(rf.key)}</code>) *</span>
                        <input class="ld-input" type="text" name="ctx_${escapeHtml(rf.key)}" data-obs-context-key="${escapeHtml(rf.key)}" data-obs-context-type="${rf.type}" value="${escapeHtml(obsForm.contextValues[rf.key] ?? (sourceRec?.values?.[rf.key] !== undefined && sourceRec?.values?.[rf.key] !== null ? String(sourceRec.values[rf.key]) : ''))}" required />
                      </label>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" id="ld-obs-submit-btn" ${state.submittingModal ? 'disabled' : ''}>
            ${state.submittingModal ? '正在写入并重算…' : obsForm.mode === 'correct' ? '提交来源纠错并重算' : '新增观测记录并重算'}
          </button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'wallet-ledger') {
    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <div class="ld-modal" id="ld-modal-wallet-ledger">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">🪙 系统代币钱包与账本流水</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${renderWalletSummaryCard(state, false)}
          ${renderWalletLedgerSection(state, data)}
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  return null;
}
