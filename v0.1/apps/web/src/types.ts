import type {
  AchievementInput,
  Field,
  MetricInput,
  RecordInput,
  TaskInput
} from '../../../packages/contracts/src/index.js';
import type { ModuleColorName, ModuleIconName } from '../../../packages/ui/src/index.js';

export type PanelRoute = '/' | '/tasks' | '/metrics' | '/achievements' | '/records' | '/settings';

export interface UserProfile {
  id: string;
  name: string;
  timezone: string;
}

export interface CapabilitiesData {
  contract_version: string;
  stage: string;
  sync: boolean;
  cloud_ai: boolean;
  recurring_tasks: boolean;
  professional_ledger: boolean;
  local_session: boolean;
  aggregations: Array<'count' | 'sum' | 'avg' | 'latest'>;
  windows: Array<'day' | 'week' | 'month' | 'all_time'>;
  // Optional T2/T3 additions; older servers omit them.
  ai_generation?: boolean;
  ai_provider?: string;
  ai_schema_version?: string;
}

export interface ModuleRow {
  id: string;
  user_id: string;
  name: string;
  description: string;
  icon: ModuleIconName;
  color: ModuleColorName;
  sort_order: number;
  status: 'enabled' | 'disabled' | 'archived';
  source: 'builtin' | 'manual' | string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RecordTypeRow {
  id: string;
  user_id: string;
  module_id: string;
  name: string;
  fields: Field[];
  schema_version: number;
  created_at: string;
}

export interface TaskRow {
  id: string;
  user_id: string;
  module_id: string;
  template_id: string;
  rule_version: number;
  definition: TaskInput;
  status: 'pending' | 'in_progress' | 'partial' | 'completed' | 'skipped' | 'cancelled';
  needs_review: boolean;
  completed_at: string | null;
  completion_origin: 'manual' | 'evidence' | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RecordRow {
  id: string;
  user_id: string;
  module_id: string;
  record_type_id: string;
  schema_version: number;
  occurred_at: string;
  timezone: string;
  status: 'draft' | 'confirmed';
  values: Record<string, string | number | boolean | null>;
  task_ids: string[];
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ComputedMetricResult {
  value: string | null;
  sample_count: number;
  source_record_ids: string[];
  start: string | null;
  end: string | null;
  period: string;
  evaluated_at: string;
  calculation_version: number;
}

export interface MetricRow {
  id: string;
  user_id: string;
  module_id: string;
  record_type_id: string;
  definition: MetricInput;
  version: number;
  created_at: string;
  computed: ComputedMetricResult;
}

export interface AchievementDefinitionRow {
  id: string;
  user_id: string;
  module_id: string;
  metric_id: string;
  definition: AchievementInput;
  version: number;
  created_at: string;
}

export interface AchievementAwardRow {
  id: string;
  user_id: string;
  achievement_id: string;
  rule_version: number;
  period_key: string;
  state: 'unlocked' | 'needs_review';
  unlocked_at: string;
  evaluated_at: string;
  evidence: ComputedMetricResult;
  original_evidence: ComputedMetricResult;
  version: number;
}

export interface BootstrapData {
  modules: ModuleRow[];
  record_types: RecordTypeRow[];
  tasks: TaskRow[];
  records: RecordRow[];
  metric_definitions: MetricRow[];
  metrics: MetricRow[];
  achievement_definitions: AchievementDefinitionRow[];
  achievement_awards: AchievementAwardRow[];
  cursor: string | number;
}

export interface ApiErrorShape {
  code: string;
  message: string;
  details?: unknown;
  request_id?: string;
}

export type PanelKey = 'tasks' | 'metrics' | 'achievements' | 'records' | 'settings';

export interface PanelFilterState {
  moduleId: string | null;
  subTab: string;
  selectedId: string | null;
  scrollY: number;
  recordTemplateId?: string | null;
  recordStatus?: 'all' | 'confirmed' | 'draft';
  recordTaskId?: string | null;
  sourceRecordIds?: string[] | null;
  sourceLabel?: string | null;
}

export interface ReturnContext {
  fromRoute: PanelRoute;
  fromPanelKey: PanelKey;
  savedFilter: PanelFilterState;
  label: string;
}

// ---------------------------------------------------------------------------
// T2/T3 AI generation (module blueprint 1.0). Shapes mirror the server views in
// packages/ai/src/service.ts and the frozen contract in packages/contracts.
// ---------------------------------------------------------------------------

export type AiMode = 'create' | 'extend';
export type AiApplyMode = 'apply' | 'preview';
export type AiContentType = 'record_types' | 'metrics' | 'tasks' | 'achievements';
export type AiJobStatus =
  | 'queued'
  | 'generating'
  | 'validating'
  | 'preview_ready'
  | 'applied'
  | 'needs_fix'
  | 'failed'
  | 'cancelled';

export interface AiConfigData {
  provider: string;
  cloud_ai: boolean;
  configured: boolean;
  model: string;
  schema_version: string;
  max_attempts: number;
  timeout_ms: number;
  daily_job_limit: number;
  max_output_tokens?: number;
  supported_content_types: AiContentType[];
  supported_tasks?: { schedules?: string[]; completion_modes?: string[] };
  supported_achievements?: { repeat_policy?: string[]; history_policy?: string[] };
  notes?: string[];
}

export interface AiValidationIssue {
  layer?: 'parse' | 'structure' | 'semantic' | 'permission' | 'business' | string;
  code?: string;
  path?: string;
  message?: string;
}

export interface AiValidationView {
  valid: boolean;
  errors: AiValidationIssue[];
  warnings: Array<string | AiValidationIssue>;
}

export interface AiBlueprintModule {
  mode: AiMode;
  target_module_id: string | null;
  local_ref: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
}

export interface AiBlueprintField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  unit?: string | null;
}

export interface AiBlueprintRecordType {
  local_ref: string;
  name: string;
  description?: string;
  renderer_kind?: string;
  fields?: AiBlueprintField[];
}

export interface AiBlueprintMetric {
  local_ref: string;
  name: string;
  description?: string;
  unit?: string;
  source?: {
    record_type_ref?: string;
    aggregation?: string;
    field_key?: string | null;
    window?: string;
  };
  proposed_target?: { operator?: string; value?: number | string } | null;
}

export interface AiBlueprintTask {
  local_ref: string;
  title: string;
  description?: string;
  priority?: string;
  estimated_minutes?: number | null;
  schedule?: { kind?: string; timezone?: string; weekdays?: number[]; local_time?: string | null };
  completion_mode?: string;
  record_binding?: {
    record_type_ref?: string;
    acceptance?: { kind?: string; field_key?: string | null; threshold?: number | string | null };
  } | null;
}

export interface AiBlueprintAchievement {
  local_ref: string;
  name: string;
  description?: string;
  icon?: string;
  condition?: { kind?: string; metric_ref?: string; operator?: string; threshold?: number | string };
  repeat_policy?: string;
  history_policy?: string;
}

export interface AiBlueprint {
  schema_version: string;
  kind: string;
  module?: AiBlueprintModule;
  record_types?: AiBlueprintRecordType[];
  metrics?: AiBlueprintMetric[];
  tasks?: AiBlueprintTask[];
  achievements?: AiBlueprintAchievement[];
  warnings?: string[];
}

/** Server counts: candidate views use plural keys, applied batches use singular kinds. */
export interface AiGenerationSummary {
  module?: number;
  record_types?: number;
  metrics?: number;
  tasks?: number;
  achievements?: number;
  record_type?: number;
  metric?: number;
  task?: number;
  achievement?: number;
}

export interface AiJobUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: number | undefined;
}

export interface AiJobRow {
  id: string;
  status: AiJobStatus;
  mode: AiMode;
  module_id: string | null;
  target_base_version: number | null;
  apply_mode: AiApplyMode;
  provider: string;
  model: string;
  attempts: number;
  usage: AiJobUsage;
  error: { code: string; message: string } | null;
  warnings: string[];
  validation: AiValidationView;
  candidate: AiBlueprint | null;
  summary: AiGenerationSummary;
  batch_id: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

export interface AiBatchObject {
  kind: string;
  local_ref: string;
  id: string;
}

export interface AiBatchRow {
  id: string;
  job_id: string;
  module_id: string;
  module_created: boolean;
  status: 'applied' | 'revoked';
  base_module_version: number | null;
  id_map: Record<string, { kind: string; id: string }>;
  objects: AiBatchObject[];
  summary: AiGenerationSummary;
  applied_at: string;
  revoked_at: string | null;
  revoke_mode: 'deleted' | 'archived' | null;
}

export interface AiGenerationEnvelope {
  job: AiJobRow;
  batch: AiBatchRow | null;
  already_applied: boolean;
}

export interface AiRevokeAction {
  mode: 'deleted' | 'archived';
  deleted_objects: Array<{ kind?: string; id?: string; action?: string }>;
  retained_objects: Array<{ kind?: string; id?: string; action?: string }>;
  reason: string;
}

export interface AiRevokeResult {
  batch: AiBatchRow;
  revoke: AiRevokeAction;
}

export interface AiGenerationRequest {
  mode: AiMode;
  module_id: string | null;
  prompt: string;
  content_types: AiContentType[];
  apply_mode: AiApplyMode;
  timezone: string;
  reference: { record_type_ids: string[]; metric_ids: string[] };
}

export type {
  AchievementInput,
  Field,
  MetricInput,
  RecordInput,
  TaskInput
};
