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
// AI generation (module blueprint 1.0) presentation tokens.
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
    description: '新增任务实例（首版仅 unscheduled 免排期任务可应用）'
  },
  achievements: {
    label: '成就定义 (achievements)',
    shortLabel: '成就',
    description: '新增基于数值门槛的一次性成就规则'
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

