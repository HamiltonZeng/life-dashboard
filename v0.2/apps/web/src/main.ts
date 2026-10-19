/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {
  DASHBOARD_STYLES,
  escapeHtml,
  renderIcon,
  SUBMISSION_STATE_META
} from '../../../packages/ui/src/index.js';
import { api, ApiClientError, generateUuid, isUnknownNetworkError } from './api.js';
import {
  assertUserExportPayload,
  buildExportFilename,
  ExportPayloadError,
  serializeUserExport,
  summarizeUserExport
} from './export.js';
import {
  bindDynamicModalControllers,
  captureActiveFormSnapshot,
  extractRecordFormDraft,
  restoreActiveFormSnapshot
} from './forms.js';
import { renderActiveModal,renderSubmissionStatusPill } from './modals.js';
import {
  renderAchievementsPanel,
  renderMetricsPanel,
  renderRecordsPanel,
  renderSettingsPanel,
  renderTasksPanel
} from './panels.js';
import {
  createInitialRecordFormState,
  createInitialState,
  parseRouteFromLocation,
  routeToPanelKey,
  type AppState
} from './state.js';
import {
  buildRecordDraftKey,
  clearPendingMutation,
  clearRecordDraft,
  computePayloadSignature,
  getPendingMutation,
  loadRecordDraft,
  loadUiPreferences,
  prepareRecordMutationEnvelope,
  savePendingMutation,
  saveRecordDraft,
  saveUiPreferences
  ,getStorageIssue
} from './storage.js';
import type {
  AiApplyMode,
  AiBatchRow,
  AiContentType,
  AiGenerationRequest,
  AiJobRow,
  AiMode,
  Field,
  PanelKey,
  PanelRoute,
  RecordInput
} from './types.js';

const state: AppState = createInitialState();

function persistUiState(): void {
  saveUiPreferences({
    theme: state.theme,
    reducedMotion: state.reducedMotion,
    unlockToastEnabled: state.unlockToastEnabled,
    showInactiveModulesInFilter: state.showInactiveModulesInFilter,
    panels: state.panels,
    returnContext: state.returnContext
  });
}

function hydrateUiStateFromStorage(): void {
  const saved = loadUiPreferences();
  if (!saved) return;
  if (saved.theme === 'dark' || saved.theme === 'light') state.theme = saved.theme;
  if (typeof saved.reducedMotion === 'boolean') state.reducedMotion = saved.reducedMotion;
  if (typeof saved.unlockToastEnabled === 'boolean') {
    state.unlockToastEnabled = saved.unlockToastEnabled;
  }
  if (typeof saved.showInactiveModulesInFilter === 'boolean') {
    state.showInactiveModulesInFilter = saved.showInactiveModulesInFilter;
  }
  if (saved.panels) {
    for (const k of ['tasks', 'metrics', 'achievements', 'records', 'settings'] as const) {
      if (saved.panels[k]) {
        state.panels[k] = { ...state.panels[k], ...saved.panels[k] };
      }
    }
  }
  if (saved.returnContext) {
    state.returnContext = saved.returnContext;
  }
}

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

function renderToastsHtml(): string {
  if (state.toasts.length === 0) return '';
  return `<div class="ld-toast-container" aria-live="polite">
    ${state.toasts
      .map(
        t => `<div class="ld-toast ${t.kind === 'unlock' ? 'is-unlock' : ''}">
          <div style="font-weight:700;margin-bottom:2px;">${escapeHtml(t.title)}</div>
          <div style="color:var(--ld-text-secondary);">${escapeHtml(t.message)}</div>
        </div>`
      )
      .join('')}
  </div>`;
}

/**
 * Region-scoped toast update: never re-renders the main panel or active modal,
 * preventing any loss of unsaved form input when toasts appear or expire.
 */
function renderToastsOnly(): void {
  const layer = document.getElementById('ld-toast-layer');
  if (layer) {
    layer.innerHTML = renderToastsHtml();
  }
}

/**
 * Updates only the S1 submission status bar inside the active record form modal
 * without re-rendering form inputs.
 */
function updateRecordStatusBarOnly(): void {
  const bar = document.querySelector('#ld-form-record .ld-draft-status-bar');
  if (!bar) return;
  bar.outerHTML=renderSubmissionStatusPill(state);
}

export function renderModalRegionOnly(preserveInput = false): void {
  const modalLayer = document.getElementById('ld-modal-layer');
  if (!modalLayer || !state.bootstrap) return;
  const snapshot = preserveInput ? captureActiveFormSnapshot() : null;
  modalLayer.innerHTML = renderActiveModal(state, state.bootstrap);
  if (snapshot) {
    restoreActiveFormSnapshot(snapshot);
  }
  bindDynamicModalControllers(
    state,
    () => renderModalRegionOnly(false),
    () => updateRecordStatusBarOnly()
  );
}

function pushToast(
  title: string,
  message: string,
  kind: 'info' | 'success' | 'unlock' | 'warning' = 'info'
): void {
  const id = generateUuid();
  state.toasts.push({ id, title, message, kind });
  renderToastsOnly();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter(t => t.id !== id);
    renderToastsOnly();
  }, 4200);
}

/**
 * S1 minimal export: hands the server export envelope to the browser as a file.
 * The JSON text is never stored in localStorage, never logged, and contains no
 * session/credential material — only the whitelisted user data tables.
 */
function downloadTextFile(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function exportUserData(): Promise<void> {
  if (state.exportUi.status === 'exporting') return;
  state.exportUi = {
    status: 'exporting',
    message: '正在从服务器读取完整数据快照（只读 GET /api/v1/export）…',
    fileName: null
  };
  renderApp({ preserveModalInput: true });
  try {
    const payload = assertUserExportPayload(await api.exportUserData());
    const fileName = buildExportFilename(
      payload.exported_at,
      payload.user?.timezone ?? state.user?.timezone
    );
    downloadTextFile(fileName, serializeUserExport(payload));
    const summary = summarizeUserExport(payload);
    state.exportUi = {
      status: 'success',
      message: `已下载 ${summary.table_count} 张表 / ${summary.row_count} 行数据；服务端校验和 ${payload.checksum.slice(0, 12)}…`,
      fileName
    };
    renderApp({ preserveModalInput: true });
    pushToast('数据导出成功', `已保存 ${fileName}；该文件可用于离线备份与 CLI 恢复`, 'success');
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 401) {
      state.authStatus = 'unauthenticated';
      state.user = null;
      state.bootstrap = null;
      state.loginError = '会话已过期或未登录，请重新输入本地登录口令。';
      state.exportUi = { status: 'error', message: '导出失败：会话已过期，请重新登录', fileName: null };
      renderApp();
      return;
    }
    const desc = describeApiError(err);
    state.exportUi = {
      status: 'error',
      message: `导出失败：${desc.message}`,
      fileName: null
    };
    renderApp({ preserveModalInput: true });
    pushToast(`导出失败${desc.code ? ` (${desc.code})` : ''}`, desc.message, 'warning');
  }
}

function saveCurrentScroll(): void {
  const key = routeToPanelKey(state.route);
  if (key) {
    state.panels[key].scrollY = window.scrollY || 0;
  }
}

function prepareRecordFormModal(params: {
  mode: 'create' | 'edit';
  recordId?: string;
  defaultModuleId: string;
  defaultRecordTypeId: string;
  defaultTaskIds: string[];
  fromTaskId?: string;
}): void {
  const draftKey = buildRecordDraftKey({
    mode: params.mode,
    recordId: params.recordId,
    moduleId: params.defaultModuleId,
    recordTypeId: params.defaultRecordTypeId,
    fromTaskId: params.fromTaskId
  });
  const savedDraft = loadRecordDraft(draftKey);
  const pendingOp = getPendingMutation(draftKey);

  state.recordForm = {
    baseVersion:savedDraft?.baseVersion??(params.mode==='edit'?state.bootstrap?.records.find(r=>r.id===params.recordId)?.version:null),
    draftKey,
    submissionStatus: pendingOp
      ? 'unknown_network'
      : savedDraft
        ? 'saved_local'
        : 'idle',
    operationId: pendingOp ? pendingOp.operationId : null,
    recordId:
      params.recordId ??
      pendingOp?.recordId ??
      savedDraft?.recordId ??
      generateUuid(),
    restoredFromStorage: Boolean(savedDraft || pendingOp),
    lastSavedLocalAt: savedDraft?.updatedAt ?? null,
    conflictError: null,
    conflictServerRecord: null,
    validationError: null
  };
  state.modalError = null;
  state.activeModal = {
    kind: 'record-form',
    ...params
  };
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
  persistUiState();
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
          <div style="font-size:12px;color:var(--ld-text-secondary);">v0.1 · 本机单用户记录</div>
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
      count: data ? data.tasks.filter(t => t.status !== 'completed' && t.status !== 'cancelled').length : undefined,
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

    <div id="ld-main-region" style="flex:1;min-width:0;display:flex;flex-direction:column;">
      ${mainContentHtml}
    </div>

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
    <div id="ld-modal-layer">${data ? renderActiveModal(state, data) : ''}</div>
    <div id="ld-toast-layer">${renderToastsHtml()}</div>
  </div>`;
}

export function renderApp(options: { preserveModalInput?: boolean } = {}): void {
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

  const snapshot = options.preserveModalInput ? captureActiveFormSnapshot() : null;
  root.innerHTML = renderShellAndMain();
  if (snapshot) {
    restoreActiveFormSnapshot(snapshot);
  }
  bindDynamicModalControllers(
    state,
    () => renderModalRegionOnly(false),
    () => updateRecordStatusBarOnly()
  );
}

async function refreshBootstrapAndNotify(
  actionSummary?: string,
  checkUnlocks = false,
  preserveModalInput = false
): Promise<void> {
  const prevUnlockedIds = new Set(
    (state.bootstrap?.achievement_awards ?? [])
      .filter(a => a.state === 'unlocked')
      .map(a => a.achievement_id)
  );
  const fresh = await api.getBootstrap();
  state.bootstrap = fresh;
  state.error = null;

  renderApp({ preserveModalInput });

  if (actionSummary) {
    pushToast('服务器已确认', actionSummary, 'success');
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
}

function handleApiError(err: unknown, options: { insideModal?: boolean } = {}): void {
  if (err instanceof ApiClientError) {
    if (err.status === 401) {
      state.authStatus = 'unauthenticated';
      state.loginError = '会话已过期或未登录，请重新输入本地登录口令。';
      renderApp();
      return;
    }
    if (options.insideModal && state.activeModal) {
      if (err.status === 409) {
        state.modalError = {
          code: err.code,
          message: err.message
        };
      }
      state.error = {
        code: err.code,
        message: err.message,
        requestId: err.requestId
      };
      renderModalRegionOnly(true);
      pushToast(`请求冲突/错误 (${err.code})`, err.message, 'warning');
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
  renderApp({ preserveModalInput: true });
}

function describeApiError(err: unknown): { code?: string; message: string } {
  if (err instanceof ApiClientError) return { code: err.code, message: err.message };
  if (err instanceof ExportPayloadError) return { code: err.code, message: err.message };
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
  if(!state.capabilities?.ai_generation)return;
  state.ai.configLoading = true;
  state.ai.configError = null;
  if (state.route === '/settings' || state.activeModal?.kind === 'ai-generate') {
    renderApp({ preserveModalInput: true });
  }
  try {
    state.ai.config = await api.getAiConfig();
  } catch (err) {
    state.ai.configError = describeApiError(err);
  } finally {
    state.ai.configLoading = false;
    if (state.route === '/settings' || state.activeModal?.kind === 'ai-generate') {
      renderApp({ preserveModalInput: true });
    }
  }
}

async function loadAiJobs(): Promise<void> {
  if(!state.capabilities?.ai_generation)return;
  state.ai.jobsLoading = true;
  state.ai.jobsError = null;
  if (state.route === '/settings') {
    renderApp({ preserveModalInput: true });
  }
  try {
    state.ai.jobs = await api.listAiGenerations({ limit: 10 });
  } catch (err) {
    state.ai.jobsError = describeApiError(err);
  } finally {
    state.ai.jobsLoading = false;
    if (state.route === '/settings') {
      renderApp({ preserveModalInput: true });
    }
  }
}

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
  renderModalRegionOnly(false);
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
      renderModalRegionOnly(false);
    } else if (action === 'retry') {
      pushToast('重新生成完成', aiJobToast(envelope.job), envelope.job.validation.valid ? 'info' : 'warning');
      renderModalRegionOnly(false);
    } else {
      pushToast('候选已生成', aiJobToast(envelope.job), envelope.job.validation.valid ? 'info' : 'warning');
      renderModalRegionOnly(false);
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
          // Keep error banner
        }
      }
    } else {
      state.ai.resultError = describeApiError(err);
    }
    await refreshAiJobsQuietly();
    renderModalRegionOnly(false);
  }
}

async function runAiRevoke(batchId: string): Promise<void> {
  if (state.ai.busy) return;
  state.ai.busy = true;
  state.ai.resultError = null;
  renderModalRegionOnly(false);
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
    renderModalRegionOnly(false);
  }
}

async function initializeApp(): Promise<void> {
  hydrateUiStateFromStorage();
  state.route = parseRouteFromLocation(window.location.pathname);
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
      persistUiState();
      renderApp();
    } else if (action === 'filter-record-status') {
      const val = (target as HTMLSelectElement).value as 'all' | 'confirmed' | 'draft';
      state.panels.records.recordStatus = val;
      persistUiState();
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
      persistUiState();
      renderApp({ preserveModalInput: true });
      return;
    }

    if (action === 'toggle-reduced-motion') {
      state.reducedMotion = !state.reducedMotion;
      persistUiState();
      renderApp({ preserveModalInput: true });
      return;
    }

    if (action === 'toggle-unlock-toast') {
      state.unlockToastEnabled = !state.unlockToastEnabled;
      persistUiState();
      renderApp({ preserveModalInput: true });
      return;
    }

    if (action === 'toggle-inactive-modules') {
      state.showInactiveModulesInFilter = !state.showInactiveModulesInFilter;
      persistUiState();
      renderApp({ preserveModalInput: true });
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
        await refreshBootstrapAndNotify('已刷新服务器数据', false, true);
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (action === 'export-data') {
      void exportUserData();
      return;
    }

    if (action === 'filter-module') {
      const modId = target.getAttribute('data-module-id') || null;
      const key = routeToPanelKey(state.route);
      if (key) {
        state.panels[key].moduleId = modId;
        if (key === 'records') {
          state.panels.records.recordTemplateId = null;
        }
        persistUiState();
        renderApp();
      }
      return;
    }

    if (action === 'panel-subtab') {
      const subTab = target.getAttribute('data-subtab') ?? 'all';
      const key = routeToPanelKey(state.route);
      if (key) {
        state.panels[key].subTab = subTab;
        persistUiState();
        renderApp();
      }
      return;
    }

    if (action === 'close-modal') {
      state.activeModal = null;
      state.modalError = null;
      renderApp();
      return;
    }

    if (action === 'close-modal-backdrop') {
      if (e.target === target) {
        state.activeModal = null;
        state.modalError = null;
        renderApp();
      }
      return;
    }

    if (action === 'discard-record-draft') {
      const key = state.recordForm.draftKey;
      if(key&&getPendingMutation(key)){pushToast('还有待确认的提交','请先确认上次结果；丢弃草稿不能撤销已发送的记录。','warning');return;}
      if (key) {
        clearRecordDraft(key);
      }
      state.recordForm = {
        ...createInitialRecordFormState(),
        draftKey: key,
        recordId: generateUuid()
      };
      renderModalRegionOnly(false);
      pushToast('本机草稿已丢弃', '已清空当前未提交的本地草稿与待重试状态', 'info');
      return;
    }

    if (action === 'resume-latest-draft' && data) {
      const draftKey = target.getAttribute('data-draft-key') ?? '';
      const saved = loadRecordDraft(draftKey);
      if (saved) {
        prepareRecordFormModal({
          mode: saved.mode,
          recordId: saved.mode === 'edit' ? saved.recordId : undefined,
          defaultModuleId: saved.moduleId,
          defaultRecordTypeId: saved.recordTypeId,
          defaultTaskIds: saved.taskIds,
          fromTaskId: saved.fromTaskId
        });
        renderApp();
      }
      return;
    }

    if (action === 'conflict-pull-latest' && data) {
      try {
        const fresh = await api.getBootstrap();
        state.bootstrap = fresh;
        if (state.activeModal?.kind === 'record-form' && state.activeModal.recordId) {
          const srv = fresh.records.find(r => r.id === state.activeModal?.kind && false) ??
            fresh.records.find(r => r.id === (state.activeModal as { recordId?: string }).recordId);
          state.recordForm.conflictServerRecord = srv ?? null;
        }
        renderModalRegionOnly(true);
        pushToast('已拉取服务器最新版本', '你可以核对服务器最新值后重新提交，或点击丢弃本地草稿', 'info');
      } catch (err) {
        handleApiError(err, { insideModal: true });
      }
      return;
    }

    if(action==='conflict-adopt-version'&&data){
      const srv=state.recordForm.conflictServerRecord;
      const form=document.getElementById('ld-form-record') as HTMLFormElement|null;
      if(srv&&form){form.setAttribute('data-base-version',String(srv.version));state.recordForm.baseVersion=srv.version;state.recordForm.conflictError=null;state.recordForm.submissionStatus='saved_local';const draft=extractRecordFormDraft(form,state,data);if(draft)saveRecordDraft(draft);renderModalRegionOnly(true);pushToast('已采用新版本作为编辑基线','本地输入仍保留，请核对后提交修改。','info');}
      return;
    }
    if(action==='copy-record-draft'&&data){const form=document.getElementById('ld-form-record') as HTMLFormElement|null;if(form){const draft=extractRecordFormDraft(form,state,data);try{await navigator.clipboard.writeText(JSON.stringify(draft,null,2));pushToast('已复制输入','请保存在安全位置。','info');}catch{pushToast('无法访问剪贴板','请直接选择表单内容复制，输入仍在当前页面。','warning');}}return;}

    if (action === 'return-context' && state.returnContext) {
      const ctx = state.returnContext;
      state.panels[ctx.fromPanelKey] = { ...ctx.savedFilter };
      state.returnContext = null;
      state.activeModal = null;
      state.modalError = null;
      persistUiState();
      navigateTo(ctx.fromRoute, { preserveReturnContext: false });
      return;
    }

    if (action === 'clear-return-context') {
      state.returnContext = null;
      persistUiState();
      renderApp();
      return;
    }

    if (action === 'clear-record-source-filter') {
      state.panels.records.sourceRecordIds = null;
      state.panels.records.sourceLabel = null;
      persistUiState();
      renderApp();
      return;
    }

    if (!data) return;

    if (action === 'open-create-task') {
      state.modalError = null;
      state.activeModal = {
        kind: 'create-task',
        defaultModuleId: state.panels.tasks.moduleId
      };
      renderApp();
      return;
    }

    if (action === 'open-ai-modal') {
      const sourcePanel = (target.getAttribute('data-ai-source-panel') ??
        routeToPanelKey(state.route)) as PanelKey | null;
      const panelModuleId = sourcePanel ? state.panels[sourcePanel]?.moduleId ?? null : null;
      state.ai.result = null;
      state.ai.resultError = null;
      state.modalError = null;
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
      state.modalError = null;
      state.activeModal = { kind: 'task-detail', taskId };
      persistUiState();
      renderApp();
      return;
    }

    if (action === 'task-go-record') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const task = data.tasks.find(t => t.id === taskId);
      if (!task || task.status === 'cancelled' || task.status === 'skipped') return;
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
      prepareRecordFormModal({
        mode: 'create',
        defaultModuleId: task.module_id,
        defaultRecordTypeId: tplId,
        defaultTaskIds: [task.id],
        fromTaskId: task.id
      });
      renderApp();
      return;
    }

    if (action === 'task-complete-manual') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const task = data.tasks.find(t => t.id === taskId);
      if (!task || task.status === 'cancelled' || task.status === 'skipped') return;
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
      prepareRecordFormModal({
        mode: 'create',
        defaultModuleId: modId,
        defaultRecordTypeId: tplId,
        defaultTaskIds: []
      });
      renderApp();
      return;
    }

    if (action === 'open-edit-record') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      const rec = data.records.find(r => r.id === recordId);
      if (!rec) return;
      state.panels.records.selectedId = recordId;
      prepareRecordFormModal({
        mode: 'edit',
        recordId: rec.id,
        defaultModuleId: rec.module_id,
        defaultRecordTypeId: rec.record_type_id,
        defaultTaskIds: rec.task_ids
      });
      renderApp();
      return;
    }

    if (action === 'open-record-detail') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      state.panels.records.selectedId = recordId;
      state.modalError = null;
      state.activeModal = { kind: 'record-detail', recordId };
      renderApp();
      return;
    }

    if (action === 'delete-record') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      const rec = data.records.find(r => r.id === recordId);
      if (!rec || state.submittingModal) return;
      state.submittingModal = true;
      renderModalRegionOnly(false);
      try {
        await api.deleteRecord(rec.id, rec.version);
        state.submittingModal = false;
        state.activeModal = null;
        clearRecordDraft(`edit:${rec.id}`);
        clearPendingMutation(`edit:${rec.id}`);
        await refreshBootstrapAndNotify(
          '记录已软删除，关联任务与成就已重新评估（失去唯一证据项已标为待复核）'
        );
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
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
      state.modalError = null;
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
      state.modalError = null;
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
      prepareRecordFormModal({
        mode: 'create',
        defaultModuleId: m.module_id,
        defaultRecordTypeId: m.record_type_id,
        defaultTaskIds: []
      });
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
      state.modalError = null;
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
      state.modalError = null;
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
      state.modalError = null;
      state.activeModal = { kind: 'create-module' };
      renderApp();
      return;
    }

    if (action === 'open-edit-module') {
      const moduleId = target.getAttribute('data-module-id') ?? '';
      state.modalError = null;
      state.activeModal = { kind: 'edit-module', moduleId };
      renderApp();
      return;
    }

    if (action === 'open-create-template') {
      state.modalError = null;
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
      if (!secret || state.loading) return;
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
      if (state.ai.busy) return;
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
            envelope.job.validation.valid ? '候选已生成' : '候选未通过校验',
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
              // Keep honest error banner
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

    if (form.id === 'ld-form-record') {
      if (state.submittingModal) return;
      const draft = extractRecordFormDraft(form, state, data);
      if (!draft) return;

      if(!saveRecordDraft(draft)){
        state.recordForm.submissionStatus='validation_error';state.recordForm.validationError={code:'LOCAL_STORAGE_FAILED',message:getStorageIssue()??'未保存本机，尚未发送请求'};
        renderModalRegionOnly(true);return;
      }
      const signature = computePayloadSignature({
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

      const candidatePayload: RecordInput | (Omit<RecordInput, 'id'> & { base_version: number }) =
        draft.mode === 'edit'
          ? {
              base_version: draft.baseVersion ?? 1,
              module_id: draft.moduleId,
              record_type_id: draft.recordTypeId,
              schema_version: draft.schemaVersion,
              occurred_at: draft.occurredAt,
              timezone: draft.timezone,
              status: draft.status,
              values: draft.values,
              task_ids: draft.taskIds
            }
          : {
              id: draft.recordId,
              module_id: draft.moduleId,
              record_type_id: draft.recordTypeId,
              schema_version: draft.schemaVersion,
              occurred_at: draft.occurredAt,
              timezone: draft.timezone,
              status: draft.status,
              values: draft.values,
              task_ids: draft.taskIds
            };

      const prepared = prepareRecordMutationEnvelope({
        draftKey: draft.draftKey,
        mode: draft.mode,
        candidateRecordId: draft.recordId,
        candidatePayload,
        signature,
        allocateUuid: generateUuid
      });

      const previous=getPendingMutation(draft.draftKey);
      const pending={draftKey:draft.draftKey,operationId:prepared.operationId,recordId:prepared.recordId,mode:prepared.mode,payloadSignature:previous?.payloadSignature??signature,frozenPayload:prepared.payload,lastError:{code:'AWAITING_RECEIPT',message:'等待服务器确认'},savedAt:previous?.savedAt??new Date().toISOString()};
      if(!savePendingMutation(pending)){
        state.recordForm.submissionStatus='validation_error';state.recordForm.validationError={code:'LOCAL_STORAGE_FAILED',message:getStorageIssue()??'待确认操作未能保存本机，未发送请求'};
        renderModalRegionOnly(true);return;
      }

      state.submittingModal = true;
      state.recordForm.submissionStatus = 'submitting';
      state.recordForm.operationId = prepared.operationId;
      state.recordForm.recordId = prepared.recordId;
      state.recordForm.conflictError = null;
      state.recordForm.validationError = null;
      state.modalError = null;
      renderModalRegionOnly(true);

      let confirmed:import('./types.js').RecordRow;
      try {
        if (prepared.mode === 'edit') {
          confirmed=await api.updateRecord(
            prepared.recordId,
            prepared.payload as Omit<RecordInput, 'id'> & { base_version: number },
            prepared.operationId
          );
        } else {
          confirmed=await api.createRecord(prepared.payload as RecordInput, prepared.operationId);
        }
      } catch (err) {
        state.submittingModal = false;
        if (isUnknownNetworkError(err)) {
          // S1: Unknown network result -> keep exact operationId & frozenPayload for safe idempotent retry
          const errMsg = err instanceof Error ? err.message : '网络结果未知';
          savePendingMutation({...pending,lastError:{code:'NETWORK_UNKNOWN',message:errMsg}});
          state.recordForm.submissionStatus = 'unknown_network';
          renderModalRegionOnly(true);
          pushToast(
            '网络结果未知（已保留本机草稿）',
            '未收到服务器回执。请先确认上次提交，当前修改将单独保留，不会另建一条记录。',
            'warning'
          );
          return;
        }

        // Definite server error (400 / 409 / 422): clear pending network retry so next edit gets a fresh operation_id,
        // while keeping the local draft and form inputs intact!
        clearPendingMutation(draft.draftKey);
        state.recordForm.operationId = null;

        if (err instanceof ApiClientError && err.status === 409) {
          state.recordForm.submissionStatus = 'conflict_pending';
          state.recordForm.conflictError = {
            code: err.code,
            message: err.message,
            requestId: err.requestId
          };
          renderModalRegionOnly(true);
          pushToast(`版本/状态冲突 (${err.code})`, `${err.message}；已保留你当前的本地输入`, 'warning');
          return;
        }

        const desc = describeApiError(err);
        state.recordForm.submissionStatus = 'validation_error';
        state.recordForm.validationError = {
          code: desc.code ?? 'VALIDATION_ERROR',
          message: desc.message
        };
        renderModalRegionOnly(true);
        pushToast(`校验未通过 (${desc.code ?? 'ERROR'})`, desc.message, 'warning');
        return;
      }
      state.submittingModal=false;
      // Confirmation and refreshing the list are separate operations. A failed GET
      // must never reclassify an already acknowledged write as an unknown mutation.
      if(previous&&previous.payloadSignature!==signature){
        const editKey=buildRecordDraftKey({mode:'edit',recordId:confirmed.id,moduleId:draft.moduleId,recordTypeId:draft.recordTypeId});
        const working={...draft,draftKey:editKey,mode:'edit' as const,recordId:confirmed.id,baseVersion:confirmed.version};
        if(!saveRecordDraft(working)){
          state.recordForm.submissionStatus='validation_error';state.recordForm.validationError={code:'LOCAL_STORAGE_FAILED',message:'上次记录已在服务器确认；当前修改未保存本机，请复制输入后重试。'};renderModalRegionOnly(true);return;
        }
        clearPendingMutation(draft.draftKey);if(editKey!==draft.draftKey)clearRecordDraft(draft.draftKey);
        try{state.bootstrap=await api.getBootstrap();}catch{if(state.bootstrap&&!state.bootstrap.records.some(r=>r.id===confirmed.id))state.bootstrap.records.push(confirmed);}
        prepareRecordFormModal({mode:'edit',recordId:confirmed.id,defaultModuleId:draft.moduleId,defaultRecordTypeId:draft.recordTypeId,defaultTaskIds:draft.taskIds});
        renderApp();pushToast('上次提交已确认','当前修改仍是草稿，请核对后保存到同一条记录。','info');return;
      }
      clearPendingMutation(draft.draftKey);clearRecordDraft(draft.draftKey);
      state.recordForm.submissionStatus='confirmed_server';state.activeModal=null;
      try{await refreshBootstrapAndNotify('服务器已确认保存记录',true);}catch{renderApp();pushToast('记录已确认，列表刷新失败','记录已经保存；请刷新列表，无需重新创建。','warning');}
      return;
    }

    if (state.submittingModal) return;

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

      state.submittingModal = true;
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
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建任务「${title}」`);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
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

      state.submittingModal = true;
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
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建数值定义「${name}」`);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
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

      state.submittingModal = true;
      try {
        await api.createAchievement({
          module_id,
          metric_id,
          name,
          operator,
          threshold,
          history_policy
        });
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建成就定义「${name}」`, true);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
      }
      return;
    }

    if (form.id === 'ld-form-create-module') {
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      const description = String(fd.get('description') ?? '').trim();
      const icon = String(fd.get('icon') ?? 'book') as any;
      const color = String(fd.get('color') ?? 'blue') as any;

      state.submittingModal = true;
      try {
        await api.createModule({ name, description, icon, color });
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建自定义模块「${name}」，现已加入各面板筛选`);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
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

      state.submittingModal = true;
      try {
        await api.updateModule(moduleId, {
          base_version: baseVersion,
          name,
          status
        });
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已更新模块「${name}」状态为 ${status}`);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
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

      state.submittingModal = true;
      try {
        await api.createRecordType({ module_id, name, fields });
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(`已创建记录模板「${name}」`);
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
      }
      return;
    }
  });
}

setupEventDelegation();
void initializeApp();
