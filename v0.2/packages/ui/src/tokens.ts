export type ModuleIconName =
  | 'book'
  | 'dumbbell'
  | 'wallet'
  | 'sparkles'
  | 'trophy'
  | 'flag'
  | 'leaf'
  | 'music'
  | 'chat'
  | 'star';

export type ModuleColorName =
  | 'blue'
  | 'green'
  | 'amber'
  | 'violet'
  | 'rose'
  | 'cyan'
  | 'slate';

export interface ColorToken {
  key: ModuleColorName;
  label: string;
  accent: string;
  bgSoft: string;
  border: string;
  text: string;
}

export const MODULE_COLORS: Record<ModuleColorName, ColorToken> = {
  blue: {
    key: 'blue',
    label: '学习蓝',
    accent: '#3b82f6',
    bgSoft: 'rgba(59, 130, 246, 0.14)',
    border: 'rgba(59, 130, 246, 0.38)',
    text: '#60a5fa'
  },
  green: {
    key: 'green',
    label: '活力绿',
    accent: '#10b981',
    bgSoft: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.38)',
    text: '#34d399'
  },
  amber: {
    key: 'amber',
    label: '财富琥珀',
    accent: '#f59e0b',
    bgSoft: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.38)',
    text: '#fbbf24'
  },
  violet: {
    key: 'violet',
    label: '灵感紫',
    accent: '#8b5cf6',
    bgSoft: 'rgba(139, 92, 246, 0.14)',
    border: 'rgba(139, 92, 246, 0.38)',
    text: '#a78bfa'
  },
  rose: {
    key: 'rose',
    label: '珊瑚红',
    accent: '#f43f5e',
    bgSoft: 'rgba(244, 63, 94, 0.14)',
    border: 'rgba(244, 63, 94, 0.38)',
    text: '#fb7185'
  },
  cyan: {
    key: 'cyan',
    label: '晴空青',
    accent: '#06b6d4',
    bgSoft: 'rgba(6, 182, 212, 0.14)',
    border: 'rgba(6, 182, 212, 0.38)',
    text: '#22d3ee'
  },
  slate: {
    key: 'slate',
    label: '沉稳灰',
    accent: '#64748b',
    bgSoft: 'rgba(100, 116, 139, 0.16)',
    border: 'rgba(100, 116, 139, 0.4)',
    text: '#94a3b8'
  }
};

export const MODULE_ICON_LABELS: Record<ModuleIconName, string> = {
  book: '书籍 / 学习',
  dumbbell: '哑铃 / 锻炼',
  wallet: '账夹 / 财富',
  sparkles: '星芒 / 娱乐',
  trophy: '奖杯 / 挑战',
  flag: '旗帜 / 目标',
  leaf: '绿叶 / 习惯',
  music: '音符 / 艺术',
  chat: '对话 / 交际',
  star: '星标 / 收藏'
};

export const TASK_STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待开始', tone: 'neutral' },
  in_progress: { label: '进行中', tone: 'info' },
  partial: { label: '部分完成', tone: 'warning' },
  completed: { label: '已完成', tone: 'success' },
  ended: { label: '已结束（未完成）', tone: 'warning' },
  skipped: { label: '已跳过', tone: 'muted' },
  cancelled: { label: '已取消', tone: 'muted' }
};

export const COMPLETION_MODE_META: Record<string, { label: string; badge: string; actionLabel: string }> = {
  manual: {
    label: '手动完成',
    badge: '自主确认',
    actionLabel: '标记完成'
  },
  record_optional: {
    label: '记录可选',
    badge: '可完成或关联记录',
    actionLabel: '完成并记录'
  },
  record_required: {
    label: '必须关联记录',
    badge: '需有效记录达标',
    actionLabel: '去记录'
  }
};

export const METRIC_AGGREGATION_META: Record<string, { label: string; description: string }> = {
  count: { label: '计数 (count)', description: '统计符合条件的唯一已确认记录条数' },
  sum: { label: '求和 (sum)', description: '对指定数值字段精确求和' },
  avg: { label: '均值 (avg)', description: '对非空有效样本求精确算术平均' },
  latest: { label: '最新值 (latest)', description: '取最新一条有效记录的字段数值' }
};

export const METRIC_WINDOW_META: Record<string, { label: string; shortLabel: string }> = {
  day: { label: '当日窗口 (自然日)', shortLabel: '今日' },
  week: { label: '本周窗口 (周一起)', shortLabel: '本周' },
  month: { label: '本月窗口 (自然月)', shortLabel: '本月' },
  all_time: { label: '累计窗口 (全部历史)', shortLabel: '累计' }
};

export const FIELD_TYPE_META: Record<string, { label: string; isNumeric: boolean }> = {
  text: { label: '短文本 (text)', isNumeric: false },
  textarea: { label: '长文本 (textarea)', isNumeric: false },
  integer: { label: '整数 (integer)', isNumeric: true },
  decimal: { label: '精确小数 (decimal)', isNumeric: true },
  date: { label: '日期 (date)', isNumeric: false },
  boolean: { label: '布尔开关 (boolean)', isNumeric: false },
  single_select: { label: '单选枚举 (single_select)', isNumeric: false }
};

export const MODULE_STATUS_META: Record<string, { label: string; tone: string }> = {
  enabled: { label: '启用中', tone: 'success' },
  disabled: { label: '已停用', tone: 'warning' },
  archived: { label: '已归档', tone: 'muted' }
};

// ---------------------------------------------------------------------------
// S1 Record & Form Reliability Status Tokens
// Explicitly distinguishes local draft, waiting for server, unknown network
// result (retry with same operation_id), server confirmed, and 409 conflict.
// ---------------------------------------------------------------------------

export type SubmissionStateKind =
  | 'idle'
  | 'saved_local'
  | 'submitting'
  | 'unknown_network'
  | 'confirmed_server'
  | 'conflict_pending'
  | 'validation_error';

export const SUBMISSION_STATE_META: Record<
  SubmissionStateKind,
  { label: string; tone: string; description: string }
> = {
  idle: {
    label: '准备输入',
    tone: 'neutral',
    description: '尚未修改表单内容'
  },
  saved_local: {
    label: '已保存本机草稿',
    tone: 'info',
    description: '输入已保存在当前浏览器本机草稿，刷新页面可恢复，尚未提交至服务器'
  },
  submitting: {
    label: '等待服务器确认',
    tone: 'info',
    description: '正在向服务器提交并锁定重复点击，请等待事务回执'
  },
  unknown_network: {
    label: '网络结果未知（待重试）',
    tone: 'warning',
    description: '网络中断或超时，未收到服务器回执；直接点击重试将沿用同一 operation_id 与完整载荷，避免重复记账'
  },
  confirmed_server: {
    label: '服务器已确认',
    tone: 'success',
    description: '服务器事务已确认写入并完成派生统计重算'
  },
  conflict_pending: {
    label: '冲突待处理 (409)',
    tone: 'danger',
    description: '服务器版本或状态已变化；已保留你当前未保存的本地输入，请核对差异后处理'
  },
  validation_error: {
    label: '校验未通过',
    tone: 'danger',
    description: '请求未通过字段或规则校验，已保留当前输入供修正'
  }
};

// ---------------------------------------------------------------------------
// AI generation (module blueprint 1.0) presentation tokens & support matrix.
// ---------------------------------------------------------------------------

export const AI_JOB_STATUS_META: Record<string, { label: string; tone: string; description: string }> = {
  queued: { label: '排队中', tone: 'neutral', description: '已提交，等待服务端处理' },
  generating: { label: '生成中', tone: 'info', description: '正在请求模型生成候选蓝图' },
  validating: { label: '校验中', tone: 'info', description: '模型输出已返回，服务端正在执行五层校验' },
  preview_ready: { label: '待预览', tone: 'info', description: '候选已通过校验，尚未写入任何配置' },
  applied: { label: '已添加', tone: 'success', description: '候选已在一个事务中应用为配置定义' },
  needs_fix: { label: '需要修正', tone: 'warning', description: '候选未通过校验，候选与错误已保留' },
  failed: { label: '失败', tone: 'danger', description: '供应商调用或生成失败，可查看错误并重试' },
  cancelled: { label: '已取消', tone: 'muted', description: '未应用的候选已取消，不会写入配置' }
};

export const AI_CONTENT_TYPE_META: Record<
  string,
  { label: string; shortLabel: string; description: string }
> = {
  record_types: {
    label: '记录模板 (record_types)',
    shortLabel: '记录模板',
    description: '新增通用记录模板与字段定义，供任务与数值引用'
  },
  metrics: {
    label: '数值定义 (metrics)',
    shortLabel: '数值',
    description: '新增 count / sum / avg / latest 数值与时间窗口'
  },
  tasks: {
    label: '任务 (tasks)',
    shortLabel: '任务',
    description: '新增任务实例（当前支持 unscheduled 免排期与 once 单日任务）'
  },
  achievements: {
    label: '成就定义 (achievements)',
    shortLabel: '成就',
    description: '新增基于数值门槛的成就规则（支持 once 与 per_period）'
  }
};

export const AI_MODE_META: Record<string, { label: string; description: string }> = {
  create: { label: '新建模块 + 配套配置', description: '由蓝图创建新模块；目标模块 ID 必须为空' },
  extend: { label: '扩展现有模块', description: '向所选启用模块追加配置；不修改模块名称/图标/颜色' }
};

export const AI_APPLY_MODE_META: Record<string, { label: string; description: string }> = {
  apply: { label: '生成并添加', description: '校验通过后立即在同一事务中写入配置定义' },
  preview: { label: '仅预览候选', description: '只生成候选并保存校验结果，确认后再手动应用' }
};

export interface BlueprintSupportMatrixRow {
  category: string;
  persistedFields: string;
  candidateOnlyFields: string;
  boundaryNote: string;
}

export const AI_BLUEPRINT_SUPPORT_MATRIX: BlueprintSupportMatrixRow[] = [
  {
    category: '模块 (module)',
    persistedFields: 'create 模式写入 name、description、icon、color',
    candidateOnlyFields: 'extend 模式下的模块 name / icon / color 仅作目标核对',
    boundaryNote: '扩展现有模块不会覆盖原模块名称、图标或主题色'
  },
  {
    category: '记录模板 (record_types)',
    persistedFields: 'name、fields (key/label/type/required/unit/options/minimum/maximum)',
    candidateOnlyFields: '模板级 description（仅在候选预览展示，记入 warnings）',
    boundaryNote: '仅支持 generic 通用渲染器；不生成真实记录'
  },
  {
    category: '数值定义 (metrics)',
    persistedFields: 'name、unit、aggregation (count/sum/avg/latest)、field_key、window、timezone',
    candidateOnlyFields: 'description、proposed_target（建议目标仅展示，不写入正式数值定义）',
    boundaryNote: '建议目标未采用前不参与正式目标进度；无真实记录时显示「暂无数据」'
  },
  {
    category: '任务 (tasks)',
    persistedFields: 'title、completion_mode、record_type_id、acceptance、business_date (once)、timezone',
    candidateOnlyFields: 'description、priority、estimated_minutes（仅保留在候选蓝图，记入 warnings）',
    boundaryNote: '支持 unscheduled 与 once；daily/weekly 周期调度将在后续阶段开放，当前明确拒绝'
  },
  {
    category: '成就 (achievements)',
    persistedFields: 'name、metric_id、operator (gte/lte)、threshold、repeat_policy (once/per_period)、history_policy',
    candidateOnlyFields: 'description、icon（仅在候选预览展示）',
    boundaryNote: 'AI 不能直接输出 unlocked=true，必须由真实已确认记录触发解锁'
  }
];

// ---------------------------------------------------------------------------
// v0.2 Phase 1: 3D Avatar Renderer Port & Static Fallback (H04)
// No 3D engine, no model/asset network requests, no arbitrary script execution.
// ---------------------------------------------------------------------------

export const AVATAR_ACTION_IDS = ['idle', 'greeting', 'celebrate', 'focus'] as const;
export type AvatarActionId = (typeof AVATAR_ACTION_IDS)[number];

export const AVATAR_ACTION_META: Record<AvatarActionId, { label: string; badge: string }> = {
  idle: { label: '静息待机 (idle)', badge: '静态占位' },
  greeting: { label: '问候状态 (greeting)', badge: '静态回退' },
  celebrate: { label: '达成庆祝 (celebrate)', badge: '静态回退' },
  focus: { label: '专注状态 (focus)', badge: '静态回退' }
};

export interface AvatarInputState {
  character_id: string;
  model_asset_ref: string | null;
  action_id?: AvatarActionId | string;
  animation_state?: AvatarActionId | string;
  appearance_config?: Record<string, unknown> | null;
  reduced_motion?: boolean;
  version?: number;
}

export interface AvatarEnvironmentConfig {
  width?: number;
  height?: number;
  reduced_motion?: boolean;
  performance_tier?: 'low' | 'medium' | 'high';
}

export interface AvatarEventMap {
  ready: {
    mode: 'static_fallback';
    character_id: string;
    action_id: AvatarActionId;
    reduced_motion: boolean;
    asset_loaded: false;
    network_requests: 0;
  };
  error: {
    code: 'UNSUPPORTED_ACTION' | 'ASSET_DOWNLOAD_DISABLED';
    message: string;
    fallback_action: AvatarActionId;
  };
  interaction: {
    character_id: string;
    action_id: AvatarActionId;
    target: string;
  };
}

export interface AvatarMountContainer {
  innerHTML?: string;
  setAttribute?: (name: string, value: string) => void;
}

export interface AvatarRendererPort {
  mount(
    container: AvatarMountContainer | null,
    state: AvatarInputState,
    env?: AvatarEnvironmentConfig
  ): void;
  update(state: Partial<AvatarInputState>, env?: Partial<AvatarEnvironmentConfig>): void;
  pause(): void;
  dispose(): void;
  on<K extends keyof AvatarEventMap>(
    event: K,
    listener: (payload: AvatarEventMap[K]) => void
  ): () => void;
  triggerInteraction(target?: string): void;
  getState(): {
    mounted: boolean;
    paused: boolean;
    disposed: boolean;
    character_id: string;
    model_asset_ref: null;
    action_id: AvatarActionId;
    reduced_motion: boolean;
    version: number;
    network_requests: 0;
  };
}

function isAllowedAvatarAction(action: unknown): action is AvatarActionId {
  return typeof action === 'string' && (AVATAR_ACTION_IDS as readonly string[]).includes(action);
}

export class StaticAvatarRenderer implements AvatarRendererPort {
  private container: AvatarMountContainer | null = null;
  private mounted = false;
  private paused = false;
  private disposed = false;
  private characterId = 'default-avatar';
  private actionId: AvatarActionId = 'idle';
  private reducedMotion = false;
  private version = 1;
  private listeners: {
    [K in keyof AvatarEventMap]: Set<(payload: AvatarEventMap[K]) => void>;
  } = {
    ready: new Set(),
    error: new Set(),
    interaction: new Set()
  };

  on<K extends keyof AvatarEventMap>(
    event: K,
    listener: (payload: AvatarEventMap[K]) => void
  ): () => void {
    this.listeners[event].add(listener);
    return () => {
      this.listeners[event].delete(listener);
    };
  }

  private emit<K extends keyof AvatarEventMap>(event: K, payload: AvatarEventMap[K]): void {
    for (const fn of this.listeners[event]) {
      try {
        fn(payload);
      } catch {
        // Listener errors must never crash UI rendering
      }
    }
  }

  private applyState(state: Partial<AvatarInputState>, env?: Partial<AvatarEnvironmentConfig>): void {
    if (typeof state.character_id === 'string' && state.character_id.trim()) {
      this.characterId = state.character_id.trim();
    }
    if (typeof state.version === 'number' && Number.isInteger(state.version) && state.version > 0) {
      this.version = state.version;
    }
    const rm = env?.reduced_motion ?? state.reduced_motion;
    if (typeof rm === 'boolean') {
      this.reducedMotion = rm;
    }

    // Never download external model assets in v0.2 Phase 1
    if (state.model_asset_ref !== undefined && state.model_asset_ref !== null) {
      this.emit('error', {
        code: 'ASSET_DOWNLOAD_DISABLED',
        message: 'v0.2 第一阶段不加载或下载 3D 模型资源，已回退静态占位',
        fallback_action: 'idle'
      });
    }

    const rawAction = state.action_id ?? state.animation_state;
    if (rawAction !== undefined) {
      if (isAllowedAvatarAction(rawAction)) {
        this.actionId = this.reducedMotion ? 'idle' : rawAction;
      } else {
        this.actionId = 'idle';
        this.emit('error', {
          code: 'UNSUPPORTED_ACTION',
          message: `不支持的动作标识 ${String(rawAction)}，已回退至 idle`,
          fallback_action: 'idle'
        });
      }
    } else if (this.reducedMotion) {
      this.actionId = 'idle';
    }
  }

  private syncContainerAttributes(): void {
    if (!this.container?.setAttribute) return;
    this.container.setAttribute('data-avatar-renderer', 'static');
    this.container.setAttribute('data-avatar-mounted', String(this.mounted && !this.disposed));
    this.container.setAttribute('data-avatar-paused', String(this.paused));
    this.container.setAttribute('data-character-id', this.characterId);
    this.container.setAttribute('data-action-id', this.actionId);
    this.container.setAttribute('data-reduced-motion', String(this.reducedMotion));
    this.container.setAttribute('data-model-asset-ref', 'null');
  }

  mount(
    container: AvatarMountContainer | null,
    state: AvatarInputState,
    env?: AvatarEnvironmentConfig
  ): void {
    this.container = container;
    this.mounted = true;
    this.paused = false;
    this.disposed = false;
    this.applyState(state, env);
    this.syncContainerAttributes();
    this.emit('ready', {
      mode: 'static_fallback',
      character_id: this.characterId,
      action_id: this.actionId,
      reduced_motion: this.reducedMotion,
      asset_loaded: false,
      network_requests: 0
    });
  }

  update(state: Partial<AvatarInputState>, env?: Partial<AvatarEnvironmentConfig>): void {
    if (this.disposed) return;
    this.applyState(state, env);
    this.syncContainerAttributes();
  }

  pause(): void {
    if (!this.mounted || this.disposed) return;
    this.paused = true;
    this.actionId = 'idle';
    this.syncContainerAttributes();
  }

  dispose(): void {
    this.mounted = false;
    this.paused = true;
    this.disposed = true;
    this.syncContainerAttributes();
    this.container = null;
  }

  triggerInteraction(target = 'avatar-slot'): void {
    if (!this.mounted || this.paused || this.disposed) return;
    this.emit('interaction', {
      character_id: this.characterId,
      action_id: this.actionId,
      target
    });
  }

  getState() {
    return {
      mounted: this.mounted,
      paused: this.paused,
      disposed: this.disposed,
      character_id: this.characterId,
      model_asset_ref: null as null,
      action_id: this.actionId,
      reduced_motion: this.reducedMotion,
      version: this.version,
      network_requests: 0 as const
    };
  }
}

export function createStaticAvatarRenderer(): AvatarRendererPort {
  return new StaticAvatarRenderer();
}

// ---------------------------------------------------------------------------
// v0.2 Phase 2: Periodic Tasks, Trends, Milestones, Wallet & AI Action-Proposal
// ---------------------------------------------------------------------------

export const TASK_CATEGORY_META: Record<
  'main' | 'daily' | 'weekly' | 'monthly',
  { label: string; shortLabel: string; rewardAmount: number; quotaLimit: number; quotaWindow: string; description: string }
> = {
  main: {
    label: '主线任务 (main)',
    shortLabel: '主线任务',
    rewardAmount: 100,
    quotaLimit: 1,
    quotaWindow: '每月最多 1 次',
    description: '长期目标或里程碑主线，单个实例持续追踪，不支持静默重写已生成快照'
  },
  daily: {
    label: '每日委托 (daily)',
    shortLabel: '每日委托',
    rewardAmount: 10,
    quotaLimit: 3,
    quotaWindow: '每日最多 3 次',
    description: '按模板锁定时区自然日生成当期实例，支持跨日补录与 7 天补录奖励窗口'
  },
  weekly: {
    label: '周常委托 (weekly)',
    shortLabel: '周常委托',
    rewardAmount: 50,
    quotaLimit: 3,
    quotaWindow: '每周最多 3 次',
    description: '周一 00:00 起算的当周实例，支持次数、不同自然日天数或数值累计验收'
  },
  monthly: {
    label: '月常委托 (monthly)',
    shortLabel: '月常委托',
    rewardAmount: 200,
    quotaLimit: 2,
    quotaWindow: '每月最多 2 次',
    description: '自然月 1 日 00:00 起算的当月实例，规则变更自下一周期生效'
  }
};

export const TASK_RULE_KIND_META: Record<
  'linked_exists' | 'linked_field_gte' | 'count' | 'distinct_days' | 'sum',
  { label: string; description: string }
> = {
  linked_exists: {
    label: '关联记录存在 (linked_exists)',
    description: '周期内至少有 1 条显式勾选关联本任务实例的已确认记录'
  },
  linked_field_gte: {
    label: '关联记录单条达标 (linked_field_gte)',
    description: '周期内显式关联本任务实例的记录中，指定数值字段达到门槛'
  },
  count: {
    label: '周期记录次数累计 (count)',
    description: '周期半开区间内符合模板与筛选条件的已确认记录总条数达到门槛'
  },
  distinct_days: {
    label: '周期不同自然日天数 (distinct_days)',
    description: '周期半开区间内按锁定时区去重后的有效记录自然日天数达到门槛'
  },
  sum: {
    label: '周期数值字段求和 (sum)',
    description: '周期半开区间内符合条件的记录指定数值字段精确累加达到门槛'
  }
};

export const REWARD_ELIGIBILITY_META: Record<
  'pending' | 'eligible' | 'quota_full' | 'expired' | 'legacy',
  { label: string; tone: string; description: string }
> = {
  pending: {
    label: '待完成结算',
    tone: 'neutral',
    description: '任务尚未有效完成，首次有效完成时按服务端系统策略与额度结算'
  },
  eligible: {
    label: '有效奖励资格',
    tone: 'success',
    description: '已锁定当期奖励名额并发放代币；若撤回或证据失效将冲正，恢复达标沿用原资格'
  },
  quota_full: {
    label: '本期额度已满（不发币）',
    tone: 'warning',
    description: '任务正常记为完成，但所属类别当期奖励名额已满，不再发放系统代币'
  },
  expired: {
    label: '超补录窗口（不发币）',
    tone: 'warning',
    description: '已超过周期结束后 7 天补录奖励窗口，事实与完成正常统计，不补发系统代币'
  },
  legacy: {
    label: '历史单次任务（不补发）',
    tone: 'muted',
    description: 'v0.1/第一阶段单次任务保持原完成语义，不迁移补发第二阶段系统代币'
  }
};

export const TREND_RANGE_META: Record<
  'last_7_days' | 'month' | 'quarter' | 'year',
  {
    label: string;
    shortLabel: string;
    grains: readonly ('1d' | '2d' | '3d' | '4d' | '5d' | '6d' | '7d' | '14d' | '21d' | '1mo')[];
    defaultGrain: '1d' | '7d' | '14d';
  }
> = {
  last_7_days: {
    label: '近七天 (last_7_days)',
    shortLabel: '近七天',
    grains: ['1d'],
    defaultGrain: '1d'
  },
  month: {
    label: '本月 (month)',
    shortLabel: '本月',
    grains: ['1d', '2d', '3d'],
    defaultGrain: '1d'
  },
  quarter: {
    label: '本季度 (quarter)',
    shortLabel: '本季度',
    grains: ['3d', '4d', '5d', '6d', '7d'],
    defaultGrain: '7d'
  },
  year: {
    label: '本年 (year)',
    shortLabel: '本年',
    grains: ['7d', '14d', '21d', '1mo'],
    defaultGrain: '14d'
  }
};

export const TREND_FALLBACK_META: Record<
  'insufficient_samples' | 'zero_variance' | 'too_few_remaining',
  { label: string; description: string }
> = {
  insufficient_samples: {
    label: '有效样本不足（已回退）',
    description: '当前时间范围内有效记录天数少于最小样本数要求，未剔除任何点位'
  },
  zero_variance: {
    label: '零方差等值序列（不剔除）',
    description: '当前范围内所有有效日数值完全相同（方差为 0），保留全部有效点位'
  },
  too_few_remaining: {
    label: '筛选后剩余点不足 2 个（已回退全部点）',
    description: '应用排除后剩余有效点少于 2 个无法构成趋势对比，已自动回退显示全部有效点'
  }
};

export const AI_ACTION_PROPOSAL_META: Record<
  'home' | 'tasks' | 'metrics' | 'achievements' | 'records' | 'profile',
  {
    intent: string;
    title: string;
    allowedActions: string[];
    contextScopeNote: string;
  }
> = {
  home: {
    intent: 'home.assist',
    title: '首页统一上下文助手 (action-proposal/1.0)',
    allowedActions: ['record.create', 'task_template.create', 'metric.explain', 'ask_clarification'],
    contextScopeNote: '仅按显式授权的当前固定数值、当期任务与个人摘要 ID 构造上下文白名单'
  },
  tasks: {
    intent: 'tasks.propose',
    title: '任务委托候选与规则建议 (action-proposal/1.0)',
    allowedActions: ['task_template.create', 'task_template.change', 'ask_clarification'],
    contextScopeNote: '仅引用当前筛选模块、记录模板与任务模板 ID；禁止输出奖励金额或直接标记完成'
  },
  metrics: {
    intent: 'metrics.analyze',
    title: '数值趋势解释与指标候选 (action-proposal/1.0)',
    allowedActions: ['metric.explain', 'metric.propose', 'ask_clarification'],
    contextScopeNote: '仅引用当前选中数值定义与来源记录 ID；禁止篡改真实日值或统计口径'
  },
  achievements: {
    intent: 'achievements.propose',
    title: '成就系列与里程碑候选 (action-proposal/1.0)',
    allowedActions: ['achievement_series.propose', 'ask_clarification'],
    contextScopeNote: '仅引用当前模块与记录模板 ID；禁止直接输出 unlocked=true 或伪造授予'
  },
  records: {
    intent: 'records.propose',
    title: '自然语言结构化记录候选 (action-proposal/1.0)',
    allowedActions: ['record.create', 'ask_clarification'],
    contextScopeNote: '仅生成待用户确认的 record.create 候选，绝不静默直接写入事实表'
  },
  profile: {
    intent: 'profile.propose',
    title: '个人资料字段整理候选 (action-proposal/1.0)',
    allowedActions: ['profile.propose', 'ask_clarification'],
    contextScopeNote: '仅限显式授权的资料字段 ID；自然语言内容仅作纯数据，绝不作为指令或权限配置执行'
  }
};
