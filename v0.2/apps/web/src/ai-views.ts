import {
  AI_APPLY_MODE_META,
  AI_BLUEPRINT_SUPPORT_MATRIX,
  AI_CONTENT_TYPE_META,
  AI_JOB_STATUS_META,
  AI_MODE_META,
  escapeHtml,
  MODULE_COLORS,
  MODULE_ICON_LABELS,
  renderModuleBadge,
  type ModuleIconName
} from '../../../packages/ui/src/index.js';
import type { AppState } from './state.js';
import type {
  AiBatchRow,
  AiBlueprint,
  AiConfigData,
  AiGenerationSummary,
  AiJobRow,
  AiValidationIssue,
  BootstrapData,
  ModuleRow
} from './types.js';

function formatAiTime(iso: string | null | undefined): string {
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

function findModule(data: BootstrapData, id: string): ModuleRow | undefined {
  return data.modules.find(m => m.id === id);
}

function aiBadgeClass(tone: string): string {
  if (tone === 'success') return 'ld-badge-success';
  if (tone === 'warning') return 'ld-badge-warning';
  if (tone === 'danger') return 'ld-badge-danger';
  if (tone === 'info') return 'ld-badge-info';
  return '';
}

export function renderAiStatusBadge(status: string): string {
  const meta = AI_JOB_STATUS_META[status] ?? { label: status, tone: 'neutral', description: '' };
  return `<span class="ld-badge ${aiBadgeClass(meta.tone)}" title="${escapeHtml(meta.description)}">${escapeHtml(meta.label)}</span>`;
}

function aiKv(label: string, value: string): string {
  return `<div class="ld-ai-kv"><span class="ld-ai-kv-label">${escapeHtml(label)}</span><span class="ld-ai-kv-value">${escapeHtml(value)}</span></div>`;
}

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

export function renderAiSummaryChips(summary?: AiGenerationSummary): string {
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

export function renderAiSupportMatrixCard(): string {
  return `<div class="ld-card" data-support-matrix="blueprint-1.0">
    <div class="ld-card-top">
      <div>
        <h3 class="ld-card-title">模块蓝图 1.0 与正式定义字段支持矩阵</h3>
        <p class="ld-panel-subtitle">明确区分「写入正式数据库定义的字段」与「仅保留在候选蓝图供预览参考的字段」，避免误以为建议目标或排期说明已自动生效。</p>
      </div>
      <span class="ld-badge ld-badge-info">Schema 1.0 映射边界</span>
    </div>
    <div style="overflow-x:auto;">
      <table class="ld-table">
        <thead>
          <tr>
            <th>配置类别</th>
            <th>写入正式定义的字段</th>
            <th>仅候选预览保留（不写正式表）</th>
            <th>阶段与业务边界</th>
          </tr>
        </thead>
        <tbody>
          ${AI_BLUEPRINT_SUPPORT_MATRIX.map(
            row => `<tr>
              <td><strong>${escapeHtml(row.category)}</strong></td>
              <td>${escapeHtml(row.persistedFields)}</td>
              <td style="color:var(--ld-text-secondary);">${escapeHtml(row.candidateOnlyFields)}</td>
              <td>${escapeHtml(row.boundaryNote)}</td>
            </tr>`
          ).join('')}
        </tbody>
      </table>
    </div>
  </div>`;
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
            ${aiKv('单次超时 timeout_ms', `${config.timeout_ms} ms`)}
            ${aiKv('任务总时限 task_timeout_ms', `${config.task_timeout_ms ?? 12500} ms`)}
            ${aiKv('滚动 24h 任务上限', `${config.daily_job_limit} (${config.quota_unit ?? 'generation_jobs'})`)}
            ${aiKv('货币预算强制', String(config.monetary_budget_enforced ?? false))}
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
              <td style="white-space:nowrap;">${escapeHtml(formatAiTime(job.created_at))}</td>
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
    ${renderAiSupportMatrixCard()}
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
  // S0-A R4 alignment: only active (non-archived) metrics in bootstrap are eligible
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
              '允许引用的已有活动数值定义',
              moduleMetrics.map(m => ({ value: m.id, text: `${m.definition.name} (${m.definition.unit})` })),
              'reference.metric_ids（可选，多选，已归档数值不可引用）'
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
          <textarea class="ld-input" name="prompt" rows="4" maxlength="4000" required placeholder="例如：在学习与发展里，给我设计一套每次十分钟起步的编程练习任务，配一个记录模板、学习时长统计和一个成就。不要创建通知。"></textarea>
        </label>

        <div class="ld-card-meta" style="line-height:1.7;">
          <div>时区：<code>${escapeHtml(userTz)}</code>（来自当前用户资料，随请求提交 <code>timezone</code>）</div>
          <div>字段映射说明：任务说明/优先级/预计时长、模板说明及数值建议目标仅保留在候选蓝图预览中（并提示 warnings），不自动写入正式规则表。</div>
        </div>
      </div>
      <div class="ld-modal-footer">
        <button type="button" class="ld-btn" data-action="close-modal">取消</button>
        <button type="submit" class="ld-btn ld-btn-primary" ${state.ai.busy ? 'disabled' : ''}>提交生成</button>
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
            `<li><strong>${escapeHtml(rt.name)}</strong> <code>${escapeHtml(rt.local_ref)}</code> · ${(rt.fields ?? []).length} 个字段${(rt.fields ?? []).map(f => escapeHtml(f.label)).join('、') ? `：${(rt.fields ?? []).map(f => escapeHtml(f.label)).join('、')}` : ''}${rt.description ? ' <span class="ld-badge">含候选说明（仅预览）</span>' : ''}</li>`
        )
        .join('')}</ul>`
    : '';
  const metricHtml = metrics.length
    ? `<ul class="ld-ai-list">${metrics
        .map(
          m =>
            `<li><strong>${escapeHtml(m.name)}</strong> · ${escapeHtml(m.source?.aggregation ?? '')} / ${escapeHtml(m.source?.window ?? '')}${m.source?.field_key ? ` · 字段 ${escapeHtml(m.source.field_key)}` : ' · 唯一记录计数'} · 单位 ${escapeHtml(m.unit ?? '—')}${m.proposed_target ? ` · 建议目标 ${escapeHtml(m.proposed_target.operator ?? '')} ${escapeHtml(String(m.proposed_target.value ?? ''))}（仅候选保留，未写入正式定义）` : ''}</li>`
        )
        .join('')}</ul>`
    : '';
  const taskHtml = tasks.length
    ? `<ul class="ld-ai-list">${tasks
        .map(
          t =>
            `<li><strong>${escapeHtml(t.title)}</strong> · ${escapeHtml(t.completion_mode ?? '')} · 排期 ${escapeHtml(t.schedule?.kind ?? '—')}${t.record_binding?.acceptance ? ` · 验收 ${escapeHtml(t.record_binding.acceptance.kind ?? '')}${t.record_binding.acceptance.kind === 'field_gte' ? ` (${escapeHtml(t.record_binding.acceptance.field_key ?? '')} ≥ ${escapeHtml(String(t.record_binding.acceptance.threshold ?? ''))})` : ''}` : ''}${t.estimated_minutes ? ` · 预计 ${escapeHtml(String(t.estimated_minutes))} 分钟（仅候选说明）` : ''}</li>`
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
        <h3 class="ld-card-title">候选蓝图（候选预览字段与正式写入边界已标注）</h3>
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
        <p class="ld-panel-subtitle">批次 ${escapeHtml(batch.id.slice(0, 8))}… · job ${escapeHtml(batch.job_id.slice(0, 8))}… · 应用时间 ${escapeHtml(formatAiTime(batch.applied_at))}${batch.revoked_at ? ` · 撤销时间 ${escapeHtml(formatAiTime(batch.revoked_at))}` : ''}</p>
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
      <span>尝试 ${job.attempts} 次 · 已报告 tokens ${escapeHtml(String(job.usage?.total_tokens ?? 0))}</span>
      <span>创建 ${escapeHtml(formatAiTime(job.created_at))}${job.finished_at ? ` · 结束 ${escapeHtml(formatAiTime(job.finished_at))}` : ''}</span>
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
    bodyHtml = `<div class="ld-ai-busy"><span class="ld-ai-busy-dot"></span><span>服务端正在同步执行生成与五层校验…（单次时限 ${escapeHtml(String(state.ai.config?.timeout_ms ?? '—'))} ms / 任务总时限 ${escapeHtml(String(state.ai.config?.task_timeout_ms ?? 12500))} ms）</span></div>`;
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
