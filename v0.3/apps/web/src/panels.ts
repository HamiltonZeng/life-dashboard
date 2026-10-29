import {
  COMPLETION_MODE_META,
  escapeHtml,
  METRIC_AGGREGATION_META,
  METRIC_WINDOW_META,
  MODULE_STATUS_META,
  renderEmptyState,
  renderErrorBanner,
  renderModuleBadge,
  renderModuleFilterBar,
  TASK_CATEGORY_META,
  TASK_STATUS_META
} from '../../../packages/ui/src/index.js';
import {
  describeAiProvider,
  renderAiGenerateModal,
  renderAiResultModal,
  renderSettingsAiSection
} from './ai-views.js';
import {
  buildFallbackHomeFromBootstrap,
  renderDisabledAiContainer,
  renderHomePanel,
  renderProfileStatusBar,
  renderSettingsProfileSection
} from './home-profile.js';
import { renderActiveModal } from './modals.js';
import {
  computeFallbackAchievementSummary,
  describePhase2Rule,
  isTaskOrTemplatePinned,
  renderAchievementSeriesList,
  renderAchievementSummaryBar,
  renderColorSwatchBadge,
  renderMetricTrendSection,
  renderPanelAiContextBar,
  renderTaskRewardPill,
  renderTasksCombinationFilterBar,
  renderTaskTemplateSection,
  renderWalletLedgerSection,
  renderWalletSummaryCard
} from './phase2-views.js';
import type { AppState } from './state.js';
import {
  loadAllPendingConfigMutations,
  loadAllPendingMutations,
  loadAllRecordDrafts
} from './storage.js';
import type {
  AchievementAwardRow,
  BootstrapData,
  MetricRow,
  ModuleRow,
  RecordRow,
  RecordTypeRow,
  TaskRow
} from './types.js';

export {
  buildFallbackHomeFromBootstrap,
  computeFallbackAchievementSummary,
  describeAiProvider,
  describePhase2Rule,
  renderAchievementSeriesList,
  renderAchievementSummaryBar,
  renderActiveModal,
  renderAiGenerateModal,
  renderAiResultModal,
  renderDisabledAiContainer,
  renderHomePanel,
  renderMetricTrendSection,
  renderPanelAiContextBar,
  renderProfileStatusBar,
  renderSettingsAiSection,
  renderSettingsProfileSection,
  renderTasksCombinationFilterBar,
  renderTaskTemplateSection,
  renderWalletLedgerSection,
  renderWalletSummaryCard
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function getLocalIsoWithOffset(now = new Date()): string {
  const tzOffsetMin = -now.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  const offH = pad(tzOffsetMin / 60);
  const offM = pad(tzOffsetMin % 60);
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}${sign}${offH}:${offM}`;
}

export function getTodayIsoDate(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

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

export function describeTaskAcceptance(data: BootstrapData, task: TaskRow): string {
  const def = task.definition;
  if (def.completion_mode === 'manual') {
    return '无需关联记录，可随时手动确认完成';
  }
  const tpl = findTemplate(data, def.record_type_id);
  const tplName = tpl ? `「${tpl.name}」` : '指定模板';
  if (!def.acceptance || def.acceptance.kind === 'exists') {
    return `关联至少 1 条已确认的${tplName}记录`;
  }
  const targetFieldKey = def.acceptance.field_key;
  const field = tpl?.fields.find(f => f.key === targetFieldKey);
  const fieldLabel = field ? `「${field.label}」` : targetFieldKey;
  const unit = field?.unit ? ` ${field.unit}` : '';
  return `关联单条已确认${tplName}，且${fieldLabel} ≥ ${def.acceptance.threshold}${unit}`;
}

export function diagnosePartialTask(data: BootstrapData, task: TaskRow): string | null {
  const linked = data.records.filter(r => r.task_ids.includes(task.id));
  const confirmed = linked.filter(r => r.status === 'confirmed');
  const drafts = linked.filter(r => r.status === 'draft');
  if (task.status !== 'partial' && drafts.length === 0) return null;

  const def = task.definition;
  const tpl = findTemplate(data, def.record_type_id);
  if (confirmed.length === 0 && drafts.length > 0) {
    return `已关联 ${drafts.length} 条草稿记录；草稿不参与事实统计，确认保存后将重算任务状态。`;
  }
  if (def.acceptance?.kind === 'field_gte') {
    const key = def.acceptance.field_key;
    const field = tpl?.fields.find(f => f.key === key);
    const unit = field?.unit ? ` ${field.unit}` : '';
    const label = field?.label ?? key;
    const threshold = Number(def.acceptance.threshold);
    const nums = confirmed
      .map(r => r.values[key])
      .filter(v => v !== null && v !== undefined && v !== '')
      .map(v => Number(v))
      .filter(n => !Number.isNaN(n));
    if (nums.length === 0) {
      return `已关联 ${confirmed.length} 条记录，但「${label}」均为未知（空值），需单条记录 ≥ ${def.acceptance.threshold}${unit}。`;
    }
    const maxVal = Math.max(...nums);
    const diff = threshold - maxVal;
    if (diff > 0) {
      return `当前单条最高「${label}」为 ${maxVal}${unit}，要求单条 ≥ ${def.acceptance.threshold}${unit}（还差 ${Number(diff.toFixed(6))}${unit}）。`;
    }
  }
  return null;
}

function renderReturnBanner(state: AppState): string {
  const ctx = state.returnContext;
  if (!ctx) return '';
  return `<div class="ld-return-banner">
    <div>
      <strong>跨面板跳转中：</strong>${escapeHtml(ctx.label)}
      <span style="color:var(--ld-text-secondary);margin-left:6px;">返回时将自动恢复原面板筛选与选中状态</span>
    </div>
    <div style="display:flex;gap:8px;">
      <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="return-context">← 返回原位置</button>
      <button type="button" class="ld-btn ld-btn-sm" data-action="clear-return-context">留在当前面板</button>
    </div>
  </div>`;
}

export function renderTasksPanel(state: AppState, data: BootstrapData): string {
  const aiEnabled = state.capabilities?.legacy_ai_generation === true;
  const p = state.panels.tasks;
  const tf = state.taskFilter;

  // Merge rich Phase 2 instances (state.taskInstances) with bootstrap tasks so both work seamlessly
  const richById = new Map(state.taskInstances.map(t => [t.id, t]));
  const allTasks: TaskRow[] = [
    ...data.tasks.map(t => richById.get(t.id) ?? t),
    ...state.taskInstances.filter(t => !data.tasks.some(bt => bt.id === t.id))
  ];

  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const t of allTasks) {
    countsByModule[t.module_id] = (countsByModule[t.module_id] ?? 0) + 1;
  }

  const today = getTodayIsoDate();
  const filtered = allTasks.filter(t => {
    if (p.moduleId && t.module_id !== p.moduleId) return false;
    // Combination filter bar checks
    if (tf.category !== 'all' && (t.category ?? 'main') !== tf.category) return false;
    if (tf.color !== 'all' && (t.color ?? 'blue').toLowerCase() !== tf.color.toLowerCase()) {
      return false;
    }
    if (tf.pinnedOnly && !isTaskOrTemplatePinned(state, t).isPinned) {
      return false;
    }
    if (tf.status !== 'all') {
      if (tf.status === 'open') {
        if (t.status !== 'pending' && t.status !== 'partial' && t.status !== 'in_progress') return false;
      } else if (tf.status === 'needs_review') {
        if (!t.needs_review) return false;
      } else if (t.status !== tf.status) {
        return false;
      }
    }
    // Subtab checks
    if (p.subTab === 'today') {
      return !t.definition.business_date || t.definition.business_date === today;
    }
    if (p.subTab === 'completed') return t.status === 'completed';
    if (p.subTab === 'partial') return t.status === 'partial';
    if (p.subTab === 'ended') return t.status === 'ended';
    if (p.subTab === 'needs_review') return t.needs_review;
    return true;
  });

  const cardsHtml = filtered.length === 0
    ? renderEmptyState({
        icon: 'flag',
        title: p.moduleId ? '当前模块下暂无任务' : '暂无任务实例',
        description: '你可以创建周期任务模板（主线/每日/周常/月常）或单次任务实例，体验「任务 → 记录 → 数值 → 成就 → 系统代币奖励」真实写库闭环。',
        primaryActionLabel: '＋ 新建周期/主线模板',
        primaryActionData: 'data-action="open-create-task-template"',
        secondaryActionLabel: aiEnabled ? '✦ AI 生成配置' : '＋ 新建单次任务',
        secondaryActionData: aiEnabled ? 'data-action="open-ai-modal"' : 'data-action="open-create-task"'
      })
    : `<div class="ld-card-list">
        ${filtered
          .map(t => {
            const mod = findModule(data, t.module_id);
            const statusMeta = TASK_STATUS_META[t.status] ?? { label: t.status, tone: 'neutral' };
            const modeMeta = COMPLETION_MODE_META[t.definition.completion_mode] ?? {
              label: t.definition.completion_mode,
              badge: '',
              actionLabel: '去记录'
            };
            const partialReason = diagnosePartialTask(data, t);
            const linkedRecords = data.records.filter(r => r.task_ids.includes(t.id));
            const isSelected = p.selectedId === t.id;
            const isClosedTask = t.status === 'cancelled' || t.status === 'skipped';
            const catMeta = t.category ? TASK_CATEGORY_META[t.category] : undefined;
            const pinState = isTaskOrTemplatePinned(state, t);
            const canRevokeManual =
              t.status === 'completed' && t.completion_origin === 'manual';

            const statusBadgeClass =
              t.status === 'completed'
                ? 'ld-badge-success'
                : t.status === 'partial' || t.status === 'ended'
                  ? 'ld-badge-warning'
                  : isClosedTask
                    ? ''
                    : 'ld-badge-info';

            // S0-A R3 UI defense: cancelled or skipped tasks cannot be completed or recorded against
            let primaryButtons = '';
            if (!isClosedTask) {
              if (t.definition.completion_mode === 'record_required') {
                primaryButtons = `<button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="task-go-record" data-task-id="${escapeHtml(t.id)}">去记录</button>`;
              } else if (t.definition.completion_mode === 'record_optional') {
                primaryButtons = `
                  <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="task-go-record" data-task-id="${escapeHtml(t.id)}">完成并记录</button>
                  ${t.status !== 'completed' ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-success" data-action="task-complete-manual" data-task-id="${escapeHtml(t.id)}">标记完成</button>` : ''}
                `;
              } else {
                primaryButtons =
                  t.status !== 'completed'
                    ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-success" data-action="task-complete-manual" data-task-id="${escapeHtml(t.id)}">标记完成</button>`
                    : '';
              }
            }

            return `<article class="ld-card ${isSelected ? 'is-selected' : ''} ${t.needs_review ? 'is-needs-review' : ''}" data-task-card="${escapeHtml(t.id)}" data-task-status="${escapeHtml(t.status)}" data-task-category="${escapeHtml(t.category ?? 'main')}">
              <div class="ld-card-top">
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${renderModuleBadge(mod, true)}
                    ${catMeta ? `<span class="ld-badge ld-badge-info">${escapeHtml(catMeta.shortLabel)}</span>` : ''}
                    ${t.color ? renderColorSwatchBadge(t.color) : ''}
                    <span class="ld-badge">${escapeHtml(modeMeta.label)}</span>
                    <span class="ld-badge">${t.period ? `周期: ${escapeHtml(t.period.start.slice(0, 10))}${t.period.end ? ` ~ ${escapeHtml(t.period.end.slice(0, 10))}` : ''} (${escapeHtml(t.period.timezone)})` : t.definition.business_date ? `计划日期: ${escapeHtml(t.definition.business_date)}` : '不限日期'}</span>
                    ${pinState.isPinned ? '<span class="ld-badge ld-badge-success">📌 已固定首页</span>' : ''}
                  </div>
                  <h3 class="ld-card-title">${escapeHtml(t.definition.title)}</h3>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  ${t.needs_review ? `<span class="ld-badge ld-badge-warning">⚠ 完成依据变化，待复核</span>` : ''}
                  <span class="ld-badge ${statusBadgeClass}">${escapeHtml(statusMeta.label)}</span>
                </div>
              </div>
              <div class="ld-card-meta" style="justify-content:space-between;flex-wrap:wrap;">
                <span><strong>验收要求：</strong>${escapeHtml(t.locked_rule ? describePhase2Rule(data, t.locked_rule) : describeTaskAcceptance(data, t))}</span>
                ${
                  t.progress && t.progress.target
                    ? `<span>当前进度：<strong>${escapeHtml(String(t.progress.value ?? '0'))} / ${escapeHtml(t.progress.target)}</strong>（有效记录 ${t.progress.source_record_ids.length} 条 · ${t.progress.distinct_dates.length} 个自然日）</span>`
                    : ''
                }
              </div>
              ${t.reward_summary ? renderTaskRewardPill(t.reward_summary, t.category) : ''}
              ${partialReason ? `<div class="ld-badge ld-badge-warning" style="align-self:flex-start;padding:5px 10px;">${escapeHtml(partialReason)}</div>` : ''}
              <div class="ld-card-footer">
                <div class="ld-card-meta">
                  <span>已关联记录：<strong>${linkedRecords.length}</strong> 条</span>
                  ${t.completed_at ? `<span>· 完成于 ${escapeHtml(formatDateTime(t.completed_at))} (${t.completion_origin === 'manual' ? '手动确认' : '记录达标'})</span>` : ''}
                  ${t.status === 'ended' ? `<span>· 本周期已结束未完成（周期结束后 7 天内补录仍可获资格，超期补录仅计事实不发币）</span>` : ''}
                  ${isClosedTask ? `<span>· 已关闭状态（不可再完成）</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  ${primaryButtons}
                  ${
                    canRevokeManual
                      ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-warning" data-action="open-revoke-task" data-task-id="${escapeHtml(t.id)}">撤回手动完成</button>`
                      : ''
                  }
                  ${
                    !isClosedTask && t.period
                      ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-danger" data-action="open-cancel-task" data-task-id="${escapeHtml(t.id)}">取消实例</button>`
                      : ''
                  }
                  ${
                    !isClosedTask
                      ? `<button type="button" class="ld-btn ld-btn-sm" data-action="${pinState.pinKind === 'template' ? 'task-toggle-typed-pin' : 'home-toggle-pin-task'}" data-pin-kind="${pinState.pinKind}" data-pin-id="${escapeHtml(pinState.pinId)}" data-task-id="${escapeHtml(t.id)}">${pinState.isPinned ? '取消首页固定' : '📌 固定首页'}</button>`
                      : ''
                  }
                  <button type="button" class="ld-btn ld-btn-sm" data-action="open-task-detail" data-task-id="${escapeHtml(t.id)}">查看详情</button>
                </div>
              </div>
            </article>`;
          })
          .join('')}
      </div>`;

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">任务面板</h1>
        <p class="ld-panel-subtitle">支持主线任务、每日委托、周常委托与月常委托，以及周期累计验收、组合筛选与系统代币规则奖励</p>
      </div>
      <div class="ld-panel-actions">
        ${aiEnabled ? '<button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="tasks">✦ AI 生成</button>' : ''}
        <button type="button" class="ld-btn" data-action="open-create-task">＋ 新建单次任务</button>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-task-template">＋ 新建周期/主线模板</button>
      </div>
    </header>
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    ${renderTasksCombinationFilterBar(state, data)}
    ${renderTaskTemplateSection(state, data)}
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="任务范围筛选">
        ${[
          { key: 'all', label: `全部 (${allTasks.length})` },
          { key: 'today', label: '今日 / 不限期' },
          { key: 'partial', label: '部分完成' },
          { key: 'completed', label: '已完成' },
          { key: 'ended', label: '已结束未完成' },
          { key: 'needs_review', label: `待复核 (${allTasks.filter(x => x.needs_review).length})` }
        ]
          .map(
            tab =>
              `<button type="button" class="ld-tab-btn ${p.subTab === tab.key ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="${tab.key}">${escapeHtml(tab.label)}</button>`
          )
          .join('')}
      </div>
    </div>
    ${cardsHtml}
  </div>`;
}

export function renderRecordsPanel(state: AppState, data: BootstrapData): string {
  if(state.panels.records.subTab==='ai_review')state.panels.records.subTab='list';
  const p = state.panels.records;
  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const r of data.records) {
    countsByModule[r.module_id] = (countsByModule[r.module_id] ?? 0) + 1;
  }

  const availableTemplates = data.record_types.filter(
    rt => !p.moduleId || rt.module_id === p.moduleId
  );

  const filtered = data.records.filter(r => {
    if (p.moduleId && r.module_id !== p.moduleId) return false;
    if (p.recordTemplateId && r.record_type_id !== p.recordTemplateId) return false;
    if (p.recordStatus && p.recordStatus !== 'all' && r.status !== p.recordStatus) return false;
    if (p.recordTaskId && !r.task_ids.includes(p.recordTaskId)) return false;
    if (p.sourceRecordIds && !p.sourceRecordIds.includes(r.id)) return false;
    return true;
  });

  const localDraftEntries = Object.values(loadAllRecordDrafts());
  const pendingOpEntries = Object.values(loadAllPendingMutations());

  const localDraftBanner =
    localDraftEntries.length > 0
      ? `<div class="ld-draft-status-bar" data-local-drafts-count="${localDraftEntries.length}">
          <div>
            <span class="ld-badge ld-badge-info">已保存本机草稿 (${localDraftEntries.length})</span>
            ${
              pendingOpEntries.length > 0
                ? `<span class="ld-badge ld-badge-warning">网络结果未知待重试 (${pendingOpEntries.length})</span>`
                : ''
            }
            <span style="margin-left:6px;color:var(--ld-text-secondary);">本机存在未提交到服务器的表单草稿，打开对应记录表单将自动恢复输入。</span>
          </div>
          <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="resume-latest-draft" data-draft-key="${escapeHtml(localDraftEntries[0].draftKey)}">继续编辑本机草稿</button>
        </div>`
      : '';

  let bodyHtml = '';
  if (p.subTab === 'ai_review') {
    const confirmedCount = filtered.filter(r => r.status === 'confirmed').length;
    const draftCount = filtered.filter(r => r.status === 'draft').length;
    bodyHtml = `<div class="ld-card">
      <div class="ld-card-top">
        <div>
          <h3 class="ld-card-title">AI 复盘（日报 / 周报子视图）</h3>
          <p class="ld-panel-subtitle" style="margin-top:4px;">按《产品设计文档 v0.2》第 12.4 节，日报与周报位于记录面板子视图，不占用空白首页或新增第六面板。</p>
        </div>
        <span class="ld-badge ld-badge-warning">S4 阶段接入</span>
      </div>
      <div class="ld-card-meta" style="line-height:1.7;">
        <div>当前筛选范围内共有 <strong>${confirmedCount}</strong> 条服务器已确认记录、<strong>${draftCount}</strong> 条服务器草稿记录。</div>
        <div>确定性统计驱动的日报/周报将在 S4 阶段接入，界面不会伪造 AI 复盘正文。</div>
      </div>
    </div>`;
  } else if (filtered.length === 0) {
    bodyHtml = renderEmptyState({
      icon: 'book',
      title: '暂无符合筛选条件的记录',
      description: '记录面板只保存真实发生的事项或草稿，不预填任何虚构时长或金额。点击下方按钮新增第一条记录。',
      primaryActionLabel: '＋ 新建记录',
      primaryActionData: 'data-action="open-create-record"'
    });
  } else {
    const renderRecordCard = (r: RecordRow) => {
      const mod = findModule(data, r.module_id);
      const tpl = findTemplate(data, r.record_type_id);
      const linkedTasks = data.tasks.filter(t => r.task_ids.includes(t.id));
      const isSelected = p.selectedId === r.id;

      const fieldEntries = (tpl?.fields ?? []).map(f => {
        const rawVal = r.values[f.key];
        const formatted =
          rawVal === null || rawVal === undefined || rawVal === ''
            ? '<span style="color:var(--ld-text-muted);">未知 (null)</span>'
            : typeof rawVal === 'boolean'
              ? rawVal
                ? '是'
                : '否'
              : `${escapeHtml(rawVal)}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}`;
        return `<div style="display:flex;gap:6px;font-size:13px;">
          <span style="color:var(--ld-text-secondary);">${escapeHtml(f.label)}：</span>
          <strong>${formatted}</strong>
        </div>`;
      });

      return `<article class="ld-card ${isSelected ? 'is-selected' : ''} ${p.subTab === 'timeline' ? 'ld-timeline-item' : ''}" data-record-card="${escapeHtml(r.id)}">
        <div class="ld-card-top">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod, true)}
            <span class="ld-badge">${escapeHtml(tpl?.name ?? '记录模板')}</span>
            <span class="ld-badge ${r.status === 'confirmed' ? 'ld-badge-success' : 'ld-badge-warning'}">
              ${r.status === 'confirmed' ? '服务器已确认' : '服务器草稿（不计入统计）'}
            </span>
          </div>
          <span class="ld-card-meta">${escapeHtml(formatDateTime(r.occurred_at))} (${escapeHtml(r.timezone)}) · v${r.version}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;padding:4px 0;">
          ${fieldEntries.join('')}
        </div>
        <div class="ld-card-footer">
          <div class="ld-card-meta">
            ${
              linkedTasks.length > 0
                ? `<span>关联任务 (${linkedTasks.length})：${linkedTasks.map(t => `<button type="button" class="ld-btn ld-btn-sm" data-action="record-jump-task" data-task-id="${escapeHtml(t.id)}">${escapeHtml(t.definition.title)}</button>`).join(' ')}</span>`
                : '<span>未关联任务（仅计入所属模块与模板统计）</span>'
            }
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button type="button" class="ld-btn ld-btn-sm" data-action="open-edit-record" data-record-id="${escapeHtml(r.id)}">编辑</button>
            <button type="button" class="ld-btn ld-btn-sm" data-action="open-record-detail" data-record-id="${escapeHtml(r.id)}">详情 / 删除</button>
          </div>
        </div>
      </article>`;
    };

    bodyHtml =
      p.subTab === 'timeline'
        ? `<div class="ld-timeline">${filtered.map(renderRecordCard).join('')}</div>`
        : `<div class="ld-card-list">${filtered.map(renderRecordCard).join('')}</div>`;
  }

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${localDraftBanner}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">记录面板</h1>
        <p class="ld-panel-subtitle">真实发生事项与草稿的统一入口，按唯一记录 ID 驱动任务验收、精确统计与成就评估</p>
      </div>
      <div class="ld-panel-actions">
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-record">＋ 新建记录</button>
      </div>
    </header>
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    ${
      p.sourceRecordIds
        ? `<div class="ld-return-banner" style="background:var(--ld-bg-elevated);">
            <span><strong>当前按来源证据筛选：</strong>${escapeHtml(p.sourceLabel ?? `共 ${p.sourceRecordIds.length} 条来源记录`)}</span>
            <button type="button" class="ld-btn ld-btn-sm" data-action="clear-record-source-filter">清除来源筛选</button>
          </div>`
        : ''
    }
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="记录视图切换">
        <button type="button" class="ld-tab-btn ${p.subTab === 'list' ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="list">列表视图</button>
        <button type="button" class="ld-tab-btn ${p.subTab === 'timeline' ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="timeline">时间线视图</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <select class="ld-select" style="width:auto;" data-action="filter-record-template" aria-label="按记录模板筛选">
          <option value="">全部记录模板</option>
          ${availableTemplates
            .map(
              rt =>
                `<option value="${escapeHtml(rt.id)}" ${p.recordTemplateId === rt.id ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
            )
            .join('')}
        </select>
        <select class="ld-select" style="width:auto;" data-action="filter-record-status" aria-label="按确认状态筛选">
          <option value="all" ${(!p.recordStatus || p.recordStatus === 'all') ? 'selected' : ''}>全部状态</option>
          <option value="confirmed" ${p.recordStatus === 'confirmed' ? 'selected' : ''}>已确认 (confirmed)</option>
          <option value="draft" ${p.recordStatus === 'draft' ? 'selected' : ''}>草稿 (draft)</option>
        </select>
      </div>
    </div>
    ${bodyHtml}
  </div>`;
}

export function renderMetricsPanel(state: AppState, data: BootstrapData): string {
  const aiEnabled = state.capabilities?.legacy_ai_generation === true;
  const p = state.panels.metrics;
  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const m of data.metrics) {
    countsByModule[m.module_id] = (countsByModule[m.module_id] ?? 0) + 1;
  }

  const filtered = data.metrics.filter(m => {
    if (p.moduleId && m.module_id !== p.moduleId) return false;
    if (p.subTab !== 'all' && m.definition.window !== p.subTab) return false;
    return true;
  });

  const gridHtml = filtered.length === 0
    ? renderEmptyState({
        icon: 'dumbbell',
        title: '暂无数值定义',
        description: '支持对指定记录模板进行 count（计数）、sum（求和）、avg（均值）、latest（最新值）精确聚合，无数据时如实显示「暂无数据」而非 0。',
        primaryActionLabel: '＋ 新建数值定义',
        primaryActionData: 'data-action="open-create-metric"',
        secondaryActionLabel: aiEnabled ? '✦ AI 生成配置' : undefined,
        secondaryActionData: 'data-action="open-ai-modal"'
      })
    : `<div class="ld-card-grid">
        ${filtered
          .map(m => {
            const mod = findModule(data, m.module_id);
            const tpl = findTemplate(data, m.record_type_id);
            const field = tpl?.fields.find(f => f.key === m.definition.field_key);
            const winMeta = METRIC_WINDOW_META[m.definition.window] ?? {
              label: m.definition.window,
              shortLabel: m.definition.window
            };
            const aggMeta = METRIC_AGGREGATION_META[m.definition.aggregation] ?? {
              label: m.definition.aggregation,
              description: ''
            };
            const hasValue = m.computed.value !== null && m.computed.value !== undefined;
            const isSelected = p.selectedId === m.id;

            return `<article class="ld-card ${isSelected ? 'is-selected' : ''}" data-metric-card="${escapeHtml(m.id)}">
              <div class="ld-card-top">
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  ${renderModuleBadge(mod, true)}
                  <span class="ld-badge ld-badge-info">${escapeHtml(winMeta.shortLabel)}</span>
                  <span class="ld-badge">${escapeHtml(aggMeta.label)}</span>
                </div>
                <span class="ld-card-meta">有效样本 ${m.computed.sample_count} 条</span>
              </div>
              <div>
                <h3 class="ld-card-title">${escapeHtml(m.definition.name)}</h3>
                <div class="ld-metric-value-box">
                  ${
                    hasValue
                      ? `<span class="ld-metric-number">${escapeHtml(m.computed.value)}</span><span class="ld-metric-unit">${escapeHtml(m.definition.unit)}</span>`
                      : `<span class="ld-metric-number is-null">暂无数据</span>`
                  }
                </div>
              </div>
              <div class="ld-card-meta">
                <span>来源模板：<strong>${escapeHtml(tpl?.name ?? '未知模板')}</strong>${field ? ` · 字段「${escapeHtml(field.label)}」` : ' · 唯一记录计数'}</span>
              </div>
              ${renderMetricTrendSection(m.id, state, data)}
              <div class="ld-card-footer">
                <button type="button" class="ld-btn ld-btn-sm" data-action="metric-view-sources" data-metric-id="${escapeHtml(m.id)}">
                  查看来源记录 (${m.computed.source_record_ids.length})
                </button>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                  <button type="button" class="ld-btn ld-btn-sm" data-action="home-toggle-pin-metric" data-metric-id="${escapeHtml(m.id)}">${(state.homePreferences?.pinned_metric_ids ?? []).includes(m.id) ? '取消首页固定' : '📌 固定首页'}</button>
                  <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="metric-add-record" data-metric-id="${escapeHtml(m.id)}">＋ 记一条</button>
                  <button type="button" class="ld-btn ld-btn-sm" data-action="open-metric-detail" data-metric-id="${escapeHtml(m.id)}">详情</button>
                </div>
              </div>
            </article>`;
          })
          .join('')}
      </div>`;

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">数值面板</h1>
        <p class="ld-panel-subtitle">基于已确认唯一记录与十进制精确运算，展示日 / 周 / 月 / 累计统计窗口及四范围等权日均趋势图</p>
      </div>
      <div class="ld-panel-actions">
        ${aiEnabled ? '<button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="metrics">✦ AI 生成</button>' : ''}
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-metric">＋ 新建数值定义</button>
      </div>
    </header>
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="时间窗口筛选">
        ${[
          { key: 'all', label: '全部窗口' },
          { key: 'day', label: '今日 (day)' },
          { key: 'week', label: '本周 (week)' },
          { key: 'month', label: '本月 (month)' },
          { key: 'all_time', label: '累计 (all_time)' }
        ]
          .map(
            t =>
              `<button type="button" class="ld-tab-btn ${p.subTab === t.key ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="${t.key}">${escapeHtml(t.label)}</button>`
          )
          .join('')}
      </div>
    </div>
    ${gridHtml}
  </div>`;
}

export function renderAchievementsPanel(state: AppState, data: BootstrapData): string {
  const aiEnabled = state.capabilities?.legacy_ai_generation === true;
  const p = state.panels.achievements;
  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const a of data.achievement_definitions) {
    countsByModule[a.module_id] = (countsByModule[a.module_id] ?? 0) + 1;
  }
  for (const s of state.achievementSeries) {
    countsByModule[s.module_id] = (countsByModule[s.module_id] ?? 0) + 1;
  }

  const filtered = data.achievement_definitions.filter(a => {
    if (p.moduleId && a.module_id !== p.moduleId) return false;
    const award = findAward(data, a.id);
    if (p.subTab === 'unlocked') return award?.state === 'unlocked';
    if (p.subTab === 'needs_review') return award?.state === 'needs_review';
    if (p.subTab === 'unstarted') return !award;
    return true;
  });

  const gridHtml = filtered.length === 0
    ? renderEmptyState({
        icon: 'trophy',
        title: '暂无成就定义',
        description: '成就不由 AI 直接标记完成，而是绑定某个数值定义或系列多门槛，在真实记录达标时由规则引擎自动授予。',
        primaryActionLabel: '＋ 新建成就定义',
        primaryActionData: 'data-action="open-create-achievement"',
        secondaryActionLabel: aiEnabled ? '✦ AI 生成配置' : '＋ 新建多门槛成就系列',
        secondaryActionData: aiEnabled ? 'data-action="open-ai-modal"' : 'data-action="open-create-achievement-series"'
      })
    : `<div class="ld-card-grid">
        ${filtered
          .map(a => {
            const mod = findModule(data, a.module_id);
            const metric = findMetric(data, a.metric_id);
            const award = findAward(data, a.id);
            const currentVal = metric?.computed.value ?? null;
            const thresholdNum = Number(a.definition.threshold);
            const currentNum = currentVal !== null ? Number(currentVal) : 0;
            const pct =
              thresholdNum > 0
                ? Math.min(100, Math.max(0, Math.round((currentNum / thresholdNum) * 100)))
                : award?.state === 'unlocked'
                  ? 100
                  : 0;

            const stateBadge =
              award?.state === 'unlocked'
                ? `<span class="ld-badge ld-badge-success">🏆 已解锁</span>`
                : award?.state === 'needs_review'
                  ? `<span class="ld-badge ld-badge-warning">⚠ 完成依据变化，待复核</span>`
                  : `<span class="ld-badge">未解锁</span>`;

            return `<article class="ld-card ${p.selectedId === a.id ? 'is-selected' : ''} ${award?.state === 'needs_review' ? 'is-needs-review' : ''}" data-achievement-card="${escapeHtml(a.id)}">
              <div class="ld-card-top">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                  ${renderModuleBadge(mod, true)}
                  <span class="ld-badge">${a.definition.history_policy === 'include_existing' ? '可追溯历史记录' : '仅统计创建后记录'}</span>
                </div>
                ${stateBadge}
              </div>
              <div>
                <h3 class="ld-card-title">${escapeHtml(a.definition.name)}</h3>
                <p class="ld-card-meta" style="margin:6px 0 10px;">
                  条件：当数值 <strong>「${escapeHtml(metric?.definition.name ?? '关联数值')}」</strong>
                  ${a.definition.operator === 'gte' ? '≥' : '≤'} <strong>${escapeHtml(a.definition.threshold)} ${escapeHtml(metric?.definition.unit ?? '')}</strong>
                </p>
                <div class="ld-progress-track">
                  <div class="ld-progress-fill" style="width:${pct}%;"></div>
                </div>
                <div class="ld-card-meta" style="margin-top:6px;justify-content:space-between;">
                  <span>当前数值：<strong>${currentVal !== null ? `${escapeHtml(currentVal)} ${escapeHtml(metric?.definition.unit ?? '')}` : '暂无数据'}</strong></span>
                  <span>目标门槛：${escapeHtml(a.definition.threshold)} ${escapeHtml(metric?.definition.unit ?? '')}</span>
                </div>
              </div>
              ${
                award
                  ? `<div class="ld-card-meta" style="background:var(--ld-bg-elevated);padding:8px 10px;border-radius:var(--ld-radius-sm);">
                      <div>根据历史/当前记录解锁，首次评估于：<strong>${escapeHtml(formatDateTime(award.unlocked_at))}</strong>（规则 v${award.rule_version}）</div>
                      ${
                        award.state === 'needs_review'
                          ? `<div style="color:var(--ld-warning);">原解锁值：${escapeHtml(award.original_evidence.value ?? 'null')} → 最新复核值：${escapeHtml(award.evidence.value ?? '暂无数据')}</div>`
                          : ''
                      }
                    </div>`
                  : ''
              }
              <div class="ld-card-footer">
                <button type="button" class="ld-btn ld-btn-sm" data-action="achievement-jump-metric" data-metric-id="${escapeHtml(a.metric_id)}">
                  查看关联数值
                </button>
                <div style="display:flex;gap:6px;">
                  ${
                    award
                      ? `<button type="button" class="ld-btn ld-btn-sm" data-action="achievement-view-evidence" data-achievement-id="${escapeHtml(a.id)}">查看解锁依据 (${award.evidence.source_record_ids.length})</button>`
                      : ''
                  }
                  <button type="button" class="ld-btn ld-btn-sm" data-action="open-achievement-detail" data-achievement-id="${escapeHtml(a.id)}">详情</button>
                </div>
              </div>
            </article>`;
          })
          .join('')}
      </div>`;

  const summary = computeFallbackAchievementSummary(state, data);

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">成就面板</h1>
        <p class="ld-panel-subtitle">支持多门槛成就系列与单门槛成就定义；严格区分有效授予总数 (${summary.effective_awards_count})、已达成系列数 (${summary.achieved_series_count}) 与待复核数 (${summary.needs_review_count})</p>
      </div>
      <div class="ld-panel-actions">
        ${aiEnabled ? '<button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="achievements">✦ AI 生成</button>' : ''}
        <button type="button" class="ld-btn" data-action="open-create-achievement">＋ 新建单门槛成就</button>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-achievement-series">＋ 新建多门槛系列</button>
      </div>
    </header>
    ${renderAchievementSummaryBar(state, data)}
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="成就状态筛选">
        ${[
          { key: 'all', label: `全部 (${data.achievement_definitions.length + state.achievementSeries.length})` },
          { key: 'unlocked', label: `有效授予 (${summary.effective_awards_count})` },
          { key: 'unstarted', label: '未解锁 / 进行中' },
          { key: 'needs_review', label: `需复核 (${summary.needs_review_count})` }
        ]
          .map(
            t =>
              `<button type="button" class="ld-tab-btn ${p.subTab === t.key ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="${t.key}">${escapeHtml(t.label)}</button>`
          )
          .join('')}
      </div>
    </div>
    ${renderAchievementSeriesList(state, data)}
    ${gridHtml}
  </div>`;
}

export function renderSettingsPanel(state: AppState, data: BootstrapData): string {
  const p = state.panels.settings;
  const aiEnabled = state.capabilities?.legacy_ai_generation === true;
  if (p.subTab === 'ai' && !aiEnabled) p.subTab = 'modules';
  const subTab = p.subTab || 'modules';
  const pendingConfigOps = Object.values(loadAllPendingConfigMutations());

  let sectionHtml = '';
  if (subTab === 'profile') {
    sectionHtml = renderSettingsProfileSection(state, data);
  } else if (subTab === 'wallet') {
    sectionHtml = `<div class="ld-card-list">
      ${renderWalletSummaryCard(state, false)}
      ${renderWalletLedgerSection(state, data)}
    </div>`;
  } else if (subTab === 'modules') {
    sectionHtml = `<div class="ld-card-list">
      <div class="ld-card" style="flex-direction:row;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div>
          <h3 class="ld-card-title">模块管理（默认模块与自定义模块）</h3>
          <p class="ld-panel-subtitle">四个默认模块与自定义模块使用相同能力接口。改名或归档保留稳定 UUID 与历史记录关联。</p>
        </div>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-module">＋ 新建自定义模块</button>
      </div>
      <div class="ld-card-grid">
        ${data.modules
          .map(m => {
            const st = MODULE_STATUS_META[m.status] ?? { label: m.status, tone: 'neutral' };
            const tplCount = data.record_types.filter(x => x.module_id === m.id).length;
            const taskCount = data.tasks.filter(x => x.module_id === m.id).length;
            const metricCount = data.metrics.filter(x => x.module_id === m.id).length;
            const achCount = data.achievement_definitions.filter(x => x.module_id === m.id).length;
            const recCount = data.records.filter(x => x.module_id === m.id).length;

            return `<article class="ld-card">
              <div class="ld-card-top">
                ${renderModuleBadge(m)}
                <div style="display:flex;gap:6px;">
                  <span class="ld-badge">${m.source === 'builtin' ? '内置模块' : '自定义模块'}</span>
                  <span class="ld-badge ${m.status === 'enabled' ? 'ld-badge-success' : m.status === 'disabled' ? 'ld-badge-warning' : ''}">${escapeHtml(st.label)}</span>
                </div>
              </div>
              <p class="ld-card-meta">${escapeHtml(m.description || '暂无模块说明')}</p>
              <div class="ld-card-meta">
                <span>模板 ${tplCount}</span> · <span>任务 ${taskCount}</span> · <span>数值 ${metricCount}</span> · <span>成就 ${achCount}</span> · <span>记录 ${recCount}</span> · <span>v${m.version}</span>
              </div>
              <div class="ld-card-footer">
                <span class="ld-card-meta" style="font-family:monospace;font-size:11px;">ID: ${escapeHtml(m.id.slice(0, 8))}…</span>
                <button type="button" class="ld-btn ld-btn-sm" data-action="open-edit-module" data-module-id="${escapeHtml(m.id)}">改名 / 状态管理</button>
              </div>
            </article>`;
          })
          .join('')}
      </div>
    </div>`;
  } else if (subTab === 'dependencies') {
    sectionHtml = `<div class="ld-card-list">
      <div class="ld-card" style="flex-direction:row;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div>
          <h3 class="ld-card-title">记录模板与内容依赖检查</h3>
          <p class="ld-panel-subtitle">首期阻止破坏性删除模板或修改已被引用的字段类型，确保任务按钮与成就条件不会指向失效对象。</p>
        </div>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-template">＋ 新建记录模板</button>
      </div>
      <div class="ld-card">
        <h3 class="ld-card-title">记录模板依赖关系表</h3>
        <div style="overflow-x:auto;">
          <table class="ld-table">
            <thead>
              <tr>
                <th>模板名称</th>
                <th>所属模块</th>
                <th>字段定义 (key / 类型 / 单位)</th>
                <th>引用该模板的任务</th>
                <th>引用该模板的数值</th>
                <th>已存记录数</th>
              </tr>
            </thead>
            <tbody>
              ${data.record_types
                .map(rt => {
                  const mod = findModule(data, rt.module_id);
                  const refTasks = data.tasks.filter(t => t.definition.record_type_id === rt.id);
                  const refMetrics = data.metrics.filter(m => m.record_type_id === rt.id);
                  const recCount = data.records.filter(r => r.record_type_id === rt.id).length;
                  return `<tr>
                    <td><strong>${escapeHtml(rt.name)}</strong> <span class="ld-badge">v${rt.schema_version}</span></td>
                    <td>${renderModuleBadge(mod, true)}</td>
                    <td>
                      ${rt.fields
                        .map(
                          f =>
                            `<span class="ld-badge" style="margin:2px;">${escapeHtml(f.label)} (<code>${escapeHtml(f.key)}</code>: ${escapeHtml(f.type)}${f.unit ? `/${escapeHtml(f.unit)}` : ''}${f.required ? ' *' : ''})</span>`
                        )
                        .join(' ')}
                    </td>
                    <td>${refTasks.length > 0 ? refTasks.map(t => escapeHtml(t.definition.title)).join('、') : '<span style="color:var(--ld-text-muted);">无</span>'}</td>
                    <td>${refMetrics.length > 0 ? refMetrics.map(m => escapeHtml(m.definition.name)).join('、') : '<span style="color:var(--ld-text-muted);">无</span>'}</td>
                    <td>${recCount} 条</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
      <div class="ld-card">
        <h3 class="ld-card-title">数值与成就引用链</h3>
        <div style="overflow-x:auto;">
          <table class="ld-table">
            <thead>
              <tr>
                <th>数值名称</th>
                <th>所属模块</th>
                <th>聚合与窗口</th>
                <th>引用该数值的成就</th>
              </tr>
            </thead>
            <tbody>
              ${
                data.metrics.length === 0
                  ? `<tr><td colspan="4" style="color:var(--ld-text-muted);">暂无数值定义</td></tr>`
                  : data.metrics
                      .map(m => {
                        const mod = findModule(data, m.module_id);
                        const refAch = data.achievement_definitions.filter(a => a.metric_id === m.id);
                        return `<tr>
                          <td><strong>${escapeHtml(m.definition.name)}</strong></td>
                          <td>${renderModuleBadge(mod, true)}</td>
                          <td><code>${escapeHtml(m.definition.aggregation)}</code> / <code>${escapeHtml(m.definition.window)}</code> (${escapeHtml(m.definition.unit)})</td>
                          <td>${refAch.length > 0 ? refAch.map(a => escapeHtml(a.definition.name)).join('、') : '<span style="color:var(--ld-text-muted);">无</span>'}</td>
                        </tr>`;
                      })
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  } else if (subTab === 'ai') {
    sectionHtml = renderSettingsAiSection(state, data);
  } else if (subTab === 'display') {
    const isMinimal = Boolean(state.homePreferences?.minimal_mode);
    sectionHtml = `<div class="ld-card-list">
      <div class="ld-card">
        <h3 class="ld-card-title">显示与首页偏好</h3>
        <div class="ld-form-grid" style="margin-top:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>主页极简模式 (minimal_mode)</strong>
              <div class="ld-card-meta">开启后首页主内容区只保留居中的 AI 对话容器，隐藏形象、摘要、数值、趋势、任务和成就卡片；关闭后自动恢复原固定顺序与输入草稿（偏好保存在服务器）</div>
            </div>
            <button type="button" class="ld-btn ${isMinimal ? 'ld-btn-primary' : ''}" id="ld-settings-minimal-toggle-btn" data-action="toggle-minimal-mode" data-minimal-mode="${String(isMinimal)}">
              ${isMinimal ? '已开启极简模式（点击恢复标准首页）' : '已关闭（点击开启极简模式）'}
            </button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>界面主题配色</strong>
              <div class="ld-card-meta">默认采用深色游戏面板风格，可随时切换浅色高对比主题（偏好自动保存在本机）</div>
            </div>
            <button type="button" class="ld-btn" data-action="toggle-theme">
              当前：${state.theme === 'dark' ? '🌙 深色主题 (点击切为浅色)' : '☀️ 浅色主题 (点击切为深色)'}
            </button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>减少动态效果 (Reduced Motion)</strong>
              <div class="ld-card-meta">关闭过渡动画与进度条动效</div>
            </div>
            <button type="button" class="ld-btn" data-action="toggle-reduced-motion">
              ${state.reducedMotion ? '已开启减少动效' : '标准动效'}
            </button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>成就解锁轻量提示</strong>
              <div class="ld-card-meta">保存记录触发新成就解锁时在右下角展示非阻断提示</div>
            </div>
            <button type="button" class="ld-btn" data-action="toggle-unlock-toast">
              ${state.unlockToastEnabled ? '已启用提示' : '已静默'}
            </button>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>面板筛选栏显示已停用/已归档模块</strong>
              <div class="ld-card-meta">默认隐藏停用或归档模块入口，开启后可在各面板筛选查看历史归档模块数据</div>
            </div>
            <button type="button" class="ld-btn" data-action="toggle-inactive-modules">
              ${state.showInactiveModulesInFilter ? '显示全部状态模块' : '仅显示启用模块'}
            </button>
          </div>
        </div>
      </div>
    </div>`;
  } else {
    const exportUi = state.exportUi;
    const exportSupported = state.capabilities?.user_export !== false;
    const exportBusy = exportUi.status === 'exporting';
    const exportStatusTone =
      exportUi.status === 'success'
        ? 'ld-badge-success'
        : exportUi.status === 'error'
          ? 'ld-badge-danger'
          : exportUi.status === 'exporting'
            ? 'ld-badge-info'
            : '';
    const exportStatusLabel =
      exportUi.status === 'success'
        ? '导出成功'
        : exportUi.status === 'error'
          ? '导出失败'
          : exportUi.status === 'exporting'
            ? '正在导出'
            : '尚未导出';
    const exportStatusMessage =
      exportUi.message ??
      '尚未导出。导出文件是服务端返回的完整 JSON 快照（含 format / schema_version / checksum），可直接作为 CLI 恢复的输入；浏览器不会保存任何登录口令。';

    sectionHtml = `<div class="ld-card-list">
      ${renderWalletSummaryCard(state, false)}
      <div class="ld-card">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">数据导出（人工备份）</h3>
            <p class="ld-panel-subtitle">
              从服务器只读读取当前账户的完整数据快照（模块、模板、任务、记录、记录修订、数值、成就、变更日志与迁移版本），
              并下载为带服务端 checksum 的 JSON 文件。这是「导出」，不是「恢复」：本页面不提供恢复入口，恢复需在本地用 CLI 对空数据库执行。
            </p>
          </div>
          <button type="button" class="ld-btn ld-btn-primary" data-action="export-data" ${exportBusy || !exportSupported ? 'disabled' : ''}>
            ${exportBusy ? '正在导出…' : '⭳ 导出数据'}
          </button>
        </div>
        ${
          exportSupported
            ? ''
            : `<div class="ld-card-meta" style="color:var(--ld-text-muted);">当前服务端 capabilities 未声明 user_export，导出入口已禁用。</div>`
        }
        <div class="ld-card-meta" style="margin-top:8px;" data-export-status="${escapeHtml(exportUi.status)}">
          <span class="ld-badge ${exportStatusTone}">${escapeHtml(exportStatusLabel)}</span>
          <span>${escapeHtml(exportStatusMessage)}</span>
        </div>
        ${
          exportUi.fileName
            ? `<div class="ld-card-meta">已下载文件：<code data-export-file="${escapeHtml(exportUi.fileName)}">${escapeHtml(exportUi.fileName)}</code></div>`
            : ''
        }
        <div class="ld-card-footer">
          <div class="ld-card-meta">
            <span>导出范围：当前登录账户的全部白名单数据表</span> ·
            <span>恢复：CLI only（页面不提供）</span>
          </div>
          <span class="ld-badge">GET /api/v1/export</span>
        </div>
      </div>
      <div class="ld-card">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">本地账户</h3>
            <p class="ld-panel-subtitle">仅在本机使用；退出后需重新登录。</p>
          </div>
          <button type="button" class="ld-btn ld-btn-danger" data-action="logout">退出当前会话</button>
        </div>
        <div class="ld-form-row" style="margin-top:8px;">
          <div class="ld-field">
            <span class="ld-label">当前登录账户</span>
            <div><strong>${escapeHtml(state.user?.name ?? '本地用户')}</strong> (<code>${escapeHtml(state.user?.id ?? '')}</code>)</div>
          </div>
          <div class="ld-field">
            <span class="ld-label">默认时区 (IANA)</span>
            <div><code>${escapeHtml(state.user?.timezone ?? 'Asia/Shanghai')}</code></div>
          </div>
          <div class="ld-field">
            <span class="ld-label">服务端变更日志游标 (cursor)</span>
            <div><code>seq = ${escapeHtml(data.cursor)}</code></div>
          </div>
          <div class="ld-field">
            <span class="ld-label">契约版本 / 阶段</span>
            <div><code>${escapeHtml(state.capabilities?.contract_version ?? '0.2.0')}</code> / <code>${escapeHtml(state.capabilities?.stage ?? 'v0.2-phase2')}</code></div>
          </div>
        </div>
        <div class="ld-card-footer">
          <div class="ld-card-meta">
            <span>local_session: <strong>${String(state.capabilities?.local_session ?? true)}</strong></span> ·
            <span>sync: <strong>${String(state.capabilities?.sync ?? false)}</strong></span> ·
            <span>cloud_ai: <strong>${String(state.capabilities?.cloud_ai ?? false)}</strong></span> ·
            <span>recurring_tasks: <strong>${String(state.capabilities?.recurring_tasks ?? false)}</strong></span>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="refresh-bootstrap">刷新服务器数据</button>
        </div>
      </div>
    </div>`;
  }

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">设置面板</h1>
        <p class="ld-panel-subtitle">管理个人资料与观测绑定、代币钱包、模块、记录模板、内容依赖、显示偏好与本地账户会话</p>
      </div>
    </header>
    ${
      pendingConfigOps.length > 0
        ? `<div class="ld-draft-status-bar" data-pending-config-ops="${pendingConfigOps.length}">
            <div>
              <span class="ld-badge ld-badge-warning">存在待确认的配置提交 (${pendingConfigOps.length})</span>
              <span style="margin-left:6px;color:var(--ld-text-secondary);">上次配置创建或资料更新未收到服务器回执，点击继续确认将沿用原 operation_id 与实体 ID。</span>
            </div>
            <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="resume-pending-config" data-config-kind="${escapeHtml(pendingConfigOps[0].kind)}">继续确认待定配置</button>
          </div>`
        : ''
    }
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="设置分组">
        ${[
          { key: 'profile', label: '个人信息详情' },
          { key: 'wallet', label: '🪙 代币钱包与流水' },
          { key: 'modules', label: '模块管理' },
          { key: 'dependencies', label: '内容配置与依赖' },
          { key: 'ai', label: 'AI 设置与自动填充' },
          { key: 'display', label: '显示与反馈' },
          { key: 'account', label: '账户与数据' }
        ]
          .filter(t => t.key !== 'ai' || aiEnabled)
          .map(
            t =>
              `<button type="button" class="ld-tab-btn ${subTab === t.key ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="${t.key}">${escapeHtml(t.label)}</button>`
          )
          .join('')}
      </div>
    </div>
    ${sectionHtml}
  </div>`;
}
