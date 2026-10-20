import type {
  AchievementSeriesView,
  AchievementSummaryData,
  AiConfigData,
  AiGenerationEnvelope,
  AiJobRow,
  BootstrapData,
  CapabilitiesData,
  ConfigFormRuntimeState,
  HomeData,
  HomePreferencesData,
  MetricTrendData,
  PanelFilterState,
  PanelKey,
  PanelRoute,
  ProfileData,
  ProfileFormRuntimeState,
  RecordFormRuntimeState,
  ReturnContext,
  SubmissionStateKind,
  TaskCategory,
  TaskRow,
  TaskTemplateRow,
  TrendGrain,
  TrendRange,
  UserProfile,
  WalletData,
  WalletLedgerEntry
} from './types.js';

export interface ToastItem {
  id: string;
  title: string;
  message: string;
  kind: 'info' | 'success' | 'unlock' | 'warning';
}

export interface AiState {
  config: AiConfigData | null;
  configLoading: boolean;
  configError: { code?: string; message: string } | null;
  jobs: AiJobRow[];
  jobsLoading: boolean;
  jobsError: { code?: string; message: string } | null;
  busy: boolean;
  result: AiGenerationEnvelope | null;
  resultError: { code?: string; message: string; details?: unknown } | null;
  lastRevoke: string | null;
}

export interface ModalConflictBannerState {
  code: string;
  message: string;
  serverVersion?: number;
  serverSummary?: string;
}

/** S1 minimal export UI state (download only; restore stays CLI-only). */
export interface ExportUiState {
  status: 'idle' | 'exporting' | 'success' | 'error';
  message: string | null;
  fileName: string | null;
}

export interface TrendControlState {
  range: TrendRange;
  grain: TrendGrain;
  precision: number;
  excludeDates: string[];
  varianceEnabled: boolean;
  varianceThreshold: number;
  minimumDays: number;
  includeAll: boolean;
  selectedPointKey: string | null;
}

export interface ObservationFormRuntimeState {
  fieldId: string;
  mode: 'new' | 'correct';
  occurredAt: string;
  timezone: string;
  rawValue: string;
  isNull: boolean;
  sourceRecordId: string;
  sourceBaseVersion: number | null;
  contextValues: Record<string, string>;
  submissionStatus: SubmissionStateKind;
  operationId: string | null;
  entityId: string;
  conflictError: { code: string; message: string; current?: unknown } | null;
  validationError: { code: string; message: string } | null;
  lastImpactSummary: string | null;
}

export interface TaskFilterState {
  category: 'all' | TaskCategory;
  status: string;
  color: string;
  pinnedOnly: boolean;
}

export interface AppState {
  authStatus: 'checking' | 'unauthenticated' | 'authenticated';
  user: UserProfile | null;
  capabilities: CapabilitiesData | null;
  bootstrap: BootstrapData | null;
  home: HomeData | null;
  profile: ProfileData | null;
  homePreferences: HomePreferencesData | null;
  // v0.2 Phase 2 domain state slices
  taskTemplates: TaskTemplateRow[];
  taskInstances: TaskRow[];
  taskFilter: TaskFilterState;
  achievementSeries: AchievementSeriesView[];
  achievementSummary: AchievementSummaryData | null;
  wallet: WalletData | null;
  walletLedger: WalletLedgerEntry[];
  walletLedgerTotal: number;
  walletLedgerTaskFilter: string | null;
  metricTrendErrors?:Record<string,string>;
  phase2LoadError?:string|null;
  walletLedgerOffset?:number;
  metricTrends: Record<string, MetricTrendData>;
  metricTrendControls: Record<string, TrendControlState>;
  observationForm: ObservationFormRuntimeState | null;
  loading: boolean;
  submittingModal: boolean;
  error: { code?: string; message: string; requestId?: string } | null;
  modalError: ModalConflictBannerState | null;
  loginError: string | null;
  route: PanelRoute;
  theme: 'dark' | 'light';
  reducedMotion: boolean;
  unlockToastEnabled: boolean;
  showInactiveModulesInFilter: boolean;
  panels: Record<PanelKey, PanelFilterState>;
  returnContext: ReturnContext | null;
  recordForm: RecordFormRuntimeState;
  configForm: ConfigFormRuntimeState;
  profileForm: ProfileFormRuntimeState;
  exportUi: ExportUiState;
  ai: AiState;
  activeModal:
    | null
    | { kind: 'create-task'; defaultModuleId: string | null }
    | { kind: 'create-task-template'; defaultModuleId: string | null; defaultCategory?: TaskCategory }
    | { kind: 'edit-task-template'; templateId: string }
    | { kind: 'revoke-task'; taskId: string; mode: 'revoke' | 'cancel' }
    | { kind: 'task-detail'; taskId: string }
    | {
        kind: 'record-form';
        mode: 'create' | 'edit';
        recordId?: string;
        defaultModuleId: string;
        defaultRecordTypeId: string;
        defaultTaskIds: string[];
        fromTaskId?: string;
      }
    | { kind: 'record-detail'; recordId: string }
    | { kind: 'create-metric'; defaultModuleId: string | null }
    | { kind: 'metric-detail'; metricId: string }
    | { kind: 'create-achievement'; defaultModuleId: string | null }
    | { kind: 'create-achievement-series'; defaultModuleId: string | null }
    | { kind: 'series-detail'; seriesId: string }
    | { kind: 'achievement-detail'; achievementId: string }
    | { kind: 'write-observation'; fieldId: string; mode?: 'new' | 'correct' }
    | { kind: 'wallet-ledger'; taskId?: string | null }
    | { kind: 'create-module' }
    | { kind: 'edit-module'; moduleId: string }
    | { kind: 'create-template'; defaultModuleId: string | null }
    | { kind: 'ai-generate'; moduleId: string | null }
    | { kind: 'ai-result'; moduleId: string | null };
  toasts: ToastItem[];
}

export function createInitialRecordFormState(): RecordFormRuntimeState {
  return {
    draftKey: '',
    submissionStatus: 'idle',
    operationId: null,
    recordId: null,
    restoredFromStorage: false,
    lastSavedLocalAt: null,
    conflictError: null,
    conflictServerRecord: null,
    validationError: null
  };
}

export function createInitialConfigFormState(): ConfigFormRuntimeState {
  return {
    draftKey: '',
    kind: null,
    submissionStatus: 'idle',
    operationId: null,
    entityId: null,
    restoredFromStorage: false,
    lastSavedLocalAt: null,
    conflictError: null,
    validationError: null
  };
}

export function createInitialProfileFormState(profile?: ProfileData | null): ProfileFormRuntimeState {
  return {
    baseVersion: profile?.version ?? 1,
    nickname: profile?.nickname ?? '本地用户',
    bio: profile?.bio ?? '',
    bioIsNull: profile ? profile.bio === null : true,
    timezone: profile?.timezone ?? 'Asia/Shanghai',
    fields: profile
      ? profile.module_fields.map(f => ({
          ...f,
          options: [...(f.options ?? [])],
          binding: f.binding ? { ...f.binding } : undefined,
          source_ref: f.source_ref ? { ...f.source_ref } : undefined
        }))
      : [],
    removeIds: [],
    dirty: false,
    submissionStatus: 'idle',
    operationId: null,
    lastSavedMessage: null,
    conflictError: null,
    conflictServerProfile: null,
    validationError: null,
    pendingLeaveTarget: null
  };
}

export function syncProfileFormFromServer(
  state: AppState,
  profile: ProfileData,
  forceOverwriteDirty = false
): void {
  if (state.profileForm.dirty && !forceOverwriteDirty) {
    return;
  }
  state.profileForm = createInitialProfileFormState(profile);
}

export function createInitialTrendControlState(precision = 0): TrendControlState {
  return {
    range: 'last_7_days',
    grain: '1d',
    precision,
    excludeDates: [],
    varianceEnabled: false,
    varianceThreshold: 0.5,
    minimumDays: 5,
    includeAll: false,
    selectedPointKey: null
  };
}

export function createInitialState(): AppState {
  return {
    authStatus: 'checking',
    user: null,
    capabilities: null,
    bootstrap: null,
    home: null,
    profile: null,
    homePreferences: null,
    taskTemplates: [],
    taskInstances: [],
    taskFilter: {
      category: 'all',
      status: 'all',
      color: 'all',
      pinnedOnly: false
    },
    achievementSeries: [],
    achievementSummary: null,
    wallet: null,
    walletLedger: [],
    walletLedgerTotal: 0,
    walletLedgerTaskFilter: null,
    metricTrends: {},
    metricTrendControls: {},
    observationForm: null,
    loading: false,
    submittingModal: false,
    error: null,
    modalError: null,
    loginError: null,
    route: '/',
    theme: 'dark',
    reducedMotion: false,
    unlockToastEnabled: true,
    showInactiveModulesInFilter: false,
    panels: {
      tasks: {
        moduleId: null,
        subTab: 'all',
        selectedId: null,
        scrollY: 0
      },
      metrics: {
        moduleId: null,
        subTab: 'all',
        selectedId: null,
        scrollY: 0
      },
      achievements: {
        moduleId: null,
        subTab: 'all',
        selectedId: null,
        scrollY: 0
      },
      records: {
        moduleId: null,
        subTab: 'list',
        selectedId: null,
        scrollY: 0,
        recordTemplateId: null,
        recordStatus: 'all',
        recordTaskId: null,
        sourceRecordIds: null,
        sourceLabel: null
      },
      settings: {
        moduleId: null,
        subTab: 'modules',
        selectedId: null,
        scrollY: 0
      }
    },
    returnContext: null,
    recordForm: createInitialRecordFormState(),
    configForm: createInitialConfigFormState(),
    profileForm: createInitialProfileFormState(),
    exportUi: {
      status: 'idle',
      message: null,
      fileName: null
    },
    ai: {
      config: null,
      configLoading: false,
      configError: null,
      jobs: [],
      jobsLoading: false,
      jobsError: null,
      busy: false,
      result: null,
      resultError: null,
      lastRevoke: null
    },
    activeModal: null,
    toasts: []
  };
}

export function routeToPanelKey(route: PanelRoute): PanelKey | null {
  switch (route) {
    case '/tasks':
      return 'tasks';
    case '/metrics':
      return 'metrics';
    case '/achievements':
      return 'achievements';
    case '/records':
      return 'records';
    case '/settings':
      return 'settings';
    default:
      return null;
  }
}

export function parseRouteFromLocation(pathname: string): PanelRoute {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (
    clean === '/' ||
    clean === '/tasks' ||
    clean === '/metrics' ||
    clean === '/achievements' ||
    clean === '/records' ||
    clean === '/settings'
  ) {
    return clean;
  }
  return '/';
}
