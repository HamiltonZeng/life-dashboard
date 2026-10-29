import {reports} from './report-ui.js';
import {planning} from './planning-ui.js';
import {handleTaskEvent} from './task-events.js';
import {handleTrendEvent} from './trend-events.js';
import {handleWalletEvent} from './wallet-events.js';
import {submitObservation} from './observation-submit.js';
import {PeriodicSync} from './periodic-sync.js';
import {submitPhase2Command} from './phase2-submit.js';
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
import {
  createStaticAvatarRenderer,
  DASHBOARD_STYLES,
  escapeHtml,
  renderIcon
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
  extractConfigFormDraft,
  extractProfileFormToState,
  extractRecordFormDraft,
  restoreActiveFormSnapshot
} from './forms.js';
import {
  renderActiveModal,
  renderConfigSubmissionStatusPill,
  renderSubmissionStatusPill
} from './modals.js';
import {
  buildFallbackHomeFromBootstrap,
  renderAchievementsPanel,
  renderHomePanel,
  renderMetricsPanel,
  renderProfileStatusBar,
  renderRecordsPanel,
  renderSettingsPanel,
  renderTasksPanel
} from './panels.js';
import {
  createInitialConfigFormState,
  createInitialProfileFormState,
  createInitialRecordFormState,
  createInitialState,
  createInitialTrendControlState,
  parseRouteFromLocation,
  routeToPanelKey,
  syncProfileFormFromServer,
  type AppState
} from './state.js';
import {
  buildConfigDraftKey,
  buildRecordDraftKey,
  clearAiDraft,
  clearConfigDraft,
  clearPendingConfigMutation,
  clearPendingMutation,
  clearProfileDraft,
  clearRecordDraft,
  computeConfigPayloadSignature,
  computePayloadSignature,
  getPendingConfigMutation,
  getPendingMutation,
  getStorageIssue,
  loadConfigDraft,
  loadProfileDraft,
  loadRecordDraft,
  loadUiPreferences,
  prepareConfigMutationEnvelope,
  prepareRecordMutationEnvelope,
  saveAiDraft,
  saveConfigDraft,
  savePendingConfigMutation,
  savePendingMutation,
  saveProfileDraft,
  saveRecordDraft,
  saveUiPreferences
} from './storage.js';
import type {
  AchievementSeriesInput,
  AchievementSeriesMilestoneInput,
  AiApplyMode,
  AiBatchRow,
  AiContentType,
  AiDraftScope,
  AiGenerationRequest,
  AiJobRow,
  AiMode,
  ConfigMutationKind,
  Field,
  HomePreferencesInput,
  PanelKey,
  PanelRoute,
  ProfileData,
  ProfileFieldRow,
  ProfileInput,
  RecordInput,
  TaskCategory,
  TaskColor,
  TaskRule,
  TaskRow,
  TaskTemplateInput,
  TaskTemplatePatch,
  TrendPin,
  TypedTaskPin
} from './types.js';

const state: AppState = createInitialState();
export const avatarRenderer = createStaticAvatarRenderer();
const periodic=new PeriodicSync({state:(status,message)=>{state.periodicSync={status,message};},refresh:async()=>{state.bootstrap=await api.getBootstrap();await Promise.all([syncHomeAndProfileQuietly(),syncPhase2DomainQuietly()]);}});
async function refreshPeriodic(force=false){try{await periodic.ensure(force);}catch{}if(state.authStatus==='authenticated')renderApp({preserveModalInput:true});}


function persistUiState(): void {
  saveUiPreferences({
    theme: state.theme,
    reducedMotion: state.reducedMotion,
    unlockToastEnabled: state.unlockToastEnabled,
    showInactiveModulesInFilter: state.showInactiveModulesInFilter,
    panels: state.panels,
    taskFilter:state.taskFilter,
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
  if(saved.taskFilter)state.taskFilter={...state.taskFilter,...saved.taskFilter};
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
  bar.outerHTML = renderSubmissionStatusPill(state);
}

function updateConfigStatusBarOnly(): void {
  const bar = document.querySelector('form[data-config-kind] .ld-draft-status-bar');
  if (!bar) return;
  bar.outerHTML = renderConfigSubmissionStatusPill(state);
}

function updateProfileStatusBarOnly(): void {
  const bar = document.getElementById('ld-profile-status-bar');
  if (!bar) return;
  bar.outerHTML = renderProfileStatusBar(state);
}

function syncAvatarRendererLifecycle(): void {
  if (typeof document === 'undefined') return;
  const isHomeStandard =
    state.authStatus === 'authenticated' &&
    state.route === '/' &&
    !state.homePreferences?.minimal_mode;
  if (!isHomeStandard) {
    avatarRenderer.pause();
    avatarRenderer.dispose();
    return;
  }
  const slot = document.getElementById('ld-home-avatar-slot');
  if (slot) {
    avatarRenderer.mount(
      slot,
      {
        character_id: state.profile?.id ?? state.user?.id ?? 'local-character',
        model_asset_ref: null,
        action_id: 'idle',
        reduced_motion: state.reducedMotion,
        version: state.profile?.version ?? 1
      },
      {
        reduced_motion: state.reducedMotion
      }
    );
  }
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
    () => updateRecordStatusBarOnly(),
    () => updateConfigStatusBarOnly(),
    () => updateProfileStatusBarOnly()
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

function prepareConfigFormModal(
  kind: ConfigMutationKind,
  modal: NonNullable<AppState['activeModal']>
): void {
  const draftKey = buildConfigDraftKey(kind);
  const savedDraft = loadConfigDraft(draftKey);
  const pendingOp = getPendingConfigMutation(draftKey);
  state.configForm = {
    draftKey,
    kind,
    submissionStatus: pendingOp ? 'unknown_network' : savedDraft?.confirmedEntityId ? 'confirmed_server' : savedDraft ? 'saved_local' : 'idle',
    operationId: pendingOp ? pendingOp.operationId : null,
    entityId: pendingOp?.entityId ?? savedDraft?.entityId ?? generateUuid(),
    restoredFromStorage: Boolean(savedDraft || pendingOp),
    lastSavedLocalAt: savedDraft?.updatedAt ?? null,
    conflictError: null,
    validationError: null
  };
  state.modalError = null;
  state.activeModal = modal;
}

function shouldGuardProfileUnsavedLeave(nextRoute?: PanelRoute, nextSubTab?: string): boolean {
  if (state.route !== '/settings' || state.panels.settings.subTab !== 'profile') {
    return false;
  }
  if (!state.profileForm.dirty) return false;
  if (nextRoute !== undefined && nextRoute !== '/settings') {
    state.profileForm.pendingLeaveTarget = { kind: 'route', route: nextRoute };
    renderApp({ preserveModalInput: true });
    return true;
  }
  if (nextSubTab !== undefined && nextSubTab !== 'profile') {
    state.profileForm.pendingLeaveTarget = { kind: 'subtab', subTab: nextSubTab };
    renderApp({ preserveModalInput: true });
    return true;
  }
  return false;
}

function navigateTo(
  route: PanelRoute,
  options: { pushHistory?: boolean; preserveReturnContext?: boolean; bypassUnsavedGuard?: boolean } = {}
): void {
  if (!options.bypassUnsavedGuard && shouldGuardProfileUnsavedLeave(route)) {
    return;
  }
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
  if(state.authStatus==='authenticated'&&['/','/tasks','/records'].includes(route))void refreshPeriodic(true);
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
          <div style="font-size:12px;color:var(--ld-text-secondary);">v0.3 开发版 · 本机单用户记录</div>
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
      count: state.achievementSummary?.effective_awards_count ?? (data ? data.achievement_awards.filter(a => a.state === 'unlocked').length : undefined),
      warning: Boolean(state.achievementSummary?.needs_review_count || (data ? data.achievement_awards.some(a => a.state === 'needs_review') : false))
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
    mainContentHtml = renderHomePanel(state, data, state.home).replace('</main>',reports.render()+'</main>');
  } else if (!data) {
    mainContentHtml = `<main class="ld-main"><div class="ld-panel-container"><div class="ld-card">正在加载面板数据...</div></div></main>`;
  } else if (state.route === '/tasks') {
    mainContentHtml = `<main class="ld-main">${planning.render('tasks')}${renderTasksPanel(state, data)}</main>`;
  } else if (state.route === '/metrics') {
    mainContentHtml = `<main class="ld-main">${planning.render('metrics')}${renderMetricsPanel(state, data)}</main>`;
  } else if (state.route === '/achievements') {
    mainContentHtml = `<main class="ld-main">${planning.render('achievements')}${renderAchievementsPanel(state, data)}</main>`;
  } else if (state.route === '/records') {
    mainContentHtml = `<main class="ld-main">${planning.render('records')}${renderRecordsPanel(state, data)}</main>`;
  } else if (state.route === '/settings') {
    mainContentHtml = `<main class="ld-main">${planning.render('settings')}${planning.renderSettings()}${reports.render(true)}${renderSettingsPanel(state, data)}</main>`;
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
          <span>👤 ${escapeHtml(state.profile?.nickname ?? state.user?.name ?? '本地用户')}</span>
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
      ${state.phase2LoadError?`<div class="ld-error-banner" role="alert">${escapeHtml(state.phase2LoadError)}<button class="ld-btn" data-action="retry-phase2">重试</button></div>`:''}
    ${state.periodicSync?.status==='syncing'?'<div role="status" data-periodic-status="syncing">正在确认完整当期任务集合…</div>':state.periodicSync?.status==='error'?`<div class="ld-error-banner" role="alert" data-periodic-status="error">当期任务尚未确认：${escapeHtml(state.periodicSync.message??'刷新失败')}<button type="button" class="ld-btn" data-action="task-materialize-current">重试周期刷新</button></div>`:''}
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
  planning.setAccount(state.user?.id??'',state.bootstrap?.modules??[]);
  planning.changed=()=>planning.mount();
  planning.refresh=async()=>{await refreshBootstrapAndNotify(undefined,false,true);};
  root.innerHTML = renderShellAndMain();
  void planning.load();reports.changed=()=>reports.mount();void reports.load(state.user?.id??'');
  if (snapshot) {
    restoreActiveFormSnapshot(snapshot);
  }
  syncAvatarRendererLifecycle();
  bindDynamicModalControllers(
    state,
    () => renderModalRegionOnly(false),
    () => updateRecordStatusBarOnly(),
    () => updateConfigStatusBarOnly(),
    () => updateProfileStatusBarOnly()
  );
}

async function syncHomeAndProfileQuietly(): Promise<void> {
  try {
    const home = await api.getHome();
    state.home = home;
    state.profile = home.profile;
    state.homePreferences = home.preferences;
    if (home.wallet) {
      state.wallet = home.wallet;
    }
    if (home.achievement_summary) {
      state.achievementSummary = home.achievement_summary;
    }
    if (state.user) {
      state.user.name = home.profile.nickname;
      state.user.timezone = home.profile.timezone;
    }
    syncProfileFormFromServer(state, home.profile);
  } catch (err) {
    throw err;
  }
}

const trendRequests=new Map<string,number>();
async function syncMetricTrendQuietly(metricId: string): Promise<void> {
  if (!metricId) return;
  if (!state.metricTrendControls[metricId]) {
    state.metricTrendControls[metricId] = createInitialTrendControlState();
  }
  const ctrl = {...state.metricTrendControls[metricId],excludeDates:[...state.metricTrendControls[metricId].excludeDates]};
  const request=(trendRequests.get(metricId)??0)+1;trendRequests.set(metricId,request);
  try {
    const trend = await api.getMetricTrend(metricId, {
      range: ctrl.range,
      grain: ctrl.grain,
      precision: ctrl.precision,
      exclude_dates: ctrl.excludeDates,
      variance_enabled: ctrl.varianceEnabled,
      variance_threshold: ctrl.varianceThreshold,
      minimum_days: ctrl.minimumDays,
      include_all: ctrl.includeAll
    });
    if(trendRequests.get(metricId)===request){state.metricTrends[metricId]=trend;delete (state.metricTrendErrors??={})[metricId];}
  } catch (err) {
    if(trendRequests.get(metricId)===request){delete state.metricTrends[metricId];(state.metricTrendErrors??={})[metricId]=err instanceof Error?err.message:'趋势读取失败';}
  }
}

async function syncPhase2DomainQuietly(): Promise<void> {
  const allPages=async<T>(get:(offset:number)=>Promise<{data:T[];page:{total:number}}>)=>{const data:T[]=[];let total=0;do{const page=await get(data.length);total=page.page.total;data.push(...page.data);if(!page.data.length)break;}while(data.length<total);return {data,page:{total}};};
  const [tplRes, instRes, seriesRes, summaryRes, walletRes, ledgerRes] = await Promise.allSettled([
    api.getTaskTemplates(),
    allPages<TaskRow>(offset=>api.getTaskInstances({limit:100,offset})),
    allPages<import('./types.js').AchievementSeriesView>(offset=>api.getAchievementSeries({limit:100,offset})),
    api.getAchievementSummary(),
    api.getWallet(),
    api.getWalletLedger({ limit: 50, offset: state.walletLedgerOffset??0, task_id:state.walletLedgerTaskFilter??undefined })
  ]);
  if (tplRes.status === 'fulfilled') state.taskTemplates = tplRes.value;
  if (instRes.status === 'fulfilled') state.taskInstances = instRes.value.data;
  if (seriesRes.status === 'fulfilled') state.achievementSeries = seriesRes.value.data;
  if (summaryRes.status === 'fulfilled') state.achievementSummary = summaryRes.value;
  if (walletRes.status === 'fulfilled') state.wallet = walletRes.value;
  if (ledgerRes.status === 'fulfilled') {
    state.walletLedger = ledgerRes.value.data;
    state.walletLedgerTotal = ledgerRes.value.page.total;
  }
  const metrics = state.bootstrap?.metrics ?? [];
  state.phase2LoadError=[tplRes,instRes,seriesRes,summaryRes,walletRes,ledgerRes].some(r=>r.status==='rejected')?'部分数据读取失败，请刷新重试；未将失败当作空数据。':null;
  await Promise.allSettled(metrics.map(m => syncMetricTrendQuietly(m.id)));
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
  await refreshPeriodic(true);
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
  if(!state.capabilities?.legacy_ai_generation)return;
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
  if(!state.capabilities?.legacy_ai_generation)return;
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
    await refreshPeriodic(true);
    const savedProfileDraft = loadProfileDraft();
    if (savedProfileDraft) {
      state.profileForm = {
        ...createInitialProfileFormState(state.profile),
        baseVersion: savedProfileDraft.baseVersion,
        nickname: savedProfileDraft.nickname,
        bio: savedProfileDraft.bio ?? '',
        bioIsNull: savedProfileDraft.bio === null,
        timezone: savedProfileDraft.timezone,
        fields: savedProfileDraft.upserts ?? [],
        removeIds: savedProfileDraft.removeIds ?? [],
        dirty: true,
        submissionStatus: getPendingConfigMutation(buildConfigDraftKey('profile'))
          ? 'unknown_network'
          : 'saved_local',
        operationId: getPendingConfigMutation(buildConfigDraftKey('profile'))?.operationId ?? null
      };
    }
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

function buildProfilePayload(pf: AppState['profileForm']): ProfileInput {
  return {
    base_version: pf.baseVersion,
    nickname: pf.nickname.trim(),
    bio: pf.bioIsNull ? null : pf.bio,
    timezone: pf.timezone.trim(),
    field_upserts: pf.fields
      .filter(f => state.bootstrap?.modules.some(m => m.id === f.module_id && m.status === 'enabled'))
      .map(f => {
        const kind: ProfileFieldRow['kind'] = f.kind ?? 'profile';
        if (kind === 'observation' || kind === 'derived') {
          return {
            id: f.id,
            module_id: f.module_id,
            key: f.key,
            label: f.label,
            type: f.type,
            kind,
            value: null,
            unit: f.unit,
            options: f.options ?? [],
            binding: f.binding ?? null
          };
        }
        return {
          id: f.id,
          module_id: f.module_id,
          key: f.key,
          label: f.label,
          type: f.type,
          kind: 'profile' as const,
          value: f.value,
          unit: f.unit,
          options: f.options ?? []
        };
      }),
    field_remove_ids: pf.removeIds
  };
}

async function updateHomePreferencesReliably(
  patch: Omit<HomePreferencesInput, 'base_version'>,
  summary: string
): Promise<void> {
  const currentPrefs = state.homePreferences ?? state.home?.preferences;
  const baseVersion = currentPrefs?.version ?? 1;
  const payload: HomePreferencesInput = {
    base_version: baseVersion,
    ...patch
  };
  const draftKey = buildConfigDraftKey('home-preferences');
  const sig = computeConfigPayloadSignature('home-preferences', payload);
  const prepared = prepareConfigMutationEnvelope({
    draftKey,
    kind: 'home-preferences',
    candidateEntityId: state.user?.id ?? 'user-1',
    candidatePayload: payload,
    signature: sig,
    allocateUuid: generateUuid
  });

  if(!savePendingConfigMutation({
    draftKey,
    kind: 'home-preferences',
    operationId: prepared.operationId,
    entityId: prepared.entityId,
    payloadSignature: sig,
    frozenPayload: prepared.payload,
    lastError: { code: 'AWAITING_RECEIPT', message: '等待服务器确认' },
    savedAt: new Date().toISOString()
  })) {
    pushToast('未保存本机',getStorageIssue()??'首页偏好尚未发送，请恢复本机存储后重试','warning');
    return;
  }

  try {
    const updated = await api.updateHomePreferences(prepared.payload, prepared.operationId);
    clearPendingConfigMutation(draftKey);
    state.homePreferences = updated;
    if (state.home) {
      state.home.preferences = updated;
    }
    await syncHomeAndProfileQuietly().catch(() => {});
    renderApp({ preserveModalInput: true });
    pushToast('首页偏好已保存', summary, 'success');
  } catch (err) {
    if (!isUnknownNetworkError(err)) {
      clearPendingConfigMutation(draftKey);
    }
    if (err instanceof ApiClientError && err.status === 409) {
      const srv = (err.details as { current?: typeof state.homePreferences } | undefined)?.current;
      if (srv) {
        state.homePreferences = srv;
        if (state.home) state.home.preferences = srv;
      }
      renderApp({ preserveModalInput: true });
      pushToast('首页偏好版本冲突 (409)', `${err.message}；已同步服务器最新偏好版本`, 'warning');
      return;
    }
    handleApiError(err);
  }
}

function setupEventDelegation(): void {
  window.addEventListener('focus',()=>{if(state.authStatus==='authenticated')void refreshPeriodic(true);});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.authStatus==='authenticated')void refreshPeriodic(true);});
  window.setInterval(()=>{if(document.visibilityState==='visible'&&state.authStatus==='authenticated')void refreshPeriodic();},30000);
  window.addEventListener('beforeunload', e => {
    if (state.profileForm.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  window.addEventListener('popstate', () => {
    const nextRoute = parseRouteFromLocation(window.location.pathname);
    if (shouldGuardProfileUnsavedLeave(nextRoute)) {
      window.history.pushState({ route: state.route }, '', state.route);
      return;
    }
    state.route = nextRoute;
    renderApp();
    if(state.authStatus==='authenticated'&&['/','/tasks','/records'].includes(nextRoute))void refreshPeriodic(true);
  });

  document.addEventListener('keydown',e=>{const t=(e.target as Element)?.closest<HTMLElement>('.ld-trend-point');if(t&&(e.key==='Enter'||e.key===' ')){e.preventDefault();t.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
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
    } else if (action === 'task-filter-change') {
      const key = target.getAttribute('data-filter-key');
      if (key === 'category') {
        state.taskFilter.category = (target as HTMLSelectElement).value as AppState['taskFilter']['category'];
      } else if(key==='moduleId'){state.panels.tasks.moduleId=(target as HTMLSelectElement).value==='all'?null:(target as HTMLSelectElement).value;
      } else if (key === 'status') {
        state.taskFilter.status = (target as HTMLSelectElement).value;
      } else if (key === 'color') {
        state.taskFilter.color = (target as HTMLSelectElement).value;
      } else if (key === 'pinnedOnly') {
        state.taskFilter.pinnedOnly = (target as HTMLInputElement).checked;
      }
      persistUiState();renderApp();
    } else if(action==='trend-set-precision'){const id=target.getAttribute('data-metric-id')!;const ctrl=state.metricTrendControls[id]??=createInitialTrendControlState();ctrl.precision=Number((target as HTMLSelectElement).value);void syncMetricTrendQuietly(id).then(()=>renderApp({preserveModalInput:true}));
    } else if (action === 'trend-set-variance-pct') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return;
      if (!state.metricTrendControls[metricId]) {
        state.metricTrendControls[metricId] = createInitialTrendControlState();
      }
      state.metricTrendControls[metricId].varianceThreshold = Number((target as HTMLSelectElement).value) || 0.5;
      void syncMetricTrendQuietly(metricId).then(() => renderApp({ preserveModalInput: true }));
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

    if (action === 'profile-stay') {
      state.profileForm.pendingLeaveTarget = null;
      renderApp({ preserveModalInput: true });
      return;
    }

    if (action === 'profile-discard-and-leave') {
      const pendingTarget = state.profileForm.pendingLeaveTarget;
      clearProfileDraft();
      clearPendingConfigMutation(buildConfigDraftKey('profile'));
      state.profileForm = createInitialProfileFormState(state.profile);
      if (pendingTarget?.kind === 'route') {
        navigateTo(pendingTarget.route, { bypassUnsavedGuard: true });
      } else if (pendingTarget?.kind === 'subtab') {
        state.panels.settings.subTab = pendingTarget.subTab;
        persistUiState();
        renderApp();
      } else {
        renderApp();
      }
      return;
    }

    if (action === 'save-ai-draft') {
      const scope = (target.getAttribute('data-ai-scope') ?? 'home') as AiDraftScope;
      const inputEl = document.getElementById(
        scope === 'home' ? 'ld-home-ai-input' : 'ld-records-ai-input'
      ) as HTMLTextAreaElement | null;
      const text = inputEl?.value ?? '';
      if (saveAiDraft(scope, text)) {
        renderApp({ preserveModalInput: true });
        pushToast('本地 AI 草稿已保存', '已保存在当前浏览器，不会触发模型调用', 'info');
      } else {
        pushToast('草稿未保存', getStorageIssue() ?? '浏览器存储不可用', 'warning');
      }
      return;
    }

    if (action === 'clear-ai-draft') {
      const scope = (target.getAttribute('data-ai-scope') ?? 'home') as AiDraftScope;
      clearAiDraft(scope);
      const inputEl = document.getElementById(
        scope === 'home' ? 'ld-home-ai-input' : 'ld-records-ai-input'
      ) as HTMLTextAreaElement | null;
      if (inputEl) inputEl.value = '';
      renderApp({ preserveModalInput: true });
      pushToast('已清空本地 AI 草稿', '本地待发送草稿已清除', 'info');
      return;
    }

    if (action === 'toggle-minimal-mode') {
      const currentMinimal = Boolean(
        state.homePreferences?.minimal_mode ?? state.home?.preferences.minimal_mode
      );
      await updateHomePreferencesReliably(
        { minimal_mode: !currentMinimal },
        !currentMinimal
          ? '已开启主页极简模式（原固定顺序与 AI 草稿已保留）'
          : '已恢复标准主页（固定数值与任务顺序已恢复）'
      );
      return;
    }

    if (action === 'home-open-profile') {
      state.panels.settings.subTab = 'profile';
      persistUiState();
      navigateTo('/settings');
      return;
    }

    if (action === 'home-clean-unavailable-pins') {
      const home = state.home ?? buildFallbackHomeFromBootstrap(state, data);
      const validMetricIds = (state.homePreferences?.pinned_metric_ids ?? []).filter(id =>
        home.metrics.some(m => m.id === id)
      );
      const validTaskIds = (state.homePreferences?.pinned_task_ids ?? []).filter(id =>
        (data?.tasks ?? home.tasks).some(
          t => t.id === id && t.status !== 'cancelled' && t.status !== 'skipped'
        )
      );
      await updateHomePreferencesReliably(
        {
          pinned_metric_ids: validMetricIds,
          task_pins:(state.homePreferences?.task_pins??validTaskIds.map(id=>({kind:'instance' as const,id}))).filter(p=>!(home.warnings??[]).some(w=>w.kind==='task'&&w.id===p.id)),
          pinned_trends:(state.homePreferences?.pinned_trends??[]).filter(p=>!(home.warnings??[]).some(w=>w.kind==='metric'&&w.id===p.metric_id))
        },
        '已清理失效的首页固定引用'
      );
      return;
    }

    if (action === 'home-toggle-pin-metric') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return;
      const current = [...(state.homePreferences?.pinned_metric_ids ?? [])];
      const next = current.includes(metricId)
        ? current.filter(id => id !== metricId)
        : [...current, metricId];
      await updateHomePreferencesReliably(
        { pinned_metric_ids: next },
        current.includes(metricId) ? '已取消固定该数值卡片' : '已将该数值卡片固定到首页'
      );
      return;
    }

    if (action === 'home-move-pin-metric') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const dir = target.getAttribute('data-dir') ?? 'up';
      const current = [...(state.homePreferences?.pinned_metric_ids ?? [])];
      const idx = current.indexOf(metricId);
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swapIdx >= 0 && swapIdx < current.length) {
        [current[idx], current[swapIdx]] = [current[swapIdx], current[idx]];
        await updateHomePreferencesReliably({ pinned_metric_ids: current }, '已调整首页数值固定顺序');
      }
      return;
    }

    if (action === 'home-toggle-pin-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      if (!taskId) return;
      const current=[...(state.homePreferences?.task_pins??state.homePreferences?.pinned_task_ids.map(id=>({kind:'instance' as const,id}))??[])];
      const t=state.taskInstances.find(t=>t.id===taskId)??data?.tasks.find(t=>t.id===taskId);
      const template=t&&state.taskTemplates.find(x=>x.id===t.template_id);
      const existing=current.find(p=>p.kind==='instance'&&p.id===taskId||p.kind==='template'&&p.id===template?.id);
      const next=existing?current.filter(p=>p!==existing):[...current,{kind:template?'template' as const:'instance' as const,id:template?.id??taskId}];
      await updateHomePreferencesReliably({task_pins:next},existing?'已取消固定任务':'已固定任务');
      return;
    }

    if (action === 'home-move-pin-task') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const dir = target.getAttribute('data-dir') ?? 'up';
      const current = [...(state.homePreferences?.pinned_task_ids ?? [])];
      const idx = current.indexOf(taskId);
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (idx >= 0 && swapIdx >= 0 && swapIdx < current.length) {
        [current[idx], current[swapIdx]] = [current[swapIdx], current[idx]];
        await updateHomePreferencesReliably({ pinned_task_ids: current }, '已调整首页任务固定顺序');
      }
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
      if (key === 'settings' && shouldGuardProfileUnsavedLeave(undefined, subTab)) {
        return;
      }
      if (key) {
        state.panels[key].subTab = subTab;
        persistUiState();
        renderApp();
      }
      return;
    }

    if (action === 'close-modal') {
      planning.advanced=false;
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

    if (action === 'discard-config-draft') {
      const key = state.configForm.draftKey;
      if (key && getPendingConfigMutation(key)) {
        pushToast('还有待确认的配置提交', '请先点击确认上次提交；丢弃草稿不能撤销已发送的配置请求。', 'warning');
        return;
      }
      if (key) {
        clearConfigDraft(key);
      }
      state.configForm = {
        ...createInitialConfigFormState(),
        draftKey: key,
        kind: state.configForm.kind,
        entityId: generateUuid()
      };
      renderModalRegionOnly(false);
      pushToast('本机配置草稿已丢弃', '已清空当前未提交的配置草稿', 'info');
      return;
    }

    if(action==='copy-config-draft'){
      const form=document.querySelector<HTMLFormElement>('form[data-config-kind]');
      const draft=form?extractConfigFormDraft(form,state):null;
      if(draft)try{await navigator.clipboard.writeText(JSON.stringify(draft.rawInputs,null,2));pushToast('已复制当前输入','上次配置已确认，当前修改尚未提交','info');}catch{pushToast('请手动复制输入','本机草稿仍保留，可直接选择表单内容复制','warning');}
      return;
    }
    if (action === 'resume-pending-config') {
      const kind = (target.getAttribute('data-config-kind') ?? '') as ConfigMutationKind;
      if (kind === 'profile') {
        state.panels.settings.subTab = 'profile';
        persistUiState();
        navigateTo('/settings');
      } else if (kind === 'create-module') {
        prepareConfigFormModal('create-module', { kind: 'create-module' });
        renderApp();
      } else if (kind === 'create-template') {
        prepareConfigFormModal('create-template', {
          kind: 'create-template',
          defaultModuleId: state.panels.settings.moduleId
        });
        renderApp();
      } else if (kind === 'create-task') {
        prepareConfigFormModal('create-task', {
          kind: 'create-task',
          defaultModuleId: state.panels.tasks.moduleId
        });
        renderApp();
      } else if (kind === 'create-task-template') {
        prepareConfigFormModal('create-task-template', {
          kind: 'create-task-template',
          defaultModuleId: state.panels.tasks.moduleId
        });
        renderApp();
      } else if (kind === 'create-metric') {
        prepareConfigFormModal('create-metric', {
          kind: 'create-metric',
          defaultModuleId: state.panels.metrics.moduleId
        });
        renderApp();
      } else if (kind === 'create-achievement') {
        prepareConfigFormModal('create-achievement', {
          kind: 'create-achievement',
          defaultModuleId: state.panels.achievements.moduleId
        });
        renderApp();
      } else if (kind === 'create-achievement-series') {
        prepareConfigFormModal('create-achievement-series', {
          kind: 'create-achievement-series',
          defaultModuleId: state.panels.achievements.moduleId
        });
        renderApp();
      }
      return;
    }

    if (action === 'profile-add-field' && data) {
      const form = document.getElementById('ld-form-profile') as HTMLFormElement | null;
      if (form) extractProfileFormToState(form, state);
      const selectEl = document.getElementById('ld-profile-add-module-select') as HTMLSelectElement | null;
      const kindEl = document.getElementById('ld-profile-add-kind-select') as HTMLSelectElement | null;
      const modId =
        selectEl?.value ||
        data.modules.find(m => m.status === 'enabled')?.id ||
        '';
      if (!modId) return;
      const kind = ((kindEl?.value || 'profile') as ProfileFieldRow['kind']);
      const nextIdx = state.profileForm.fields.length + 1;
      const firstRt = data.record_types.find(rt => rt.module_id === modId) ?? data.record_types[0];
      const firstNumeric=firstRt?.fields.find(f=>['integer','decimal'].includes(f.type));
      const firstRtField=firstNumeric?.key??'';
      const firstMetric = data.metrics.find(m => m.module_id === modId) ?? data.metrics[0];
      state.profileForm.fields.push({
        id: generateUuid(),
        module_id: modId,
        key: `field_${nextIdx}`,
        label: `自定义字段 ${nextIdx}`,
        type:kind==='derived'?'decimal':kind==='observation'?(firstNumeric?.type as 'integer'|'decimal'??'decimal'):'text',
        kind,
        value: kind === 'profile' ? '' : null,
        unit:kind==='observation'?firstNumeric?.unit??null:kind==='derived'?firstMetric?.definition.unit??null:null,
        options: [],
        binding:
          kind === 'observation'
            ? { record_type_id: firstRt?.id ?? '', field_key: firstRtField }
            : kind === 'derived'
              ? { metric_id: firstMetric?.id ?? '' }
              : null
      });
      state.profileForm.dirty = true;
      state.profileForm.submissionStatus = 'saved_local';
      renderApp();
      return;
    }

    if (action === 'profile-remove-field') {
      const form = document.getElementById('ld-form-profile') as HTMLFormElement | null;
      if (form) extractProfileFormToState(form, state);
      const fieldId = target.getAttribute('data-field-id') ?? '';
      if (!fieldId) return;
      state.profileForm.fields = state.profileForm.fields.filter(f => f.id !== fieldId);
      const existedOnServer = (state.profile?.module_fields ?? []).some(f => f.id === fieldId);
      if (existedOnServer && !state.profileForm.removeIds.includes(fieldId)) {
        state.profileForm.removeIds.push(fieldId);
      }
      state.profileForm.dirty = true;
      state.profileForm.submissionStatus = 'saved_local';
      renderApp();
      return;
    }

    if (action === 'profile-reset-draft') {
      clearProfileDraft();
      clearPendingConfigMutation(buildConfigDraftKey('profile'));
      state.profileForm = createInitialProfileFormState(state.profile);
      renderApp();
      pushToast('已重置个人资料修改', '已恢复为服务器当前已保存版本', 'info');
      return;
    }

    if (action === 'profile-conflict-pull') {
      try {
        const freshProfile = await api.getProfile();
        state.profile = freshProfile;
        if (state.home) state.home.profile = freshProfile;
        state.profileForm.conflictServerProfile = freshProfile;
        renderApp({ preserveModalInput: true });
        pushToast('已拉取服务器最新个人资料', '请核对差异并点击「采用服务器版本作为编辑基线」后再保存', 'info');
      } catch (err) {
        handleApiError(err);
      }
      return;
    }

    if (action === 'profile-conflict-adopt') {
      const srv = state.profileForm.conflictServerProfile;
      if (srv) {
        const form = document.getElementById('ld-form-profile') as HTMLFormElement | null;
        if (form) extractProfileFormToState(form, state);
        state.profileForm.baseVersion = srv.version;
        state.profileForm.conflictError = null;
        state.profileForm.submissionStatus = 'saved_local';
        saveProfileDraft({
          baseVersion: state.profileForm.baseVersion,
          nickname: state.profileForm.nickname,
          bio: state.profileForm.bioIsNull ? null : state.profileForm.bio,
          timezone: state.profileForm.timezone,
          upserts: state.profileForm.fields,
          removeIds: state.profileForm.removeIds,
          rawInputs: {},
          updatedAt: new Date().toISOString()
        });
        renderApp({ preserveModalInput: true });
        pushToast(
          `已采用服务器 v${srv.version} 作为编辑基线`,
          '你当前的本地修改仍完整保留，现在可点击「保存个人资料」提交',
          'info'
        );
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
      if (ctx.fromPanelKey !== 'home') {
        state.panels[ctx.fromPanelKey] = { ...ctx.savedFilter };
      }
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

    if (action === 'home-metric-sources') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      const m =
        state.home?.metrics.find(x => x.id === metricId) ??
        data.metrics.find(x => x.id === metricId);
      if (!m) return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.metrics },
        label: `来自首页数值「${m.definition.name}」的来源记录核查`
      };
      state.panels.records.moduleId = m.module_id;
      state.panels.records.recordTemplateId = m.record_type_id;
      state.panels.records.sourceRecordIds = [...m.computed.source_record_ids];
      state.panels.records.sourceLabel = `首页数值「${m.definition.name}」的 ${m.computed.source_record_ids.length} 条有效样本记录`;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'home-metric-detail') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.metrics },
        label: '来自首页的数值详情查看'
      };
      state.panels.metrics.selectedId = metricId;
      navigateTo('/metrics', { preserveReturnContext: true });
      state.activeModal = { kind: 'metric-detail', metricId };
      void syncMetricTrendQuietly(metricId).then(()=>renderApp({preserveModalInput:true}));
      renderApp();
      return;
    }

    if (action === 'home-task-detail') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.tasks },
        label: '来自首页的任务来源查看'
      };
      state.panels.tasks.selectedId = taskId;
      navigateTo('/tasks', { preserveReturnContext: true });
      state.activeModal = { kind: 'task-detail', taskId };
      renderApp();
      return;
    }

    if (action === 'home-task-go-record') {
      const taskId = target.getAttribute('data-task-id') ?? '';
      const task =
        state.home?.tasks.find(t => t.id === taskId) ??
        data.tasks.find(t => t.id === taskId);
      if (!task || task.status === 'cancelled' || task.status === 'skipped') return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.tasks },
        label: `来自首页任务「${task.definition.title}」`
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

    if ((action==='home-achievement-evidence'||action==='home-achievement-detail')&&target.getAttribute('data-series-id')){const id=target.getAttribute('data-series-id')!;state.activeModal={kind:'series-detail',seriesId:id};renderApp();return;}
    if (action === 'home-achievement-evidence') {
      const achievementId = target.getAttribute('data-achievement-id') ?? '';
      const award =
        state.home?.recent_achievements.find(a => a.achievement_id === achievementId) ??
        data.achievement_awards.find(a => a.achievement_id === achievementId);
      const def = data.achievement_definitions.find(a => a.id === achievementId);
      if (!award) return;
      const achName =
        (award as { definition?: { name?: string } }).definition?.name ??
        def?.definition.name ??
        '成就';
      const modId =
        (award as { module_id?: string }).module_id ?? def?.module_id ?? null;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.achievements },
        label: `来自首页成就「${achName}」的解锁依据记录`
      };
      const ids =
        award.evidence.source_record_ids.length > 0
          ? award.evidence.source_record_ids
          : award.original_evidence.source_record_ids;
      state.panels.records.moduleId = modId;
      state.panels.records.sourceRecordIds = [...ids];
      state.panels.records.sourceLabel = `成就「${achName}」的解锁依据记录 (${ids.length} 条)`;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'home-achievement-detail') {
      const achievementId = target.getAttribute('data-achievement-id') ?? '';
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/',
        fromPanelKey: 'home',
        savedFilter: { ...state.panels.achievements },
        label: '来自首页的成就定义查看'
      };
      state.panels.achievements.selectedId = achievementId;
      navigateTo('/achievements', { preserveReturnContext: true });
      state.activeModal = { kind: 'achievement-detail', achievementId };
      renderApp();
      return;
    }

    if (action === 'planning-advanced') {planning.advanced=true;renderApp();return;}
    if (action === 'open-create-task') {
      planning.advanced=false;
      prepareConfigFormModal('create-task', {
        kind: 'create-task',
        defaultModuleId: state.panels.tasks.moduleId
      });
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
        await submitPhase2Command('create-task',`phase2:complete:${task.id}`,task.id,{base_version:task.version},(p,key)=>api.completeTask(task.id,p.base_version,key));
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
      prepareConfigFormModal('create-metric', {
        kind: 'create-metric',
        defaultModuleId: state.panels.metrics.moduleId
      });
      renderApp();
      return;
    }

    if (action === 'open-metric-detail') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      state.panels.metrics.selectedId = metricId;
      state.modalError = null;
      state.activeModal = { kind: 'metric-detail', metricId };
      void syncMetricTrendQuietly(metricId).then(()=>renderApp({preserveModalInput:true}));
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
      prepareConfigFormModal('create-achievement', {
        kind: 'create-achievement',
        defaultModuleId: state.panels.achievements.moduleId
      });
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
      void syncMetricTrendQuietly(metricId).then(()=>renderApp({preserveModalInput:true}));
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
      prepareConfigFormModal('create-module', { kind: 'create-module' });
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
      prepareConfigFormModal('create-template', {
        kind: 'create-template',
        defaultModuleId: state.panels.settings.moduleId
      });
      renderApp();
      return;
    }

    if (action === 'tasks-filter-reset') {
      state.taskFilter = {
        category: 'all',
        status: 'all',
        color: 'all',
        pinnedOnly: false
      };
      state.panels.tasks.moduleId=null;persistUiState();renderApp();
      return;
    }

    if(await handleTaskEvent(action,target,phase2Context(data)))return;

    if(await handleTrendEvent(action,target,phase2Context(data)))return;

    if (action === 'open-create-achievement-series') {
      prepareConfigFormModal('create-achievement-series', {
        kind: 'create-achievement-series',
        defaultModuleId: state.panels.achievements.moduleId
      });
      renderApp();
      return;
    }

    if (action === 'open-series-detail') {
      const seriesId = target.getAttribute('data-series-id') ?? '';
      if (!seriesId) return;
      state.modalError = null;
      state.activeModal = { kind: 'series-detail', seriesId };
      renderApp();
      return;
    }

    if (action === 'series-view-sources') {
      const seriesId = target.getAttribute('data-series-id') ?? '';
      const milestoneId = target.getAttribute('data-milestone-id') ?? '';
      const s = state.achievementSeries.find(x => x.id === seriesId);
      const ms = s?.milestones.find(x => x.id === milestoneId);
      const award = ms?.award;
      if (!s) return;
      const ids =
        award ? (award.evidence.source_record_ids.length ? award.evidence.source_record_ids : award.original_evidence.source_record_ids) : s.progress.source_record_ids;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: state.route,
        fromPanelKey: routeToPanelKey(state.route) ?? 'home',
        savedFilter: { ...state.panels.achievements },
        label: `来自成就系列「${s.definition.name}${ms ? " · "+ms.label : ""}」的证据记录`
      };
      state.panels.records.moduleId = s.module_id;
      state.panels.records.sourceRecordIds = [...ids];
      state.panels.records.sourceLabel = `成就系列「${s.definition.name}${ms ? " · "+ms.label : ""}」的证据记录 (${ids.length} 条)`;
      state.activeModal = null;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'open-write-observation') {
      const fieldId = target.getAttribute('data-field-id') ?? '';
      const mode = (target.getAttribute('data-obs-mode') ?? 'new') as 'new' | 'correct';
      if (!fieldId) return;
      state.observationForm = null;
      state.modalError = null;
      state.activeModal = { kind: 'write-observation', fieldId, mode };
      renderApp();
      return;
    }

    if (action === 'profile-jump-source-record') {
      const recordId = target.getAttribute('data-record-id') ?? '';
      if (!recordId) return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/settings',
        fromPanelKey: 'settings',
        savedFilter: { ...state.panels.settings },
        label: '来自个人资料观测值来源记录查看'
      };
      state.panels.records.selectedId = recordId;
      state.activeModal = { kind: 'record-detail', recordId };
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if (action === 'profile-jump-source-metric') {
      const metricId = target.getAttribute('data-metric-id') ?? '';
      if (!metricId) return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/settings',
        fromPanelKey: 'settings',
        savedFilter: { ...state.panels.settings },
        label: '来自个人资料派生值来源数值查看'
      };
      state.panels.metrics.selectedId = metricId;
      state.activeModal = { kind: 'metric-detail', metricId };
      void syncMetricTrendQuietly(metricId).then(()=>renderApp({preserveModalInput:true}));
      navigateTo('/metrics', { preserveReturnContext: true });
      return;
    }

    if (action === 'profile-jump-derived-records') {
      const fieldId = target.getAttribute('data-field-id') ?? '';
      const srvField = (state.profile?.module_fields ?? []).find(f => f.id === fieldId);
      const ids = srvField?.source_ref?.source_record_ids ?? [];
      if (!srvField || ids.length === 0) return;
      saveCurrentScroll();
      state.returnContext = {
        fromRoute: '/settings',
        fromPanelKey: 'settings',
        savedFilter: { ...state.panels.settings },
        label: `来自个人资料派生字段「${srvField.label}」的来源记录`
      };
      state.panels.records.moduleId = srvField.module_id;
      state.panels.records.sourceRecordIds = [...ids];
      state.panels.records.sourceLabel = `派生字段「${srvField.label}」的 ${ids.length} 条来源记录`;
      navigateTo('/records', { preserveReturnContext: true });
      return;
    }

    if(action==='wallet-page'){state.walletLedgerOffset=Math.max(0,(state.walletLedgerOffset??0)+Number(target.getAttribute('data-delta')??0));await syncPhase2DomainQuietly();renderApp();return;}
    if(action==='retry-phase2'){await syncPhase2DomainQuietly();renderApp();return;}
    if(action==='trend-retry'){const id=target.getAttribute('data-metric-id');if(id)await syncMetricTrendQuietly(id);renderApp();return;}
    if(action==='template-adopt-baseline'){state.taskTemplates=await api.getTaskTemplates();state.modalError=null;renderApp({preserveModalInput:true});return;}
    if(action==='observation-adopt-binding'){const obs=state.observationForm;if(!obs?.bindingConflict)return;const fresh=await api.getProfile();const f=fresh.module_fields.find(f=>f.id===obs.fieldId);if(!f)return;state.profile=fresh;state.profileForm=createInitialProfileFormState(fresh);obs.bindingFingerprint=f.binding_fingerprint;obs.bindingSnapshot={binding:{record_type_id:f.binding!.record_type_id!,field_key:f.binding!.field_key!},type:f.type,unit:f.unit};obs.bindingConflict=undefined;obs.conflictError=null;obs.validationError=null;obs.entityId=generateUuid();obs.sourceBaseVersion=null;obs.sourceRecordId='';obs.mode='new';obs.lastImpactSummary='已明确采用最新绑定；请检查类型、单位和必填上下文后保存。';renderApp();return;}
    if(action==='observation-adopt-baseline'){const obs=state.observationForm;if(!obs)return;const fresh=await api.getBootstrap();const r=fresh.records.find(r=>r.id===obs.sourceRecordId);if(!r){pushToast('来源不可用','来源记录已删除，请关闭后选择新增观测','warning');return;}state.bootstrap=fresh;obs.sourceBaseVersion=r.version;obs.conflictError=null;obs.submissionStatus='saved_local';renderApp();return;}
    if(await handleWalletEvent(action,target,phase2Context(data)))return;

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
        await refreshPeriodic(true);
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

    if (form.id === 'ld-form-profile') {
      extractProfileFormToState(form, state);
      const pf = state.profileForm;
      const draftKey = buildConfigDraftKey('profile');
      const candidatePayload=buildProfilePayload(pf);

      const sig = computeConfigPayloadSignature('profile', candidatePayload);
      const prepared = prepareConfigMutationEnvelope({
        draftKey,
        kind: 'profile',
        candidateEntityId: state.profile?.id ?? state.user?.id ?? 'user-1',
        candidatePayload,
        signature: sig,
        allocateUuid: generateUuid
      });
      const previous = getPendingConfigMutation<ProfileInput>(draftKey);
      const pending = {
        draftKey,
        kind: 'profile' as const,
        operationId: prepared.operationId,
        entityId: prepared.entityId,
        payloadSignature: previous?.payloadSignature ?? sig,
        frozenPayload: prepared.payload,
        lastError: { code: 'AWAITING_RECEIPT', message: '等待服务器确认' },
        savedAt: previous?.savedAt ?? new Date().toISOString()
      };

      if (!savePendingConfigMutation(pending)) {
        pf.submissionStatus = 'validation_error';
        pf.validationError = {
          code: 'LOCAL_STORAGE_FAILED',
          message: getStorageIssue() ?? '未保存本机，尚未发送请求'
        };
        renderApp({ preserveModalInput: true });
        return;
      }

      state.submittingModal = true;
      pf.submissionStatus = 'submitting';
      pf.operationId = prepared.operationId;
      pf.conflictError = null;
      pf.validationError = null;
      pf.lastSavedMessage = null;
      renderApp({ preserveModalInput: true });

      try {
        const updatedProfile = await api.updateProfile(prepared.payload, prepared.operationId);
        state.submittingModal = false;
        const liveForm=document.getElementById('ld-form-profile') as HTMLFormElement|null;
        if(liveForm)extractProfileFormToState(liveForm,state);
        const working=state.profileForm;
        const keepWorking=computeConfigPayloadSignature('profile',buildProfilePayload(working))!==computeConfigPayloadSignature('profile',prepared.payload);
        if(keepWorking){
          working.baseVersion=updatedProfile.version;
          working.dirty=true;working.submissionStatus='saved_local';working.operationId=null;
          working.lastSavedMessage='上次资料已确认；当前修改仍是草稿，请核对后再次保存。';
          if(!saveProfileDraft({baseVersion:working.baseVersion,nickname:working.nickname,bio:working.bioIsNull?null:working.bio,timezone:working.timezone,upserts:working.fields,removeIds:working.removeIds,rawInputs:{},updatedAt:new Date().toISOString()})){
            working.validationError={code:'LOCAL_STORAGE_FAILED',message:'上次资料已确认；当前修改未保存本机，请复制后重试。'};
            renderApp({preserveModalInput:true});return;
          }
        }
        clearPendingConfigMutation(draftKey);
        if(!keepWorking)clearProfileDraft();
        state.profile = updatedProfile;
        if (state.home) state.home.profile = updatedProfile;
        if (state.user) {
          state.user.name = updatedProfile.nickname;
          state.user.timezone = updatedProfile.timezone;
        }
        if(!keepWorking)state.profileForm = {
          ...createInitialProfileFormState(updatedProfile),
          submissionStatus: 'confirmed_server',
          lastSavedMessage: `个人资料已保存（服务器版本 v${updatedProfile.version}）`
        };
        await syncHomeAndProfileQuietly().catch(() => {});
        renderApp();
        pushToast(keepWorking?'上次资料已确认':'个人资料已保存',keepWorking?'当前修改仍保留为草稿，请核对后再次保存。':`服务器已确认更新至 v${updatedProfile.version}`, 'success');
      } catch (err) {
        state.submittingModal = false;
        if (isUnknownNetworkError(err)) {
          const msg = err instanceof Error ? err.message : '网络结果未知';
          savePendingConfigMutation({
            ...pending,
            lastError: { code: 'NETWORK_UNKNOWN', message: msg }
          });
          pf.submissionStatus = 'unknown_network';
          renderApp({ preserveModalInput: true });
          pushToast(
            '网络结果未知（已保留草稿）',
            '未收到服务器回执；点击确认将沿用原 operation_id 确认结果。',
            'warning'
          );
          return;
        }

        clearPendingConfigMutation(draftKey);
        pf.operationId = null;

        if (err instanceof ApiClientError && err.status === 409) {
          pf.submissionStatus = 'conflict_pending';
          pf.conflictError = {
            code: err.code,
            message: err.message,
            requestId: err.requestId
          };
          const srvCurrent = (err.details as { current?: ProfileData } | undefined)?.current;
          if (srvCurrent) {
            pf.conflictServerProfile = srvCurrent;
          }
          renderApp({ preserveModalInput: true });
          pushToast(
            `版本冲突 (${err.code})`,
            '已保留你当前未保存的本地输入，请核对服务器版本并显式采用基线后重试',
            'warning'
          );
          return;
        }

        const desc = describeApiError(err);
        pf.submissionStatus = 'validation_error';
        pf.validationError = {
          code: desc.code ?? 'VALIDATION_ERROR',
          message: desc.message
        };
        renderApp({ preserveModalInput: true });
        pushToast(`资料校验未通过 (${desc.code ?? 'ERROR'})`, desc.message, 'warning');
      }
      return;
    }

    const submitConfigCreationReliably = async <TPayload extends { id: string }>(
      kind: ConfigMutationKind,
      buildCandidate: (entityId: string) => TPayload,
      executeCall: (payload: TPayload, operationId: string) => Promise<{ id: string }>,
      successLabel: (payload: TPayload) => string,
      checkUnlocks = false
    ): Promise<void> => {
      const draft = extractConfigFormDraft(form, state);
      if(draft?.confirmedEntityId){pushToast('上次配置已确认','当前输入仍保留为草稿，请复制或丢弃草稿后再新建配置','info');return;}
      const draftKey = draft?.draftKey ?? buildConfigDraftKey(kind);
      const entityId = draft?.entityId ?? state.configForm.entityId ?? generateUuid();
      if (draft && !saveConfigDraft(draft)) {
        state.configForm.submissionStatus = 'validation_error';
        state.configForm.validationError = {
          code: 'LOCAL_STORAGE_FAILED',
          message: getStorageIssue() ?? '未保存本机，尚未发送请求'
        };
        renderModalRegionOnly(true);
        return;
      }

      const candidatePayload = buildCandidate(entityId);
      const sig = computeConfigPayloadSignature(kind, candidatePayload);
      const prepared = prepareConfigMutationEnvelope({
        draftKey,
        kind,
        candidateEntityId: entityId,
        candidatePayload,
        signature: sig,
        allocateUuid: generateUuid
      });
      const previous = getPendingConfigMutation<TPayload>(draftKey);
      const pending = {
        draftKey,
        kind,
        operationId: prepared.operationId,
        entityId: prepared.entityId,
        payloadSignature: previous?.payloadSignature ?? sig,
        frozenPayload: prepared.payload,
        lastError: { code: 'AWAITING_RECEIPT', message: '等待服务器确认' },
        savedAt: previous?.savedAt ?? new Date().toISOString()
      };

      if (!savePendingConfigMutation(pending)) {
        state.configForm.submissionStatus = 'validation_error';
        state.configForm.validationError = {
          code: 'LOCAL_STORAGE_FAILED',
          message: getStorageIssue() ?? '待确认操作未能保存本机，未发送请求'
        };
        renderModalRegionOnly(true);
        return;
      }

      state.submittingModal = true;
      state.configForm.submissionStatus = 'submitting';
      state.configForm.operationId = prepared.operationId;
      state.configForm.entityId = prepared.entityId;
      state.configForm.conflictError = null;
      state.configForm.validationError = null;
      state.modalError = null;
      renderModalRegionOnly(true);

      try {
        await executeCall(prepared.payload, prepared.operationId);
      } catch (err) {
        state.submittingModal = false;
        if (isUnknownNetworkError(err)) {
          const errMsg = err instanceof Error ? err.message : '网络结果未知';
          savePendingConfigMutation({
            ...pending,
            lastError: { code: 'NETWORK_UNKNOWN', message: errMsg }
          });
          state.configForm.submissionStatus = 'unknown_network';
          renderModalRegionOnly(true);
          pushToast(
            '网络结果未知（已冻结原提交）',
            '未收到服务器回执；再次点击确认将沿用原 operation_id 与实体 ID，绝不复制重复配置。',
            'warning'
          );
          return;
        }

        clearPendingConfigMutation(draftKey);
        state.configForm.operationId = null;

        if (err instanceof ApiClientError && err.status === 409) {
          state.configForm.submissionStatus = 'conflict_pending';
          state.configForm.conflictError = {
            code: err.code,
            message: err.message,
            requestId: err.requestId
          };
          renderModalRegionOnly(true);
          pushToast(`配置冲突 (${err.code})`, err.message, 'warning');
          return;
        }

        const desc = describeApiError(err);
        state.configForm.submissionStatus = 'validation_error';
        state.configForm.validationError = {
          code: desc.code ?? 'VALIDATION_ERROR',
          message: desc.message
        };
        renderModalRegionOnly(true);
        pushToast(`校验未通过 (${desc.code ?? 'ERROR'})`, desc.message, 'warning');
        return;
      }

      state.submittingModal = false;
      // Confirm the frozen operation separately from edits made after its response was lost.
      if(previous && previous.payloadSignature!==sig && draft){
        if(!saveConfigDraft({...draft,confirmedEntityId:prepared.entityId})){
          state.configForm.validationError={code:'LOCAL_STORAGE_FAILED',message:'上次配置已在服务器确认；当前修改未保存本机，请复制输入后重试。'};
          renderModalRegionOnly(true);return;
        }
        clearPendingConfigMutation(draftKey);
        state.configForm.submissionStatus='confirmed_server';
        state.configForm.operationId=null;
        await refreshBootstrapAndNotify(undefined,false,true).catch(()=>renderModalRegionOnly(true));
        pushToast('上次配置已确认','当前修改仍保留为本机草稿，没有另建配置；可复制当前输入或丢弃草稿。','info');
        return;
      }
      clearPendingConfigMutation(draftKey);
      clearConfigDraft(draftKey);
      state.configForm = createInitialConfigFormState();
      state.activeModal = null;
      try {
        await refreshBootstrapAndNotify(successLabel(prepared.payload), checkUnlocks);
      } catch {
        renderApp();
        pushToast('配置已在服务器确认', '列表刷新失败，请手动刷新查看，无需重复创建。', 'warning');
      }
    };

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
      let acceptance:
        | { kind: 'exists' }
        | { kind: 'field_gte'; field_key: string; threshold: string }
        | null = null;

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

      await submitConfigCreationReliably(
        'create-task',
        entityId => ({
          id: entityId,
          module_id,
          title,
          completion_mode,
          record_type_id,
          acceptance,
          business_date: business_date_raw || null,
          timezone
        }),
        (payload, opId) => api.createTask(payload, opId),
        payload => `已创建任务「${payload.title}」`
      );
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

      await submitConfigCreationReliably(
        'create-metric',
        entityId => ({
          id: entityId,
          module_id,
          record_type_id,
          name,
          unit,
          aggregation,
          field_key,
          window: windowVal,
          timezone
        }),
        (payload, opId) => api.createMetric(payload, opId),
        payload => `已创建数值定义「${payload.name}」`
      );
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

      await submitConfigCreationReliably(
        'create-achievement',
        entityId => ({
          id: entityId,
          module_id,
          metric_id,
          name,
          operator,
          threshold,
          history_policy
        }),
        (payload, opId) => api.createAchievement(payload, opId),
        payload => `已创建成就定义「${payload.name}」`,
        true
      );
      return;
    }

    if (form.id === 'ld-form-create-module') {
      const fd = new FormData(form);
      const name = String(fd.get('name') ?? '').trim();
      const description = String(fd.get('description') ?? '').trim();
      const icon = String(fd.get('icon') ?? 'book') as any;
      const color = String(fd.get('color') ?? 'blue') as any;

      await submitConfigCreationReliably(
        'create-module',
        entityId => ({
          id: entityId,
          name,
          description,
          icon,
          color
        }),
        (payload, opId) => api.createModule(payload, opId),
        payload => `已创建自定义模块「${payload.name}」，现已加入各面板筛选`
      );
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

      await submitConfigCreationReliably(
        'create-template',
        entityId => ({
          id: entityId,
          module_id,
          name,
          fields
        }),
        (payload, opId) => api.createRecordType(payload, opId),
        payload => `已创建记录模板「${payload.name}」`
      );
      return;
    }

    if (form.id === 'ld-form-create-task-template') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const title = String(fd.get('title') ?? '').trim();
      const category = String(fd.get('category') ?? 'daily') as TaskCategory;
      const color=String(fd.get('color')??'blue') as TaskColor;
      const completion_mode=String(fd.get('completion_mode')??'manual') as 'manual'|'record_optional'|'record_required';
      const timezone=String(fd.get('timezone')??'Asia/Shanghai');
      const due_at=category==='main'?(String(fd.get('due_at')??'').trim()||null):null;
      const record_type_id=String(fd.get('record_type_id')??'');
      const kind=String(fd.get('rule_kind')??'count');
      const threshold=String(fd.get('threshold')??'1').trim();
      const field_key=String(fd.get('field_key')??'');
      let rule:TaskRule|null=null;
      if(completion_mode!=='manual'){
        if(kind==='linked_exists')rule={kind,record_type_id};
        else if(kind==='linked_field_gte')rule={kind,record_type_id,field_key,threshold};
        else if(kind==='sum')rule={kind,record_type_id,field_key,threshold,unit:String(fd.get('unit')??''),filters:[]};
        else rule={kind:kind==='distinct_days'?'distinct_days':'count',record_type_id,threshold,filters:[]};
      }

      await submitConfigCreationReliably(
        'create-task-template',
        entityId =>
          ({
            id: entityId,
            module_id,
            title,
            category,
            color,
            completion_mode,
            rule,
            timezone,
            due_at
          }) satisfies TaskTemplateInput,
        async (payload, opId) => {
          const created = await api.createTaskTemplate(payload, opId);
          return { id: created.template.id };
        },
        payload => `已创建周期任务模板「${payload.title}」并生成当前周期实例`
      );
      return;
    }

    if (form.id === 'ld-form-edit-task-template') {
      const templateId = form.getAttribute('data-template-id') ?? '';
      const baseVersion = Number(form.getAttribute('data-base-version') ?? '1');
      const fd = new FormData(form);
      const tpl=state.taskTemplates.find(t=>t.id===templateId);
      const title=String(fd.get('title')??tpl?.definition.title??'');
      const patch:TaskTemplatePatch={base_version:baseVersion,status:String(fd.get('status')??'enabled') as 'enabled'|'archived'};
      if(tpl?.definition.category!=='main'){
        patch.title=title;patch.color=String(fd.get('color')??'blue') as TaskColor;
        patch.timezone=String(fd.get('timezone')??tpl?.definition.timezone??'Asia/Shanghai');
        const mode=String(fd.get('completion_mode')??'manual') as 'manual'|'record_optional'|'record_required';patch.completion_mode=mode;
        const kind=String(fd.get('rule_kind')??'count'),record_type_id=String(fd.get('record_type_id')??''),threshold=String(fd.get('threshold')??'1'),field_key=String(fd.get('field_key')??'');
        const oldRule=(tpl?.next_definition??tpl?.definition)?.rule;
        const filters=oldRule&&'filters' in oldRule?oldRule.filters??[]:[];
        patch.rule=mode==='manual'?null:kind==='linked_exists'?{kind,record_type_id}:kind==='linked_field_gte'?{kind,record_type_id,field_key,threshold}:kind==='sum'?{kind,record_type_id,field_key,threshold,unit:String(fd.get('unit')??''),filters}:{kind:kind==='distinct_days'?'distinct_days':'count',record_type_id,threshold,filters};
        const effective=String(fd.get('effective_from')??'').trim();if(effective)patch.effective_from=effective;
      }

      state.submittingModal = true;
      renderModalRegionOnly(true);
      try {
        await submitPhase2Command('edit-task-template',`phase2:template:${templateId}`,templateId,patch,(p,key)=>api.updateTaskTemplate(templateId,p,key));
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(
          `已更新周期任务模板「${title}」（规则修改从下一周期生效，历史实例快照已锁定）`
        );
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
      }
      return;
    }

    if (form.id === 'ld-form-revoke-task') {
      const taskId = form.getAttribute('data-task-id') ?? '';
      const baseVersion = Number(form.getAttribute('data-base-version') ?? '1');
      const mode = (form.getAttribute('data-revoke-mode') ?? 'revoke') as 'revoke' | 'cancel';
      const fd = new FormData(form);
      const reason = String(fd.get('reason') ?? '').trim();
      state.submittingModal = true;
      renderModalRegionOnly(true);
      try {
        if (mode === 'revoke') {
          await submitPhase2Command('revoke-task',`phase2:revoke:${taskId}`,taskId,{base_version:baseVersion,reason},(p,key)=>api.revokeTask(taskId,p.base_version,p.reason,key));
        } else {
          await submitPhase2Command('cancel-task',`phase2:cancel:${taskId}`,taskId,{base_version:baseVersion,reason},(p,key)=>api.cancelTask(taskId,p.base_version,p.reason,key));
        }
        state.submittingModal = false;
        state.activeModal = null;
        await refreshBootstrapAndNotify(
          mode === 'revoke'
            ? '已撤回手动完成状态，并追加冲正流水，原奖励资格和名额保留'
            : '已取消该任务实例（若已发奖则已追加冲销流水）'
        );
      } catch (err) {
        state.submittingModal = false;
        handleApiError(err, { insideModal: true });
      }
      return;
    }

    if (form.id === 'ld-form-create-achievement-series') {
      const fd = new FormData(form);
      const module_id = String(fd.get('module_id') ?? '');
      const name=String(fd.get('name')??'').trim();
      const record_type_id=String(fd.get('record_type_id')??'');
      const aggregation=String(fd.get('aggregation')??'distinct_days') as 'count'|'distinct_days'|'sum';
      const field_key=aggregation==='sum'?String(fd.get('field_key')??''):null;
      const unit=String(fd.get('unit')??'天');
      const timezone=String(fd.get('timezone')??'Asia/Shanghai');
      const history_policy=String(fd.get('history_policy')??'include_existing') as 'include_existing'|'from_activation';
      const labels=String(fd.get('milestones_labels')??'').split(/[,，]/).map(v=>v.trim());
      const milestones:AchievementSeriesMilestoneInput[]=String(fd.get('milestones_thresholds')??'').split(/[,，]/).filter(v=>v.trim()).map((v,i)=>({id:generateUuid(),threshold:v.trim(),label:labels[i]??''}));

      await submitConfigCreationReliably(
        'create-achievement-series',
        entityId =>
          ({
            id: entityId,
            module_id,
            record_type_id,aggregation,field_key,unit,timezone,filters:[],
            name,history_policy,milestones
          }) satisfies AchievementSeriesInput,
        (payload, opId) => api.createAchievementSeries(payload, opId),
        payload => `已创建成就系列「${payload.name}」（含 ${payload.milestones.length} 个里程碑档位）`,
        true
      );
      return;
    }

    if (form.id === 'ld-form-write-observation') {await submitObservation(form,phase2Context(data));return;}
  });
}

function phase2Context(data:NonNullable<AppState['bootstrap']>){return {state,data,refreshPeriodic,pushToast,handleApiError,prepareConfigFormModal,renderApp,updateHomePreferencesReliably,syncMetricTrendQuietly,saveCurrentScroll,navigateTo,syncPhase2DomainQuietly,persistUiState,renderModalRegionOnly,refreshBootstrapAndNotify,describeApiError};}
export type Phase2EventContext=ReturnType<typeof phase2Context>;

setupEventDelegation();
void initializeApp();

planning.install();reports.install();
document.addEventListener('planning-entity',async(event)=>{
 const {kind,id}=(event as CustomEvent).detail;
 await syncPhase2DomainQuietly();
 if(kind==='report'){navigateTo('/');await reports.open(id);return;}
 if(kind==='profile_field'){navigateTo('/settings');return;}
 if(kind==='report_schedule'){navigateTo('/settings');return;}
 if(kind==='module'){navigateTo('/settings');return;}
 if(kind==='achievement_series'){state.activeModal={kind:'series-detail',seriesId:id};renderApp();return;}
 if(kind==='metric'){state.activeModal={kind:'metric-detail',metricId:id};renderApp();return;}
 if(kind==='record_type'){navigateTo('/records');return;}
 if(kind==='task_template'){const template=state.taskTemplates.find(t=>t.id===id);if(template?.current_instance_id){state.activeModal={kind:'task-detail',taskId:template.current_instance_id};renderApp();}else navigateTo('/tasks');return;}
});
