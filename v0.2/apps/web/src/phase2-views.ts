import {
  AI_ACTION_PROPOSAL_META,
  COMPLETION_MODE_META,
  escapeHtml,
  METRIC_AGGREGATION_META,
  MODULE_COLORS,
  renderEmptyState,
  renderModuleBadge,
  REWARD_ELIGIBILITY_META,
  SUBMISSION_STATE_META,
  TASK_CATEGORY_META,
  TASK_RULE_KIND_META,
  TASK_STATUS_META,
  TREND_FALLBACK_META,
  TREND_RANGE_META,
  type ModuleColorName
} from '../../../packages/ui/src/index.js';
import type { AppState, TrendControlState } from './state.js';
import { createInitialTrendControlState } from './state.js';
import type {
  AchievementSeriesView,
  AchievementSummaryData,
  AiActionPanelScope,
  AiContextEnvelope,
  BootstrapData,
  MetricTrendData,
  ModuleRow,
  RewardSummary,
  TaskCategory,
  TaskRow,
  TaskRule,
  TaskTemplateRow,
  TrendGrain,
  TrendPin,
  TrendRange,
  WalletData,
  WalletLedgerEntry
} from './types.js';

function findModule(data: BootstrapData | null, id: string): ModuleRow | undefined {
  return data?.modules.find(m => m.id === id);
}

export function resolveColorHex(color: string | undefined): string {
  if (!color) return MODULE_COLORS.blue.accent;
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const token = MODULE_COLORS[color as ModuleColorName];
  return token ? token.accent : MODULE_COLORS.blue.accent;
}

export function renderColorSwatchBadge(color: string | undefined): string {
  const raw = color ?? 'blue';
  const hex = resolveColorHex(raw);
  const token = MODULE_COLORS[raw as ModuleColorName];
  const label = token ? `${token.label} (${raw})` : raw;
  return `<span class="ld-badge" data-task-color="${escapeHtml(raw)}" title="颜色标签（仅用于分类展示与筛选，不影响任务难度或奖励金额）">
    <span class="ld-color-swatch" style="background:${escapeHtml(hex)};"></span>
    <span>${escapeHtml(label)}</span>
  </span>`;
}

export function getValidGrainsForRange(range: TrendRange): readonly TrendGrain[] {
  return TREND_RANGE_META[range]?.grains ?? ['1d'];
}

export function getDefaultGrainForRange(range: TrendRange): TrendGrain {
  return TREND_RANGE_META[range]?.defaultGrain ?? '1d';
}

// ---------------------------------------------------------------------------
// G3: Per-Panel Restricted AI Context & Action-Proposal 1.0 Entry (Disabled in MVP)
// ---------------------------------------------------------------------------

export function buildPanelAiContextEnvelope(
  panel: AiActionPanelScope,
  state: AppState,
  data: BootstrapData | null
): AiContextEnvelope {
  const tz = state.profile?.timezone ?? state.user?.timezone ?? 'Asia/Shanghai';
  const enabledMods = (data?.modules ?? []).filter(m => m.status === 'enabled').slice(0, 10);
  const modIds =
    panel !== 'home' && panel !== 'profile' && state.panels[panel as 'tasks' | 'metrics' | 'achievements' | 'records']?.moduleId
      ? [state.panels[panel as 'tasks' | 'metrics' | 'achievements' | 'records'].moduleId!]
      : enabledMods.map(m => m.id);

  return {
    panel,
    module_ids: modIds.slice(0, 10),
    record_type_ids: (data?.record_types ?? [])
      .filter(rt => modIds.includes(rt.module_id))
      .map(rt => rt.id)
      .slice(0, 20),
    metric_ids: (data?.metrics ?? [])
      .filter(m => modIds.includes(m.module_id))
      .map(m => m.id)
      .slice(0, 20),
    task_template_ids: state.taskTemplates
      .filter(t => modIds.includes(t.module_id))
      .map(t => t.id)
      .slice(0, 20),
    task_instance_ids: (state.taskInstances.length > 0 ? state.taskInstances : data?.tasks ?? [])
      .filter(t => modIds.includes(t.module_id))
      .map(t => t.id)
      .slice(0, 20),
    series_ids: state.achievementSeries
      .filter(s => modIds.includes(s.module_id))
      .map(s => s.id)
      .slice(0, 20),
    profile_field_ids: (state.profile?.module_fields ?? [])
      .filter(f => modIds.includes(f.module_id))
      .map(f => f.id)
      .slice(0, 30),
    source_record_ids: (data?.records ?? [])
      .filter(r => r.status === 'confirmed' && !r.deleted_at && modIds.includes(r.module_id))
      .map(r => r.id)
      .slice(0, 30),
    timezone: tz
  };
}

export function renderPanelAiContextBar(
  panel: AiActionPanelScope,
  state: AppState,
  data: BootstrapData | null
): string {
  const meta = AI_ACTION_PROPOSAL_META[panel];
  const ctx = buildPanelAiContextEnvelope(panel, state, data);
  return `<div class="ld-ai-context-box" id="ld-ai-proposal-bar-${escapeHtml(panel)}" data-ai-action-proposal="${escapeHtml(panel)}" data-ai-schema="action-proposal/1.0" data-ai-enabled="false">
    <div style="display:flex;flex-direction:column;gap:4px;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <strong style="font-size:13px;">${escapeHtml(meta.title)}</strong>
        <span class="ld-badge ld-badge-warning" data-ai-status="FEATURE_DISABLED">FEATURE_DISABLED · v0.3 开放</span>
        <span class="ld-badge">intent: <code>${escapeHtml(meta.intent)}</code></span>
      </div>
      <div style="font-size:12px;color:var(--ld-text-secondary);">
        ${escapeHtml(meta.contextScopeNote)} · 允许候选动作：<code>${escapeHtml(meta.allowedActions.join(' / '))}</code>（绝不包含余额/奖励/直接解锁字段）
      </div>
      <div class="ld-card-meta" style="font-size:11px;">
        <span>限量授权白名单：模块(${ctx.module_ids.length}) · 模板(${ctx.record_type_ids.length}) · 指标(${ctx.metric_ids.length}) · 任务模板(${ctx.task_template_ids.length}) · 系列(${ctx.series_ids.length}) · 资料字段(${ctx.profile_field_ids.length})</span>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;">
      <button type="button" class="ld-btn ld-btn-sm" data-action="ai-proposal-preview-disabled" data-ai-panel="${escapeHtml(panel)}" disabled aria-disabled="true">
        生成候选预览（未开放）
      </button>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// G1: Periodic Tasks, Rules, Combination Filter & Reward Status
// ---------------------------------------------------------------------------

export function describePhase2Rule(data: BootstrapData | null, rule: TaskRule | null | undefined): string {
  if (!rule) return '无需关联记录，可随时手动确认完成';
  const tpl = data?.record_types.find(rt => rt.id === rule.record_type_id);
  const tplName = tpl ? `「${tpl.name}」` : '指定记录模板';
  const filterNote =
    'filters' in rule && rule.filters && rule.filters.length > 0
      ? `（含 ${rule.filters.length} 项字段过滤：${rule.filters.map(f => `${f.field_key} ${f.operator} ${String(f.value)}`).join(', ')}）`
      : '';

  if (rule.kind === 'linked_exists') {
    return `周期内至少关联 1 条已确认的${tplName}记录`;
  }
  if (rule.kind === 'linked_field_gte') {
    const field = tpl?.fields.find(f => f.key === rule.field_key);
    const fLabel = field ? `${field.label} (${field.key})` : rule.field_key;
    const unit = field?.unit ? ` ${field.unit}` : '';
    return `周期内显式关联的${tplName}记录中，单条「${fLabel}」≥ ${rule.threshold}${unit}`;
  }
  if (rule.kind === 'count') {
    return `周期内已确认的${tplName}记录累计次数 ≥ ${rule.threshold} 次${filterNote}`;
  }
  if (rule.kind === 'distinct_days') {
    return `周期内已确认的${tplName}记录按锁定时区去重自然日天数 ≥ ${rule.threshold} 天${filterNote}`;
  }
  if (rule.kind === 'sum') {
    const field = tpl?.fields.find(f => f.key === rule.field_key);
    const fLabel = field ? `${field.label} (${field.key})` : rule.field_key;
    return `周期内已确认的${tplName}记录「${fLabel}」累计求和 ≥ ${rule.threshold} ${rule.unit}${filterNote}`;
  }
  return '自定义验收规则';
}

export function renderTaskRewardPill(reward: RewardSummary | undefined, category?: TaskCategory): string {
  const catMeta = TASK_CATEGORY_META[category ?? 'main'] ?? TASK_CATEGORY_META.main;
  const r: RewardSummary = reward ?? {
    policy_version: 'reward-policy-v1',
    candidate_amount: String(catMeta.rewardAmount),
    net_amount: '0',
    eligibility: 'pending',
    quota_period: null,
    reversed: false
  };
  const eligMeta = REWARD_ELIGIBILITY_META[r.eligibility] ?? REWARD_ELIGIBILITY_META.pending;
  const badgeTone =
    r.reversed
      ? 'ld-badge-danger'
      : eligMeta.tone === 'success'
        ? 'ld-badge-success'
        : eligMeta.tone === 'warning'
          ? 'ld-badge-warning'
          : '';

  const stateLabel = r.reversed
    ? `已冲正（净得 ${r.net_amount} 代币 · 原资格保留）`
    : r.eligibility === 'eligible'
      ? `已入账 +${r.net_amount} 代币`
      : eligMeta.label;

  return `<div class="ld-reward-pill" data-task-reward-eligibility="${escapeHtml(r.eligibility)}" data-task-reward-reversed="${String(r.reversed)}" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;">
    <span class="ld-badge ${badgeTone}">🪙 候选 ${escapeHtml(r.candidate_amount)} 代币 · ${escapeHtml(stateLabel)}</span>
    ${
      r.policy_version
        ? `<span class="ld-badge" title="系统奖励策略版本（金额由服务端规则锁定，不可手改）">规则 <code>${escapeHtml(r.policy_version)}</code>${r.quota_period ? ` · 额度周期 <code>${escapeHtml(r.quota_period)}</code>` : ''}</span>`
        : ''
    }
  </div>`;
}

export function renderTasksCombinationFilterBar(state: AppState, data: BootstrapData): string {
  const tf = state.taskFilter;
  const activeModId = state.panels.tasks.moduleId ?? 'all';
  const modules = data.modules.filter(m =>
    state.showInactiveModulesInFilter ? true : m.status === 'enabled'
  );

  const allTasks = state.taskInstances.length > 0 ? state.taskInstances : data.tasks;
  const customColors = Array.from(
    new Set(
      allTasks
        .map(t => t.color)
        .filter((c): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
    )
  );

  return `<section class="ld-card" id="ld-tasks-filter-bar" data-tasks-filter="combination">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">组合筛选与周期物化</h3>
        <p class="ld-panel-subtitle">按任务类别（主线/每日/周常/月常）、模块、状态（含已结束 ended）、颜色与首页固定组合筛选（AND 逻辑）</p>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button type="button" class="ld-btn ld-btn-sm" id="ld-tasks-materialize-btn" data-action="task-materialize-current">
          ⚡ 物化当期周期实例
        </button>
        <button type="button" class="ld-btn ld-btn-sm" id="ld-tasks-filter-reset-btn" data-action="tasks-filter-reset">
          重置筛选
        </button>
      </div>
    </div>
    <div class="ld-form-row" style="grid-template-columns:repeat(auto-fit,minmax(155px,1fr));gap:10px;">
      <label class="ld-field">
        <span class="ld-label">任务类别 (category)</span>
        <select class="ld-select" id="ld-task-filter-category" data-action="task-filter-change" data-filter-key="category">
          <option value="all" ${tf.category === 'all' ? 'selected' : ''}>全部类别</option>
          <option value="main" ${tf.category === 'main' ? 'selected' : ''}>主线任务 (main · 100币/月1)</option>
          <option value="daily" ${tf.category === 'daily' ? 'selected' : ''}>每日委托 (daily · 10币/日3)</option>
          <option value="weekly" ${tf.category === 'weekly' ? 'selected' : ''}>周常委托 (weekly · 50币/周3)</option>
          <option value="monthly" ${tf.category === 'monthly' ? 'selected' : ''}>月常委托 (monthly · 200币/月2)</option>
        </select>
      </label>
      <label class="ld-field">
        <span class="ld-label">所属模块 (module)</span>
        <select class="ld-select" id="ld-task-filter-module" data-action="task-filter-change" data-filter-key="moduleId">
          <option value="all" ${activeModId === 'all' ? 'selected' : ''}>全部启用模块</option>
          ${modules
            .map(
              m =>
                `<option value="${escapeHtml(m.id)}" ${activeModId === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
            )
            .join('')}
        </select>
      </label>
      <label class="ld-field">
        <span class="ld-label">任务状态 (status)</span>
        <select class="ld-select" id="ld-task-filter-status" data-action="task-filter-change" data-filter-key="status">
          <option value="all" ${tf.status === 'all' ? 'selected' : ''}>全部状态</option>
          <option value="open" ${tf.status === 'open' ? 'selected' : ''}>待办与部分完成 (pending + partial)</option>
          <option value="pending" ${tf.status === 'pending' ? 'selected' : ''}>待开始 (pending)</option>
          <option value="partial" ${tf.status === 'partial' ? 'selected' : ''}>部分完成 (partial)</option>
          <option value="completed" ${tf.status === 'completed' ? 'selected' : ''}>已完成 (completed)</option>
          <option value="ended" ${tf.status === 'ended' ? 'selected' : ''}>已结束未完成 (ended)</option>
          <option value="needs_review" ${tf.status === 'needs_review' ? 'selected' : ''}>待复核 (needs_review)</option>
          <option value="cancelled" ${tf.status === 'cancelled' ? 'selected' : ''}>已取消 (cancelled)</option>
        </select>
      </label>
      <label class="ld-field">
        <span class="ld-label">颜色标签 (color)</span>
        <select class="ld-select" id="ld-task-filter-color" data-action="task-filter-change" data-filter-key="color">
          <option value="all" ${tf.color === 'all' ? 'selected' : ''}>全部颜色</option>
          ${Object.values(MODULE_COLORS)
            .map(
              c =>
                `<option value="${c.key}" ${tf.color === c.key ? 'selected' : ''}>${escapeHtml(c.label)} (${c.key})</option>`
            )
            .join('')}
          ${customColors
            .map(
              hex =>
                `<option value="${escapeHtml(hex)}" ${tf.color.toLowerCase() === hex.toLowerCase() ? 'selected' : ''}>自定义色值 (${escapeHtml(hex)})</option>`
            )
            .join('')}
        </select>
      </label>
      <label class="ld-field" style="justify-content:flex-end;">
        <span class="ld-label">首页固定筛选</span>
        <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:8px 0;">
          <input type="checkbox" id="ld-task-filter-pinned" data-action="task-filter-change" data-filter-key="pinnedOnly" ${tf.pinnedOnly ? 'checked' : ''} />
          <span>仅看已固定到首页的任务</span>
        </label>
      </label>
    </div>
  </section>`;
}

export function isTaskOrTemplatePinned(
  state: AppState,
  task: TaskRow
): { isPinned: boolean; pinKind: 'template' | 'instance'; pinId: string } {
  const prefs = state.homePreferences ?? state.home?.preferences;
  const typedPins = prefs?.task_pins ?? [];
  const legacyPins = prefs?.pinned_task_ids ?? [];
  const isPhase2Template = state.taskTemplates.some(tpl => tpl.id === task.template_id && tpl.phase2);

  if (isPhase2Template) {
    const pinnedTpl = typedPins.some(p => p.kind === 'template' && p.id === task.template_id);
    if (pinnedTpl) {
      return { isPinned: true, pinKind: 'template', pinId: task.template_id };
    }
  }
  const pinnedInst =
    typedPins.some(p => p.kind === 'instance' && p.id === task.id) ||
    legacyPins.includes(task.id);
  return {
    isPinned: pinnedInst,
    pinKind: isPhase2Template ? 'template' : 'instance',
    pinId: isPhase2Template ? task.template_id : task.id
  };
}

export function renderTaskTemplateSection(state: AppState, data: BootstrapData): string {
  const activeModId = state.panels.tasks.moduleId;
  const templates = state.taskTemplates.filter(tpl =>
    activeModId ? tpl.module_id === activeModId : true
  );
  const typedPins = state.homePreferences?.task_pins ?? state.home?.preferences?.task_pins ?? [];

  return `<section class="ld-card" id="ld-task-templates-section" data-section="task-templates">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">周期任务与主线模板 (${templates.length})</h3>
        <p class="ld-panel-subtitle">模板定义与当期实例快照分离：修改模板规则或时区仅自下一周期生效（<code>effective_at</code>），不会篡改已生成实例快照；固定周期模板到首页将在每个周期自动解析当期实例。</p>
      </div>
      <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" id="ld-open-create-task-template-btn" data-action="open-create-task-template">
        ＋ 新建周期/主线模板
      </button>
    </div>
    ${
      templates.length === 0
        ? `<div class="ld-card-meta">暂无二阶段周期任务模板。点击右上角「＋ 新建周期/主线模板」可创建主线任务、每日委托、周常委托或月常委托，创建时将在同一事务内自动物化当期实例。</div>`
        : `<div class="ld-card-grid">
            ${templates
              .map(tpl => {
                const mod = findModule(data, tpl.module_id);
                const def = tpl.definition;
                const catMeta = TASK_CATEGORY_META[def.category] ?? TASK_CATEGORY_META.main;
                const isPinned = typedPins.some(p => p.kind === 'template' && p.id === tpl.id);
                return `<article class="ld-card" data-task-template-card="${escapeHtml(tpl.id)}">
                  <div class="ld-card-top">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      ${renderModuleBadge(mod, true)}
                      <span class="ld-badge ld-badge-info">${escapeHtml(catMeta.shortLabel)}</span>
                      ${renderColorSwatchBadge(def.color)}
                      <span class="ld-badge ${tpl.status === 'enabled' ? 'ld-badge-success' : ''}">${tpl.status === 'enabled' ? '启用中' : '已归档'}</span>
                      <span class="ld-badge">模板 v${tpl.version}</span>
                    </div>
                  </div>
                  <div>
                    <h4 class="ld-card-title">${escapeHtml(def.title)}</h4>
                    <div class="ld-card-meta" style="margin-top:4px;flex-direction:column;align-items:flex-start;gap:2px;">
                      <span><strong>验收规则：</strong>${escapeHtml(describePhase2Rule(data, def.rule))}</span>
                      <span><strong>完成模式：</strong>${escapeHtml(COMPLETION_MODE_META[def.completion_mode]?.label ?? def.completion_mode)} · <strong>时区：</strong><code>${escapeHtml(tpl.schedule_timezone || def.timezone)}</code></span>
                      <span><strong>系统奖励规则：</strong>${catMeta.rewardAmount} 代币（${escapeHtml(catMeta.quotaWindow)} · 不可手动修改金额）</span>
                    </div>
                  </div>
                  ${
                    tpl.next_definition && tpl.effective_at
                      ? `<div class="ld-badge ld-badge-warning" style="align-self:flex-start;" data-template-pending-change="${escapeHtml(tpl.id)}">
                          ⏳ 待生效变更将于 ${escapeHtml(tpl.effective_at)}（当前周期结束后）对新实例生效：标题「${escapeHtml(tpl.next_definition.title)}」· 时区 ${escapeHtml(tpl.next_definition.timezone)}
                        </div>`
                      : ''
                  }
                  <div class="ld-card-footer">
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <button type="button" class="ld-btn ld-btn-sm" data-action="open-edit-task-template" data-template-id="${escapeHtml(tpl.id)}">
                        ${def.category === 'main' ? '归档主线模板' : '编辑未来周期规则'}
                      </button>
                      ${
                        tpl.current_instance_id
                          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="open-task-detail" data-task-id="${escapeHtml(tpl.current_instance_id)}">查看当期实例</button>`
                          : ''
                      }
                    </div>
                    <button type="button" class="ld-btn ld-btn-sm" data-action="task-toggle-typed-pin" data-pin-kind="template" data-pin-id="${escapeHtml(tpl.id)}">
                      ${isPinned ? '📌 取消固定模板' : '📌 固定模板到首页'}
                    </button>
                  </div>
                </article>`;
              })
              .join('')}
          </div>`
    }
  </section>`;
}

// ---------------------------------------------------------------------------
// G1: Achievement Series & Multi-Milestones
// ---------------------------------------------------------------------------

export function computeFallbackAchievementSummary(
  state: AppState,
  data: BootstrapData
): AchievementSummaryData {
  if (state.achievementSummary) return state.achievementSummary;
  const enabledModIds = new Set(
    data.modules.filter(m => m.status === 'enabled').map(m => m.id)
  );
  const activeDefs = new Set(
    data.achievement_definitions
      .filter(d => enabledModIds.has(d.module_id))
      .map(d => d.id)
  );
  const legacyUnlocked = data.achievement_awards.filter(
    a => activeDefs.has(a.achievement_id) && a.state === 'unlocked'
  ).length;
  const legacyReview = data.achievement_awards.filter(
    a => activeDefs.has(a.achievement_id) && a.state === 'needs_review'
  ).length;

  let seriesUnlockedAwards = 0;
  let seriesReviewAwards = 0;
  let achievedSeries = 0;
  for (const s of state.achievementSeries) {
    if (!enabledModIds.has(s.module_id)) continue;
    let hasUnlockedInSeries = false;
    for (const m of s.milestones) {
      if (m.award?.state === 'unlocked') {
        seriesUnlockedAwards += 1;
        hasUnlockedInSeries = true;
      } else if (m.award?.state === 'needs_review') {
        seriesReviewAwards += 1;
      }
    }
    if (hasUnlockedInSeries) achievedSeries += 1;
  }

  return {
    effective_awards_count: legacyUnlocked + seriesUnlockedAwards,
    achieved_series_count: achievedSeries,
    needs_review_count: legacyReview + seriesReviewAwards,
    legacy_effective_awards_count: legacyUnlocked
  };
}

export function renderAchievementSummaryBar(state: AppState, data: BootstrapData): string {
  const summary = computeFallbackAchievementSummary(state, data);
  return `<section class="ld-card" id="ld-achievement-summary-bar" data-achievement-summary="true">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">成就与里程碑统计总览</h3>
        <p class="ld-panel-subtitle">严格分离「有效授予总数（含同系列多门槛多次授予）」、「已达成系列数」与「待复核数」；1/3/10 天系列达到 10 天时计为 3 次有效授予、1 个已达成系列。</p>
      </div>
      <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" id="ld-open-create-series-btn" data-action="open-create-achievement-series">
        ＋ 新建多门槛成就系列
      </button>
    </div>
    <div class="ld-wallet-summary-grid">
      <div class="ld-wallet-stat-box" data-summary-stat="effective_awards_count">
        <span class="ld-card-meta">有效授予总数 (effective_awards_count)</span>
        <span class="ld-wallet-stat-val">${summary.effective_awards_count}</span>
        <span class="ld-card-meta">含系列里程碑授予 + 历史有效授予 (${summary.legacy_effective_awards_count})</span>
      </div>
      <div class="ld-wallet-stat-box" data-summary-stat="achieved_series_count">
        <span class="ld-card-meta">已达成系列数 (achieved_series_count)</span>
        <span class="ld-wallet-stat-val">${summary.achieved_series_count}</span>
        <span class="ld-card-meta">至少有 1 个里程碑处于有效 unlocked 状态的系列</span>
      </div>
      <div class="ld-wallet-stat-box" data-summary-stat="needs_review_count">
        <span class="ld-card-meta">待复核授予数 (needs_review_count)</span>
        <span class="ld-wallet-stat-val" style="color:${summary.needs_review_count > 0 ? 'var(--ld-warning)' : 'var(--ld-text-primary)'};">${summary.needs_review_count}</span>
        <span class="ld-card-meta">因来源记录修改/删除跌破门槛，保留原授予 ID 待复核</span>
      </div>
    </div>
  </section>`;
}

export function renderAchievementSeriesList(state: AppState, data: BootstrapData): string {
  const activeModId = state.panels.achievements.moduleId;
  const subTab = state.panels.achievements.subTab;
  const enabledModIds = new Set(
    data.modules.filter(m => m.status === 'enabled').map(m => m.id)
  );

  const seriesList = state.achievementSeries.filter(s => {
    if (!state.showInactiveModulesInFilter && !enabledModIds.has(s.module_id)) return false;
    if (activeModId && s.module_id !== activeModId) return false;
    if (subTab === 'unlocked') return s.milestones.some(m => m.award?.state === 'unlocked');
    if (subTab === 'needs_review') return s.milestones.some(m => m.award?.state === 'needs_review');
    if (subTab === 'locked') return s.milestones.every(m => !m.award);
    return true;
  });

  if (seriesList.length === 0) {
    return `<section class="ld-card" id="ld-achievement-series-section">
      <div class="ld-card-top">
        <h3 class="ld-card-title">多门槛成就系列 (0)</h3>
      </div>
      <div class="ld-card-meta">当前筛选下暂无多门槛成就系列。点击上方「＋ 新建多门槛成就系列」可创建如 1 / 3 / 10 天连续运动或累计时长系列。</div>
    </section>`;
  }

  return `<section class="ld-card" id="ld-achievement-series-section">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">多门槛成就系列 (${seriesList.length})</h3>
        <p class="ld-panel-subtitle">展示系列内全部升序里程碑门槛、真实累计进度（count / distinct_days / sum）与解锁证据；不发放额外成就代币</p>
      </div>
    </div>
    <div class="ld-card-list">
      ${seriesList
        .map(s => {
          const mod = findModule(data, s.module_id);
          const tpl = data.record_types.find(rt => rt.id === s.record_type_id);
          const unlockedCount = s.milestones.filter(m => m.award?.state === 'unlocked').length;
          const reviewCount = s.milestones.filter(m => m.award?.state === 'needs_review').length;
          const aggLabel =
            s.definition.aggregation === 'distinct_days'
              ? '不同自然日天数 (distinct_days)'
              : s.definition.aggregation === 'count'
                ? '记录总次数 (count)'
                : `数值字段求和 (sum · ${s.definition.field_key ?? ''})`;

          return `<article class="ld-card" data-achievement-series-card="${escapeHtml(s.id)}">
            <div class="ld-card-top">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                ${renderModuleBadge(mod)}
                <span class="ld-badge ld-badge-info">${escapeHtml(aggLabel)}</span>
                <span class="ld-badge">有效里程碑 ${unlockedCount} / ${s.milestones.length}</span>
                ${reviewCount > 0 ? `<span class="ld-badge ld-badge-warning">⚠ 待复核 ${reviewCount}</span>` : ''}
              </div>
              <span class="ld-card-meta">模板：${escapeHtml(tpl?.name ?? s.record_type_id)} · 时区 <code>${escapeHtml(s.definition.timezone)}</code></span>
            </div>
            <div>
              <h4 class="ld-card-title">${escapeHtml(s.definition.name)}</h4>
              <div class="ld-card-meta" style="margin-top:4px;">
                <span>当前真实累计进度：<strong>${escapeHtml(s.progress.value)} ${escapeHtml(s.definition.unit)}</strong></span>
                <span>· 来源记录：<strong>${s.progress.source_record_ids.length} 条</strong></span>
                <span>· 覆盖不同自然日：<strong>${s.progress.distinct_dates.length} 天</strong></span>
              </div>
            </div>
            <div class="ld-series-milestone-track">
              ${s.milestones
                .map(m => {
                  const aw = m.award;
                  const stateCls =
                    aw?.state === 'unlocked'
                      ? 'is-unlocked'
                      : aw?.state === 'needs_review'
                        ? 'is-needs-review'
                        : '';
                  const badgeHtml =
                    aw?.state === 'unlocked'
                      ? `<span class="ld-badge ld-badge-success">🏆 已解锁 (v${aw.version})</span>`
                      : aw?.state === 'needs_review'
                        ? `<span class="ld-badge ld-badge-warning">⚠ 待复核 (v${aw.version})</span>`
                        : `<span class="ld-badge">🔒 未解锁</span>`;
                  return `<div class="ld-milestone-node ${stateCls}" data-milestone-id="${escapeHtml(m.id)}" data-milestone-threshold="${escapeHtml(m.threshold)}" data-milestone-state="${escapeHtml(aw?.state ?? 'locked')}">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:4px;">
                      <strong>≥ ${escapeHtml(m.threshold)} ${escapeHtml(s.definition.unit)}</strong>
                      ${badgeHtml}
                    </div>
                    ${m.label ? `<div style="font-size:12px;color:var(--ld-text-secondary);">${escapeHtml(m.label)}</div>` : ''}
                    ${
                      aw
                        ? `<div style="font-size:11px;color:var(--ld-text-muted);">
                            <div>授予 ID: <code>${escapeHtml(aw.id.slice(0, 8))}…</code></div>
                            <div>当前值: ${escapeHtml(String(aw.evidence.value ?? '0'))} / 原解锁值: ${escapeHtml(String(aw.original_evidence.value ?? '0'))}</div>
                          </div>`
                        : `<div style="font-size:11px;color:var(--ld-text-muted);">当前进度 ${escapeHtml(s.progress.value)} / ${escapeHtml(m.threshold)}</div>`
                    }
                  </div>`;
                })
                .join('')}
            </div>
            <div class="ld-card-footer">
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="ld-btn ld-btn-sm" data-action="series-view-sources" data-series-id="${escapeHtml(s.id)}">
                  查看依据记录 (${s.progress.source_record_ids.length})
                </button>
                <button type="button" class="ld-btn ld-btn-sm" data-action="open-series-detail" data-series-id="${escapeHtml(s.id)}">
                  系列与里程碑详情
                </button>
              </div>
              <span class="ld-card-meta">历史策略：<code>${escapeHtml(s.definition.history_policy ?? 'include_existing')}</code></span>
            </div>
          </article>`;
        })
        .join('')}
    </div>
  </section>`;
}

// ---------------------------------------------------------------------------
// G2: Metric Trend SVG Line Chart, Interactive Points & View Filters
// ---------------------------------------------------------------------------

export function buildLocalFallbackTrend(
  metricId: string,
  state: AppState,
  data: BootstrapData | null,
  ctrl: TrendControlState
): MetricTrendData | null {
  const metric = data?.metrics.find(m => m.id === metricId);
  if (!metric) return null;
  const cached = state.metricTrends[metricId];
  if (cached && cached.range===ctrl.range && cached.grain===ctrl.grain && cached.precision===ctrl.precision) {
    return cached;
  }
  return null;
}

export function renderTrendSvgChart(
  trend: MetricTrendData,
  selectedPointKey: string | null = null
): string {
  const buckets = trend.buckets;
  const width = 640;
  const height = 180;
  const padLeft = 44;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 32;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const numericValues = buckets
    .map(b => (b.value !== null && b.value !== undefined ? Number(b.value) : null))
    .filter((v): v is number => v !== null && Number.isFinite(v));

  const minVal = numericValues.length > 0 ? Math.min(0, ...numericValues) : 0;
  const maxVal = numericValues.length > 0 ? Math.max(1, ...numericValues) : 10;
  const span = maxVal - minVal === 0 ? 1 : maxVal - minVal;

  const xOf = (idx: number) =>
    buckets.length <= 1
      ? padLeft + plotW / 2
      : padLeft + (idx / (buckets.length - 1)) * plotW;
  const yOf = (val: number) => padTop + plotH - ((val - minVal) / span) * plotH;

  // Build disconnected polyline segments: null breaks the segment, 0 stays connected!
  const segments: string[][] = [];
  let currentSeg: string[] = [];
  buckets.forEach((b, idx) => {
    if (b.value === null || b.value === undefined) {
      if (currentSeg.length > 0) {
        segments.push(currentSeg);
        currentSeg = [];
      }
    } else {
      const n = Number(b.value);
      if (Number.isFinite(n)) {
        currentSeg.push(`${xOf(idx).toFixed(1)},${yOf(n).toFixed(1)}`);
      }
    }
  });
  if (currentSeg.length > 0) segments.push(currentSeg);

  const polylinesSvg = segments
    .filter(seg => seg.length >= 2)
    .map(
      seg =>
        `<polyline fill="none" stroke="var(--ld-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${seg.join(' ')}" data-trend-segment="true" />`
    )
    .join('');

  const pointsSvg = buckets
    .map((b, idx) => {
      const cx = xOf(idx).toFixed(1);
      const key = `${b.start_date}..${b.end_date}`;
      const isSelected = selectedPointKey === key || (!selectedPointKey && idx === buckets.length - 1);
      if (b.value === null || b.value === undefined) {
        const cy = (padTop + plotH / 2).toFixed(1);
        return `<g class="ld-trend-point is-null" tabindex="0" role="button" aria-label="${escapeHtml(b.start_date)} 至 ${escapeHtml(b.end_date)}: 暂无数据 (null)" data-action="trend-select-point" data-metric-id="${escapeHtml(trend.metric_id)}" data-point-key="${escapeHtml(key)}" data-point-null="true">
          <circle cx="${cx}" cy="${cy}" r="${isSelected ? '5.5' : '4'}" fill="var(--ld-bg-card)" stroke="var(--ld-text-muted)" stroke-dasharray="2,2" stroke-width="1.5" />
        </g>`;
      }
      const n = Number(b.value);
      const cy = yOf(Number.isFinite(n) ? n : 0).toFixed(1);
      return `<g class="ld-trend-point" tabindex="0" role="button" aria-label="${escapeHtml(b.start_date)} 至 ${escapeHtml(b.end_date)}: 显示值 ${escapeHtml(String(b.display_value))} ${escapeHtml(trend.unit)}（未舍入原值 ${escapeHtml(String(b.value))}）" data-action="trend-select-point" data-metric-id="${escapeHtml(trend.metric_id)}" data-point-key="${escapeHtml(key)}" data-point-value="${escapeHtml(String(b.value))}" data-point-display="${escapeHtml(String(b.display_value))}">
        <circle cx="${cx}" cy="${cy}" r="${isSelected ? '6.5' : '4.5'}" fill="${b.incomplete ? 'var(--ld-warning)' : 'var(--ld-accent)'}" stroke="var(--ld-bg-card)" stroke-width="2" />
      </g>`;
    })
    .join('');

  const selectedBucket =
    buckets.find(b => `${b.start_date}..${b.end_date}` === selectedPointKey) ??
    buckets[buckets.length - 1];

  const tooltipHtml = selectedBucket
    ? `<div class="ld-trend-tooltip" data-trend-point-detail="${escapeHtml(`${selectedBucket.start_date}..${selectedBucket.end_date}`)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div>
            <strong>时间桶范围：<code>${escapeHtml(selectedBucket.start_date)}</code> ~ <code>${escapeHtml(selectedBucket.end_date)}</code></strong>
            ${selectedBucket.incomplete ? '<span class="ld-badge ld-badge-warning" style="margin-left:6px;">当前未完整末桶 (incomplete)</span>' : ''}
          </div>
          <span class="ld-badge">有效天数 ${selectedBucket.valid_days} / 应有天数 ${selectedBucket.expected_days}</span>
        </div>
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <span>显示值 (ROUND_HALF_UP, 精度 ${trend.precision} 位)：<strong data-bucket-display-value="${escapeHtml(String(selectedBucket.display_value ?? 'null'))}">${selectedBucket.display_value !== null ? `${escapeHtml(selectedBucket.display_value)} ${escapeHtml(trend.unit)}` : '暂无数据 (null)'}</strong></span>
          <span>未舍入精确日均原值 (Decimal)：<code data-bucket-raw-value="${escapeHtml(String(selectedBucket.value ?? 'null'))}">${escapeHtml(String(selectedBucket.value ?? 'null'))}</code></span>
          ${
            selectedBucket.excluded_dates.length > 0
              ? `<span>已排除日期：<code>${escapeHtml(selectedBucket.excluded_dates.join(', '))}</code></span>`
              : ''
          }
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <span style="color:var(--ld-text-muted);">来源记录数：${selectedBucket.source_record_ids.length} 条</span>
          <button type="button" class="ld-btn ld-btn-sm" data-point-key="${escapeHtml(`${selectedBucket.start_date}..${selectedBucket.end_date}`)}" data-action="trend-bucket-sources" data-metric-id="${escapeHtml(trend.metric_id)}" data-source-ids="${escapeHtml(selectedBucket.source_record_ids.join(','))}">
            查看该桶来源记录 (${selectedBucket.source_record_ids.length})
          </button>
        </div>
      </div>`
    : '';

  return `<div class="ld-trend-chart-wrap" data-trend-chart="${escapeHtml(trend.metric_id)}" data-trend-range="${escapeHtml(trend.range)}" data-trend-grain="${escapeHtml(trend.grain)}">
    <svg class="ld-trend-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="数值趋势折线图 (${escapeHtml(trend.start_date)} 至 ${escapeHtml(trend.end_date)})">
      <line x1="${padLeft}" y1="${padTop}" x2="${padLeft}" y2="${padTop + plotH}" stroke="var(--ld-border-strong)" stroke-width="1" />
      <line x1="${padLeft}" y1="${padTop + plotH}" x2="${padLeft + plotW}" y2="${padTop + plotH}" stroke="var(--ld-border-strong)" stroke-width="1" />
      <text x="${padLeft - 6}" y="${padTop + 10}" text-anchor="end" fill="var(--ld-text-muted)" font-size="10">${escapeHtml(String(maxVal))}</text>
      <text x="${padLeft - 6}" y="${padTop + plotH}" text-anchor="end" fill="var(--ld-text-muted)" font-size="10">${escapeHtml(String(minVal))}</text>
      <text x="${padLeft}" y="${height - 8}" text-anchor="start" fill="var(--ld-text-muted)" font-size="10">${escapeHtml(trend.start_date)}</text>
      <text x="${padLeft + plotW}" y="${height - 8}" text-anchor="end" fill="var(--ld-text-muted)" font-size="10">${escapeHtml(trend.end_date)}</text>
      ${polylinesSvg}
      ${pointsSvg}
    </svg>
    ${tooltipHtml}
  </div>`;
}

export function renderMetricTrendSection(
  metricId: string,
  state: AppState,
  data: BootstrapData | null,
  options: { compactForHome?: boolean; explicitTrend?: MetricTrendData } = {}
): string {
  const metric = data?.metrics.find(m => m.id === metricId);
  const defaultPrec = metric?.definition.display_precision ?? 0;
  const ctrl = state.metricTrendControls[metricId] ?? createInitialTrendControlState(defaultPrec);
  const trend = options.explicitTrend ?? buildLocalFallbackTrend(metricId, state, data, ctrl);
  if(!trend)return `<div class="ld-card-meta" role="status" data-trend-unavailable="${escapeHtml(metricId)}">${escapeHtml(state.metricTrendErrors?.[metricId]??'趋势数据尚未加载')} <button class="ld-btn" data-action="trend-retry" data-metric-id="${escapeHtml(metricId)}">重新读取趋势</button></div>`;

  const validGrains = getValidGrainsForRange(trend.range);
  const pinnedTrends = state.homePreferences?.pinned_trends ?? state.home?.preferences?.pinned_trends ?? [];
  const isPinned = pinnedTrends.some((p: TrendPin) => p.metric_id === metricId);
  const fbReason = trend.exclusions.fallback_reason;
  const fbMeta = fbReason ? TREND_FALLBACK_META[fbReason] : null;

  if (options.compactForHome) {
    return `<article class="ld-card" data-home-trend-card="${escapeHtml(metricId)}">
      <div class="ld-card-top">
        <div>
          <h4 class="ld-card-title">${escapeHtml(metric?.definition.name ?? '固定趋势图')} · ${escapeHtml(TREND_RANGE_META[trend.range]?.shortLabel ?? trend.range)} (${escapeHtml(trend.grain)})</h4>
          <p class="ld-panel-subtitle">覆盖率：有效 ${trend.coverage.valid_days} / 应有 ${trend.coverage.expected_days} 天（纳入计算 ${trend.coverage.included_days} 天）· 单位：${escapeHtml(trend.unit)}</p>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="ld-btn ld-btn-sm" data-action="home-metric-detail" data-metric-id="${escapeHtml(metricId)}">查看趋势详情</button>
          <button type="button" class="ld-btn ld-btn-sm" data-action="trend-toggle-pin" data-metric-id="${escapeHtml(metricId)}">取消固定趋势</button>
        </div>
      </div>
      ${renderTrendSvgChart(trend, ctrl.selectedPointKey)}
    </article>`;
  }

  return `<div class="ld-form-grid" id="ld-metric-trend-panel-${escapeHtml(metricId)}" data-metric-trend-panel="${escapeHtml(metricId)}" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--ld-border);">
    <div class="ld-trend-controls">
      <label class="ld-field">显示小数位<select class="ld-select" data-action="trend-set-precision" data-metric-id="${escapeHtml(metricId)}">${[0,1,2,3,4,5,6].map(n=>`<option value="${n}" ${ctrl.precision===n?'selected':''}>${n} 位</option>`).join('')}</select></label>
      <label class="ld-field">方差贡献阈值<select class="ld-select" data-action="trend-set-variance-pct" data-metric-id="${escapeHtml(metricId)}">${[0.1,0.25,0.5,0.75,1].map(n=>`<option value="${n}" ${ctrl.varianceThreshold===n?'selected':''}>${n*100}%</option>`).join('')}</select></label>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;">时间范围：</span>
        ${(['last_7_days', 'month', 'quarter', 'year'] as const)
          .map(
            r =>
              `<button type="button" class="ld-btn ld-btn-sm ${trend.range === r ? 'ld-btn-primary' : ''}" data-action="trend-set-range" data-metric-id="${escapeHtml(metricId)}" data-range="${r}">${escapeHtml(TREND_RANGE_META[r].shortLabel)}</button>`
          )
          .join('')}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="font-size:12px;font-weight:600;">粒度 (grain)：</span>
        ${validGrains
          .map(
            g =>
              `<button type="button" class="ld-btn ld-btn-sm ${trend.grain === g ? 'ld-btn-primary' : ''}" data-action="trend-set-grain" data-metric-id="${escapeHtml(metricId)}" data-grain="${g}">${escapeHtml(g)}</button>`
          )
          .join('')}
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <button type="button" class="ld-btn ld-btn-sm ${trend.view_filter.variance_enabled ? 'ld-btn-primary' : ''}" data-action="trend-toggle-variance" data-metric-id="${escapeHtml(metricId)}">
          ${trend.view_filter.variance_enabled ? '✓ 方差异常筛选已开' : '开启方差异常筛选'}
        </button>
        <button type="button" class="ld-btn ld-btn-sm ${trend.view_filter.include_all ? 'ld-btn-primary' : ''}" data-action="trend-toggle-include-all" data-metric-id="${escapeHtml(metricId)}">
          ${trend.view_filter.include_all ? '✓ 原始全点显示中' : '切换原始全点'}
        </button>
        <button type="button" class="ld-btn ld-btn-sm" data-action="trend-toggle-pin" data-metric-id="${escapeHtml(metricId)}">
          ${isPinned ? '📌 取消固定趋势' : '📌 固定趋势到首页'}
        </button>
      </div>
    </div>

    <div class="ld-card-meta" style="justify-content:space-between;flex-wrap:wrap;">
      <span>区间：<code>${escapeHtml(trend.start_date)}</code> ~ <code>${escapeHtml(trend.end_date)}</code> (${escapeHtml(trend.timezone)}) · 有效日 ${trend.coverage.valid_days}/${trend.coverage.expected_days} · 纳入桶平均 ${trend.coverage.included_days} 日</span>
      <span>缺失日期断线显示（绝不补 0），真实 0 值保留为 0；筛选仅作用于当前视图，不删除底层记录或影响任务/成就。</span>
    </div>

    ${
      fbMeta
        ? `<div class="ld-badge ld-badge-warning" data-trend-fallback="${escapeHtml(fbReason!)}" style="padding:8px 12px;align-self:flex-start;">
            <strong>⚠ ${escapeHtml(fbMeta.label)}：</strong>${escapeHtml(fbMeta.description)}
          </div>`
        : ''
    }

    ${renderTrendSvgChart(trend, ctrl.selectedPointKey)}

    <details style="font-size:12px;">
      <summary style="cursor:pointer;color:var(--ld-text-secondary);">
        每日原始点位与手工/方差排除管理（共 ${trend.daily_values.length} 天，已应用排除 ${trend.exclusions.applied_dates.length} 天）
      </summary>
      <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;">
        ${trend.daily_values
          .map(d => {
            const isManual = trend.exclusions.manual_dates.includes(d.date);
            const isAuto = trend.exclusions.automatic_dates.includes(d.date);
            const valLabel = d.value === null ? 'null (无记录)' : `${d.display_value} (原:${d.value})`;
            return `<button type="button" class="ld-btn ld-btn-sm ${d.excluded ? 'ld-btn-danger' : ''}" data-action="trend-toggle-exclude-date" data-metric-id="${escapeHtml(metricId)}" data-date="${escapeHtml(d.date)}" title="点击排除或恢复该自然日（仅视图级筛选）">
              <span>${escapeHtml(d.date)}: ${escapeHtml(valLabel)}</span>
              ${isManual ? '<span class="ld-badge">手工排除</span>' : ''}
              ${isAuto ? '<span class="ld-badge">高方差</span>' : ''}
            </button>`;
          })
          .join('')}
      </div>
    </details>
  </div>`;
}

// ---------------------------------------------------------------------------
// G3: Read-Only Token Wallet & Append-Only Ledger
// ---------------------------------------------------------------------------

export function renderWalletSummaryCard(state: AppState, compact = false): string {
  const wallet=state.wallet??state.home?.wallet;
  if(!wallet)return '<section class="ld-card" role="status">钱包数据尚未读取，不能确认余额。<button class="ld-btn" data-action="retry-phase2">重新读取</button></section>';

  return `<section class="ld-card" id="${compact ? 'ld-home-wallet-card' : 'ld-settings-wallet-card'}" data-wallet-card="readonly" data-wallet-balance="${escapeHtml(wallet.balance)}" data-wallet-effective-earned="${escapeHtml(wallet.effective_earned)}">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">🪙 系统代币钱包（只读账本）</h3>
        <p class="ld-panel-subtitle">策略版本 <code>${escapeHtml(wallet.policy_version)}</code> · 奖励日历时区 <code>${escapeHtml(wallet.quota_timezone)}</code> · 账本版本 v${wallet.version}</p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <span class="ld-badge ld-badge-info">append-only 不可篡改账本</span>
        <span class="ld-badge">不支持充值 / 手改余额 / 商城兑换</span>
      </div>
    </div>
    <div class="ld-wallet-summary-grid">
      <div class="ld-wallet-stat-box">
        <span class="ld-card-meta">当前净余额 (balance)</span>
        <span class="ld-wallet-stat-val" data-wallet-field="balance">${escapeHtml(wallet.balance)} <small style="font-size:12px;">TOKEN</small></span>
        <span class="ld-card-meta">全部发放、失效冲正与恢复流水的精确净额</span>
      </div>
      <div class="ld-wallet-stat-box">
        <span class="ld-card-meta">累计有效获得 (effective_earned)</span>
        <span class="ld-wallet-stat-val" data-wallet-field="effective_earned">${escapeHtml(wallet.effective_earned)} <small style="font-size:12px;">TOKEN</small></span>
        <span class="ld-card-meta">恢复流水 (reinstatement) 沿用原资格，不重复虚增收益</span>
      </div>
    </div>
    <div class="ld-card-meta" style="margin-top:4px;">
      <span>系统冻结定额：主线 100/月1 · 每日 10/日3 · 周常 50/周3 · 月常 200/月2 · 首次补录窗口：周期结束后 7 天内（含截止点）。</span>
    </div>
    <div class="ld-card-footer">
      <span class="ld-card-meta">v0.1 历史完成任务不自动补发代币</span>
      <button type="button" class="ld-btn ld-btn-sm" data-action="open-wallet-ledger">
        查看钱包流水明细 (${state.walletLedgerTotal || state.walletLedger.length})
      </button>
    </div>
  </section>`;
}

export function renderWalletLedgerSection(state: AppState, data: BootstrapData | null): string {
  const entries = state.walletLedger;
  const tasks = state.taskInstances.length > 0 ? state.taskInstances : data?.tasks ?? [];

  const kindLabel: Record<WalletLedgerEntry['kind'], { label: string; cls: string }> = {
    grant: { label: '首次有效发放 (grant)', cls: 'ld-badge-success' },
    reversal: { label: '撤回/证据失效冲正 (reversal)', cls: 'ld-badge-danger' },
    reinstatement: { label: '恢复原奖励资格 (reinstatement)', cls: 'ld-badge-info' }
  };

  return `<section class="ld-card" id="ld-wallet-ledger-section" data-wallet-ledger="readonly">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">代币账本流水明细 (${state.walletLedgerTotal || entries.length})</h3>
        <p class="ld-panel-subtitle">每一笔发放、冲正、恢复均绑定任务资格与 root/previous 流水链，点击可跳回来源任务实例</p>
      </div>
      ${
        state.walletLedgerTaskFilter
          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="wallet-clear-task-filter">清除任务筛选 (${escapeHtml(state.walletLedgerTaskFilter.slice(0, 8))}…)</button>`
          : ''
      }
    </div>
    <div class="ld-card-meta">第 ${Math.floor((state.walletLedgerOffset??0)/50)+1} 页 · 共 ${state.walletLedgerTotal} 笔 <button class="ld-btn" data-action="wallet-page" data-delta="-50" ${(state.walletLedgerOffset??0)===0?'disabled':''}>上一页</button><button class="ld-btn" data-action="wallet-page" data-delta="50" ${(state.walletLedgerOffset??0)+entries.length>=state.walletLedgerTotal?'disabled':''}>下一页</button></div>
    ${
      entries.length === 0
        ? `<div class="ld-card-meta">当前暂无代币账本流水。完成二阶段主线或周期委托任务后，系统将按额度自动发放并记录流水。</div>`
        : `<div class="ld-card-list">
            ${entries
              .map(entry => {
                const task = tasks.find(t => t.id === entry.task_id);
                const kMeta = kindLabel[entry.kind] ?? { label: entry.kind, cls: '' };
                return `<article class="ld-card" data-ledger-entry="${escapeHtml(entry.id)}" data-ledger-kind="${escapeHtml(entry.kind)}" style="padding:10px 14px;">
                  <div class="ld-card-top">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      <span class="ld-badge ${kMeta.cls}">${escapeHtml(kMeta.label)}</span>
                      <strong style="font-size:15px;">${Number(entry.amount) > 0 ? `+${escapeHtml(entry.amount)}` : escapeHtml(entry.amount)} TOKEN</strong>
                      <span class="ld-badge">序号 #${entry.ordinal}</span>
                      <span class="ld-badge">策略 <code>${escapeHtml(entry.policy_version)}</code></span>
                    </div>
                    <span class="ld-card-meta">${escapeHtml(entry.created_at)}</span>
                  </div>
                  <div class="ld-card-meta" style="justify-content:space-between;flex-wrap:wrap;">
                    <div>
                      <span>来源任务：<strong>${escapeHtml(task?.definition.title ?? entry.task_id)}</strong></span>
                      <span> · 原因：<code>${escapeHtml(entry.reason)}</code></span>
                      <span> · 根流水：<code>${escapeHtml(entry.root_entry_id.slice(0, 8))}…</code>${entry.previous_entry_id ? ` · 前序：<code>${escapeHtml(entry.previous_entry_id.slice(0, 8))}…</code>` : ''}</span>
                    </div>
                    <button type="button" class="ld-btn ld-btn-sm" data-action="wallet-go-task" data-task-id="${escapeHtml(entry.task_id)}">
                      跳回来源任务 →
                    </button>
                  </div>
                </article>`;
              })
              .join('')}
          </div>`
    }
  </section>`;
}
