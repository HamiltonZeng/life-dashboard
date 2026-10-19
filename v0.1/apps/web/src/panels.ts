import {
  AI_APPLY_MODE_META,
  AI_CONTENT_TYPE_META,
  AI_JOB_STATUS_META,
  AI_MODE_META,
  COMPLETION_MODE_META,
  escapeHtml,
  FIELD_TYPE_META,
  METRIC_AGGREGATION_META,
  METRIC_WINDOW_META,
  MODULE_COLORS,
  MODULE_ICON_LABELS,
  MODULE_STATUS_META,
  renderEmptyState,
  renderErrorBanner,
  renderIcon,
  renderModuleBadge,
  renderModuleFilterBar,
  TASK_STATUS_META,
  type ModuleColorName,
  type ModuleIconName
} from '../../../packages/ui/src/index.js';
import type { AppState } from './state.js';
import type {
  AchievementAwardRow,
  AchievementDefinitionRow,
  AiBatchRow,
  AiBlueprint,
  AiConfigData,
  AiGenerationEnvelope,
  AiGenerationSummary,
  AiJobRow,
  AiValidationIssue,
  BootstrapData,
  MetricRow,
  ModuleRow,
  RecordRow,
  RecordTypeRow,
  TaskRow
} from './types.js';

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

// ---------------------------------------------------------------------------
// AI generation (T2/T3): config, jobs, validation, candidate and batch views.
// Every model-provided string is escaped; no candidate field is trusted as fact.
// ---------------------------------------------------------------------------

function aiBadgeClass(tone: string): string {
  if (tone === 'success') return 'ld-badge-success';
  if (tone === 'warning') return 'ld-badge-warning';
  if (tone === 'danger') return 'ld-badge-danger';
  if (tone === 'info') return 'ld-badge-info';
  return '';
}

function renderAiStatusBadge(status: string): string {
  const meta = AI_JOB_STATUS_META[status] ?? { label: status, tone: 'neutral', description: '' };
  return `<span class="ld-badge ${aiBadgeClass(meta.tone)}" title="${escapeHtml(meta.description)}">${escapeHtml(meta.label)}</span>`;
}

function aiKv(label: string, value: string): string {
  return `<div class="ld-ai-kv"><span class="ld-ai-kv-label">${escapeHtml(label)}</span><span class="ld-ai-kv-value">${escapeHtml(value)}</span></div>`;
}

/**
 * Honest provider description. `cloud_ai=false` or provider=mock must never be
 * presented as a real DeepSeek call; keys are never read by the browser.
 */
export function describeAiProvider(
  config: AiConfigData | null,
  state: AppState
): { provider: string; cloud: boolean; model: string; schema: string; honest: string; warning: boolean } {
  if (!config) {
    return {
      provider: state.capabilities?.ai_provider ?? '未知',
      cloud: state.capabilities?.cloud_ai ?? false,
      model: '未知',
      schema: state.capabilities?.ai_schema_version ?? '1.0',
      honest:
        '尚未从服务端 /api/v1/ai/config 读取到 AI 配置。界面不会假设模型可用，也不会在本地保存任何密钥。',
      warning: true
    };
  }
  let honest: string;
  let warning = false;
  if (config.provider === 'mock' || !config.cloud_ai) {
    honest =
      config.provider === 'mock'
        ? '当前为本地确定性模拟供应商（mock）：不会访问 DeepSeek，不产生云端 API 费用；结果仅代表服务端校验通过的配置候选，不代表真实模型能力。'
        : '服务端声明 cloud_ai = false：生成不会调用云端模型，界面也不会把结果描述为真实 DeepSeek 调用。';
  } else if (!config.configured) {
    honest =
      '服务端选择 DeepSeek 但尚未配置可用 API Key：生成请求会明确失败，界面不会伪造候选或假装成功。';
    warning = true;
  } else {
    honest =
      '服务端已配置 DeepSeek；只有你主动触发生成时才会调用付费接口。API Key 只保存在服务端，浏览器不读取、不存储。';
  }
  return {
    provider: config.provider,
    cloud: config.cloud_ai,
    model: config.model,
    schema: config.schema_version,
    honest,
    warning
  };
}

function aiSummaryItems(summary?: AiGenerationSummary): Array<{ label: string; count: number }> {
  if (!summary) return [];
  const items: Array<{ label: string; count: number }> = [];
  const pick = (label: string, keys: Array<keyof AiGenerationSummary>) => {
    for (const key of keys) {
      const value = summary[key];
      if (typeof value === 'number' && value > 0) {
        items.push({ label, count: value });
        return;
      }
    }
  };
  pick('模块', ['module']);
  pick('记录模板', ['record_types', 'record_type']);
  pick('数值', ['metrics', 'metric']);
  pick('任务', ['tasks', 'task']);
  pick('成就', ['achievements', 'achievement']);
  return items;
}

function renderAiSummaryChips(summary?: AiGenerationSummary): string {
  const items = aiSummaryItems(summary);
  if (items.length === 0) return '<span class="ld-card-meta">无新增内容</span>';
  return `<div class="ld-ai-count-row">${items
    .map(item => `<span class="ld-ai-count">${escapeHtml(item.label)} ${item.count}</span>`)
    .join('')}</div>`;
}

function aiIssueParts(issue: string | AiValidationIssue): {
  code: string;
  path: string;
  layer: string;
  message: string;
} {
  if (typeof issue === 'string') return { code: '', path: '', layer: '', message: issue };
  return {
    code: issue.code ?? '',
    path: issue.path ?? '',
    layer: issue.layer ?? '',
    message: issue.message ?? JSON.stringify(issue)
  };
}

function renderAiIssues(
  issues: Array<string | AiValidationIssue> | undefined,
  kind: 'error' | 'warning'
): string {
  if (!issues || issues.length === 0) return '';
  return `<div class="ld-ai-issue-list">${issues
    .map(issue => {
      const parts = aiIssueParts(issue);
      return `<div class="ld-ai-issue ${kind === 'warning' ? 'is-warning' : ''}">
        ${parts.code ? `<span class="ld-ai-issue-code">${escapeHtml(parts.code)}</span>` : ''}
        ${parts.layer ? `<span class="ld-ai-issue-code">${escapeHtml(parts.layer)}</span>` : ''}
        ${parts.path ? `<span class="ld-ai-issue-code">${escapeHtml(parts.path)}</span>` : ''}
        <span>${escapeHtml(parts.message)}</span>
      </div>`;
    })
    .join('')}</div>`;
}

function renderAiNotes(notes: string[] | undefined): string {
  if (!notes || notes.length === 0) return '';
  return `<ul class="ld-ai-list">${notes.map(note => `<li>${escapeHtml(note)}</li>`).join('')}</ul>`;
}

function renderAiConfigCard(state: AppState): string {
  const { config, configLoading, configError } = state.ai;
  const info = describeAiProvider(config, state);
  const supported = config?.supported_content_types ?? [];
  const taskSchedules = config?.supported_tasks?.schedules?.join(' / ') ?? '—';
  const completionModes = config?.supported_tasks?.completion_modes?.join(' / ') ?? '—';
  const repeatPolicies = config?.supported_achievements?.repeat_policy?.join(' / ') ?? '—';
  const historyPolicies = config?.supported_achievements?.history_policy?.join(' / ') ?? '—';

  return `<div class="ld-card">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">DeepSeek 连接与模块蓝图 1.0（AI 自动填充）</h3>
        <p class="ld-panel-subtitle">实时读取 <code>GET /api/v1/ai/config</code>。密钥只保存在服务端，浏览器只展示配置状态，不读取、不存储任何 Key。</p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        <span class="ld-badge ${info.cloud ? 'ld-badge-success' : 'ld-badge-warning'}">cloud_ai = ${String(info.cloud)}</span>
        <span class="ld-badge">provider = ${escapeHtml(info.provider)}</span>
        <button type="button" class="ld-btn ld-btn-sm" data-action="refresh-ai-config" ${state.ai.configLoading ? 'disabled' : ''}>${state.ai.configLoading ? '刷新中…' : '刷新 AI 配置'}</button>
      </div>
    </div>
    <div class="ld-ai-honest-banner ${info.warning ? 'is-warning' : ''}">${escapeHtml(info.honest)}</div>
    ${
      configError
        ? `<div class="ld-error-banner" role="alert" style="margin-top:8px;"><span>无法读取 AI 配置（${escapeHtml(configError.code ?? 'ERROR')}）：${escapeHtml(configError.message)}</span></div>`
        : ''
    }
    ${
      configLoading && !config
        ? '<div class="ld-ai-busy"><span class="ld-ai-busy-dot"></span><span>正在读取服务端 AI 配置…</span></div>'
        : ''
    }
    ${
      config
        ? `<div class="ld-ai-config-grid" style="margin-top:10px;">
            ${aiKv('供应商 provider', config.provider)}
            ${aiKv('模型 model', config.model)}
            ${aiKv('云端调用 cloud_ai', String(config.cloud_ai))}
            ${aiKv('配置状态 configured', String(config.configured))}
            ${aiKv('蓝图版本 schema_version', config.schema_version)}
            ${aiKv('最大尝试 max_attempts', String(config.max_attempts))}
            ${aiKv('超时 timeout_ms', `${config.timeout_ms} ms`)}
            ${aiKv('每日生成上限 daily_job_limit', String(config.daily_job_limit))}
          </div>
          <div class="ld-card-meta" style="margin-top:10px;flex-direction:column;align-items:flex-start;gap:4px;line-height:1.7;">
            <div><strong>本次可生成的内容类型：</strong>${supported.length > 0 ? supported.map(key => escapeHtml(AI_CONTENT_TYPE_META[key]?.label ?? key)).join('、') : '—'}</div>
            <div><strong>任务子集：</strong>排期 <code>${escapeHtml(taskSchedules)}</code> · 完成方式 <code>${escapeHtml(completionModes)}</code></div>
            <div><strong>成就子集：</strong>重复策略 <code>${escapeHtml(repeatPolicies)}</code> · 历史范围 <code>${escapeHtml(historyPolicies)}</code></div>
            ${renderAiNotes(config.notes)}
          </div>`
        : ''
    }
  </div>`;
}

function renderAiJobsCard(state: AppState, data: BootstrapData): string {
  const jobs = state.ai.jobs;
  const rowsHtml =
    jobs.length === 0
      ? `<tr><td colspan="6" style="color:var(--ld-text-muted);">暂无 AI 生成任务。点击「✦ 发起 AI 生成」创建第一个候选配置。</td></tr>`
      : jobs
          .map(job => {
            const mod = job.module_id ? findModule(data, job.module_id) : undefined;
            const applyModeMeta = AI_APPLY_MODE_META[job.apply_mode] ?? { label: job.apply_mode, description: '' };
            return `<tr>
              <td style="white-space:nowrap;">${escapeHtml(formatDateTime(job.created_at))}</td>
              <td>${renderAiStatusBadge(job.status)}</td>
              <td>
                <div>${escapeHtml(AI_MODE_META[job.mode]?.label ?? job.mode)}</div>
                <div class="ld-card-meta">${escapeHtml(applyModeMeta.label)}</div>
              </td>
              <td>${mod ? renderModuleBadge(mod, true) : `<span class="ld-card-meta">${job.mode === 'create' ? '新建模块' : '未知模块'}</span>`}</td>
              <td>
                ${renderAiSummaryChips(job.summary)}
                ${job.error ? `<div class="ld-card-meta" style="margin-top:4px;"><span class="ld-badge ld-badge-danger">${escapeHtml(job.error.code)}</span> ${escapeHtml(job.error.message)}</div>` : ''}
              </td>
              <td>
                <div class="ld-card-meta">尝试 ${job.attempts} 次 · 候选 ${job.validation.valid ? '校验通过' : '未通过'}</div>
                <button type="button" class="ld-btn ld-btn-sm" style="margin-top:4px;" data-action="ai-open-job" data-job-id="${escapeHtml(job.id)}">查看详情</button>
              </td>
            </tr>`;
          })
          .join('');

  return `<div class="ld-card">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">最近的 AI 生成任务</h3>
        <p class="ld-panel-subtitle">列表接口不含完整候选；状态来自服务端真实 job，不使用「正在思考」长期遮住失败。</p>
      </div>
      <button type="button" class="ld-btn ld-btn-sm" data-action="refresh-ai-jobs" ${state.ai.jobsLoading ? 'disabled' : ''}>${state.ai.jobsLoading ? '刷新中…' : '刷新任务列表'}</button>
    </div>
    ${
      state.ai.jobsError
        ? `<div class="ld-error-banner" role="alert"><span>无法读取生成任务（${escapeHtml(state.ai.jobsError.code ?? 'ERROR')}）：${escapeHtml(state.ai.jobsError.message)}</span></div>`
        : ''
    }
    <div style="overflow-x:auto;">
      <table class="ld-table ld-ai-job-table">
        <thead><tr><th>创建时间</th><th>状态</th><th>模式 / 应用方式</th><th>目标模块</th><th>内容摘要 / 错误</th><th>详情</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  </div>`;
}

export function renderSettingsAiSection(state: AppState, data: BootstrapData): string {
  return `<div class="ld-card-list">
    ${renderAiConfigCard(state)}
    <div class="ld-card">
      <div class="ld-card-top">
        <div>
          <h3 class="ld-card-title">AI 生成与自动填充</h3>
          <p class="ld-panel-subtitle">生成结果统一为模块蓝图 1.0；服务端执行解析、结构、语义、权限与版本、业务五层校验，任何一层失败都不会留下半套对象。</p>
        </div>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-ai-modal">✦ 发起 AI 生成</button>
      </div>
      <div class="ld-card-meta" style="flex-direction:column;align-items:flex-start;gap:4px;line-height:1.7;">
        <div>1. <strong>只生成配置定义：</strong>不会生成真实记录、不会直接完成或解锁任何任务与成就；应用后仍由真实记录驱动统计与授予。</div>
        <div>2. <strong>默认追加、不覆盖：</strong>首期协议只提供新增包，不夹带更新或删除指令；同名对象不会自动合并。</div>
        <div>3. <strong>应用与撤销：</strong>应用候选时在一个事务内写入配置与 ID 映射；撤销时若已被真实记录或外部配置引用，只归档/停用，绝不级联删除真实生活记录。</div>
        <div>4. <strong>密钥边界：</strong>不提供任何 API Key 输入或存储；配置状态由服务端 <code>/ai/config</code> 如实返回。</div>
      </div>
    </div>
    ${renderAiJobsCard(state, data)}
  </div>`;
}

function aiReferenceSelect(
  id: string,
  label: string,
  options: Array<{ value: string; text: string }>,
  hint: string
): string {
  return `<label class="ld-field">
    <span class="ld-label">${escapeHtml(label)} <span class="ld-label-hint">${escapeHtml(hint)}</span></span>
    <select class="ld-select" id="${id}" name="${id}" multiple size="${Math.min(Math.max(options.length, 2), 5)}" ${options.length === 0 ? 'disabled' : ''}>
      ${
        options.length === 0
          ? `<option value="" disabled>当前模块暂无可引用对象</option>`
          : options
              .map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.text)}</option>`)
              .join('')
      }
    </select>
  </label>`;
}

export function renderAiGenerateModal(state: AppState, data: BootstrapData): string {
  const enabledModules = data.modules.filter(m => m.status === 'enabled');
  const modal = state.activeModal?.kind === 'ai-generate' ? state.activeModal : null;
  const selectedModId = modal?.moduleId ?? enabledModules[0]?.id ?? '';
  const info = describeAiProvider(state.ai.config, state);
  const supported = state.ai.config?.supported_content_types ?? [
    'record_types',
    'metrics',
    'tasks',
    'achievements'
  ];
  const userTz = state.user?.timezone ?? 'Asia/Shanghai';
  const selectedModule = enabledModules.find(m => m.id === selectedModId);
  const moduleRecordTypes = selectedModule
    ? data.record_types.filter(rt => rt.module_id === selectedModule.id)
    : [];
  const moduleMetrics = selectedModule ? data.metrics.filter(m => m.module_id === selectedModule.id) : [];

  const contentTypeChecks = supported
    .map(key => {
      const meta = AI_CONTENT_TYPE_META[key] ?? {
        label: key,
        shortLabel: key,
        description: ''
      };
      return `<label style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border:1px solid var(--ld-border);border-radius:var(--ld-radius-sm);background:var(--ld-bg-elevated);cursor:pointer;">
        <input type="checkbox" name="content_types" value="${escapeHtml(key)}" checked style="margin-top:3px;" />
        <span>
          <strong style="font-size:13px;">${escapeHtml(meta.label)}</strong>
          <span class="ld-card-meta" style="display:block;">${escapeHtml(meta.description)}</span>
        </span>
      </label>`;
    })
    .join('');

  return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
    <form class="ld-modal" id="ld-form-ai-generate">
      <div class="ld-modal-header">
        <div>
          <h2 class="ld-modal-title">✦ AI 生成模块蓝图配置</h2>
          <div class="ld-card-meta">服务端蓝图 1.0 · schema ${escapeHtml(info.schema)} · provider ${escapeHtml(info.provider)}</div>
        </div>
        <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
      </div>
      <div class="ld-modal-body">
        <div class="ld-ai-honest-banner ${info.warning ? 'is-warning' : ''}">${escapeHtml(info.honest)}</div>

        <div class="ld-form-row">
          <label class="ld-field">
            <span class="ld-label">生成模式 *</span>
            <select class="ld-select" name="mode" id="ld-ai-mode-select">
              ${Object.entries(AI_MODE_META)
                .map(
                  ([value, meta]) =>
                    `<option value="${escapeHtml(value)}" ${value === 'extend' && enabledModules.length > 0 ? 'selected' : ''}>${escapeHtml(meta.label)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="ld-field">
            <span class="ld-label">写入方式 *</span>
            <select class="ld-select" name="apply_mode">
              ${Object.entries(AI_APPLY_MODE_META)
                .map(
                  ([value, meta]) =>
                    `<option value="${escapeHtml(value)}">${escapeHtml(meta.label)} — ${escapeHtml(meta.description)}</option>`
                )
                .join('')}
            </select>
          </label>
        </div>

        <div id="ld-ai-extend-fields" class="ld-form-grid">
          <label class="ld-field">
            <span class="ld-label">目标模块 * <span class="ld-label-hint">仅向选中的启用模块追加配置，不修改其名称/图标/颜色</span></span>
            <select class="ld-select" name="module_id" id="ld-ai-module-select">
              ${
                enabledModules.length === 0
                  ? `<option value="">没有启用的模块；请先新建或启用模块</option>`
                  : enabledModules
                      .map(
                        m =>
                          `<option value="${escapeHtml(m.id)}" ${m.id === selectedModId ? 'selected' : ''}>${escapeHtml(m.name)} (v${m.version})</option>`
                      )
                      .join('')
              }
            </select>
          </label>
          <div class="ld-form-row">
            ${aiReferenceSelect(
              'ai-ref-record-types',
              '允许引用的已有记录模板',
              moduleRecordTypes.map(rt => ({ value: rt.id, text: rt.name })),
              'reference.record_type_ids（可选，多选）'
            )}
            ${aiReferenceSelect(
              'ai-ref-metrics',
              '允许引用的已有数值定义',
              moduleMetrics.map(m => ({ value: m.id, text: `${m.definition.name} (${m.definition.unit})` })),
              'reference.metric_ids（可选，多选）'
            )}
          </div>
        </div>

        <div id="ld-ai-create-fields" class="ld-form-grid" style="display:none;">
          <div class="ld-ai-honest-banner">新建模块的名称 / 图标 / 主题色会作为明确要求写入本次生成提示；服务端 API 只接收 prompt、mode、content_types、timezone，不会把额外字段当作已授权写入。</div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">新模块名称 <span class="ld-label-hint">写入提示</span></span>
              <input class="ld-input" type="text" name="new_module_name" maxlength="60" placeholder="例如：语言学习" />
            </label>
            <label class="ld-field">
              <span class="ld-label">模块图标</span>
              <select class="ld-select" name="new_module_icon">
                ${Object.keys(MODULE_ICON_LABELS)
                  .map(key => `<option value="${escapeHtml(key)}">${escapeHtml(MODULE_ICON_LABELS[key as ModuleIconName])}</option>`)
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">主题色</span>
              <select class="ld-select" name="new_module_color">
                ${Object.values(MODULE_COLORS)
                  .map(color => `<option value="${escapeHtml(color.key)}">${escapeHtml(color.label)}</option>`)
                  .join('')}
              </select>
            </label>
          </div>
        </div>

        <div class="ld-field">
          <span class="ld-label">本次生成内容类型 * <span class="ld-label-hint">至少选择一类</span></span>
          <div class="ld-ai-candidate-grid">${contentTypeChecks}</div>
        </div>

        <label class="ld-field">
          <span class="ld-label">你的需求描述 * <span class="ld-label-hint">真实记录仍由你填写；模型只能生成配置定义</span></span>
          <textarea class="ld-input" name="prompt" rows="5" maxlength="4000" required placeholder="例如：在学习与发展里，给我设计一套每次十分钟起步的编程练习任务，配一个记录模板、学习时长统计和一个成就。不要创建通知。"></textarea>
        </label>

        <div class="ld-card-meta" style="line-height:1.7;">
          <div>时区：<code>${escapeHtml(userTz)}</code>（来自当前用户资料，随请求提交 <code>timezone</code>）</div>
          <div>本阶段同步生成，服务端超时上限内返回；异步 worker 与排队恢复属后续阶段。</div>
          <div>首版不会生成或应用「每日/每周/一次性」排期任务与按周期重复成就；出现时服务端会明确拒绝并保留候选，不会静默降级。</div>
        </div>
      </div>
      <div class="ld-modal-footer">
        <button type="button" class="ld-btn" data-action="close-modal">取消</button>
        <button type="submit" class="ld-btn ld-btn-primary">提交生成</button>
      </div>
    </form>
  </div>`;
}

function renderAiCandidateCard(candidate: AiBlueprint | null): string {
  if (!candidate) {
    return `<div class="ld-card">
      <h3 class="ld-card-title">候选蓝图</h3>
      <div class="ld-card-meta">服务端未返回完整候选（列表接口不返回候选；失败或已应用时也可能为空）。界面不会在此情况下声称已应用任何配置。</div>
    </div>`;
  }
  const module = candidate.module;
  const recordTypes = candidate.record_types ?? [];
  const metrics = candidate.metrics ?? [];
  const tasks = candidate.tasks ?? [];
  const achievements = candidate.achievements ?? [];
  const warnings = candidate.warnings ?? [];

  const section = (title: string, count: number, listHtml: string, emptyText: string): string => `<div>
    <strong style="font-size:13px;">${escapeHtml(title)} (${count})</strong>
    ${listHtml || `<div class="ld-card-meta">${escapeHtml(emptyText)}</div>`}
  </div>`;

  const rtHtml = recordTypes.length
    ? `<ul class="ld-ai-list">${recordTypes
        .map(
          rt =>
            `<li><strong>${escapeHtml(rt.name)}</strong> <code>${escapeHtml(rt.local_ref)}</code> · ${(rt.fields ?? []).length} 个字段${(rt.fields ?? []).map(f => escapeHtml(f.label)).join('、') ? `：${(rt.fields ?? []).map(f => escapeHtml(f.label)).join('、')}` : ''}</li>`
        )
        .join('')}</ul>`
    : '';
  const metricHtml = metrics.length
    ? `<ul class="ld-ai-list">${metrics
        .map(
          m =>
            `<li><strong>${escapeHtml(m.name)}</strong> · ${escapeHtml(m.source?.aggregation ?? '')} / ${escapeHtml(m.source?.window ?? '')}${m.source?.field_key ? ` · 字段 ${escapeHtml(m.source.field_key)}` : ' · 唯一记录计数'} · 单位 ${escapeHtml(m.unit ?? '—')}${m.proposed_target ? ` · 建议目标 ${escapeHtml(m.proposed_target.operator ?? '')} ${escapeHtml(String(m.proposed_target.value ?? ''))}（未采用，不参与正式进度）` : ''}</li>`
        )
        .join('')}</ul>`
    : '';
  const taskHtml = tasks.length
    ? `<ul class="ld-ai-list">${tasks
        .map(
          t =>
            `<li><strong>${escapeHtml(t.title)}</strong> · ${escapeHtml(t.completion_mode ?? '')} · 排期 ${escapeHtml(t.schedule?.kind ?? '—')}${t.record_binding?.acceptance ? ` · 验收 ${escapeHtml(t.record_binding.acceptance.kind ?? '')}${t.record_binding.acceptance.kind === 'field_gte' ? ` (${escapeHtml(t.record_binding.acceptance.field_key ?? '')} ≥ ${escapeHtml(String(t.record_binding.acceptance.threshold ?? ''))})` : ''}` : ''}</li>`
        )
        .join('')}</ul>`
    : '';
  const achHtml = achievements.length
    ? `<ul class="ld-ai-list">${achievements
        .map(
          a =>
            `<li><strong>${escapeHtml(a.name)}</strong> · ${escapeHtml(a.condition?.operator ?? '')} ${escapeHtml(String(a.condition?.threshold ?? ''))} · 重复策略 ${escapeHtml(a.repeat_policy ?? '—')} · 历史范围 ${escapeHtml(a.history_policy ?? '—')}</li>`
        )
        .join('')}</ul>`
    : '';
  const warningsHtml = warnings.length
    ? `<ul class="ld-ai-list">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`
    : '';

  return `<div class="ld-card">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">候选蓝图（尚未写入任何配置）</h3>
        <p class="ld-panel-subtitle">schema_version ${escapeHtml(candidate.schema_version)} · kind ${escapeHtml(candidate.kind)}${module ? ` · 模块「${escapeHtml(module.name)}」(${escapeHtml(module.mode)})` : ''}</p>
      </div>
      <span class="ld-badge">${escapeHtml(module?.icon ?? '')} · ${escapeHtml(module?.color ?? '')}</span>
    </div>
    ${module ? `<div class="ld-ai-honest-banner">目标：${module.mode === 'create' ? '新建模块' : '扩展现有模块'}${module.description ? ` · ${escapeHtml(module.description)}` : ''}</div>` : ''}
    <div class="ld-ai-candidate-grid">
      ${section('记录模板', recordTypes.length, rtHtml, '无新增记录模板')}
      ${section('数值', metrics.length, metricHtml, '无新增数值')}
      ${section('任务', tasks.length, taskHtml, '无新增任务')}
      ${section('成就', achievements.length, achHtml, '无新增成就')}
    </div>
    ${warningsHtml ? `<div><strong style="font-size:13px;">候选 warnings</strong>${warningsHtml}</div>` : ''}
  </div>`;
}

function renderAiBatchCard(batch: AiBatchRow, data: BootstrapData, busy: boolean): string {
  const mod = findModule(data, batch.module_id);
  const revoked = batch.status === 'revoked';
  return `<div class="ld-card">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">已应用批次</h3>
        <p class="ld-panel-subtitle">批次 ${escapeHtml(batch.id.slice(0, 8))}… · job ${escapeHtml(batch.job_id.slice(0, 8))}… · 应用时间 ${escapeHtml(formatDateTime(batch.applied_at))}${batch.revoked_at ? ` · 撤销时间 ${escapeHtml(formatDateTime(batch.revoked_at))}` : ''}</p>
      </div>
      <span class="ld-badge ${revoked ? 'ld-badge-warning' : 'ld-badge-success'}">${revoked ? '已撤销' : '已应用'}${batch.revoke_mode ? ` / ${escapeHtml(batch.revoke_mode)}` : ''}</span>
    </div>
    <div class="ld-card-meta">
      ${renderAiSummaryChips(batch.summary)}
      <span>目标模块：${mod ? renderModuleBadge(mod, true) : escapeHtml(batch.module_id)}</span>
      ${batch.module_created ? '<span class="ld-badge ld-badge-info">本次新建模块</span>' : ''}
    </div>
    ${batch.objects.length > 0 ? `<ul class="ld-ai-list">${batch.objects.map(o => `<li>${escapeHtml(o.kind)} <code>${escapeHtml(o.local_ref)}</code> → <code>${escapeHtml(o.id.slice(0, 8))}…</code></li>`).join('')}</ul>` : ''}
    ${
      revoked
        ? '<div class="ld-ai-honest-banner">该批次已撤销；被真实记录或外部配置引用的对象只归档/停用，真实生活记录未被删除。</div>'
        : `<div class="ld-ai-honest-banner">撤销时：无引用则删除本次新增定义；一旦被记录、授予或其他配置引用，则归档模块、取消任务、停用数值/成就，绝不级联删除真实记录。</div>
           <div class="ld-card-footer">
             <span class="ld-card-meta">撤销操作不可恢复已删除的配置定义，但不会删除任何真实记录。</span>
             <button type="button" class="ld-btn ld-btn-danger" data-action="ai-revoke-batch" data-batch-id="${escapeHtml(batch.id)}" ${busy ? 'disabled' : ''}>撤销本次添加</button>
           </div>`
    }
  </div>`;
}

function renderAiJobDetailCard(state: AppState, job: AiJobRow, data: BootstrapData): string {
  const mod = job.module_id ? findModule(data, job.module_id) : undefined;
  const applyModeMeta = AI_APPLY_MODE_META[job.apply_mode] ?? { label: job.apply_mode, description: '' };
  const busy = state.ai.busy;
  const canApply =
    job.status === 'preview_ready' || (job.status === 'needs_fix' && job.validation.valid === true);
  const canRetry =
    (job.status === 'needs_fix' || job.status === 'failed') &&
    job.attempts < (state.ai.config?.max_attempts ?? job.attempts + 1);
  const canCancel = job.status === 'preview_ready' || job.status === 'needs_fix';
  const alreadyApplied = state.ai.result?.already_applied ?? false;

  return `<div class="ld-card">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">生成任务详情</h3>
        <p class="ld-panel-subtitle">job ${escapeHtml(job.id)} · ${escapeHtml(AI_MODE_META[job.mode]?.label ?? job.mode)} · ${escapeHtml(applyModeMeta.label)}</p>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
        ${renderAiStatusBadge(job.status)}
        ${alreadyApplied ? '<span class="ld-badge ld-badge-info">重复请求已合并为同一批次</span>' : ''}
      </div>
    </div>
    <div class="ld-card-meta" style="line-height:1.8;">
      <span>目标模块：${mod ? renderModuleBadge(mod, true) : job.mode === 'create' ? '新建模块' : escapeHtml(job.module_id ?? '未知')}</span>
      <span>provider <code>${escapeHtml(job.provider)}</code> · model <code>${escapeHtml(job.model)}</code></span>
      <span>尝试 ${job.attempts} 次 · tokens ${escapeHtml(String(job.usage?.total_tokens ?? 0))}</span>
      <span>创建 ${escapeHtml(formatDateTime(job.created_at))}${job.finished_at ? ` · 结束 ${escapeHtml(formatDateTime(job.finished_at))}` : ''}</span>
    </div>
    ${job.error ? `<div class="ld-error-banner" role="alert"><span><strong>${escapeHtml(job.error.code)}</strong>：${escapeHtml(job.error.message)}</span></div>` : ''}
    <div>
      <strong style="font-size:13px;">服务端校验（${job.validation.valid ? '通过' : '未通过'}）</strong>
      ${
        job.validation.errors.length > 0
          ? renderAiIssues(job.validation.errors, 'error')
          : '<div class="ld-card-meta">无结构 / 语义 / 权限 / 业务校验错误。</div>'
      }
      ${
        job.validation.warnings && job.validation.warnings.length > 0
          ? `<div style="margin-top:6px;"><strong style="font-size:12px;color:var(--ld-text-secondary);">校验 warnings</strong>${renderAiIssues(job.validation.warnings, 'warning')}</div>`
          : ''
      }
      ${
        job.warnings && job.warnings.length > 0
          ? `<div style="margin-top:6px;"><strong style="font-size:12px;color:var(--ld-text-secondary);">服务端 warnings</strong>${renderAiIssues(job.warnings, 'warning')}</div>`
          : ''
      }
    </div>
    <div class="ld-card-meta" style="line-height:1.7;">
      <div><strong>内容摘要：</strong></div>
      ${renderAiSummaryChips(job.summary)}
    </div>
    <div class="ld-card-footer" style="gap:8px;">
      <div class="ld-card-meta">
        ${
          job.status === 'applied'
            ? '候选已应用，配置定义由服务端事务写入；真实记录仍需你手动填写。'
            : job.status === 'preview_ready'
              ? '候选仅保存在服务端，尚未写入任何配置。'
              : job.status === 'needs_fix'
                ? '候选与错误已保留；可重试生成或取消，不会部分应用。'
                : job.status === 'cancelled'
                  ? '候选已取消，不会写入配置。'
                  : job.status === 'failed'
                    ? '生成失败，不影响手动记录与五面板使用。'
                    : '任务状态由服务端记录。'
        }
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${canApply ? `<button type="button" class="ld-btn ld-btn-primary" data-action="ai-apply-job" data-job-id="${escapeHtml(job.id)}" ${busy ? 'disabled' : ''}>应用候选配置</button>` : ''}
        ${canRetry ? `<button type="button" class="ld-btn" data-action="ai-retry-job" data-job-id="${escapeHtml(job.id)}" ${busy ? 'disabled' : ''}>重新生成候选</button>` : ''}
        ${canCancel ? `<button type="button" class="ld-btn ld-btn-danger" data-action="ai-cancel-job" data-job-id="${escapeHtml(job.id)}" ${busy ? 'disabled' : ''}>取消候选</button>` : ''}
      </div>
    </div>
  </div>`;
}

export function renderAiResultModal(state: AppState, data: BootstrapData): string {
  const ai = state.ai;
  const result = ai.result;
  const backModuleId = state.activeModal?.kind === 'ai-result' ? state.activeModal.moduleId : null;

  let bodyHtml = '';
  if (ai.busy && !result) {
    bodyHtml = `<div class="ld-ai-busy"><span class="ld-ai-busy-dot"></span><span>服务端正在同步执行生成与五层校验…（接口超时上限 ${escapeHtml(String(state.ai.config?.timeout_ms ?? '—'))} ms；不会自动重试无限次）</span></div>`;
  } else if (!result) {
    bodyHtml = `<div class="ld-error-banner" role="alert"><span>尚未取得生成结果。${
      ai.resultError
        ? `(${escapeHtml(ai.resultError.code ?? 'ERROR')}) ${escapeHtml(ai.resultError.message)}`
        : ''
    }</span></div>`;
  }

  const errorHtml = ai.resultError
    ? `<div class="ld-error-banner" role="alert"><span><strong>${escapeHtml(ai.resultError.code ?? 'ERROR')}</strong>：${escapeHtml(ai.resultError.message)}</span></div>`
    : '';

  return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
    <div class="ld-modal">
      <div class="ld-modal-header">
        <div>
          <h2 class="ld-modal-title">✦ AI 生成结果</h2>
          <div class="ld-card-meta">状态与校验结果全部来自服务端；界面不虚构候选、解锁或完成事实。</div>
        </div>
        <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
      </div>
      <div class="ld-modal-body">
        ${bodyHtml}
        ${errorHtml}
        ${result ? renderAiJobDetailCard(state, result.job, data) : ''}
        ${result && result.job.candidate ? renderAiCandidateCard(result.job.candidate) : ''}
        ${result && result.batch ? renderAiBatchCard(result.batch, data, ai.busy) : ''}
        ${result && !result.batch && result.job.status === 'preview_ready' ? '<div class="ld-ai-honest-banner">当前是预览候选，尚未写入配置。点击「应用候选配置」后才会在同一事务内创建定义。</div>' : ''}
      </div>
      <div class="ld-modal-footer">
        <button type="button" class="ld-btn" data-action="ai-back-to-form" data-module-id="${escapeHtml(backModuleId ?? '')}">再生成一次</button>
        <button type="button" class="ld-btn ld-btn-primary" data-action="close-modal">关闭</button>
      </div>
    </div>
  </div>`;
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
  const p = state.panels.tasks;
  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const t of data.tasks) {
    countsByModule[t.module_id] = (countsByModule[t.module_id] ?? 0) + 1;
  }

  const today = getTodayIsoDate();
  const filtered = data.tasks.filter(t => {
    if (p.moduleId && t.module_id !== p.moduleId) return false;
    if (p.subTab === 'today') {
      return !t.definition.business_date || t.definition.business_date === today;
    }
    if (p.subTab === 'completed') return t.status === 'completed';
    if (p.subTab === 'partial') return t.status === 'partial';
    if (p.subTab === 'needs_review') return t.needs_review;
    return true;
  });

  const cardsHtml = filtered.length === 0
    ? renderEmptyState({
        icon: 'flag',
        title: p.moduleId ? '当前模块下暂无任务' : '暂无任务实例',
        description: '你可以手动创建手动完成、记录可选或必须关联记录的任务实例，体验「任务 → 记录 → 数值 → 成就」真实写库闭环。',
        primaryActionLabel: '＋ 新建任务',
        primaryActionData: 'data-action="open-create-task"',
        secondaryActionLabel: '✦ AI 生成配置',
        secondaryActionData: 'data-action="open-ai-modal"'
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
            const statusBadgeClass =
              t.status === 'completed'
                ? 'ld-badge-success'
                : t.status === 'partial'
                  ? 'ld-badge-warning'
                  : 'ld-badge-info';

            let primaryButtons = '';
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

            return `<article class="ld-card ${isSelected ? 'is-selected' : ''} ${t.needs_review ? 'is-needs-review' : ''}" data-task-card="${escapeHtml(t.id)}">
              <div class="ld-card-top">
                <div style="display:flex;flex-direction:column;gap:6px;">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    ${renderModuleBadge(mod, true)}
                    <span class="ld-badge">${escapeHtml(modeMeta.label)}</span>
                    <span class="ld-badge">${t.definition.business_date ? `计划日期: ${escapeHtml(t.definition.business_date)}` : '不限日期'}</span>
                  </div>
                  <h3 class="ld-card-title">${escapeHtml(t.definition.title)}</h3>
                </div>
                <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                  ${t.needs_review ? `<span class="ld-badge ld-badge-warning">⚠ 完成依据变化，待复核</span>` : ''}
                  <span class="ld-badge ${statusBadgeClass}">${escapeHtml(statusMeta.label)}</span>
                </div>
              </div>
              <div class="ld-card-meta">
                <span><strong>验收要求：</strong>${escapeHtml(describeTaskAcceptance(data, t))}</span>
              </div>
              ${partialReason ? `<div class="ld-badge ld-badge-warning" style="align-self:flex-start;padding:5px 10px;">${escapeHtml(partialReason)}</div>` : ''}
              <div class="ld-card-footer">
                <div class="ld-card-meta">
                  <span>已关联记录：<strong>${linkedRecords.length}</strong> 条</span>
                  ${t.completed_at ? `<span>· 完成于 ${escapeHtml(formatDateTime(t.completed_at))} (${t.completion_origin === 'manual' ? '手动确认' : '记录达标'})</span>` : ''}
                </div>
                <div style="display:flex;align-items:center;gap:8px;">
                  ${primaryButtons}
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
        <p class="ld-panel-subtitle">管理各模块待办事项，支持手动完成、记录可选与必须关联真实记录三种验收方式</p>
      </div>
      <div class="ld-panel-actions">
        <button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="tasks">✦ AI 生成</button>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-task">＋ 新建任务</button>
      </div>
    </header>
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="任务范围筛选">
        ${[
          { key: 'all', label: `全部 (${data.tasks.length})` },
          { key: 'today', label: '今日 / 不限期' },
          { key: 'partial', label: '部分完成' },
          { key: 'completed', label: '已完成' },
          { key: 'needs_review', label: `待复核 (${data.tasks.filter(x => x.needs_review).length})` }
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

  let bodyHtml = '';
  if (p.subTab === 'ai_review') {
    const confirmedCount = filtered.filter(r => r.status === 'confirmed').length;
    const draftCount = filtered.filter(r => r.status === 'draft').length;
    const aiInfo = describeAiProvider(state.ai.config, state);
    bodyHtml = `<div class="ld-card">
      <div class="ld-card-top">
        <div>
          <h3 class="ld-card-title">AI 复盘（日报 / 周报子视图）</h3>
          <p class="ld-panel-subtitle" style="margin-top:4px;">按《产品设计文档 v0.2》第 12.4 节，日报与周报位于记录面板子视图，不占用空白首页或新增第六面板。</p>
        </div>
        <span class="ld-badge ld-badge-warning">阶段状态：报告未实现（后续阶段）</span>
      </div>
      <div class="ld-card-meta" style="line-height:1.7;">
        <div>当前筛选范围内共有 <strong>${confirmedCount}</strong> 条已确认记录、<strong>${draftCount}</strong> 条草稿记录。</div>
        <div><strong>本子视图不会生成任何复盘内容：</strong>日报 / 周报能力（确定性统计 + 文本报告）尚未实现，界面不伪造报告、不虚构结论，也不把分析文字当成已授权的任务或配置。</div>
        <div>AI 生成配置已可在任务 / 数值 / 成就面板的「✦ AI 生成」或 <strong>设置 → AI 设置与自动填充</strong> 中使用；服务端 provider = <code>${escapeHtml(aiInfo.provider)}</code>，cloud_ai = <code>${String(aiInfo.cloud)}</code>。</div>
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
              ${r.status === 'confirmed' ? '已确认' : '草稿（不计入统计）'}
            </span>
          </div>
          <span class="ld-card-meta">${escapeHtml(formatDateTime(r.occurred_at))} (${escapeHtml(r.timezone)})</span>
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
        <button type="button" class="ld-tab-btn ${p.subTab === 'ai_review' ? 'is-active' : ''}" data-action="panel-subtab" data-subtab="ai_review">AI 复盘</button>
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
        primaryActionData: 'data-action="open-create-metric"'
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
              <div class="ld-card-footer">
                <button type="button" class="ld-btn ld-btn-sm" data-action="metric-view-sources" data-metric-id="${escapeHtml(m.id)}">
                  查看来源记录 (${m.computed.source_record_ids.length})
                </button>
                <div style="display:flex;gap:6px;">
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
        <p class="ld-panel-subtitle">基于已确认唯一记录与十进制精确运算，展示日 / 周 / 月 / 累计统计窗口</p>
      </div>
      <div class="ld-panel-actions">
        <button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="metrics">✦ AI 生成</button>
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
  const p = state.panels.achievements;
  const countsByModule: Record<string, number> = {};
  for (const m of data.modules) countsByModule[m.id] = 0;
  for (const a of data.achievement_definitions) {
    countsByModule[a.module_id] = (countsByModule[a.module_id] ?? 0) + 1;
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
        description: '成就不由 AI 直接标记完成，而是绑定某个数值定义与门槛，在真实记录达标时由规则引擎自动授予。',
        primaryActionLabel: '＋ 新建成就定义',
        primaryActionData: 'data-action="open-create-achievement"'
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

  return `<div class="ld-panel-container">
    ${renderReturnBanner(state)}
    ${state.error ? renderErrorBanner({ ...state.error, retryAction: 'refresh-bootstrap' }) : ''}
    <header class="ld-panel-header">
      <div class="ld-panel-title-group">
        <h1 class="ld-panel-title">成就面板</h1>
        <p class="ld-panel-subtitle">定义与授予分离，由真实记录驱动解锁；当唯一完成证据被修改或删除时自动标记「待复核」</p>
      </div>
      <div class="ld-panel-actions">
        <button type="button" class="ld-btn" data-action="open-ai-modal" data-ai-source-panel="achievements">✦ AI 生成</button>
        <button type="button" class="ld-btn ld-btn-primary" data-action="open-create-achievement">＋ 新建成就定义</button>
      </div>
    </header>
    ${renderModuleFilterBar(data.modules, p.moduleId, countsByModule, state.showInactiveModulesInFilter)}
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="成就状态筛选">
        ${[
          { key: 'all', label: `全部 (${data.achievement_definitions.length})` },
          { key: 'unlocked', label: `已解锁 (${data.achievement_awards.filter(x => x.state === 'unlocked').length})` },
          { key: 'unstarted', label: '未解锁 / 进行中' },
          { key: 'needs_review', label: `需复核 (${data.achievement_awards.filter(x => x.state === 'needs_review').length})` }
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

export function renderSettingsPanel(state: AppState, data: BootstrapData): string {
  const p = state.panels.settings;
  const subTab = p.subTab || 'modules';

  let sectionHtml = '';
  if (subTab === 'modules') {
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
    sectionHtml = `<div class="ld-card-list">
      <div class="ld-card">
        <h3 class="ld-card-title">显示、主题与反馈偏好</h3>
        <div class="ld-form-grid" style="margin-top:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
            <div>
              <strong>界面主题配色</strong>
              <div class="ld-card-meta">默认采用深色游戏面板风格，可随时切换浅色高对比主题</div>
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
    sectionHtml = `<div class="ld-card-list">
      <div class="ld-card">
        <div class="ld-card-top">
          <div>
            <h3 class="ld-card-title">本地开发会话与阶段能力矩阵</h3>
            <p class="ld-panel-subtitle">HttpOnly + SameSite=Strict Cookie 会话，所有写操作强制携带 UUID 幂等键与基准版本号</p>
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
            <div><code>${escapeHtml(state.capabilities?.contract_version ?? '0.1.0')}</code> / <code>${escapeHtml(state.capabilities?.stage ?? 'T0/T1-backend')}</code></div>
          </div>
        </div>
        <div class="ld-card-footer">
          <div class="ld-card-meta">
            <span>local_session: <strong>${String(state.capabilities?.local_session ?? true)}</strong></span> ·
            <span>sync: <strong>${String(state.capabilities?.sync ?? false)}</strong></span> ·
            <span>cloud_ai: <strong>${String(state.capabilities?.cloud_ai ?? false)}</strong></span> ·
            <span>recurring_tasks: <strong>${String(state.capabilities?.recurring_tasks ?? false)}</strong></span>
          </div>
          <button type="button" class="ld-btn ld-btn-sm" data-action="refresh-bootstrap">立即刷新一致性快照</button>
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
        <p class="ld-panel-subtitle">管理模块生命周期、记录模板、内容依赖关系、显示偏好与本地账户会话</p>
      </div>
    </header>
    <div class="ld-subfilter-bar">
      <div class="ld-tab-group" role="tablist" aria-label="设置分组">
        ${[
          { key: 'modules', label: '模块管理' },
          { key: 'dependencies', label: '内容配置与依赖' },
          { key: 'ai', label: 'AI 设置与自动填充' },
          { key: 'display', label: '显示与反馈' },
          { key: 'account', label: '账户与数据' }
        ]
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

export function renderActiveModal(state: AppState, data: BootstrapData): string {
  const modal = state.activeModal;
  if (!modal) return '';

  const enabledModules = data.modules.filter(m => m.status === 'enabled');
  const userTz = state.user?.timezone ?? 'Asia/Shanghai';

  if (modal.kind === 'create-task') {
    const selectedModId = modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const firstTpl = templates[0];
    const numericFields = (firstTpl?.fields ?? []).filter(f =>
      ['integer', 'decimal'].includes(f.type)
    );

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-task">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建任务实例</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
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
                <option value="record_required">必须关联记录 (record_required)</option>
                <option value="record_optional">记录可选 (record_optional)</option>
                <option value="manual">手动完成 (manual)</option>
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">任务标题 * <span class="ld-label-hint">1~100 字符，如「完成一次 Python 练习」</span></span>
            <input class="ld-input" type="text" name="title" maxlength="100" required placeholder="输入任务标题" />
          </label>
          <div id="ld-task-binding-group" class="ld-form-grid" style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">关联记录模板 *</span>
                <select class="ld-select" name="record_type_id" id="ld-task-template-select">
                  ${templates
                    .map(rt => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`)
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">验收规则类型 *</span>
                <select class="ld-select" name="acceptance_kind" id="ld-task-acceptance-kind">
                  <option value="exists">存在有效关联记录 (exists)</option>
                  <option value="field_gte" ${numericFields.length === 0 ? 'disabled' : ''}>指定数值字段达到门槛 (field_gte)</option>
                </select>
              </label>
            </div>
            <div id="ld-task-threshold-group" class="ld-form-row" style="display:none;">
              <label class="ld-field">
                <span class="ld-label">目标数值字段 *</span>
                <select class="ld-select" name="field_key" id="ld-task-field-select">
                  ${numericFields
                    .map(
                      f =>
                        `<option value="${escapeHtml(f.key)}">${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / ${escapeHtml(f.unit)}` : ''})</option>`
                    )
                    .join('')}
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">单条记录达标门槛 * <span class="ld-label-hint">十进制数字，如 10</span></span>
                <input class="ld-input" type="text" name="threshold" value="10" placeholder="例如 10" />
              </label>
            </div>
          </div>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">计划业务日期 <span class="ld-label-hint">可留空表示不限日期</span></span>
              <input class="ld-input" type="date" name="business_date" />
            </label>
            <label class="ld-field">
              <span class="ld-label">时区 (IANA) *</span>
              <input class="ld-input" type="text" name="timezone" value="${escapeHtml(userTz)}" required />
            </label>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary">创建任务</button>
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
            task.definition.completion_mode !== 'manual'
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
    const compatibleTasks = data.tasks.filter(
      t =>
        t.module_id === actualModId &&
        t.definition.record_type_id === actualTplId &&
        t.definition.completion_mode !== 'manual'
    );
    const selectedTaskIds = new Set(
      editingRecord ? editingRecord.task_ids : modal.defaultTaskIds
    );
    const fromTask = modal.fromTaskId ? data.tasks.find(t => t.id === modal.fromTaskId) : undefined;

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-record" data-mode="${modal.mode}" data-record-id="${escapeHtml(editingRecord?.id ?? '')}">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">${modal.mode === 'edit' ? '编辑真实记录' : '新建真实记录'}</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          ${
            fromTask
              ? `<div class="ld-return-banner">
                  <div>
                    <strong>来自任务：</strong>「${escapeHtml(fromTask.definition.title)}」
                    <div style="font-size:12px;color:var(--ld-text-secondary);">已自动携带模块、记录模板与任务实例关联；实际内容与时长请如实填写（不预填目标值）。</div>
                  </div>
                </div>`
              : ''
          }
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">所属模块 *</span>
              <select class="ld-select" name="module_id" id="ld-record-module-select" ${modal.mode === 'edit' ? 'disabled' : ''} required>
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
              <select class="ld-select" name="record_type_id" id="ld-record-template-select" ${modal.mode === 'edit' ? 'disabled' : ''} required>
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
              <input class="ld-input" type="text" name="occurred_at" value="${escapeHtml(editingRecord ? editingRecord.occurred_at : getLocalIsoWithOffset())}" required />
            </label>
            <label class="ld-field">
              <span class="ld-label">时区 (IANA) *</span>
              <input class="ld-input" type="text" name="timezone" value="${escapeHtml(editingRecord ? editingRecord.timezone : userTz)}" required />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">记录状态 *</span>
            <select class="ld-select" name="status" required>
              <option value="confirmed" ${(!editingRecord || editingRecord.status === 'confirmed') ? 'selected' : ''}>已确认 (confirmed) — 立即参与任务验收、数值聚合与成就解锁</option>
              <option value="draft" ${editingRecord?.status === 'draft' ? 'selected' : ''}>草稿 (draft) — 仅保存草稿，不计入事实统计</option>
            </select>
          </label>
          <div class="ld-form-grid" style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);">
            <div style="font-weight:600;font-size:13px;">模板字段（未知项可留空，不会伪装为 0）</div>
            ${(tpl?.fields ?? [])
              .map(f => {
                const existingVal = editingRecord ? editingRecord.values[f.key] : undefined;
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
                ? `<div class="ld-card-meta">当前模块与模板下暂无需要关联记录的任务实例。</div>`
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
          <button type="submit" class="ld-btn ld-btn-primary">${modal.mode === 'edit' ? '保存修改并重算' : '保存记录'}</button>
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
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            ${renderModuleBadge(mod)}
            <span class="ld-badge">${escapeHtml(tpl?.name ?? '模板')} (schema v${r.schema_version})</span>
            <span class="ld-badge ${r.status === 'confirmed' ? 'ld-badge-success' : 'ld-badge-warning'}">${r.status === 'confirmed' ? '已确认' : '草稿'}</span>
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
          <button type="button" class="ld-btn ld-btn-danger" data-action="delete-record" data-record-id="${escapeHtml(r.id)}">软删除记录</button>
          <button type="button" class="ld-btn ld-btn-primary" data-action="open-edit-record" data-record-id="${escapeHtml(r.id)}">编辑记录</button>
          <button type="button" class="ld-btn" data-action="close-modal">关闭</button>
        </div>
      </div>
    </div>`;
  }

  if (modal.kind === 'create-metric') {
    const selectedModId = modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const templates = data.record_types.filter(rt => rt.module_id === selectedModId);
    const firstTpl = templates[0];
    const numericFields = (firstTpl?.fields ?? []).filter(f =>
      ['integer', 'decimal'].includes(f.type)
    );

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-metric">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建数值定义</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
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
                  .map(rt => `<option value="${escapeHtml(rt.id)}">${escapeHtml(rt.name)}</option>`)
                  .join('')}
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">数值名称 * <span class="ld-label-hint">如「本周学习时长」或「累计学习次数」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="80" required placeholder="输入数值指标名称" />
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">聚合方式 *</span>
              <select class="ld-select" name="aggregation" id="ld-metric-agg-select" required>
                <option value="count">计数 (count) — 统计唯一已确认记录条数</option>
                <option value="sum" ${numericFields.length === 0 ? 'disabled' : ''}>求和 (sum) — 需选择数值字段</option>
                <option value="avg" ${numericFields.length === 0 ? 'disabled' : ''}>均值 (avg) — 需选择数值字段</option>
                <option value="latest" ${numericFields.length === 0 ? 'disabled' : ''}>最新值 (latest) — 需选择数值字段</option>
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">时间窗口 *</span>
              <select class="ld-select" name="window" required>
                <option value="week">本周 (week，周一起)</option>
                <option value="day">今日 (day，自然日)</option>
                <option value="month">本月 (month，自然月)</option>
                <option value="all_time">累计 (all_time)</option>
              </select>
            </label>
          </div>
          <div class="ld-form-row">
            <label class="ld-field" id="ld-metric-field-group" style="display:none;">
              <span class="ld-label">聚合数值字段 *</span>
              <select class="ld-select" name="field_key" id="ld-metric-field-select">
                ${numericFields
                  .map(
                    f =>
                      `<option value="${escapeHtml(f.key)}" data-unit="${escapeHtml(f.unit ?? '')}">${escapeHtml(f.label)} (${escapeHtml(f.key)}${f.unit ? ` / 单位:${escapeHtml(f.unit)}` : ''})</option>`
                  )
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">单位 * <span class="ld-label-hint">sum/avg/latest 必须与字段单位一致</span></span>
              <input class="ld-input" type="text" name="unit" id="ld-metric-unit-input" value="次" maxlength="30" required />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">统计时区 (IANA) *</span>
            <input class="ld-input" type="text" name="timezone" value="${escapeHtml(userTz)}" required />
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary">创建数值定义</button>
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
    const selectedModId = modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    const modMetrics = data.metrics.filter(m => m.module_id === selectedModId);

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-achievement">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建成就定义</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
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
              <span class="ld-label">关联数值定义 *</span>
              <select class="ld-select" name="metric_id" id="ld-ach-metric-select" required>
                ${
                  modMetrics.length === 0
                    ? `<option value="">当前模块暂无数值定义，请先创建数值</option>`
                    : modMetrics
                        .map(
                          m =>
                            `<option value="${escapeHtml(m.id)}">${escapeHtml(m.definition.name)} (${escapeHtml(m.definition.unit)})</option>`
                        )
                        .join('')
                }
              </select>
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">成就名称 * <span class="ld-label-hint">如「迈出第一步」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="80" required placeholder="输入成就名称" />
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">比较运算符 *</span>
              <select class="ld-select" name="operator" required>
                <option value="gte">大于等于 (≥ gte)</option>
                <option value="lte">小于等于 (≤ lte)</option>
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">目标门槛 (十进制字符串) *</span>
              <input class="ld-input" type="text" name="threshold" value="1" required placeholder="例如 1" />
            </label>
          </div>
          <label class="ld-field">
            <span class="ld-label">历史记录范围策略 (history_policy) *</span>
            <select class="ld-select" name="history_policy" required>
              <option value="include_existing">允许基于已确认、未删除的历史记录计算进度 (include_existing)</option>
              <option value="from_activation">仅统计本成就创建之后发生的记录 (from_activation)</option>
            </select>
          </label>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary" ${modMetrics.length === 0 ? 'disabled' : ''}>创建成就定义</button>
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
    const iconOptions = Object.entries(MODULE_ICON_LABELS) as Array<[ModuleIconName, string]>;
    const colorOptions = Object.values(MODULE_COLORS);

    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-module">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建自定义模块</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
          <label class="ld-field">
            <span class="ld-label">模块名称 * <span class="ld-label-hint">如「语言学习」</span></span>
            <input class="ld-input" type="text" name="name" maxlength="60" required placeholder="输入新模块名称" />
          </label>
          <label class="ld-field">
            <span class="ld-label">模块说明</span>
            <textarea class="ld-textarea" name="description" maxlength="1000" placeholder="描述该模块关注的日常记录、任务与成果"></textarea>
          </label>
          <div class="ld-form-row">
            <label class="ld-field">
              <span class="ld-label">图标 *</span>
              <select class="ld-select" name="icon" required>
                ${iconOptions
                  .map(([k, label]) => `<option value="${k}">${escapeHtml(label)} (${k})</option>`)
                  .join('')}
              </select>
            </label>
            <label class="ld-field">
              <span class="ld-label">主题色 *</span>
              <select class="ld-select" name="color" required>
                ${colorOptions
                  .map(c => `<option value="${c.key}">${escapeHtml(c.label)} (${c.key})</option>`)
                  .join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary">创建模块</button>
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
          <button type="submit" class="ld-btn ld-btn-primary">保存模块修改</button>
        </div>
      </form>
    </div>`;
  }

  if (modal.kind === 'create-template') {
    const selectedModId = modal.defaultModuleId ?? enabledModules[0]?.id ?? '';
    return `<div class="ld-modal-backdrop" data-action="close-modal-backdrop">
      <form class="ld-modal" id="ld-form-create-template">
        <div class="ld-modal-header">
          <h2 class="ld-modal-title">新建通用记录模板</h2>
          <button type="button" class="ld-btn ld-btn-sm" data-action="close-modal">✕</button>
        </div>
        <div class="ld-modal-body">
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
              <input class="ld-input" type="text" name="name" maxlength="60" required placeholder="输入记录模板名称" />
            </label>
          </div>
          <div style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);" class="ld-form-grid">
            <div style="font-weight:600;">字段 1（主内容字段，必填）</div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">字段 key * <span class="ld-label-hint">小写字母开头，如 topic</span></span>
                <input class="ld-input" type="text" name="f1_key" value="topic" required pattern="^[a-z][a-z0-9_]{0,63}$" />
              </label>
              <label class="ld-field">
                <span class="ld-label">显示名称 (label) *</span>
                <input class="ld-input" type="text" name="f1_label" value="实际内容" required />
              </label>
              <label class="ld-field">
                <span class="ld-label">类型 *</span>
                <select class="ld-select" name="f1_type">
                  <option value="text">短文本 (text)</option>
                  <option value="textarea">长文本 (textarea)</option>
                </select>
              </label>
            </div>
          </div>
          <div style="padding:12px;border-radius:var(--ld-radius-md);background:var(--ld-bg-elevated);border:1px solid var(--ld-border);" class="ld-form-grid">
            <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
              <input type="checkbox" name="include_f2" checked />
              <span>同时添加字段 2（可选数值字段，供任务门槛与数值聚合引用）</span>
            </label>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">字段 key</span>
                <input class="ld-input" type="text" name="f2_key" value="duration_minutes" pattern="^[a-z][a-z0-9_]{0,63}$" />
              </label>
              <label class="ld-field">
                <span class="ld-label">显示名称 (label)</span>
                <input class="ld-input" type="text" name="f2_label" value="实际分钟数" />
              </label>
            </div>
            <div class="ld-form-row">
              <label class="ld-field">
                <span class="ld-label">数值类型</span>
                <select class="ld-select" name="f2_type">
                  <option value="integer">整数 (integer)</option>
                  <option value="decimal">精确小数 (decimal)</option>
                </select>
              </label>
              <label class="ld-field">
                <span class="ld-label">单位 (unit)</span>
                <input class="ld-input" type="text" name="f2_unit" value="分钟" />
              </label>
            </div>
          </div>
        </div>
        <div class="ld-modal-footer">
          <button type="button" class="ld-btn" data-action="close-modal">取消</button>
          <button type="submit" class="ld-btn ld-btn-primary">创建记录模板</button>
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
