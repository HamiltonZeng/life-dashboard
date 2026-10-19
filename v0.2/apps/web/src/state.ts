import type {
  AiConfigData,
  AiGenerationEnvelope,
  AiJobRow,
  BootstrapData,
  CapabilitiesData,
  PanelFilterState,
  PanelKey,
  PanelRoute,
  RecordFormRuntimeState,
  ReturnContext,
  UserProfile
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

export interface AppState {
  authStatus: 'checking' | 'unauthenticated' | 'authenticated';
  user: UserProfile | null;
  capabilities: CapabilitiesData | null;
  bootstrap: BootstrapData | null;
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
  exportUi: ExportUiState;
  ai: AiState;
  activeModal:
    | null
    | { kind: 'create-task'; defaultModuleId: string | null }
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
    | { kind: 'achievement-detail'; achievementId: string }
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

export function createInitialState(): AppState {
  return {
    authStatus: 'checking',
    user: null,
    capabilities: null,
    bootstrap: null,
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
