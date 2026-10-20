import {
  COMPLETION_MODE_META,
  escapeHtml,
  FIELD_TYPE_META,
  METRIC_AGGREGATION_META,
  METRIC_WINDOW_META,
  renderEmptyState,
  renderErrorBanner,
  renderModuleBadge,
  renderStaticAvatarSlot,
  SUBMISSION_STATE_META,
  TASK_CATEGORY_META,
  TASK_STATUS_META
} from '../../../packages/ui/src/index.js';
import {
  isTaskOrTemplatePinned,
  renderColorSwatchBadge,
  renderMetricTrendSection,
  renderPanelAiContextBar,
  renderTaskRewardPill,
  renderWalletSummaryCard
} from './phase2-views.js';
import type { AppState } from './state.js';
import {
  buildConfigDraftKey,
  getPendingConfigMutation,
  getStorageIssue,
  loadAiDraft
} from './storage.js';
import type {
  AiDraftScope,
  BootstrapData,
  HomeAchievementRow,
  HomeData,
  HomePreferencesData,
  HomeWarning,
  MetricRow,
  ModuleRow,
  ProfileData,
  TaskRow
} from './types.js';

function findModule(data: BootstrapData | null, id: string): ModuleRow | undefined {
  return data?.modules.find(m => m.id === id);
}

export function formatHomeTime(iso: string | null | undefined): string {
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

export function getTodayInZone(timezone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback to local date
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function buildFallbackHomeFromBootstrap(
  state: AppState,
  data: BootstrapData | null
): HomeData {
  const userId = state.user?.id ?? 'user-1';
  const profile: ProfileData = state.profile ?? {
    id: userId,
    version: 1,
    nickname: state.user?.name ?? '本地用户',
    bio: null,
    timezone: state.user?.timezone ?? 'Asia/Shanghai',
    static_avatar_ref: null,
    module_fields: []
  };
  const preferences: HomePreferencesData = state.homePreferences ?? {
    id: userId,
    version: 1,
    minimal_mode: false,
    pinned_metric_ids: [],
    pinned_task_ids: [],
    pinned_trends: []
  };

  if (!data) {
    return {
      cursor: 0,
      profile,
      preferences,
      metrics: [],
      tasks: [],
      recent_achievements: [],
      warnings: [],
      wallet: null,
      avatar: { enabled: false, model_asset_ref: null }
    };
  }

  const enabledModIds = new Set(
    data.modules.filter(m => m.status === 'enabled').map(m => m.id)
  );
  const availableMetrics = data.metrics.filter(m => enabledModIds.has(m.module_id));
  const pinOrder = <T extends { id: string }>(rows: T[], ids: string[]): T[] => [
    ...ids.map(id => rows.find(r => r.id === id)).filter((x): x is T => Boolean(x)),
    ...rows.filter(r => !ids.includes(r.id))
  ];
  const metrics = pinOrder(availableMetrics, preferences.pinned_metric_ids);

  const openTasks = data.tasks.filter(
    t =>
      enabledModIds.has(t.module_id) &&
      t.status !== 'cancelled' &&
      t.status !== 'skipped'
  );
  const today = getTodayInZone(profile.timezone);
  const eligibleTasks = openTasks.filter(
    t =>
      preferences.pinned_task_ids.includes(t.id) ||
      t.definition.business_date === today
  );
  const tasks = pinOrder(eligibleTasks, preferences.pinned_task_ids);

  const recent_achievements: HomeAchievementRow[] = [];
  const sortedAwards = [...data.achievement_awards]
    .filter(a => a.state === 'unlocked')
    .sort((a, b) => Date.parse(b.unlocked_at) - Date.parse(a.unlocked_at));

  for (const award of sortedAwards) {
    const def = data.achievement_definitions.find(d => d.id === award.achievement_id);
    if (!def || !enabledModIds.has(def.module_id)) continue;
    const metric = availableMetrics.find(m => m.id === def.metric_id);
    if (!metric) continue;
    recent_achievements.push({
      ...award,
      definition: def.definition,
      module_id: def.module_id
    });
    if (recent_achievements.length >= 10) break;
  }

  const warnings: HomeWarning[] = [
    ...preferences.pinned_metric_ids
      .filter(id => !availableMetrics.some(m => m.id === id))
      .map(id => ({ kind: 'metric' as const, id, code: 'PIN_UNAVAILABLE' as const })),
    ...preferences.pinned_task_ids
      .filter(id => !openTasks.some(t => t.id === id))
      .map(id => ({ kind: 'task' as const, id, code: 'PIN_UNAVAILABLE' as const }))
  ];

  return {
    cursor: data.cursor,
    profile,
    preferences,
    metrics,
    tasks,
    recent_achievements,
    warnings,
    wallet: null,
    avatar: { enabled: false, model_asset_ref: null }
  };
}

export function renderDisabledAiContainer(
  scope: AiDraftScope,
  state: AppState,
  options: { inMinimalMode?: boolean } = {}
): string {
  const draftText = loadAiDraft(scope);
  const storageErr = getStorageIssue();
  const isHome = scope === 'home';
  const boxId = isHome ? 'ld-home-ai-box' : 'ld-records-ai-box';
  const inputId = isHome ? 'ld-home-ai-input' : 'ld-records-ai-input';
  const sendBtnId = isHome ? 'ld-home-ai-send-btn' : 'ld-records-ai-send-btn';
  const title = isHome ? 'AI 对话助手' : '与 AI 记录（自然语言候选预览）';
  const subtitle = isHome
    ? '统一上下文对话容器 · AI 将在 v0.3 开放，当前阶段不调用任何模型、不生成虚构回复'
    : '输入自然语言生成结构化记录候选将在 v0.3 开放；当前阶段仅保存本机待发送草稿，不会自动写入记录事实';
  const placeholder = isHome
    ? '输入你想询问或待处理的事项（草稿保存在当前浏览器，切换标准/极简模式不会丢失）…'
    : '例如：今天跑了 3 公里，用了 20 分钟（草稿仅保存在本地浏览器，v0.3 开放候选确认入库）…';

  const draftBadgeClass = storageErr
    ? 'ld-badge-danger'
    : draftText.trim().length > 0
      ? 'ld-badge-info'
      : '';
  const draftBadgeText = storageErr
    ? storageErr
    : draftText.trim().length > 0
      ? '已保存本机待发送草稿'
      : '草稿为空';

  return `<section class="ld-card ld-ai-disabled-box" id="${boxId}" data-ai-container="${scope}" data-ai-enabled="false" ${isHome ? 'data-home-section="ai-chat"' : ''}>
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">${escapeHtml(title)}</h3>
        <p class="ld-panel-subtitle">${escapeHtml(subtitle)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span class="ld-badge ld-badge-warning" data-ai-disabled-badge="${scope}">AI 将在 v0.3 开放</span>
        <span class="ld-badge ${draftBadgeClass}" data-ai-draft-status="${scope}">${escapeHtml(draftBadgeText)}</span>
        ${
          options.inMinimalMode
            ? `<button type="button" class="ld-btn ld-btn-sm" data-action="toggle-minimal-mode" id="ld-minimal-exit-btn">退出极简模式</button>`
            : ''
        }
      </div>
    </div>
    <label class="ld-field">
      <span class="ld-label">
        <span>本地待发送输入草稿</span>
        <span class="ld-label-hint">服务端能力 <code>${isHome ? 'ai_chat' : 'ai_recording'} = ${String(Boolean(isHome ? state.capabilities?.ai_chat : state.capabilities?.ai_recording))}</code></span>
      </span>
      <textarea class="ld-textarea" id="${inputId}" data-ai-draft-input="${scope}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(draftText)}</textarea>
    </label>
    <div class="ld-card-footer">
      <div class="ld-card-meta">
        <span>草稿仅保存在当前浏览器本地存储，不触发模型调用或计费。</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <button type="button" class="ld-btn ld-btn-sm" data-action="save-ai-draft" data-ai-scope="${scope}">保存草稿</button>
        <button type="button" class="ld-btn ld-btn-sm" data-action="clear-ai-draft" data-ai-scope="${scope}">清空草稿</button>
        <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" id="${sendBtnId}" data-action="${isHome ? 'send-ai-chat' : 'send-ai-record'}" disabled aria-disabled="true">
          ${isHome ? '发送（v0.3 开放）' : '生成记录候选（v0.3 开放）'}
        </button>
      </div>
    </div>
  </section>`;
}

function computeEffectiveHomeWarnings(home: HomeData): HomeWarning[] {
  const fromServer = Array.isArray(home.warnings) ? home.warnings : [];
  const seen = new Set(fromServer.map(w => `${w.kind}:${w.id}`));
  const combined: HomeWarning[] = [...fromServer];

  for (const id of home.preferences.pinned_metric_ids) {
    if (!home.metrics.some(m => m.id === id) && !seen.has(`metric:${id}`)) {
      combined.push({ kind: 'metric', id, code: 'PIN_UNAVAILABLE' });
      seen.add(`metric:${id}`);
    }
  }
  for (const id of home.preferences.pinned_task_ids) {
    if (!home.tasks.some(t => t.id === id) && !seen.has(`task:${id}`)) {
      combined.push({ kind: 'task', id, code: 'PIN_UNAVAILABLE' });
      seen.add(`task:${id}`);
    }
  }
  return combined;
}

export function renderHomePanel(
  state: AppState,
  data: BootstrapData | null,
  explicitHome?: HomeData | null
): string {
  const home = explicitHome ?? state.home ?? buildFallbackHomeFromBootstrap(state, data);
  const prefs = state.homePreferences ?? home.preferences;
  const profile = state.profile ?? home.profile;

  // H02 Minimal Mode: ONLY the centered AI container in main content area; common nav remains outside.
  if (prefs.minimal_mode) {
    return `<main class="ld-main ld-home-minimal" id="ld-home-minimal" data-home-mode="minimal" aria-label="首页（极简模式）">
      <div class="ld-minimal-ai-stage">
        ${renderDisabledAiContainer('home', state, { inMinimalMode: true })}
      </div>
    </main>`;
  }

  const warnings = computeEffectiveHomeWarnings(home);
  const pinnedMetricIds = prefs.pinned_metric_ids ?? [];
  const pinnedTaskIds = prefs.pinned_task_ids ?? [];
  const displayedMetrics: MetricRow[] = home.metrics.slice(0, 4);
  const displayedTasks: TaskRow[] = home.tasks.slice(0, 5);
  const displayedAchievements: HomeAchievementRow[] = home.recent_achievements.slice(0, 3);

  const warningsBanner =
    warnings.length > 0
      ? `<div class="ld-home-warning-banner" id="ld-home-pin-warnings" data-home-warnings="${warnings.length}" role="status">
          <div>
            <strong>⚠ 存在已归档或不可用的首页固定引用 (${warnings.length})：</strong>
            <span>${warnings.map(w => `${w.kind === 'metric' ? '数值' : '任务'} (${escapeHtml(w.id.slice(0, 8))}… · ${escapeHtml(w.code)})`).join('、')} 已从有效摘要移出，不会导致页面异常。</span>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="home-clean-unavailable-pins">移除失效固定项</button>
        </div>`
      : '';

  const moduleFieldsSummary =
    profile.module_fields.length === 0
      ? `<div class="ld-card-meta">尚未配置自定义或模块个人资料字段，可前往个人信息详情页添加。</div>`
      : `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;">
          ${profile.module_fields
            .slice(0, 6)
            .map(f => {
              const mod = findModule(data, f.module_id);
              const valText =
                f.value === null || f.value === undefined
                  ? '<span style="color:var(--ld-text-muted);">未设置 (null)</span>'
                  : typeof f.value === 'boolean'
                    ? f.value
                      ? '是 (true)'
                      : '否 (false)'
                    : `${escapeHtml(String(f.value))}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}`;
              return `<div class="ld-ai-kv" data-home-profile-field="${escapeHtml(f.key)}">
                <span class="ld-ai-kv-label">${mod ? `${escapeHtml(mod.name)} · ` : ''}${escapeHtml(f.label)} (<code>${escapeHtml(f.key)}</code>)</span>
                <span class="ld-ai-kv-value">${valText}</span>
              </div>`;
            })
            .join('')}
        </div>`;

  const metricsHtml =
    displayedMetrics.length === 0
      ? renderEmptyState({
          icon: 'dumbbell',
          title: '暂无可展示的个人数值',
          description: '首页只展示基于已确认记录计算的真实数值，不生成示例数值。前往数值面板创建数值定义或录入记录。',
          primaryActionLabel: '前往数值面板',
          primaryActionData: 'data-action="nav-route" data-route="/metrics"'
        })
      : `<div class="ld-card-grid">
          ${displayedMetrics
            .map(m => {
              const mod = findModule(data, m.module_id);
              const winMeta = METRIC_WINDOW_META[m.definition.window] ?? {
                label: m.definition.window,
                shortLabel: m.definition.window
              };
              const aggMeta = METRIC_AGGREGATION_META[m.definition.aggregation] ?? {
                label: m.definition.aggregation,
                description: ''
              };
              const isPinned = pinnedMetricIds.includes(m.id);
              const pinIdx = pinnedMetricIds.indexOf(m.id);
              const hasValue = m.computed.value !== null && m.computed.value !== undefined;

              return `<article class="ld-card" data-home-metric-card="${escapeHtml(m.id)}" data-pinned="${String(isPinned)}">
                <div class="ld-card-top">
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    ${renderModuleBadge(mod, true)}
                    <span class="ld-badge ld-badge-info">${escapeHtml(winMeta.shortLabel)}</span>
                    <span class="ld-badge">${escapeHtml(aggMeta.label)}</span>
                    ${isPinned ? '<span class="ld-badge ld-badge-success">📌 已固定</span>' : ''}
                  </div>
                  <span class="ld-card-meta">样本 ${m.computed.sample_count} 条</span>
                </div>
                <div>
                  <h4 class="ld-card-title">${escapeHtml(m.definition.name)}</h4>
                  <div class="ld-metric-value-box">
                    ${
                      hasValue
                        ? `<span class="ld-metric-number" data-metric-value="${escapeHtml(String(m.computed.value))}">${escapeHtml(String(m.computed.value))}</span><span class="ld-metric-unit">${escapeHtml(m.definition.unit)}</span>`
                        : `<span class="ld-metric-number is-null" data-metric-null="true">暂无数据</span>`
                    }
                  </div>
                </div>
                <div class="ld-card-meta">
                  <span>周期：<code>${escapeHtml(m.computed.period)}</code> · 更新于 ${escapeHtml(formatHomeTime(m.computed.evaluated_at))}</span>
                </div>
                <div class="ld-card-footer">
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="ld-btn ld-btn-sm" data-action="home-metric-sources" data-metric-id="${escapeHtml(m.id)}">
                      查看来源记录 (${m.computed.source_record_ids.length})
                    </button>
                    <button type="button" class="ld-btn ld-btn-sm" data-action="home-metric-detail" data-metric-id="${escapeHtml(m.id)}">
                      数值详情
                    </button>
                  </div>
                  <div style="display:flex;gap:4px;align-items:center;">
                    ${
                      isPinned && pinIdx > 0
                        ? `<button type="button" class="ld-btn ld-btn-sm" data-action="home-move-pin-metric" data-metric-id="${escapeHtml(m.id)}" data-dir="up" title="前移">↑</button>`
                        : ''
                    }
                    ${
                      isPinned && pinIdx >= 0 && pinIdx < pinnedMetricIds.length - 1
                        ? `<button type="button" class="ld-btn ld-btn-sm" data-action="home-move-pin-metric" data-metric-id="${escapeHtml(m.id)}" data-dir="down" title="后移">↓</button>`
                        : ''
                    }
                    <button type="button" class="ld-btn ld-btn-sm" data-action="home-toggle-pin-metric" data-metric-id="${escapeHtml(m.id)}">
                      ${isPinned ? '取消固定' : '📌 固定'}
                    </button>
                  </div>
                </div>
              </article>`;
            })
            .join('')}
        </div>`;

  const tasksHtml =
    displayedTasks.length === 0
      ? renderEmptyState({
          icon: 'flag',
          title: '今日暂无待办或固定任务',
          description: '首页展示当地自然日今日任务与已固定任务（自动去重）。前往任务面板创建或固定任务。',
          primaryActionLabel: '前往任务面板',
          primaryActionData: 'data-action="nav-route" data-route="/tasks"'
        })
      : `<div class="ld-card-list">
          ${displayedTasks
            .map(t => {
              const mod = findModule(data, t.module_id);
              const statusMeta = TASK_STATUS_META[t.status] ?? { label: t.status, tone: 'neutral' };
              const modeMeta = COMPLETION_MODE_META[t.definition.completion_mode] ?? {
                label: t.definition.completion_mode,
                badge: '',
                actionLabel: '去记录'
              };
              const pinState = isTaskOrTemplatePinned(state, t);
              const isPinned = pinnedTaskIds.includes(t.id) || pinState.isPinned;
              const pinIdx = pinnedTaskIds.indexOf(t.id);
              const catMeta = t.category ? TASK_CATEGORY_META[t.category] : undefined;
              const statusBadgeClass =
                t.status === 'completed'
                  ? 'ld-badge-success'
                  : t.status === 'partial' || t.status === 'ended'
                    ? 'ld-badge-warning'
                    : 'ld-badge-info';

              return `<article class="ld-card ${t.needs_review ? 'is-needs-review' : ''}" data-home-task-card="${escapeHtml(t.id)}" data-pinned="${String(isPinned)}">
                <div class="ld-card-top">
                  <div style="display:flex;flex-direction:column;gap:4px;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                      ${renderModuleBadge(mod, true)}
                      ${catMeta ? `<span class="ld-badge ld-badge-info">${escapeHtml(catMeta.shortLabel)}</span>` : ''}
                      ${t.color ? renderColorSwatchBadge(t.color) : ''}
                      <span class="ld-badge">${escapeHtml(modeMeta.label)}</span>
                      <span class="ld-badge">${t.period ? `周期: ${escapeHtml(t.period.start.slice(0, 10))}${t.period.end ? ` ~ ${escapeHtml(t.period.end.slice(0, 10))}` : ''}` : t.definition.business_date ? `日期: ${escapeHtml(t.definition.business_date)}` : '不限日期'}</span>
                      ${isPinned ? '<span class="ld-badge ld-badge-success">📌 已固定</span>' : ''}
                    </div>
                    <h4 class="ld-card-title">${escapeHtml(t.definition.title)}</h4>
                    ${
                      t.progress && t.progress.target
                        ? `<div class="ld-card-meta"><span>当前周期进度：<strong>${escapeHtml(String(t.progress.value ?? '0'))} / ${escapeHtml(t.progress.target)}</strong>（来源记录 ${t.progress.source_record_ids.length} 条）</span></div>`
                        : ''
                    }
                    ${t.reward_summary ? renderTaskRewardPill(t.reward_summary, t.category) : ''}
                  </div>
                  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                    ${t.needs_review ? `<span class="ld-badge ld-badge-warning">⚠ 待复核</span>` : ''}
                    <span class="ld-badge ${statusBadgeClass}">${escapeHtml(statusMeta.label)}</span>
                  </div>
                </div>
                <div class="ld-card-footer">
                  <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button type="button" class="ld-btn ld-btn-sm" data-action="home-task-detail" data-task-id="${escapeHtml(t.id)}">查看任务来源</button>
                    ${
                      t.definition.completion_mode !== 'manual' && t.status !== 'cancelled' && t.status !== 'skipped'
                        ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="home-task-go-record" data-task-id="${escapeHtml(t.id)}">去记录</button>`
                        : ''
                    }
                  </div>
                  <div style="display:flex;gap:4px;align-items:center;">
                    ${
                      isPinned && pinIdx > 0
                        ? `<button type="button" class="ld-btn ld-btn-sm" data-action="home-move-pin-task" data-task-id="${escapeHtml(t.id)}" data-dir="up" title="前移">↑</button>`
                        : ''
                    }
                    ${
                      isPinned && pinIdx >= 0 && pinIdx < pinnedTaskIds.length - 1
                        ? `<button type="button" class="ld-btn ld-btn-sm" data-action="home-move-pin-task" data-task-id="${escapeHtml(t.id)}" data-dir="down" title="后移">↓</button>`
                        : ''
                    }
                    <button type="button" class="ld-btn ld-btn-sm" data-action="home-toggle-pin-task" data-task-id="${escapeHtml(t.id)}">
                      ${isPinned ? '取消固定' : '📌 固定'}
                    </button>
                  </div>
                </div>
              </article>`;
            })
            .join('')}
        </div>`;

  const achievementsHtml =
    displayedAchievements.length === 0
      ? renderEmptyState({
          icon: 'trophy',
          title: '近期暂无已解锁成就',
          description: '首页仅展示当前有效解锁的成就授予（待复核与未解锁项不会冒充已解锁）。',
          primaryActionLabel: '前往成就面板',
          primaryActionData: 'data-action="nav-route" data-route="/achievements"'
        })
      : `<div class="ld-card-list">
          ${displayedAchievements
            .map(a => {
              const mod = findModule(data, a.module_id);
              const isMilestone = Boolean(a.series_id || a.milestone_id || a.threshold);
              const defAny = a.definition as any;
              const metric = defAny?.metric_id
                ? home.metrics.find(m => m.id === defAny.metric_id) ??
                  data?.metrics.find(m => m.id === defAny.metric_id)
                : undefined;
              const unit = defAny?.unit ?? metric?.definition.unit ?? '';
              const thresholdVal = a.threshold ?? defAny?.threshold ?? '';
              const operatorSym = defAny?.operator === 'lte' ? '≤' : '≥';
              const cardKey = a.achievement_id || a.series_id || a.id;

              return `<article class="ld-card" data-home-achievement-card="${escapeHtml(cardKey)}" ${a.milestone_id ? `data-home-milestone-id="${escapeHtml(a.milestone_id)}"` : ''}>
                <div class="ld-card-top">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${renderModuleBadge(mod, true)}
                    <span class="ld-badge ld-badge-success">🏆 ${isMilestone ? '系列里程碑授予' : '有效授予'}</span>
                    ${a.label ? `<span class="ld-badge ld-badge-info">${escapeHtml(a.label)}</span>` : ''}
                  </div>
                  <span class="ld-card-meta">${escapeHtml(formatHomeTime(a.unlocked_at))}</span>
                </div>
                <div>
                  <h4 class="ld-card-title">${escapeHtml(defAny?.name ?? '成就授予')}${a.label ? ` · ${escapeHtml(a.label)}` : ''}</h4>
                  <div class="ld-card-meta" style="margin-top:4px;">
                    <span>具体达成门槛：<strong>${operatorSym} ${escapeHtml(String(thresholdVal))}${unit ? ` ${escapeHtml(unit)}` : ''}</strong></span>
                    <span>· 当前依据值：<strong>${escapeHtml(a.evidence.value ?? 'null')}${unit ? ` ${escapeHtml(unit)}` : ''}</strong> (规则 v${a.rule_version ?? 1})</span>
                  </div>
                </div>
                <div class="ld-card-footer">
                  <button type="button" class="ld-btn ld-btn-sm" data-action="home-achievement-evidence" data-achievement-id="${escapeHtml(cardKey)}" ${a.series_id ? `data-series-id="${escapeHtml(a.series_id)}"` : ''}>
                    查看解锁依据 (${a.evidence.source_record_ids.length})
                  </button>
                  <button type="button" class="ld-btn ld-btn-sm" data-action="home-achievement-detail" data-achievement-id="${escapeHtml(cardKey)}" ${a.series_id ? `data-series-id="${escapeHtml(a.series_id)}"` : ''}>
                    查看成就定义
                  </button>
                </div>
              </article>`;
            })
            .join('')}
        </div>`;

  const homeTrends = home.trends ?? [];
  const trendsSectionHtml =
    homeTrends.length > 0
      ? `<div class="ld-card-list">
          ${homeTrends
            .slice(0, 2)
            .map(entry =>
              renderMetricTrendSection(entry.pin.metric_id, state, data, {
                compactForHome: true,
                explicitTrend: entry.result
              })
            )
            .join('')}
        </div>`
      : `<div class="ld-card-meta">当前 <code>pinned_trends = []</code>，尚未固定数值趋势图（最多可固定 2 张）。可前往数值面板选择任意数值趋势并点击「📌 固定趋势到首页」，绝不生成虚构趋势折线。</div>`;

  const hasRealWallet = Boolean(home.wallet || state.wallet);
  const walletFooterHtml = hasRealWallet
    ? renderWalletSummaryCard(state, true)
    : `<div class="ld-card-footer" data-home-wallet="null">
        <div class="ld-card-meta">
          <span><strong>代币钱包：</strong><code>wallet = null</code>（系统奖励账本未开放，不显示虚拟余额 0）</span>
        </div>
        <span class="ld-badge">未开放兑换</span>
      </div>`;

  const achSummary = home.achievement_summary ?? state.achievementSummary;

  return `<main class="ld-main" id="ld-home-standard" data-home-mode="standard" aria-label="首页">
    <div class="ld-panel-container">
      ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
      ${warningsBanner}
      <header class="ld-panel-header">
        <div class="ld-panel-title-group">
          <h1 class="ld-panel-title">个人主页 · ${escapeHtml(profile.nickname)}</h1>
          <p class="ld-panel-subtitle">基于真实确认事实的一致性读取快照（cursor = ${escapeHtml(String(home.cursor))} · 时区 ${escapeHtml(profile.timezone)}）</p>
        </div>
        <div class="ld-panel-actions">
          <button type="button" class="ld-btn" data-action="toggle-minimal-mode" id="ld-home-minimal-toggle-btn">
            进入极简模式
          </button>
          <button type="button" class="ld-btn ld-btn-primary" data-action="home-open-profile">
            个人信息详情
          </button>
        </div>
      </header>

      <div class="ld-home-grid">
        <div class="ld-home-col">
          ${renderDisabledAiContainer('home', state)}

          <section class="ld-card" id="ld-home-metrics" data-home-section="metrics">
            <div class="ld-card-top">
              <div>
                <h3 class="ld-card-title">个人数值 (${home.metrics.length})</h3>
                <p class="ld-panel-subtitle">按固定顺序优先展示（最多固定 4 项）；无数据时显示「暂无数据」，绝不填假 0</p>
              </div>
              <button type="button" class="ld-btn ld-btn-sm" data-action="nav-route" data-route="/metrics">查看全部 (${home.metrics.length})</button>
            </div>
            ${metricsHtml}
          </section>

          <section class="ld-card" id="ld-home-trends" data-home-section="trends">
            <div class="ld-card-top">
              <div>
                <h3 class="ld-card-title">数值趋势固定区 (${homeTrends.length}/2)</h3>
                <p class="ld-panel-subtitle">与数值面板同源计算四时间范围等权日均折线图（最多固定 2 张）；缺失日断线、0 值保留</p>
              </div>
              <button type="button" class="ld-btn ld-btn-sm" data-action="nav-route" data-route="/metrics">管理趋势固定</button>
            </div>
            ${trendsSectionHtml}
          </section>
        </div>

        <div class="ld-home-col">
          ${renderStaticAvatarSlot({
            characterId: profile.id,
            nickname: profile.nickname,
            actionId: 'idle',
            reducedMotion: state.reducedMotion,
            modelAssetRef: home.avatar.model_asset_ref
          })}

          <section class="ld-card ld-profile-summary-card" id="ld-home-profile-summary" data-home-section="profile-summary">
            <div class="ld-card-top">
              <div>
                <h3 class="ld-card-title">个人摘要与资料</h3>
                <p class="ld-panel-subtitle">资料版本 v${profile.version} · 时区 <code>${escapeHtml(profile.timezone)}</code></p>
              </div>
              <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="home-open-profile">编辑个人资料</button>
            </div>
            <div class="ld-card-meta">
              <span><strong>简介：</strong>${profile.bio !== null && profile.bio !== '' ? escapeHtml(profile.bio) : '<span style="color:var(--ld-text-muted);">未填写 (null)</span>'}</span>
            </div>
            ${moduleFieldsSummary}
            ${!hasRealWallet ? walletFooterHtml : ''}
          </section>

          ${hasRealWallet ? walletFooterHtml : ''}

          <section class="ld-card" id="ld-home-tasks" data-home-section="tasks">
            <div class="ld-card-top">
              <div>
                <h3 class="ld-card-title">今日与固定任务 (${home.tasks.length})</h3>
                <p class="ld-panel-subtitle">当前周期委托实例、当地今日 (${escapeHtml(getTodayInZone(profile.timezone))}) 任务与已固定任务去重（最多固定 5 项）</p>
              </div>
              <button type="button" class="ld-btn ld-btn-sm" data-action="nav-route" data-route="/tasks">查看全部</button>
            </div>
            ${tasksHtml}
          </section>

          <section class="ld-card" id="ld-home-achievements" data-home-section="achievements">
            <div class="ld-card-top">
              <div>
                <h3 class="ld-card-title">近期成就与里程碑 (${home.recent_achievements.length})</h3>
                <p class="ld-panel-subtitle">最近有效授予的成就与具体里程碑门槛${achSummary ? `（有效授予总数 ${achSummary.effective_awards_count} · 已达成系列 ${achSummary.achieved_series_count} · 待复核 ${achSummary.needs_review_count}）` : ''}</p>
              </div>
              <button type="button" class="ld-btn ld-btn-sm" data-action="nav-route" data-route="/achievements">查看全部</button>
            </div>
            ${achievementsHtml}
          </section>
        </div>
      </div>
    </div>
  </main>`;
}

export function renderProfileStatusBar(state: AppState): string {
  const pf = state.profileForm;
  const meta = SUBMISSION_STATE_META[pf.submissionStatus] ?? SUBMISSION_STATE_META.idle;
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

  return `<div class="ld-draft-status-bar" id="ld-profile-status-bar" data-profile-status="${escapeHtml(pf.submissionStatus)}" data-submission-status="${escapeHtml(pf.submissionStatus)}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span class="ld-badge ${badgeClass}">${escapeHtml(pf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? '未保存本机' : meta.label)}</span>
      <span style="color:var(--ld-text-secondary);">${escapeHtml(pf.lastSavedMessage ?? (pf.validationError?.code === 'LOCAL_STORAGE_FAILED' ? pf.validationError.message : meta.description))}</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="ld-badge">基线 v${pf.baseVersion}</span>
      ${
        pf.operationId
          ? `<code style="font-size:11px;color:var(--ld-text-muted);">op: ${escapeHtml(pf.operationId.slice(0, 10))}…</code>`
          : ''
      }
      ${
        pf.dirty
          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="profile-reset-draft">放弃未保存修改</button>`
          : ''
      }
    </div>
  </div>`;
}

export function renderSettingsProfileSection(state: AppState, data: BootstrapData): string {
  const pf = state.profileForm;
  const enabledModules = data.modules.filter(m => m.status === 'enabled');
  const pendingProfileOp = getPendingConfigMutation(buildConfigDraftKey('profile'));
  const srvConflict = pf.conflictServerProfile;

  const leaveGuardHtml = pf.pendingLeaveTarget
    ? `<div class="ld-unsaved-leave-guard" id="ld-profile-leave-confirm" data-unsaved-guard="profile" role="alert">
        <div>
          <strong>⚠ 离开页面提醒：</strong>个人资料存在尚未保存到服务器的修改。你要继续编辑并保留修改，还是放弃修改并离开？
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="profile-stay">继续编辑（保留未保存修改）</button>
          <button type="button" class="ld-btn ld-btn-sm ld-btn-danger" data-action="profile-discard-and-leave">放弃未保存修改并离开</button>
        </div>
      </div>`
    : '';

  const unsavedBarHtml = pf.dirty
    ? `<div class="ld-profile-unsaved-bar" data-profile-unsaved="true" role="status">
        <div>
          <strong>未保存状态：</strong>当前表单包含尚未提交至服务器的个人资料更改（已暂存本机草稿）。
        </div>
        <span>待移除字段：${pf.removeIds.length} 项</span>
      </div>`
    : '';

  const conflictPanelHtml = pf.conflictError
    ? `<div class="ld-conflict-panel" id="ld-profile-conflict-panel" role="alert" data-conflict-code="${escapeHtml(pf.conflictError.code)}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div>
            <strong>⚠ 个人资料版本冲突 (${escapeHtml(pf.conflictError.code)})：</strong>${escapeHtml(pf.conflictError.message)}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button type="button" class="ld-btn ld-btn-sm" data-action="profile-conflict-pull">拉取服务器最新版本</button>
            ${
              srvConflict
                ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="profile-conflict-adopt">采用服务器版本 v${srvConflict.version} 作为编辑基线</button>`
                : ''
            }
          </div>
        </div>
        <div style="color:var(--ld-text-secondary);font-size:12px;">
          已完整保留你当前未保存的本地输入，绝不静默覆盖服务器数据。
          ${
            srvConflict
              ? `服务器当前基线：<code>v${srvConflict.version}</code> · 昵称：<code>${escapeHtml(srvConflict.nickname)}</code> · 简介：<code>${escapeHtml(srvConflict.bio ?? 'null')}</code> · 时区：<code>${escapeHtml(srvConflict.timezone)}</code> · 模块字段数：<code>${srvConflict.module_fields.length}</code>`
              : ''
          }
        </div>
      </div>`
    : '';

  const valErrorHtml = pf.validationError
    ? `<div class="ld-error-banner" role="alert" data-profile-validation-error="${escapeHtml(pf.validationError.code)}">
        <span><strong>${escapeHtml(pf.validationError.code)}</strong>：${escapeHtml(pf.validationError.message)}（已保留你当前的输入）</span>
      </div>`
    : '';

  const pendingBannerHtml = pendingProfileOp
    ? `<div class="ld-return-banner" style="background:var(--ld-warning-soft);border-color:rgba(245,158,11,0.5);">
        <div>
          <strong>上次个人资料提交结果待确认：</strong>请点击下方「确认上次提交」沿用原 <code>operation_id</code> 确认结果。
        </div>
      </div>`
    : '';

  const fieldRowsHtml =
    pf.fields.length === 0
      ? `<div class="ld-card-meta">当前暂无模块个人资料字段。点击下方按钮可在四个默认模块或自定义模块下添加「资料/配置 (profile)」、「观测绑定 (observation)」或「派生只读 (derived)」字段。</div>`
      : `<div class="ld-card-list">
          ${pf.fields
            .map(f => {
              const mod = findModule(data, f.module_id);
              const modEditable = !mod || mod.status === 'enabled';
              const serverField = state.profile?.module_fields.find(sf => sf.id === f.id);
              const hydratedValue = serverField?.value ?? f.value;
              const sourceRef = serverField?.source_ref ?? f.source_ref;
              const isNull = f.value === null || f.value === undefined;
              const valStr = isNull ? '' : String(f.value);
              const optionsStr = (f.options ?? []).join(', ');
              const modTemplates = data.record_types.filter(rt => rt.module_id === f.module_id);
              const modMetrics = data.metrics.filter(m => m.module_id === f.module_id);

              if (f.kind === 'observation') {
                const boundTplId = f.binding?.record_type_id ?? modTemplates[0]?.id ?? '';
                const boundTpl = modTemplates.find(rt => rt.id === boundTplId) ?? modTemplates[0];
                const numFields = (boundTpl?.fields ?? []).filter(tf =>
                  ['integer', 'decimal'].includes(tf.type)
                );
                const boundFieldKey = f.binding?.field_key ?? numFields[0]?.key ?? '';

                return `<div class="ld-card" style="padding:12px 14px;" data-profile-field-row="${escapeHtml(f.id)}" data-field-key="${escapeHtml(f.key)}" data-field-kind="observation">
                  <input type="hidden" data-pf-prop="kind" value="observation" />
                  <div class="ld-card-top">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      ${renderModuleBadge(mod, true)}
                      <span class="ld-badge ld-badge-warning">kind = observation (观测字段 · 来源记录驱动)</span>
                      <span class="ld-badge">最新观测值：<strong>${hydratedValue !== null && hydratedValue !== undefined ? `${escapeHtml(String(hydratedValue))}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}` : '暂无来源记录 (null)'}</strong></span>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" data-action="open-write-observation" data-field-id="${escapeHtml(f.id)}" data-obs-mode="new" ${!modEditable ? 'disabled' : ''}>
                        ＋ 新增发生时间观测
                      </button>
                      ${
                        sourceRef?.record_id
                          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="open-write-observation" data-field-id="${escapeHtml(f.id)}" data-obs-mode="correct" ${!modEditable ? 'disabled' : ''}>
                              纠错最新来源记录 (v${sourceRef.version ?? 1})
                            </button>
                            <button type="button" class="ld-btn ld-btn-sm" data-action="profile-jump-source-record" data-record-id="${escapeHtml(sourceRef.record_id)}">
                              查看来源记录 →
                            </button>`
                          : ''
                      }
                      <button type="button" class="ld-btn ld-btn-sm ld-btn-danger" data-action="profile-remove-field" data-field-id="${escapeHtml(f.id)}" ${!modEditable ? 'disabled' : ''}>移除字段</button>
                    </div>
                  </div>
                  <div class="ld-form-row">
                    <label class="ld-field">
                      <span class="ld-label">所属模块 *</span>
                      <select class="ld-select" data-pf-prop="module_id" ${!modEditable ? 'disabled' : ''}>
                        ${data.modules
                          .filter(m => m.status === 'enabled' || m.id === f.module_id)
                          .map(
                            m =>
                              `<option value="${escapeHtml(m.id)}" ${m.id === f.module_id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">字段 key *</span>
                      <input class="ld-input" type="text" data-pf-prop="key" value="${escapeHtml(f.key)}" pattern="^[a-z][a-z0-9_]{0,63}$" required ${!modEditable ? 'disabled' : ''} />
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">显示名称 (label) *</span>
                      <input class="ld-input" type="text" data-pf-prop="label" value="${escapeHtml(f.label)}" maxlength="60" required ${!modEditable ? 'disabled' : ''} />
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">数值类型 (integer / decimal) *</span>
                      <select class="ld-select" data-pf-prop="type" ${!modEditable ? 'disabled' : ''}>
                        <option value="decimal" ${f.type === 'decimal' ? 'selected' : ''}>精确小数 (decimal)</option>
                        <option value="integer" ${f.type === 'integer' ? 'selected' : ''}>整数 (integer)</option>
                      </select>
                    </label>
                  </div>
                  <div class="ld-form-row">
                    <label class="ld-field">
                      <span class="ld-label">绑定记录模板 (binding.record_type_id) *</span>
                      <select class="ld-select" data-pf-prop="binding_record_type_id" ${!modEditable ? 'disabled' : ''}>
                        ${modTemplates
                          .map(
                            rt =>
                              `<option value="${escapeHtml(rt.id)}" ${rt.id === boundTplId ? 'selected' : ''}>${escapeHtml(rt.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">绑定数值字段 (binding.field_key) *</span>
                      <select class="ld-select" data-pf-prop="binding_field_key" ${!modEditable ? 'disabled' : ''}>
                        ${numFields
                          .map(
                            nf =>
                              `<option value="${escapeHtml(nf.key)}" ${nf.key === boundFieldKey ? 'selected' : ''}>${escapeHtml(nf.label)} (${escapeHtml(nf.key)}${nf.unit ? ` / ${escapeHtml(nf.unit)}` : ''})</option>`
                          )
                          .join('')}
                      </select>
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">单位 (须与绑定字段一致)</span>
                      <input class="ld-input" type="text" data-pf-prop="unit" value="${escapeHtml(f.unit ?? '')}" maxlength="30" ${!modEditable ? 'disabled' : ''} />
                    </label>
                  </div>
                </div>`;
              }

              if (f.kind === 'derived') {
                const boundMetricId = f.binding?.metric_id ?? modMetrics[0]?.id ?? '';
                return `<div class="ld-card" style="padding:12px 14px;" data-profile-field-row="${escapeHtml(f.id)}" data-field-key="${escapeHtml(f.key)}" data-field-kind="derived">
                  <input type="hidden" data-pf-prop="kind" value="derived" />
                  <input type="hidden" data-pf-prop="type" value="decimal" />
                  <div class="ld-card-top">
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                      ${renderModuleBadge(mod, true)}
                      <span class="ld-badge ld-badge-success">kind = derived (派生摘要 · 只读不接受手改)</span>
                      <span class="ld-badge">当前派生值：<strong>${hydratedValue !== null && hydratedValue !== undefined ? `${escapeHtml(String(hydratedValue))}${f.unit ? ` ${escapeHtml(f.unit)}` : ''}` : '暂无数据 (null)'}</strong></span>
                    </div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap;">
                      ${
                        boundMetricId
                          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="profile-jump-source-metric" data-metric-id="${escapeHtml(boundMetricId)}">
                              查看来源指标与趋势 →
                            </button>`
                          : ''
                      }
                      ${
                        sourceRef?.source_record_ids && sourceRef.source_record_ids.length > 0
                          ? `<button type="button" class="ld-btn ld-btn-sm" data-action="profile-jump-derived-records" data-field-id="${escapeHtml(f.id)}" data-source-ids="${escapeHtml(sourceRef.source_record_ids.join(','))}" data-field-label="${escapeHtml(f.label)}">
                              查看派生来源记录 (${sourceRef.source_record_ids.length})
                            </button>`
                          : ''
                      }
                      <button type="button" class="ld-btn ld-btn-sm ld-btn-danger" data-action="profile-remove-field" data-field-id="${escapeHtml(f.id)}" ${!modEditable ? 'disabled' : ''}>移除字段</button>
                    </div>
                  </div>
                  <div class="ld-form-row">
                    <label class="ld-field">
                      <span class="ld-label">所属模块 *</span>
                      <select class="ld-select" data-pf-prop="module_id" ${!modEditable ? 'disabled' : ''}>
                        ${data.modules
                          .filter(m => m.status === 'enabled' || m.id === f.module_id)
                          .map(
                            m =>
                              `<option value="${escapeHtml(m.id)}" ${m.id === f.module_id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`
                          )
                          .join('')}
                      </select>
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">字段 key *</span>
                      <input class="ld-input" type="text" data-pf-prop="key" value="${escapeHtml(f.key)}" pattern="^[a-z][a-z0-9_]{0,63}$" required ${!modEditable ? 'disabled' : ''} />
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">显示名称 (label) *</span>
                      <input class="ld-input" type="text" data-pf-prop="label" value="${escapeHtml(f.label)}" maxlength="60" required ${!modEditable ? 'disabled' : ''} />
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">绑定数值指标 (binding.metric_id) *</span>
                      <select class="ld-select" data-pf-prop="binding_metric_id" ${!modEditable ? 'disabled' : ''}>
                        ${modMetrics
                          .map(
                            mm =>
                              `<option value="${escapeHtml(mm.id)}" ${mm.id === boundMetricId ? 'selected' : ''}>${escapeHtml(mm.definition.name)} (${escapeHtml(mm.definition.unit)})</option>`
                          )
                          .join('')}
                      </select>
                    </label>
                    <label class="ld-field">
                      <span class="ld-label">单位 (须与指标一致)</span>
                      <input class="ld-input" type="text" data-pf-prop="unit" value="${escapeHtml(f.unit ?? '')}" maxlength="30" ${!modEditable ? 'disabled' : ''} />
                    </label>
                  </div>
                </div>`;
              }

              let valueInputHtml = '';
              if (f.type === 'boolean') {
                valueInputHtml = `<select class="ld-select" data-pf-prop="value" ${!modEditable ? 'disabled' : ''}>
                  <option value="true" ${f.value === true || valStr === 'true' ? 'selected' : ''}>是 (true)</option>
                  <option value="false" ${f.value === false || valStr === 'false' ? 'selected' : ''}>否 (false)</option>
                </select>`;
              } else if (f.type === 'textarea') {
                valueInputHtml = `<textarea class="ld-textarea" data-pf-prop="value" rows="2" ${!modEditable ? 'disabled' : ''}>${escapeHtml(valStr)}</textarea>`;
              } else {
                const inputType = f.type === 'date' ? 'date' : f.type === 'integer' ? 'number' : 'text';
                valueInputHtml = `<input class="ld-input" type="${inputType}" data-pf-prop="value" value="${escapeHtml(valStr)}" placeholder="${f.type === 'decimal' ? '十进制字符串，如 65.50' : '字段值'}" ${!modEditable ? 'disabled' : ''} />`;
              }

              return `<div class="ld-card" style="padding:12px 14px;" data-profile-field-row="${escapeHtml(f.id)}" data-field-key="${escapeHtml(f.key)}" data-field-kind="profile">
                <input type="hidden" data-pf-prop="kind" value="profile" />
                <div class="ld-card-top">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${renderModuleBadge(mod, true)}
                    <span class="ld-badge ld-badge-info">kind = profile (资料/配置)</span>
                    ${!modEditable ? '<span class="ld-badge ld-badge-warning">所属模块已归档/停用（不可编辑）</span>' : ''}
                  </div>
                  <button type="button" class="ld-btn ld-btn-sm ld-btn-danger" data-action="profile-remove-field" data-field-id="${escapeHtml(f.id)}" ${!modEditable ? 'disabled' : ''}>移除字段</button>
                </div>
                <div class="ld-form-row">
                  <label class="ld-field">
                    <span class="ld-label">所属模块 *</span>
                    <select class="ld-select" data-pf-prop="module_id" ${!modEditable ? 'disabled' : ''}>
                      ${data.modules
                        .filter(m => m.status === 'enabled' || m.id === f.module_id)
                        .map(
                          m =>
                            `<option value="${escapeHtml(m.id)}" ${m.id === f.module_id ? 'selected' : ''}>${escapeHtml(m.name)}${m.status !== 'enabled' ? ` (${m.status})` : ''}</option>`
                        )
                        .join('')}
                    </select>
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">字段 key * <span class="ld-label-hint">如 session, goal</span></span>
                    <input class="ld-input" type="text" data-pf-prop="key" value="${escapeHtml(f.key)}" pattern="^[a-z][a-z0-9_]{0,63}$" required ${!modEditable ? 'disabled' : ''} />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">显示名称 (label) *</span>
                    <input class="ld-input" type="text" data-pf-prop="label" value="${escapeHtml(f.label)}" maxlength="60" required ${!modEditable ? 'disabled' : ''} />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">字段类型 (type) *</span>
                    <select class="ld-select" data-pf-prop="type" ${!modEditable ? 'disabled' : ''}>
                      ${Object.entries(FIELD_TYPE_META)
                        .map(
                          ([k, meta]) =>
                            `<option value="${k}" ${f.type === k ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
                        )
                        .join('')}
                    </select>
                  </label>
                </div>
                <div class="ld-form-row">
                  <label class="ld-field">
                    <span class="ld-label">
                      <span>字段值 (value)</span>
                      <label style="display:inline-flex;align-items:center;gap:4px;font-weight:400;cursor:pointer;">
                        <input type="checkbox" data-pf-prop="is_null" ${isNull ? 'checked' : ''} ${!modEditable ? 'disabled' : ''} />
                        <span>未知/空值 (null)</span>
                      </label>
                    </span>
                    ${valueInputHtml}
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">单位 (unit，可选)</span>
                    <input class="ld-input" type="text" data-pf-prop="unit" value="${escapeHtml(f.unit ?? '')}" maxlength="30" placeholder="如 小时、kg" ${!modEditable ? 'disabled' : ''} />
                  </label>
                  <label class="ld-field">
                    <span class="ld-label">枚举选项 (options，逗号分隔)</span>
                    <input class="ld-input" type="text" data-pf-prop="options" value="${escapeHtml(optionsStr)}" placeholder="single_select 必填，如 初级, 进阶" ${!modEditable ? 'disabled' : ''} />
                  </label>
                </div>
              </div>`;
            })
            .join('')}
        </div>`;

  return `<div class="ld-card-list" id="ld-profile-settings">
    ${renderPanelAiContextBar('profile', state, data)}
    ${leaveGuardHtml}
    ${unsavedBarHtml}
    ${renderProfileStatusBar(state)}
    ${conflictPanelHtml}
    ${valErrorHtml}
    ${pendingBannerHtml}

    <form class="ld-form-grid" id="ld-form-profile" data-base-version="${pf.baseVersion}">
      <div class="ld-card">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">基础身份信息</h3>
            <p class="ld-panel-subtitle">修改昵称、简介或 IANA 时区通过统一事务与版本控制保存；切换时区不会重写已有历史记录或已完成任务周期，也不会重置奖励额度。</p>
          </div>
          <span class="ld-badge">静态头像引用: null（未开放）</span>
        </div>
        <div class="ld-form-row">
          <label class="ld-field">
            <span class="ld-label">昵称 (nickname) * <span class="ld-label-hint">1~60 字符，不可为 null</span></span>
            <input class="ld-input" type="text" name="nickname" id="ld-profile-nickname" maxlength="60" required value="${escapeHtml(pf.nickname)}" />
          </label>
          <label class="ld-field">
            <span class="ld-label">时区 (timezone, IANA) * <span class="ld-label-hint">如 Asia/Shanghai, UTC</span></span>
            <input class="ld-input" type="text" name="timezone" id="ld-profile-timezone" list="ld-timezone-datalist" required value="${escapeHtml(pf.timezone)}" />
            <datalist id="ld-timezone-datalist">
              <option value="Asia/Shanghai"></option>
              <option value="UTC"></option>
              <option value="Asia/Tokyo"></option>
              <option value="America/New_York"></option>
              <option value="Europe/London"></option>
              <option value="Pacific/Kiritimati"></option>
            </datalist>
          </label>
        </div>
        <label class="ld-field">
          <span class="ld-label">
            <span>个人简介 (bio) <span class="ld-label-hint">最多 1000 字符，支持清空为 null</span></span>
            <label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;">
              <input type="checkbox" name="bio_is_null" id="ld-profile-bio-null" ${pf.bioIsNull ? 'checked' : ''} />
              <span>设为 null（清空简介）</span>
            </label>
          </span>
          <textarea class="ld-textarea" name="bio" id="ld-profile-bio" maxlength="1000" placeholder="填写个人阶段、关注重点或简介（勾选上方设为 null 可清空）">${escapeHtml(pf.bio)}</textarea>
        </label>
      </div>

      <div class="ld-card" data-profile-boundary="observation-derived-disabled">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">只读展示区（观测值 observation / 派生值 derived）与来源联动边界</h3>
            <p class="ld-panel-subtitle">严格区分「资料/配置 (profile)」、「观测字段 (observation)」与「派生摘要 (derived)」，不支持在资料配置表单直接手改覆盖统计值。</p>
          </div>
          <span class="ld-badge ld-badge-warning">观测与派生禁止直接覆盖值</span>
        </div>
        <div class="ld-card-meta" style="flex-direction:column;align-items:flex-start;gap:4px;line-height:1.7;">
          <div>1. <strong>资料/配置字段 (<code>kind = "profile"</code>)：</strong>本页直接编辑并保存（支持四默认模块及自定义模块，支持合法业务名 <code>session</code>），不会伪造实际记录、不会完成任务或发放代币。</div>
          <div>2. <strong>观测字段 (<code>kind = "observation"</code>)：</strong>绑定同模块记录模板的数值字段（<code>integer / decimal</code>），配置保存时 <code>value = null</code>，不支持在资料页直接手改覆盖；请点击字段卡片上的「＋ 新增发生时间观测」或「纠错最新来源记录」通过统一记录事实核心写入并驱动全站重算。</div>
          <div>3. <strong>派生摘要 (<code>kind = "derived"</code>)：</strong>绑定同模块数值指标（<code>metric_id</code>），严格<strong>只读</strong>（禁止手改累计结果），点击可跳回来源指标与底层记录。</div>
        </div>
      </div>

      <div class="ld-card">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">四模块与自定义模块个人资料/观测/派生字段 (${pf.fields.length})</h3>
            <p class="ld-panel-subtitle">每个启用模块（含自定义模块）均可定义独立字段，同模块内 key 唯一；配置变更与观测写入分开提交，无半成功状态</p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <select class="ld-select" id="ld-profile-add-module-select" style="width:auto;" aria-label="选择新增资料字段所属模块">
              ${enabledModules
                .map(m => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`)
                .join('')}
            </select>
            <select class="ld-select" id="ld-profile-add-kind-select" style="width:auto;" aria-label="选择新增字段类别">
              <option value="profile">资料/配置 (profile)</option>
              <option value="observation">观测绑定 (observation)</option>
              <option value="derived">派生只读 (derived)</option>
            </select>
            <button type="button" class="ld-btn ld-btn-sm ld-btn-primary" id="ld-profile-add-field-btn" data-action="profile-add-field" ${enabledModules.length === 0 ? 'disabled' : ''}>
              ＋ 新增模块资料字段
            </button>
          </div>
        </div>
        ${fieldRowsHtml}
        <div class="ld-card-footer">
          <div class="ld-card-meta">
            <span>整包变更原子提交并保留配置修订 (configuration_revisions)</span>
          </div>
          <div style="display:flex;gap:8px;">
            <button type="button" class="ld-btn" data-action="profile-reset-draft" ${!pf.dirty ? 'disabled' : ''}>重置修改</button>
            <button type="submit" class="ld-btn ld-btn-primary" id="ld-profile-save-btn" ${state.submittingModal ? 'disabled' : ''}>
              ${state.submittingModal ? '等待服务器确认…' : pendingProfileOp ? '确认上次提交' : '保存个人资料'}
            </button>
          </div>
        </div>
      </div>
    </form>
  </div>`;
}
