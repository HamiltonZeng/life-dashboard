import { MODULE_COLORS, MODULE_ICON_LABELS, type ModuleColorName, type ModuleIconName } from './tokens.js';

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ICON_SVG_PATHS: Record<ModuleIconName, string> = {
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  dumbbell: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/><path d="m2 6 4-4"/><path d="m3 10 7-7"/><path d="m14 21 7-7"/>',
  wallet: '<path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4Z"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3Z"/><path d="M5 3v4"/><path d="M3 5h4"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
  leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
  music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>'
};

export function renderIcon(icon: string, size = 16): string {
  const path = ICON_SVG_PATHS[(icon as ModuleIconName) in ICON_SVG_PATHS ? (icon as ModuleIconName) : 'star'];
  const label = MODULE_ICON_LABELS[(icon as ModuleIconName)] ?? icon;
  return `<svg class="ld-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${escapeHtml(label)}">${path}</svg>`;
}

export interface ModuleVisual {
  id: string;
  name: string;
  icon: string;
  color: string;
  status?: string;
}

export function renderModuleBadge(mod: ModuleVisual | undefined, compact = false): string {
  if (!mod) {
    return `<span class="ld-module-badge ld-color-slate">未知模块</span>`;
  }
  const colorKey: ModuleColorName = (mod.color as ModuleColorName) in MODULE_COLORS ? (mod.color as ModuleColorName) : 'slate';
  const statusSuffix = mod.status && mod.status !== 'enabled'
    ? `<span class="ld-module-status-tag">(${mod.status === 'archived' ? '已归档' : '已停用'})</span>`
    : '';
  return `<span class="ld-module-badge ld-color-${colorKey}${compact ? ' is-compact' : ''}" data-module-id="${escapeHtml(mod.id)}">${renderIcon(mod.icon, compact ? 13 : 14)}<span>${escapeHtml(mod.name)}</span>${statusSuffix}</span>`;
}

export function renderModuleFilterBar(
  modules: ModuleVisual[],
  activeModuleId: string | null,
  countsByModule?: Record<string, number>,
  includeInactive = false
): string {
  const visibleModules = includeInactive
    ? modules
    : modules.filter(m => !m.status || m.status === 'enabled' || m.id === activeModuleId);
  const totalCount = countsByModule
    ? Object.values(countsByModule).reduce((a, b) => a + b, 0)
    : null;

  const allBtn = `<button type="button" class="ld-filter-chip ${activeModuleId === null ? 'is-active' : ''}" data-action="filter-module" data-module-id="">
    <span>全部模块</span>
    ${totalCount !== null ? `<span class="ld-chip-count">${totalCount}</span>` : ''}
  </button>`;

  const modBtns = visibleModules
    .map(m => {
      const colorKey: ModuleColorName = (m.color as ModuleColorName) in MODULE_COLORS ? (m.color as ModuleColorName) : 'slate';
      const active = activeModuleId === m.id;
      const count = countsByModule ? (countsByModule[m.id] ?? 0) : null;
      return `<button type="button" class="ld-filter-chip ld-chip-${colorKey} ${active ? 'is-active' : ''}" data-action="filter-module" data-module-id="${escapeHtml(m.id)}">
        ${renderIcon(m.icon, 14)}
        <span>${escapeHtml(m.name)}</span>
        ${m.status && m.status !== 'enabled' ? `<span class="ld-chip-state">${m.status === 'archived' ? '归档' : '停用'}</span>` : ''}
        ${count !== null ? `<span class="ld-chip-count">${count}</span>` : ''}
      </button>`;
    })
    .join('');

  return `<div class="ld-module-filter-bar" role="tablist" aria-label="按模块筛选">${allBtn}${modBtns}</div>`;
}

export interface EmptyStateOptions {
  icon?: ModuleIconName;
  title: string;
  description: string;
  primaryActionLabel?: string;
  primaryActionData?: string;
  secondaryActionLabel?: string;
  secondaryActionData?: string;
}

export function renderEmptyState(opts: EmptyStateOptions): string {
  return `<div class="ld-empty-state">
    <div class="ld-empty-icon">${renderIcon(opts.icon ?? 'sparkles', 28)}</div>
    <h3 class="ld-empty-title">${escapeHtml(opts.title)}</h3>
    <p class="ld-empty-desc">${escapeHtml(opts.description)}</p>
    <div class="ld-empty-actions">
      ${opts.primaryActionLabel ? `<button type="button" class="ld-btn ld-btn-primary" ${opts.primaryActionData ?? ''}>${escapeHtml(opts.primaryActionLabel)}</button>` : ''}
      ${opts.secondaryActionLabel ? `<button type="button" class="ld-btn ld-btn-secondary" ${opts.secondaryActionData ?? ''}>${escapeHtml(opts.secondaryActionLabel)}</button>` : ''}
    </div>
  </div>`;
}

export interface ErrorBannerOptions {
  code?: string;
  message: string;
  requestId?: string;
  retryAction?: string;
}

export function renderErrorBanner(opts: ErrorBannerOptions): string {
  return `<div class="ld-error-banner" role="alert">
    <div class="ld-error-content">
      <span class="ld-error-code">${escapeHtml(opts.code ?? 'ERROR')}</span>
      <span class="ld-error-msg">${escapeHtml(opts.message)}</span>
      ${opts.requestId ? `<span class="ld-error-req">请求 ID: ${escapeHtml(opts.requestId)}</span>` : ''}
    </div>
    ${opts.retryAction ? `<button type="button" class="ld-btn ld-btn-sm ld-btn-secondary" data-action="${escapeHtml(opts.retryAction)}">重试</button>` : ''}
  </div>`;
}
