/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {
  DASHBOARD_STYLES,
  escapeHtml,
  renderIcon
} from '../../../packages/ui/src/index.js';
import { api, ApiClientError, generateUuid } from './api.js';
import {
  renderAchievementsPanel,
  renderActiveModal,
  renderMetricsPanel,
  renderRecordsPanel,
  renderSettingsPanel,
  renderTasksPanel
} from './panels.js';
import {
  createInitialState,
  parseRouteFromLocation,
  routeToPanelKey,
  type AppState
} from './state.js';
import type {
  AiApplyMode,
  AiBatchRow,
  AiContentType,
  AiGenerationRequest,
  AiJobRow,
  AiMode,
  Field,
  PanelKey,
  PanelRoute
} from './types.js';

const state: AppState = createInitialState();

function ensureStylesMounted(): void {
  if (!document.getElementById('ld-dashboard-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'ld-dashboard-styles';
    styleEl.textContent = DASHBOARD_STYLES;
    document.head.appendChild(styleEl);
  }
}

function syncThemeAttributes(): void {
  document.documentElement.setAttribute('data-theme', state.theme);
  document.documentElement.setAttribute(
    'data-reduced-motion',
    state.reducedMotion ? 'true' : 'false'
  );
}

function pushToast(
  title: string,
  message: string,
  kind: 'info' | 'success' | 'unlock' | 'warning' = 'info'
): void {
  const id = generateUuid();
  state.toasts.push({ id, title, message, kind });
  renderApp();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter(t => t.id !== id);
    renderApp();
  }, 4200);
}

function saveCurrentScroll(): void {
  const key = routeToPanelKey(state.route);
  if (key) {
    state.panels[key].scrollY = window.scrollY || 0;
  }
}

function navigateTo(
  route: PanelRoute,
  options: { pushHistory?: boolean; preserveReturnContext?: boolean } = {}
): void {
  saveCurrentScroll();
  if (!options.preserveReturnContext) {
    state.returnContext = null;
  }
  state.route = route;
  state.error = null;
  if (options.pushHistory !== false && window.location.pathname !== route) {
    window.history.pushState({ route }, '', route);
  }
  renderApp();
  const key = routeToPanelKey(route);
  const targetScroll = key ? state.panels[key].scrollY : 0;
  window.scrollTo({ top: targetScroll, behavior: 'instant' as ScrollBehavior });
}

function renderLoginScreen(): string {
  return `<div class="ld-login-screen">
    <form class="ld-login-card" id="ld-login-form">
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="ld-brand-emblem">L</span>
        <div>
          <h1 style="margin:0;font-size:18px;font-weight:700;">人生面板 Life Dashboard</h1>
          <div style="font-size:12px;color:var(--ld-text-secondary);">v0.1 本地开发会话入口 (${escapeHtml(state.capabilities?.stage ?? 'T0/T1')})</div>
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:var(--ld-text-secondary);line-height:1.6;">
        请输入 <code>v0.1/.secrets/development.env</code> 中的 <code>LOCAL_LOGIN_SECRET</code>。
        服务端将验证 Origin 并签发 7 天有效的 <code>HttpOnly; SameSite=Strict</code> 会话 Cookie，前端不会将口令写入 localStorage。
      </p>
      ${
        state.loginError
          ? `<div class="ld-error-banner" role="alert"><span>${escapeHtml(state.loginError)}</span></div>`
          : ''
      }
      <label class="ld-field">
        <span class="ld-label">本地登录口令 (LOCAL_LOGIN_SECRET) *</span>
        <input class="ld-input" type="password" name="login_secret" id="ld-login-secret-input" required autocomplete="current-password" placeholder="粘贴 LOCAL_LOGIN_SECRET..." />
      </label>
      <button type="submit" class="ld-btn ld-btn-primary" style="width:100%;padding:10px;" ${state.loading ? 'disabled' : ''}>
        ${state.loading ? '正在验证会话...' : '进入人生面板'}
      </button>
    </form>
  </div>`;
}

function renderShellAndMain(): string {
  const data = state.bootstrap;
  const navItems: Array<{
    route: PanelRoute;
    key: PanelKey;
    label: string;
    shortLabel: string;
    icon: string;
    count?: number;
    warning?: boolean;
  }> = [
    {
      route: '/tasks',
      key: 'tasks',
      label: '任务面板',
      shortLabel: '任务',
      icon: 'flag',
      count: data ? data.tasks.filter(t => t.status !== 'completed').length : undefined,
      warning: data ? data.tasks.some(t => t.needs_review) : false
    },
    {
      route: '/metrics',
      key: 'metrics',
      label: '数值面板',
      shortLabel: '数值',
      icon: 'dumbbell',
      count: data ? data.metrics.length : undefined
    },
    {
      route: '/achievements',
      key: 'achievements',
      label: '成就面板',
      shortLabel: '成就',
      icon: 'trophy',
      count: data ? data.achievement_awards.filter(a => a.state === 'unlocked').length : undefined,
      warning: data ? data.achievement_awards.some(a => a.state === 'needs_review') : false
    },
    {
      route: '/records',
      key: 'records',
      label: '记录面板',
      shortLabel: '记录',
      icon: 'book',
      count: data ? data.records.length : undefined
    },
    {
      route: '/settings',
      key: 'settings',
      label: '设置面板',
      shortLabel: '设置',
      icon: 'sparkles'
    }
  ];

  const currentPanelTitle =
    state.route === '/'
      ? '首页'
      : navItems.find(n => n.route === state.route)?.label ?? '人生面板';

  let mainContentHtml = '';
  if (state.route === '/') {
    // P01 & Section 2.2: Logged-in Home page main content area is strictly blank!
    // No welcome text, no summary cards, no today tasks, no metrics overview, no AI chat, no placeholder text, no auto-redirect.
    mainContentHtml = `<main class="ld-main ld-home-blank" id="ld-home-blank" aria-label="首页"></main>`;
  } else if (!data) {
    mainContentHtml = `<main class="ld-main"><div class="ld-panel-container"><div class="ld-card">正在加载面板数据...</div></div></main>`;
  } else if (state.route === '/tasks') {
    mainContentHtml = `<main class="ld-main">${renderTasksPanel(state, data)}</main>`;
  } else if (state.route === '/metrics') {
    mainContentHtml = `<main class="ld-main">${renderMetricsPanel(state, data)}</main>`;
  } else if (state.route === '/achievements') {
    mainContentHtml = `<main class="ld-main">${renderAchievementsPanel(state, data)}</main>`;
  } else if (state.route === '/records') {
    mainContentHtml = `<main class="ld-main">${renderRecordsPanel(state, data)}</main>`;
  } else if (state.route === '/settings') {
    mainContentHtml = `<main class="ld-main">${renderSettingsPanel(state, data)}</main>`;
  }

  const toastsHtml =
    state.toasts.length > 0
      ? `<div class="ld-toast-container" aria-live="polite">
          ${state.toasts
            .map(
              t => `<div class="ld-toast ${t.kind === 'unlock' ? 'is-unlock' : ''}">
                <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(t.title)}</div>
                <div style="color:var(--ld-text-secondary);">${escapeHtml(t.message)}</div>
              </div>`
            )
            .join('')}
        </div>`
      : '';

  return `<div class="ld-app-shell">
    <aside class="ld-sidebar" aria-label="主导航">
      <button type="button" class="ld-brand-link ${state.route === '/' ? 'is-active' : ''}" data-action="nav-route" data-route="/">
        <span class="ld-brand-emblem">L</span>
        <span>人生面板</span>
      </button>
      <nav class="ld-nav-list">
        ${navItems
          .map(
            item => `<button type="button" class="ld-nav-btn ${state.route === item.route ? 'is-active' : ''}" data-action="nav-route" data-route="${item.route}">
              <span class="ld-nav-btn-left">
                ${renderIcon(item.icon, 16)}
                <span>${escapeHtml(item.label)}</span>
              </span>
              ${
                item.count !== undefined
                  ? `<span class="ld-nav-badge ${item.warning ? 'is-warning' : ''}">${item.warning ? '⚠ ' : ''}${item.count}</span>`
                  : ''
              }
            </button>`
          )
          .join('')}
      </nav>
      <div class="ld-sidebar-footer">
        <div class="ld-user-pill">
          <span>👤 ${escapeHtml(state.user?.name ?? '本地用户')}</span>
          <button type="button" class="ld-btn ld-btn-sm" data-action="toggle-theme" title="切换深浅主题">
            ${state.theme === 'dark' ? '🌙' : '☀️'}
          </button>
        </div>
        <button type="button" class="ld-btn ld-btn-sm" data-action="logout" style="width:100%;">退出登录</button>
      </div>
    </aside>

    <header class="ld-mobile-topbar">
      <button type="button" class="ld-btn ld-btn-sm ${state.route === '/' ? 'ld-btn-primary' : ''}" data-action="nav-route" data-route="/">
        <span class="ld-brand-emblem" style="width:20px;height:20px;font-size:11px;">L</span>
        <span>首页</span>
      </button>
      <strong style="font-size:15px;">${escapeHtml(currentPanelTitle)}</strong>
      <button type="button" class="ld-btn ld-btn-sm" data-action="toggle-theme">${state.theme === 'dark' ? '🌙' : '☀️'}</button>
    </header>

    ${mainContentHtml}

    <nav class="ld-mobile-dock" aria-label="移动端五面板导航">
      ${navItems
        .map(
          item => `<button type="button" class="ld-dock-btn ${state.route === item.route ? 'is-active' : ''}" data-action="nav-route" data-route="${item.route}">
            ${renderIcon(item.icon, 18)}
            <span>${escapeHtml(item.shortLabel)}</span>
          </button>`
        )
        .join('')}
    </nav>
    ${data ? renderActiveModal(state, data) : ''}
    ${toastsHtml}
  </div>`;
}

export function renderApp(): void {
  ensureStylesMounted();
  syncThemeAttributes();
  const root = document.getElementById('app');
  if (!root) return;

  if (state.authStatus === 'checking') {
    root.innerHTML = `<div class="ld-login-screen"><div class="ld-card">正在连接本地服务...</div></div>`;
    return;
  }

  if (state.authStatus === 'unauthenticated') {
    root.innerHTML = renderLoginScreen();
    return;
  }

  root.innerHTML = renderShellAndMain();
  bindDynamicModalSelectListeners();
}

function bindDynamicModalSelectListeners(): void {
  const data = state.bootstrap;
  if (!data) return;

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
      renderApp();
    };
  }
  if (recTplSelect && state.activeModal?.kind === 'record-form' && state.activeModal.mode === 'create') {
    recTplSelect.onchange = () => {
      if (state.activeModal?.kind !== 'record-form') return;
      state.activeModal.defaultRecordTypeId = recTplSelect.value;
      state.activeModal.defaultTaskIds = [];
      renderApp();
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
    achModSelect.onchange = () => {
      const metrics = data.metrics.filter(m => m.module_id === achModSelect.value);
      achMetricSelect.innerHTML =
        metrics.length === 0
          ? `<option value="">当前模块暂无数值定义，请先创建数值</option>`
          : metrics
              .map(
                m =>
                  `<option value="${escapeHtml(m.id)}">${escapeHtml(m.definition.name)} (${escapeHtml(m.definition.unit)})</option>`
              )
              .join('');
    };
  }

  // AI generation modal: mode-dependent groups and per-module reference allowlists.
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

async function refreshBootstrapAndNotify(
  actionSummary?: string,
  checkUnlocks = false
): Promise<void> {
  const prevUnlockedIds = new Set(
    (state.bootstrap?.achievement_awards ?? [])
      .filter(a => a.state === 'unlocked')
      .map(a => a.achievement_id)
  );
  const fresh = await api.getBootstrap();
  state.bootstrap = fresh;
  state.error = null;

  if (actionSummary) {
    pushToast('操作成功', actionSummary, 'success');
  }

  if (checkUnlocks && state.unlockToastEnabled) {
    for (const award of fresh.achievement_awards) {
      if (award.state === 'unlocked' && !prevUnlockedIds.has(award.achievement_id)) {
        const def = fresh.achievement_definitions.find(d => d.id === award.achievement_id);
        pushToast(
          '🏆 成就已解锁！',
          `「${def?.definition.name ?? '新成就'}」已根据真实记录达成解锁条件`,
          'unlock'
        );
      }
    }
  }

  renderApp();
}

function handleApiError(err: unknown): void {
  if (err instanceof ApiClientError) {
    if (err.status === 401) {
      state.authStatus = 'unauthenticated';
      state.loginError = '会话已过期或未登录，请重新输入本地登录口令。';
      renderApp();
      return;
    }
    state.error = {
      code: err.code,
      message: err.message,
      requestId: err.requestId
    };
    pushToast(`请求错误 (${err.code})`, err.message, 'warning');
  } else {
    state.error = {
      code: 'NETWORK_ERROR',
      message: err instanceof Error ? err.message : '网络请求异常'
    };
  }
  renderApp();
}

// ---------------------------------------------------------------------------
// AI generation state helpers (T2/T3). Errors are always shown honestly; a
// failed provider call or blueprint rejection is never turned into a fake success.
// ---------------------------------------------------------------------------

function describeApiError(err: unknown): { code?: string; message: string } {
  if (err instanceof ApiClientError) return { code: err.code, message: err.message };
  return { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : '网络请求异常' };
}

function extractAiJobId(details: unknown): string | null {
  if (typeof details !== 'object' || details === null) return null;
  const record = details as Record<string, unknown>;
  const direct = record.job_id;
  if (typeof direct === 'string') return direct;
  const nested = record.details;
  if (typeof nested === 'object' && nested !== null) {
    const nestedId = (nested as Record<string, unknown>).job_id;
    if (typeof nestedId === 'string') return nestedId;
  }
  return null;
}

async function loadAiConfig(): Promise<void> {
  state.ai.configLoading = true;
  state.ai.configError = null;
  renderApp();
  try {
    state.ai.config = await api.getAiConfig();
  } catch (err) {
    state.ai.configError = describeApiError(err);
  } finally {
    state.ai.configLoading = false;
    renderApp();
  }
}

async function loadAiJobs(): Promise<void> {
  state.ai.jobsLoading = true;
  state.ai.jobsError = null;
  renderApp();
  try {
    state.ai.jobs = await api.listAiGenerations({ limit: 10 });
  } catch (err) {
    state.ai.jobsError = describeApiError(err);
  } finally {
    state.ai.jobsLoading = false;
    renderApp();
  }
}

/** Refresh the job list without flashing the settings loading row. */
async function refreshAiJobsQuietly(): Promise<void> {
  try {
    state.ai.jobs = await api.listAiGenerations({ limit: 10 });
    state.ai.jobsError = null;
  } catch (err) {
    state.ai.jobsError = describeApiError(err);
  }
}

function aiJobToast(job: AiJobRow): string {
  if (job.error) return `${job.error.code}：${job.error.message}`;
  if (!job.validation.valid) return '候选未通过服务端校验，候选与错误已保留，未写入任何配置。';
  return '候选已通过服务端五层校验。';
}

function aiBatchToast(batch: AiBatchRow): string {
  const counts = new Map<string, number>();
  for (const object of batch.objects) counts.set(object.kind, (counts.get(object.kind) ?? 0) + 1);
  const labels: Record<string, string> = {
    module: '模块',
    record_type: '记录模板',
    metric: '数值',
    task: '任务',
    achievement: '成就'
  };
  const parts = [...counts.entries()].map(([kind, count]) => `${count} 个${labels[kind] ?? kind}`);
  return parts.length > 0
    ? `已添加${parts.join('、')}；这只是配置定义，真实记录仍需你手动填写`
    : '批次已应用（无新增对象）';
}

async function showAiJob(jobId: string): Promise<void> {
  state.ai.busy = true;
  state.ai.resultError = null;
  state.ai.result = null;
  state.activeModal = { kind: 'ai-result', moduleId: null };
  renderApp();
  try {
    state.ai.result = await api.getAiGeneration(jobId);
  } catch (err) {
    state.ai.resultError = describeApiError(err);
  } finally {
    state.ai.busy = false;
    renderApp();
  }
}

async function runAiJobAction(
  action: 'apply' | 'retry' | 'cancel',
  jobId: string
): Promise<void> {
  if (state.ai.busy) return;
  const current = state.ai.result?.job;
  const baseVersion = current && current.id === jobId ? current.target_base_version : null;
  state.ai.busy = true;
  state.ai.resultError = null;
  renderApp();
  try {
    const envelope =
      action === 'apply'
        ? await api.applyAiGeneration(jobId, baseVersion)
        : action === 'retry'
          ? await api.retryAiGeneration(jobId)
          : await api.cancelAiGeneration(jobId);
    state.ai.result = envelope;
    state.ai.busy = false;
    await refreshAiJobsQuietly();
    if (envelope.batch) {
      await refreshBootstrapAndNotify(aiBatchToast(envelope.batch));
    } else if (action === 'cancel') {
      pushToast('候选已取消', '不会写入任何配置定义', 'info');
      renderApp();
    } else if (action === 'retry') {
      pushToast('重新生成完成', aiJobToast(envelope.job), envelope.job.validation.valid ? 'info' : 'warning');
      renderApp();
    } else {
      pushToast('候选已生成', aiJobToast(envelope.job), envelope.job.validation.valid ? 'info' : 'warning');
      renderApp();
    }
  } catch (err) {
    state.ai.busy = false;
    if (err instanceof ApiClientError) {
      state.ai.resultError = { code: err.code, message: err.message, details: err.details };
      const jobIdFromError = extractAiJobId(err.details);
      if (jobIdFromError) {
        try {
          state.ai.result = await api.getAiGeneration(jobIdFromError);
        } catch {
          // Keep the error banner; the server did not expose a readable job.
        }
      }
    } else {
      state.ai.resultError = describeApiError(err);
    }
    await refreshAiJobsQuietly();
    renderApp();
  }
}

async function runAiRevoke(batchId: string): Promise<void> {
  if (state.ai.busy) return;
  state.ai.busy = true;
  state.ai.resultError = null;
  renderApp();
  try {
    const result = await api.revokeAiBatch(batchId);
    state.ai.busy = false;
    state.ai.lastRevoke = result.revoke.mode;
    if (state.ai.result) state.ai.result = { ...state.ai.result, batch: result.batch };
    await refreshBootstrapAndNotify(
      result.revoke.mode === 'deleted'
        ? '已撤销生成批次：无真实记录或外部引用，本次新增定义已删除'
        : '已撤销生成批次：存在真实记录或外部引用，相关定义已归档/停用，真实记录未被删除',
      false
    );
    await refreshAiJobsQuietly();
    renderApp();
  } catch (err) {
    state.ai.busy = false;
    state.ai.resultError = describeApiError(err);
    await refreshAiJobsQuietly();
    renderApp();
  }
}

async function initializeApp(): Promise<void> {
  state.route = parseRouteFromLocation(window.location.pathname);
  // Support optional module_id query parameter on direct panel entry (P02)
  const urlParams = new URLSearchParams(window.location.search);
  const queryModId = urlParams.get('module_id');
  const initialPanelKey = routeToPanelKey(state.route);
  if (initialPanelKey && queryModId) {
    state.panels[initialPanelKey].moduleId = queryModId;
  }

  renderApp();
  try {
    state.capabilities = await api.getCapabilities().catch(() => null);
    const me = await api.getMe();
    state.user = me;
    state.bootstrap = await api.getBootstrap();
    state.authStatus = 'authenticated';
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 401) {
      state.authStatus = 'unauthenticated';
    } else {
      state.authStatus = 'unauthenticated';
      state.loginError = err instanceof Error ? err.message : '无法连接后端 API';
    }
  }
  renderApp();
  if (state.authStatus === 'authenticated') {
    void loadAiConfig();
    void loadAiJobs();
  }
}

function setupEventDelegation(): void {
  window.addEventListener('popstate', () => {
    state.route = parseRouteFromLocation(window.location.pathname);
    renderApp();
  });

  document.addEventListener('change', e => {
    const target = e.target as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    if (action === 'filter-record-template') {
      const val = (target as HTMLSelectElement).value;
      state.panels.records.recordTemplateId = val || null;
      renderApp();
    } else if (action === 'filter-record-status') {
      const val = (target as HTMLSelectElement).value as 'all' | 'confirmed' | 'draft';
      state.panels.records.recordStatus = val;
      renderApp();
    }
  });

  document.addEventListener('click', async e => {
    const target = (e.target as HTMLElement | null)?.closest('[data-action]') as HTMLElement | null;
    if (!target) return;
    const action = target.getAttribute('data-action');
    const data = state.bootstrap;

    if (action === 'nav-route') {
      const route = (target.getAttribute('data-route') ?? '/') as PanelRoute;
      navigateTo(route);
      return;
    }

    if (action === 'toggle-theme') {
      state.theme = state.theme === 'dark' ? 'light' : 'dark';
      renderApp();
      return;
    }

    if (action === 'toggle-reduced-motion') {
      state.reducedMotion = !state.reducedMotion;
      renderApp();
      return;
    }

    if (action === 'toggle-unlock-toast') {
      state.unlockToastEnabled = !state.unlockToastEnabled;
      renderApp();
      return;
    }

    if (action === 'toggle-inactive-modules') {
      state.showInactiveModulesInFilter = !state.showInactiveModulesInFilter;
      renderApp();
      return;
    }

    if (action === 'logout') {
      try {
        await api.logout();
      } catch {
        // Ignore logout errors
      }
      state.authStatus = 'unauthenticated';
      state.user = null;
      state.bootstrap = null;
      state.activeModal = null;
      renderApp();
      return;
    }

    if (action === 'refresh-bootstrap') {
      try {
        await refreshBootstrapAndNotify('已同步最新服务端一致性快照');
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (action === 'filter-module') {
      const modId = target.getAttribute('data-module-id') || null;
      const key = routeToPanelKey(state.route);
      if (key) {
        // Section 2.3 & P03: Only change the current panel's module filter
        state.panels[key].moduleId = modId;
        if (key === 'records') {
          state.panels.records.recordTemplateId = null;
        }
        renderApp();
      }
      return;
    }

    if (action === 'panel-subtab') {
      const subTab = target.getAttribute('data-subtab') ?? 'all';
      const key = routeToPanelKey(state.route);
      if (key) {
        state.panels[key].subTab = subTab;
        renderApp();
      }
      return;
    }

    if (action === 'close-modal') {
      state.activeModal = null;
      renderApp();
      return;
    }

    if (action === 'close-modal-backdrop') {
      if (e.target === target) {
        state.activeModal = null;
        renderApp();
      }
      return;
    }

    if (action === 'return-context' && state.returnContext) {
      const ctx = state.returnContext;
      state.panels[ctx.fromPanelKey] = { ...ctx.savedFilter };
      state.returnContext = null;
      state.activeModal = null;
      navigateTo(ctx.fromRoute, { preserveReturnContext: false });
      return;
    }

    if (action === 'clear-return-context') {
      state.returnContext = null;
      renderApp();
      return;
    }

    if (action === 'clear-record-source-filter') {
      state.panels.records.sourceRecordIds = null;
      state.panels.records.sourceLabel = null;
      renderApp();
      return;
    }

    if (!data) return;

    // Open Modals
    if (action === 'open-create-task') {
      state.activeModal = {
        kind: 'create-task',
        defaultModuleId: state.panels.tasks.moduleId
      };
      renderApp();
      return;
    }

    if (action === 'open-ai-modal') {
      // Pre-fill the module filter of the current panel (or the panel that owns
      // the button) so generation targets what the user is looking at.
      const sourcePanel = (target.getAttribute('data-ai-source-panel') ??
        routeToPanelKey(state.route)) as PanelKey | null;
      const panelModuleId = sourcePanel ? state.panels[sourcePanel]?.moduleId ?? null : null;
      state.ai.result = null;
      state.ai.resultError = null;
      state.activeModal = {
        kind: 'ai-generate',
        moduleId: panelModuleId
      };
      if (!state.ai.config && !state.ai.configLoading) {
        void loadAiConfig();
      }
      renderApp();
      return;
    }

    if (action === 'refresh-ai-config') {
      void loadAiConfig();
      void loadAiJobs();
      return;
    }

    if (action === 'refresh-ai-jobs') {
      void loadAiJobs();
      return;
    }

    if (action === 'ai-open-job') {
      const jobId = target.getAttribute('data-job-id') ?? '';
      if (jobId) void showAiJob(jobId);
      return;
    }

    if (action === 'ai-apply-job') {
      const jobId = target.getAttribute('data-job-id') ?? '';
      if (jobId) void runAiJobAction('apply', jobId);
      return;
    }

    if (action === 'ai-retry-job') {
      const jobId = target.getAttribute('data-job-id') ?? '';
      if (jobId) void runAiJobAction('retry', jobId);
      return;
    }

    if (action === 'ai-cancel-job') {
      const jobId = target.getAttribute('data-job-id') ?? '';
      if (jobId) void runAiJobAction('cancel', jobId);
      return;
    }

    if (action === 'ai-revoke-batch') {
      const batchId = target.getAttribute('data-batch-id') ?? '';
      if (batchId) void runAiRevoke(batchId);
      return;
    }

    if (action === 'ai-back-to-form') {
      const moduleId = target.getAttribute('data-module-id') || null;
      state.ai.result = null;
      state.ai.resultError = null;
      state.activeModal = { kind: 'ai-generate', moduleId };
      renderApp();
      return;
    }

    if (action === 'open-task-detail') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      state.panels.tasks.selectedId = taskId;
      state.activeModal = { kind: 'task-detail', taskId };
      renderApp();
      return;
    }

    // Section 4.4 & P04: Task -> Record jump carrying module, template, task instance, return context
    if (action === 'task-go-record') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const task = data.tasks.find(t => t.id === taskId);
      if (!task) return;
      saveCurrentScroll();
      state.panels.tasks.selectedId = task.id;
      state.returnContext = {
        fromRoute: '/tasks',
        fromPanelKey: 'tasks',
        savedFilter: { ...state.panels.tasks },
        label: `来自任务「${task.definition.title}」`
      };
      const tplId =
        task.definition.record_type_id ??
        data.record_types.find(rt => rt.module_id === task.module_id)?.id ??
        '';
      navigateTo('/records', { preserveReturnContext: true });
      state.activeModal = {
        kind: 'record-form',
        mode: 'create',
        defaultModuleId: task.module_id,
        defaultRecordTypeId: tplId,
        defaultTaskIds: [task.id],
        fromTaskId: task.id
      };
      renderApp();
      return;
    }

    if (action === 'task-complete-manual') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const task = data.tasks.find(t => t.id === taskId);
      if (!task) return;
      try {
        await api.completeTask(task.id, task.version);
        await refreshBootstrapAndNotify(`已将任务「${task.definition.title}」标记为完成`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (action === 'task-jump-record-detail') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const recordId = target.getAttribute('data-record-id') ?? '';
      const task = data.tasks.find(t => t.id === taskId);
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/tasks',
        fromPanelKey: 'tasks',
        savedFilter: { ...state.panels.tasks, selectedId: taskId },
        label: `来自任务「${task?.definition.title ?? ''}」的完成依据`
      };
      state.panels.records.selectedId = recordId;
      navigateTo('/records', { preserveReturnContext: true });
      state.activeModal = { kind: 'record-detail', recordId };
      renderApp();
      return;
    }

    if (action === 'open-create-record') {
      const modId =
        state.panels.records.moduleId ??
        data.modules.find(m => m.status === 'enabled')?.id ??
        '';
      const tplId =
        state.panels.records.recordTemplateId ??
        data.record_types.find(rt => rt.module_id === modId)?.id ??
        '';
      state.activeModal = {
        kind: 'record-form',
        mode: 'create',
        defaultModuleId: modId,
        defaultRecordTypeId: tplId,
        defaultTaskIds: []
      };
      renderApp();
      return;
    }

    if (action === 'open-edit-record') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      const rec = data.records.find(r => r.id === recordId);
      if (!rec) return;
      state.panels.records.selectedId = recordId;
      state.activeModal = {
        kind: 'record-form',
        mode: 'edit',
        recordId: rec.id,
        defaultModuleId: rec.module_id,
        defaultRecordTypeId: rec.record_type_id,
        defaultTaskIds: rec.task_ids
      };
      renderApp();
      return;
    }

    if (action === 'open-record-detail') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      state.panels.records.selectedId = recordId;
      state.activeModal = { kind: 'record-detail', recordId };
      renderApp();
      return;
    }

    if (action === 'delete-record') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      const rec = data.records.find(r => r.id === recordId);
      if (!rec) return;
      try {
        await api.deleteRecord(rec.id, rec.version);
        state.activeModal = null;
        await refreshBootstrapAndNotify(
          '记录已软删除，关联任务与成就已重新评估（失去唯一证据项已标为待复核）'
        );
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (action === 'record-jump-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/records',
        fromPanelKey: 'records',
        savedFilter: { ...state.panels.records },
        label: '来自记录面板的关联任务查看'
      };
      state.panels.tasks.selectedId = taskId;
      navigateTo('/tasks', { preserveReturnContext: true });
      state.activeModal = { kind: 'task-detail', taskId };
      renderApp();
      return;
    }

    if (action === 'open-create-metric') {
      state.activeModal = {
        kind: 'create-metric',
        defaultModuleId: state.panels.metrics.moduleId
      };
      renderApp();
      return;
    }

    if (action === 'open-metric-detail') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      state.panels.metrics.selectedId = metricId;
      state.activeModal = { kind: 'metric-detail', metricId };
      renderApp();
      return;
    }

    if (action === 'metric-view-sources') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const m = data.metrics.find(x => x.id === metricId);
      if (!m) return;
      saveCurrentScroll();
      state.panels.metrics.selectedId = m.id;
      state.returnContext = {
        fromRoute: '/metrics',
        fromPanelKey: 'metrics',
        savedFilter: { ...state.panels.metrics },
        label: `来自数值「${m.definition.name}」的来源记录核查`
      };
      state.panels.records.moduleId = m.module_id;
      state.panels.records.recordTemplateId = m.record_type_id;
      state.panels.records.sourceRecordIds = [...m.computed.source_record_ids];
      state.panels.records.sourceLabel = `数值「${m.definition.name}」的 ${m.computed.source_record_ids.length} 条有效样本记录`;
      state.activeModal = null;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'metric-add-record') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const m = data.metrics.find(x => x.id === metricId);
      if (!m) return;
      saveCurrentScroll();
      state.panels.metrics.selectedId = m.id;
      state.returnContext = {
        fromRoute: '/metrics',
        fromPanelKey: 'metrics',
        savedFilter: { ...state.panels.metrics },
        label: `来自数值「${m.definition.name}」的新增观测记录`
      };
      navigateTo('/records', { preserveReturnContext: true });
      state.activeModal = {
        kind: 'record-form',
        mode: 'create',
        defaultModuleId: m.module_id,
        defaultRecordTypeId: m.record_type_id,
        defaultTaskIds: []
      };
      renderApp();
      return;
    }

    if (action === 'metric-jump-record-detail') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const recordId = target.getAttribute('data-record-id') ?? '';
      const m = data.metrics.find(x => x.id === metricId);
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/metrics',
        fromPanelKey: 'metrics',
        savedFilter: { ...state.panels.metrics, selectedId: metricId },
        label: `来自数值「${m?.definition.name ?? ''}」的样本记录详情`
      };
      state.panels.records.selectedId = recordId;
      navigateTo('/records', { preserveReturnContext: true });
      state.activeModal = { kind: 'record-detail', recordId };
      renderApp();
      return;
    }

    if (action === 'open-create-achievement') {
      state.activeModal = {
        kind: 'create-achievement',
        defaultModuleId: state.panels.achievements.moduleId
      };
      renderApp();
      return;
    }

    if (action === 'open-achievement-detail') {
      const achievementId = target.getAttribute('data-achievement-id') ?? '';
      state.panels.achievements.selectedId = achievementId;
      state.activeModal = { kind: 'achievement-detail', achievementId };
      renderApp();
      return;
    }

    if (action === 'achievement-jump-metric') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/achievements',
        fromPanelKey: 'achievements',
        savedFilter: { ...state.panels.achievements },
        label: '来自成就面板的关联数值查看'
      };
      state.panels.metrics.selectedId = metricId;
      navigateTo('/metrics', { preserveReturnContext: true });
      state.activeModal = { kind: 'metric-detail', metricId };
      renderApp();
      return;
    }

    if (action === 'achievement-view-evidence') {
      const achievementId = target.getAttribute('data-achievement-id') ?? '';
      const def = data.achievement_definitions.find(a => a.id === achievementId);
      const award = data.achievement_awards.find(a => a.achievement_id === achievementId);
      if (!def || !award) return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/achievements',
        fromPanelKey: 'achievements',
        savedFilter: { ...state.panels.achievements, selectedId: achievementId },
        label: `来自成就「${def.definition.name}」的解锁依据记录`
      };
      const ids =
        award.evidence.source_record_ids.length > 0
          ? award.evidence.source_record_ids
          : award.original_evidence.source_record_ids;
      state.panels.records.moduleId = def.module_id;
      state.panels.records.sourceRecordIds = [...ids];
      state.panels.records.sourceLabel = `成就「${def.definition.name}」的解锁依据记录 (${ids.length} 条)`;
      state.activeModal = null;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'open-create-module') {
      state.activeModal = { kind: 'create-module' };
      renderApp();
      return;
    }

    if (action === 'open-edit-module') {
      const moduleId = target.getAttribute('data-module-id') ?? '';
      state.activeModal = { kind: 'edit-module', moduleId };
      renderApp();
      return;
    }

    if (action === 'open-create-template') {
      state.activeModal = {
        kind: 'create-template',
        defaultModuleId: state.panels.settings.moduleId
      };
      renderApp();
      return;
    }
  });

  document.addEventListener('submit', async e => {
    const form = e.target as HTMLFormElement | null;
    if (!form) return;
    e.preventDefault();

    if (form.id === 'ld-login-form') {
      const fd = new FormData(form);
      const secret = String(fd.get('login_secret') ?? '').trim();
      if (!secret) return;
      state.loading = true;
      state.loginError = null;
      renderApp();
      try {
        await api.login(secret);
        const [me, capabilities, bootstrap] = await Promise.all([
          api.getMe(),
          api.getCapabilities().catch(() => null),
          api.getBootstrap()
        ]);
        state.user = me;
        state.capabilities = capabilities;
        state.bootstrap = bootstrap;
        state.authStatus = 'authenticated';
        state.loading = false;
        renderApp();
        void loadAiConfig();
        void loadAiJobs();
      } catch (err) {
        state.loading = false;
        state.loginError =
          err instanceof ApiClientError
            ? `${err.message} (${err.code})`
            : '登录失败，请检查口令或服务状态';
        renderApp();
      }
      return;
    }

    const data = state.bootstrap;
    if (!data) return;

    if (form.id === 'ld-form-ai-generate') {
      const fd = new FormData(form);
      const mode = String(fd.get('mode') ?? 'extend') as AiMode;
      const apply_mode = String(fd.get('apply_mode') ?? 'apply') as AiApplyMode;
      const module_id = mode === 'extend' ? String(fd.get('module_id') ?? '') || null : null;
      if (mode === 'extend' && !module_id) {
        pushToast('无法提交生成', '请选择一个启用中的目标模块', 'warning');
        return;
      }
      const contentTypes: AiContentType[] = fd
        .getAll('content_types')
        .map(value => String(value))
        .filter(
          (value): value is AiContentType =>
            value === 'record_types' ||
            value === 'metrics' ||
            value === 'tasks' ||
            value === 'achievements'
        );
      if (contentTypes.length === 0) {
        pushToast('无法提交生成', '请至少选择一类生成内容', 'warning');
        return;
      }
      const basePrompt = String(fd.get('prompt') ?? '').trim();
      if (!basePrompt) {
        pushToast('无法提交生成', '请填写你的需求描述', 'warning');
        return;
      }

      let prompt = basePrompt;
      if (mode === 'create') {
        const name = String(fd.get('new_module_name') ?? '').trim();
        const icon = String(fd.get('new_module_icon') ?? '').trim();
        const color = String(fd.get('new_module_color') ?? '').trim();
        const requirements: string[] = [];
        if (name) requirements.push(`模块名称必须为「${name}」`);
        if (icon) requirements.push(`模块图标 icon 使用 ${icon}`);
        if (color) requirements.push(`模块主题色 color 使用 ${color}`);
        if (requirements.length > 0) {
          prompt = `${basePrompt}\n\n补充要求（新建模块）：${requirements.join('；')}。`;
        }
      }

      const recordTypeIds = fd.getAll('ai-ref-record-types').map(value => String(value)).filter(Boolean);
      const metricIds = fd.getAll('ai-ref-metrics').map(value => String(value)).filter(Boolean);
      const input: AiGenerationRequest = {
        mode,
        module_id,
        prompt,
        content_types: contentTypes,
        apply_mode,
        timezone: state.user?.timezone ?? 'Asia/Shanghai',
        reference: { record_type_ids: recordTypeIds, metric_ids: metricIds }
      };

      state.ai.busy = true;
      state.ai.result = null;
      state.ai.resultError = null;
      state.ai.lastRevoke = null;
      state.activeModal = { kind: 'ai-result', moduleId: module_id };
      renderApp();
      try {
        const envelope = await api.createAiGeneration(input);
        state.ai.result = envelope;
        state.ai.busy = false;
        await refreshAiJobsQuietly();
        if (envelope.batch) {
          await refreshBootstrapAndNotify(aiBatchToast(envelope.batch));
        } else {
          pushToast(
            envelope.job.validation.valid ? '候选已生成（尚未应用）' : '候选未通过校验',
            aiJobToast(envelope.job),
            envelope.job.validation.valid ? 'info' : 'warning'
          );
          renderApp();
        }
      } catch (err) {
        state.ai.busy = false;
        if (err instanceof ApiClientError) {
          state.ai.resultError = { code: err.code, message: err.message, details: err.details };
          const jobId = extractAiJobId(err.details);
          if (jobId) {
            try {
              state.ai.result = await api.getAiGeneration(jobId);
            } catch {
              // Keep the honest error banner; no fabricated candidate is shown.
            }
          }
        } else {
          state.ai.resultError = describeApiError(err);
        }
        await refreshAiJobsQuietly();
        renderApp();
      }
      return;
    }

    if (form.id === 'ld-form-create-task') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const title = String(fd.get('title') ?? '').trim();
      const completion_mode = String(fd.get('completion_mode') ?? 'record_required') as
        | 'manual'
        | 'record_optional'
        | 'record_required';
      const business_date_raw = String(fd.get('business_date') ?? '').trim();
      const timezone = String(fd.get('timezone') ?? 'Asia/Shanghai').trim();

      let record_type_id: string | null = null;
      let acceptance: { kind: 'exists' } | { kind: 'field_gte'; field_key: string; threshold: string } | null = null;

      if (completion_mode !== 'manual') {
        record_type_id = String(fd.get('record_type_id') ?? '');
        const accKind = String(fd.get('acceptance_kind') ?? 'exists');
        if (accKind === 'field_gte') {
          acceptance = {
            kind: 'field_gte',
            field_key: String(fd.get('field_key') ?? ''),
            threshold: String(fd.get('threshold') ?? '1').trim()
          };
        } else {
          acceptance = { kind: 'exists' };
        }
      }

      try {
        await api.createTask({
          module_id,
          title,
          completion_mode,
          record_type_id,
          acceptance,
          business_date: business_date_raw || null,
          timezone
        });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建任务「${title}」`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-record') {
      const mode = form.getAttribute('data-mode') as 'create' | 'edit';
      const recordId = form.getAttribute('data-record-id') ?? '';
      const existing = mode === 'edit' ? data.records.find(r => r.id === recordId) : undefined;
      const fd = new FormData(form);

      const module_id = existing
        ? existing.module_id
        : String(fd.get('module_id') ?? (state.activeModal?.kind === 'record-form' ? state.activeModal.defaultModuleId : ''));
      const record_type_id = existing
        ? existing.record_type_id
        : String(fd.get('record_type_id') ?? (state.activeModal?.kind === 'record-form' ? state.activeModal.defaultRecordTypeId : ''));
      const tpl = data.record_types.find(rt => rt.id === record_type_id);
      if (!tpl) return;

      const occurred_at = String(fd.get('occurred_at') ?? '').trim();
      const timezone = String(fd.get('timezone') ?? 'Asia/Shanghai').trim();
      const status = String(fd.get('status') ?? 'confirmed') as 'draft' | 'confirmed';
      const task_ids = fd.getAll('task_id').map(v => String(v));

      const values: Record<string, string | number | boolean | null> = {};
      const fieldElements = form.querySelectorAll('[data-field-key]');
      fieldElements.forEach(el => {
        const key = el.getAttribute('data-field-key')!;
        const fType = el.getAttribute('data-field-type')!;
        const raw = (el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value.trim();
        if (raw === '') {
          values[key] = null;
        } else if (fType === 'integer') {
          values[key] = Number.parseInt(raw, 10);
        } else if (fType === 'boolean') {
          values[key] = raw === 'true';
        } else {
          // text, textarea, decimal, date, single_select all use string in contract
          values[key] = raw;
        }
      });

      try {
        if (mode === 'edit' && existing) {
          await api.updateRecord(existing.id, {
            base_version: existing.version,
            module_id,
            record_type_id,
            schema_version: existing.schema_version,
            occurred_at,
            timezone,
            status,
            values,
            task_ids
          });
          state.activeModal = null;
          await refreshBootstrapAndNotify('记录已更新，关联任务、数值与成就已同步重算', true);
        } else {
          await api.createRecord({
            module_id,
            record_type_id,
            schema_version: tpl.schema_version,
            occurred_at,
            timezone,
            status,
            values,
            task_ids
          });
          state.activeModal = null;
          await refreshBootstrapAndNotify('真实记录已保存，派生统计与任务验收已更新', true);
        }
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-create-metric') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const record_type_id = String(fd.get('record_type_id') ?? '');
      const name = String(fd.get('name') ?? '').trim();
      const aggregation = String(fd.get('aggregation') ?? 'count') as
        | 'count'
        | 'sum'
        | 'avg'
        | 'latest';
      const windowVal = String(fd.get('window') ?? 'week') as
        | 'day'
        | 'week'
        | 'month'
        | 'all_time';
      const field_key =
        aggregation === 'count' ? null : String(fd.get('field_key') ?? '') || null;
      const unit = String(fd.get('unit') ?? '').trim();
      const timezone = String(fd.get('timezone') ?? 'Asia/Shanghai').trim();

      try {
        await api.createMetric({
          module_id,
          record_type_id,
          name,
          unit,
          aggregation,
          field_key,
          window: windowVal,
          timezone
        });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建数值定义「${name}」`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-create-achievement') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const metric_id = String(fd.get('metric_id') ?? '');
      const name = String(fd.get('name') ?? '').trim();
      const operator = String(fd.get('operator') ?? 'gte') as 'gte' | 'lte';
      const threshold = String(fd.get('threshold') ?? '1').trim();
      const history_policy = String(fd.get('history_policy') ?? 'include_existing') as
        | 'include_existing'
        | 'from_activation';

      try {
        await api.createAchievement({
          module_id,
          metric_id,
          name,
          operator,
          threshold,
          history_policy
        });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建成就定义「${name}」`, true);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-create-module') {
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      const description = String(fd.get('description') ?? '').trim();
      const icon = String(fd.get('icon') ?? 'book') as any;
      const color = String(fd.get('color') ?? 'blue') as any;

      try {
        await api.createModule({ name, description, icon, color });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建自定义模块「${name}」，现已加入各面板筛选`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-edit-module') {
      const moduleId = form.getAttribute('data-module-id') ?? '';
      const baseVersion = Number(form.getAttribute('data-base-version') ?? '1');
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      const status = String(fd.get('status') ?? 'enabled') as
        | 'enabled'
        | 'disabled'
        | 'archived';

      try {
        await api.updateModule(moduleId, {
          base_version: baseVersion,
          name,
          status
        });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已更新模块「${name}」状态为 ${status}`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (form.id === 'ld-form-create-template') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const name = String(fd.get('name') ?? '').trim();
      const fields: Field[] = [
        {
          key: String(fd.get('f1_key') ?? 'topic').trim(),
          label: String(fd.get('f1_label') ?? '实际内容').trim(),
          type: String(fd.get('f1_type') ?? 'text') as Field['type'],
          required: true,
          unit: null,
          options: [],
          minimum: null,
          maximum: null
        }
      ];
      if (fd.get('include_f2')) {
        const f2Key = String(fd.get('f2_key') ?? '').trim();
        const f2Label = String(fd.get('f2_label') ?? '').trim();
        if (f2Key && f2Label && f2Key !== fields[0].key) {
          fields.push({
            key: f2Key,
            label: f2Label,
            type: String(fd.get('f2_type') ?? 'integer') as Field['type'],
            required: false,
            unit: String(fd.get('f2_unit') ?? '').trim() || null,
            options: [],
            minimum: 0,
            maximum: null
          });
        }
      }

      try {
        await api.createRecordType({ module_id, name, fields });
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建记录模板「${name}」`);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }
  });
}

setupEventDelegation();
void initializeApp();
