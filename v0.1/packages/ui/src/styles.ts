export const DASHBOARD_STYLES = `
:root,
[data-theme="dark"] {
  --ld-bg-base: #0b0f19;
  --ld-bg-panel: #111827;
  --ld-bg-card: #161f33;
  --ld-bg-card-hover: #1c2841;
  --ld-bg-elevated: #1e293b;
  --ld-bg-input: #0f172a;
  --ld-text-primary: #f1f5f9;
  --ld-text-secondary: #94a3b8;
  --ld-text-muted: #64748b;
  --ld-border: rgba(148, 163, 184, 0.16);
  --ld-border-strong: rgba(148, 163, 184, 0.28);
  --ld-accent: #3b82f6;
  --ld-accent-hover: #2563eb;
  --ld-accent-soft: rgba(59, 130, 246, 0.16);
  --ld-success: #10b981;
  --ld-success-soft: rgba(16, 185, 129, 0.16);
  --ld-warning: #f59e0b;
  --ld-warning-soft: rgba(245, 158, 11, 0.16);
  --ld-danger: #ef4444;
  --ld-danger-soft: rgba(239, 68, 68, 0.16);
  --ld-shadow: 0 10px 30px -10px rgba(0, 0, 0, 0.55);
  --ld-radius-sm: 6px;
  --ld-radius-md: 10px;
  --ld-radius-lg: 14px;
}

[data-theme="light"] {
  --ld-bg-base: #f1f5f9;
  --ld-bg-panel: #ffffff;
  --ld-bg-card: #ffffff;
  --ld-bg-card-hover: #f8fafc;
  --ld-bg-elevated: #f8fafc;
  --ld-bg-input: #ffffff;
  --ld-text-primary: #0f172a;
  --ld-text-secondary: #475569;
  --ld-text-muted: #64748b;
  --ld-border: rgba(15, 23, 42, 0.12);
  --ld-border-strong: rgba(15, 23, 42, 0.24);
  --ld-accent: #2563eb;
  --ld-accent-hover: #1d4ed8;
  --ld-accent-soft: rgba(37, 99, 235, 0.1);
  --ld-success: #059669;
  --ld-success-soft: rgba(5, 150, 105, 0.12);
  --ld-warning: #d97706;
  --ld-warning-soft: rgba(217, 119, 6, 0.12);
  --ld-danger: #dc2626;
  --ld-danger-soft: rgba(220, 38, 38, 0.12);
  --ld-shadow: 0 8px 24px -8px rgba(15, 23, 42, 0.12);
}

* {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--ld-bg-base);
  color: var(--ld-text-primary);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

[data-reduced-motion="true"] *,
[data-reduced-motion="true"] *::before,
[data-reduced-motion="true"] *::after {
  animation-duration: 0.001ms !important;
  transition-duration: 0.001ms !important;
}

/* Shell Layout */
.ld-app-shell {
  display: flex;
  min-height: 100vh;
}

.ld-sidebar {
  width: 236px;
  flex-shrink: 0;
  background: var(--ld-bg-panel);
  border-right: 1px solid var(--ld-border);
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
  padding: 16px 12px;
  z-index: 20;
}

.ld-brand-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--ld-radius-md);
  color: var(--ld-text-primary);
  text-decoration: none;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  width: 100%;
  text-align: left;
}

.ld-brand-link:hover,
.ld-brand-link.is-active {
  background: var(--ld-accent-soft);
  border-color: rgba(59, 130, 246, 0.35);
}

.ld-brand-emblem {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, #3b82f6, #8b5cf6);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 14px;
}

.ld-nav-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 16px;
  flex: 1;
}

.ld-nav-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--ld-radius-md);
  border: 1px solid transparent;
  background: transparent;
  color: var(--ld-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.ld-nav-btn:hover {
  background: var(--ld-bg-card);
  color: var(--ld-text-primary);
}

.ld-nav-btn.is-active {
  background: var(--ld-accent-soft);
  color: var(--ld-text-primary);
  border-color: rgba(59, 130, 246, 0.42);
  font-weight: 600;
}

.ld-nav-btn-left {
  display: inline-flex;
  align-items: center;
  gap: 10px;
}

.ld-nav-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--ld-bg-elevated);
  color: var(--ld-text-secondary);
  border: 1px solid var(--ld-border);
}

.ld-nav-badge.is-warning {
  background: var(--ld-warning-soft);
  color: var(--ld-warning);
  border-color: rgba(245, 158, 11, 0.4);
}

.ld-sidebar-footer {
  border-top: 1px solid var(--ld-border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ld-user-pill {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-card);
  font-size: 12px;
  color: var(--ld-text-secondary);
}

/* Mobile Header & Bottom Dock */
.ld-mobile-topbar {
  display: none;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--ld-bg-panel);
  border-bottom: 1px solid var(--ld-border);
  position: sticky;
  top: 0;
  z-index: 25;
}

.ld-mobile-dock {
  display: none;
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 58px;
  background: var(--ld-bg-panel);
  border-top: 1px solid var(--ld-border);
  padding: 4px 6px calc(4px + env(safe-area-inset-bottom, 0px));
  z-index: 30;
  justify-content: space-around;
  align-items: center;
}

.ld-dock-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 2px;
  border: none;
  background: transparent;
  color: var(--ld-text-secondary);
  font-size: 11px;
  border-radius: var(--ld-radius-sm);
  cursor: pointer;
}

.ld-dock-btn.is-active {
  color: var(--ld-accent);
  font-weight: 600;
}

/* Main Content Area */
.ld-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* Strictly Blank Home Page (P01) */
.ld-home-blank {
  flex: 1;
  min-height: calc(100vh - 2px);
}

.ld-panel-container {
  max-width: 1160px;
  width: 100%;
  margin: 0 auto;
  padding: 24px 28px 64px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ld-panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.ld-panel-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ld-panel-title {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.ld-panel-subtitle {
  margin: 0;
  font-size: 13px;
  color: var(--ld-text-secondary);
}

.ld-panel-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

/* Return Context & Draft Recovery Banners */
.ld-return-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--ld-radius-md);
  background: var(--ld-accent-soft);
  border: 1px solid rgba(59, 130, 246, 0.4);
  font-size: 13px;
  flex-wrap: wrap;
}

.ld-draft-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  border-radius: var(--ld-radius-sm);
  background: var(--ld-bg-elevated);
  border: 1px solid var(--ld-border-strong);
  font-size: 12px;
  flex-wrap: wrap;
}

.ld-conflict-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: var(--ld-radius-md);
  background: var(--ld-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.5);
  font-size: 12.5px;
}

/* Module Filter Chips */
.ld-module-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 4px;
}

.ld-filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-card);
  color: var(--ld-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s ease;
}

.ld-filter-chip:hover {
  border-color: var(--ld-border-strong);
  color: var(--ld-text-primary);
}

.ld-filter-chip.is-active {
  background: var(--ld-accent);
  border-color: var(--ld-accent);
  color: #ffffff;
}

.ld-chip-count {
  font-size: 11px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.14);
}

/* Subfilter / Toolbar */
.ld-subfilter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.ld-tab-group {
  display: inline-flex;
  background: var(--ld-bg-panel);
  border: 1px solid var(--ld-border);
  border-radius: var(--ld-radius-md);
  padding: 3px;
  gap: 2px;
  flex-wrap: wrap;
}

.ld-tab-btn {
  border: none;
  background: transparent;
  color: var(--ld-text-secondary);
  padding: 5px 12px;
  border-radius: var(--ld-radius-sm);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.ld-tab-btn.is-active {
  background: var(--ld-bg-card);
  color: var(--ld-text-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

/* Module Badges & Color Tokens */
.ld-module-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.ld-module-badge.is-compact {
  padding: 2px 7px;
  font-size: 11px;
}

.ld-color-blue { background: rgba(59, 130, 246, 0.14); border-color: rgba(59, 130, 246, 0.38); color: #60a5fa; }
.ld-color-green { background: rgba(16, 185, 129, 0.14); border-color: rgba(16, 185, 129, 0.38); color: #34d399; }
.ld-color-amber { background: rgba(245, 158, 11, 0.14); border-color: rgba(245, 158, 11, 0.38); color: #fbbf24; }
.ld-color-violet { background: rgba(139, 92, 246, 0.14); border-color: rgba(139, 92, 246, 0.38); color: #a78bfa; }
.ld-color-rose { background: rgba(244, 63, 94, 0.14); border-color: rgba(244, 63, 94, 0.38); color: #fb7185; }
.ld-color-cyan { background: rgba(6, 182, 212, 0.14); border-color: rgba(6, 182, 212, 0.38); color: #22d3ee; }
.ld-color-slate { background: rgba(100, 116, 139, 0.16); border-color: rgba(100, 116, 139, 0.4); color: #94a3b8; }

[data-theme="light"] .ld-color-blue { color: #1d4ed8; }
[data-theme="light"] .ld-color-green { color: #047857; }
[data-theme="light"] .ld-color-amber { color: #b45309; }
[data-theme="light"] .ld-color-violet { color: #6d28d9; }
[data-theme="light"] .ld-color-rose { color: #be123c; }
[data-theme="light"] .ld-color-cyan { color: #0e7490; }
[data-theme="light"] .ld-color-slate { color: #334155; }

/* Cards & Grids */
.ld-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.ld-card-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ld-card {
  background: var(--ld-bg-card);
  border: 1px solid var(--ld-border);
  border-radius: var(--ld-radius-lg);
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  transition: border-color 0.15s ease, transform 0.15s ease;
}

.ld-card:hover {
  border-color: var(--ld-border-strong);
}

.ld-card.is-selected {
  border-color: var(--ld-accent);
  box-shadow: 0 0 0 1px var(--ld-accent);
}

.ld-card.is-needs-review {
  border-color: rgba(245, 158, 11, 0.55);
}

.ld-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.ld-card-title {
  margin: 0;
  font-size: 15.5px;
  font-weight: 600;
  color: var(--ld-text-primary);
}

.ld-card-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--ld-text-secondary);
}

.ld-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--ld-border);
  flex-wrap: wrap;
}

/* Status Pills */
.ld-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-elevated);
  color: var(--ld-text-secondary);
}

.ld-badge-success {
  background: var(--ld-success-soft);
  color: var(--ld-success);
  border-color: rgba(16, 185, 129, 0.4);
}

.ld-badge-warning {
  background: var(--ld-warning-soft);
  color: var(--ld-warning);
  border-color: rgba(245, 158, 11, 0.45);
}

.ld-badge-info {
  background: var(--ld-accent-soft);
  color: var(--ld-accent);
  border-color: rgba(59, 130, 246, 0.4);
}

.ld-badge-danger {
  background: var(--ld-danger-soft);
  color: var(--ld-danger);
  border-color: rgba(239, 68, 68, 0.4);
}

/* Metric Big Value */
.ld-metric-value-box {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin: 4px 0;
}

.ld-metric-number {
  font-size: 28px;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--ld-text-primary);
}

.ld-metric-number.is-null {
  font-size: 18px;
  font-weight: 600;
  color: var(--ld-text-muted);
}

.ld-metric-unit {
  font-size: 13px;
  color: var(--ld-text-secondary);
  font-weight: 600;
}

/* Progress Bar */
.ld-progress-track {
  width: 100%;
  height: 7px;
  border-radius: 999px;
  background: var(--ld-bg-input);
  overflow: hidden;
  border: 1px solid var(--ld-border);
}

.ld-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #10b981);
  border-radius: 999px;
  transition: width 0.25s ease;
}

/* Buttons */
.ld-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: var(--ld-radius-md);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-elevated);
  color: var(--ld-text-primary);
  cursor: pointer;
  transition: all 0.15s ease;
  text-decoration: none;
}

.ld-btn:hover:not(:disabled) {
  border-color: var(--ld-border-strong);
  background: var(--ld-bg-card-hover);
}

.ld-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ld-btn-primary {
  background: var(--ld-accent);
  border-color: var(--ld-accent);
  color: #ffffff;
}

.ld-btn-primary:hover:not(:disabled) {
  background: var(--ld-accent-hover);
  border-color: var(--ld-accent-hover);
}

.ld-btn-success {
  background: var(--ld-success);
  border-color: var(--ld-success);
  color: #ffffff;
}

.ld-btn-danger {
  background: var(--ld-danger-soft);
  border-color: rgba(239, 68, 68, 0.45);
  color: var(--ld-danger);
}

.ld-btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: var(--ld-radius-sm);
}

/* Forms & Inputs */
.ld-form-grid {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ld-form-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.ld-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.ld-label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ld-text-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.ld-label-hint {
  font-weight: 400;
  font-size: 11.5px;
  color: var(--ld-text-muted);
}

.ld-input,
.ld-select,
.ld-textarea {
  width: 100%;
  padding: 8px 11px;
  border-radius: var(--ld-radius-sm);
  border: 1px solid var(--ld-border-strong);
  background: var(--ld-bg-input);
  color: var(--ld-text-primary);
  font-size: 13.5px;
  font-family: inherit;
}

.ld-textarea {
  min-height: 76px;
  resize: vertical;
}

.ld-input:focus,
.ld-select:focus,
.ld-textarea:focus {
  outline: none;
  border-color: var(--ld-accent);
  box-shadow: 0 0 0 2px var(--ld-accent-soft);
}

/* Modal / Drawer Overlay */
.ld-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(5, 8, 16, 0.72);
  backdrop-filter: blur(3px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 70;
}

.ld-modal {
  background: var(--ld-bg-panel);
  border: 1px solid var(--ld-border-strong);
  border-radius: var(--ld-radius-lg);
  box-shadow: var(--ld-shadow);
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ld-modal-header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--ld-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}

.ld-modal-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}

.ld-modal-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
}

.ld-modal-footer {
  padding: 12px 18px;
  border-top: 1px solid var(--ld-border);
  background: var(--ld-bg-panel);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

/* Empty & Error States */
.ld-empty-state {
  background: var(--ld-bg-card);
  border: 1px dashed var(--ld-border-strong);
  border-radius: var(--ld-radius-lg);
  padding: 40px 24px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.ld-empty-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: var(--ld-accent-soft);
  color: var(--ld-accent);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.ld-empty-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.ld-empty-desc {
  margin: 0;
  max-width: 440px;
  font-size: 13px;
  color: var(--ld-text-secondary);
}

.ld-empty-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  flex-wrap: wrap;
  justify-content: center;
}

.ld-error-banner {
  background: var(--ld-danger-soft);
  border: 1px solid rgba(239, 68, 68, 0.45);
  color: var(--ld-text-primary);
  padding: 10px 14px;
  border-radius: var(--ld-radius-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  flex-wrap: wrap;
}

.ld-error-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 700;
  color: var(--ld-danger);
  margin-right: 8px;
}

/* Login Screen */
.ld-login-screen {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: radial-gradient(circle at top, rgba(59, 130, 246, 0.14), transparent 55%), var(--ld-bg-base);
}

.ld-login-card {
  width: 100%;
  max-width: 420px;
  background: var(--ld-bg-panel);
  border: 1px solid var(--ld-border-strong);
  border-radius: var(--ld-radius-lg);
  padding: 28px 24px;
  box-shadow: var(--ld-shadow);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* Toast Notification */
.ld-toast-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 380px;
  pointer-events: none;
}

.ld-toast {
  background: var(--ld-bg-panel);
  border: 1px solid var(--ld-border-strong);
  border-left: 4px solid var(--ld-accent);
  border-radius: var(--ld-radius-md);
  padding: 12px 14px;
  box-shadow: var(--ld-shadow);
  font-size: 13px;
  pointer-events: auto;
}

.ld-toast.is-unlock {
  border-left-color: #f59e0b;
}

/* Timeline view */
.ld-timeline {
  position: relative;
  padding-left: 20px;
  border-left: 2px solid var(--ld-border-strong);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ld-timeline-item {
  position: relative;
}

.ld-timeline-item::before {
  content: "";
  position: absolute;
  left: -26px;
  top: 18px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ld-accent);
  border: 2px solid var(--ld-bg-base);
}

/* Table for settings dependency check & support matrix */
.ld-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.ld-table th,
.ld-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--ld-border);
  text-align: left;
}

.ld-table th {
  color: var(--ld-text-secondary);
  font-weight: 600;
  font-size: 12px;
}

/* AI generation (T2/T3): config summary, validation issues, candidate preview */
.ld-ai-config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.ld-ai-kv {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--ld-radius-md);
  background: var(--ld-bg-elevated);
  border: 1px solid var(--ld-border);
  font-size: 12px;
}

.ld-ai-kv-label {
  color: var(--ld-text-secondary);
  font-size: 11.5px;
}

.ld-ai-kv-value {
  color: var(--ld-text-primary);
  font-weight: 600;
  word-break: break-all;
}

.ld-ai-honest-banner {
  padding: 10px 12px;
  border-radius: var(--ld-radius-md);
  border: 1px solid var(--ld-border-strong);
  background: var(--ld-bg-elevated);
  font-size: 12.5px;
  line-height: 1.65;
  color: var(--ld-text-secondary);
}

.ld-ai-honest-banner.is-warning {
  border-color: rgba(245, 158, 11, 0.45);
  background: var(--ld-warning-soft);
  color: var(--ld-text-primary);
}

.ld-ai-issue-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ld-ai-issue {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: var(--ld-radius-sm);
  border: 1px solid rgba(239, 68, 68, 0.35);
  background: var(--ld-danger-soft);
  font-size: 12px;
  line-height: 1.55;
}

.ld-ai-issue.is-warning {
  border-color: rgba(245, 158, 11, 0.35);
  background: var(--ld-warning-soft);
}

.ld-ai-issue-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-input);
  color: var(--ld-text-primary);
  white-space: nowrap;
}

.ld-ai-candidate-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.ld-ai-count-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ld-ai-count {
  padding: 3px 9px;
  border-radius: 999px;
  border: 1px solid var(--ld-border);
  background: var(--ld-bg-elevated);
  font-size: 12px;
  color: var(--ld-text-secondary);
}

.ld-ai-list {
  margin: 4px 0 0;
  padding-left: 16px;
  font-size: 12px;
  line-height: 1.65;
  color: var(--ld-text-secondary);
}

.ld-ai-busy {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-radius: var(--ld-radius-md);
  border: 1px dashed var(--ld-border-strong);
  background: var(--ld-bg-elevated);
  font-size: 13px;
  color: var(--ld-text-secondary);
}

.ld-ai-busy-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--ld-accent);
  animation: ld-ai-pulse 1.1s ease-in-out infinite;
}

@keyframes ld-ai-pulse {
  0%, 100% { opacity: 0.35; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.1); }
}

[data-reduced-motion="true"] .ld-ai-busy-dot {
  animation: none;
  opacity: 1;
}

.ld-ai-job-table td,
.ld-ai-job-table th {
  vertical-align: top;
}

/* Responsive Mobile Layout (including 360px narrow screen & non-occlusion) */
@media (max-width: 768px) {
  .ld-app-shell {
    flex-direction: column;
  }
  .ld-sidebar {
    display: none;
  }
  .ld-mobile-topbar {
    display: flex;
  }
  .ld-mobile-dock {
    display: flex;
  }
  .ld-panel-container {
    padding: 14px 12px 92px;
  }
  .ld-card-grid {
    grid-template-columns: 1fr;
  }
  .ld-form-row {
    grid-template-columns: 1fr;
  }
  .ld-modal-backdrop {
    align-items: flex-start;
    padding: 10px 8px calc(68px + env(safe-area-inset-bottom, 0px));
  }
  .ld-modal {
    max-height: calc(100vh - 82px);
  }
  .ld-toast-container {
    bottom: 68px;
    left: 12px;
    right: 12px;
    max-width: none;
  }
}
`;
