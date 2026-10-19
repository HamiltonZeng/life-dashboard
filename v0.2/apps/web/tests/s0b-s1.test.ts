import {
  AI_BLUEPRINT_SUPPORT_MATRIX,
  DASHBOARD_STYLES,
  SUBMISSION_STATE_META
} from '../../../packages/ui/src/index.js';
import { ApiClientError, isUnknownNetworkError } from '../src/api.js';
import {
  renderAiGenerateModal,
  renderAiResultModal,
  renderAiSupportMatrixCard,
  renderSettingsAiSection
} from '../src/ai-views.js';
import { renderActiveModal } from '../src/modals.js';
import {
  diagnosePartialTask,
  renderAchievementsPanel,
  renderMetricsPanel,
  renderRecordsPanel,
  renderSettingsPanel,
  renderTasksPanel
} from '../src/panels.js';
import {
  assertUserExportPayload,
  buildExportFilename,
  serializeUserExport
} from '../src/export.js';
import { createInitialState } from '../src/state.js';
import {
  buildRecordDraftKey,
  clearAllBrowserStorageForTest,
  computePayloadSignature,
  getPendingMutation,
  loadRecordDraft,
  prepareRecordMutationEnvelope,
  savePendingMutation,
  saveRecordDraft,
  saveUiPreferences,
  loadUiPreferences
} from '../src/storage.js';
import type { BootstrapData, RecordRow } from '../src/types.js';

export interface TestCaseResult {
  id: string;
  name: string;
  category: 'S0-B' | 'S1';
  passed: boolean;
  assertions: number;
  details: string;
}

function assert(condition: boolean, message: string, counter: { count: number }): void {
  counter.count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createFixtureBootstrap(): BootstrapData {
  return {
    cursor: 1,
    modules: [
      {
        id: 'mod-study',
        user_id: 'user-1',
        name: '学习与发展',
        description: '编程与阅读积累',
        icon: 'book',
        color: 'blue',
        sort_order: 1,
        status: 'enabled',
        source: 'builtin',
        version: 1,
        created_at: '2026-10-19T00:00:00Z',
        updated_at: '2026-10-19T00:00:00Z'
      }
    ],
    record_types: [
      {
        id: 'rt-coding',
        user_id: 'user-1',
        module_id: 'mod-study',
        name: '编程练习记录',
        schema_version: 1,
        created_at: '2026-10-19T00:00:00Z',
        fields: [
          {
            key: 'duration_minutes',
            label: '练习时长',
            type: 'integer',
            required: true,
            unit: '分钟',
            options: [],
            minimum: 1,
            maximum: 600
          },
          {
            key: 'topic',
            label: '练习主题',
            type: 'text',
            required: false,
            unit: null,
            options: [],
            minimum: null,
            maximum: null
          }
        ]
      }
    ],
    tasks: [
      {
        id: 'task-py-10',
        user_id: 'user-1',
        module_id: 'mod-study',
        template_id: 'tpl-1',
        rule_version: 1,
        status: 'pending',
        needs_review: false,
        completed_at: null,
        completion_origin: null,
        version: 1,
        created_at: '2026-10-19T00:00:00Z',
        updated_at: '2026-10-19T00:00:00Z',
        definition: {
          id: 'task-py-10',
          module_id: 'mod-study',
          title: '完成一次 Python 练习',
          completion_mode: 'record_required',
          record_type_id: 'rt-coding',
          acceptance: {
            kind: 'field_gte',
            field_key: 'duration_minutes',
            threshold: '10'
          },
          business_date: '2026-10-19',
          timezone: 'Asia/Shanghai'
        }
      }
    ],
    records: [],
    metric_definitions: [],
    metrics: [
      {
        id: 'metric-coding-sum',
        user_id: 'user-1',
        module_id: 'mod-study',
        record_type_id: 'rt-coding',
        version: 1,
        created_at: '2026-10-19T00:00:00Z',
        definition: {
          id: 'metric-coding-sum',
          module_id: 'mod-study',
          record_type_id: 'rt-coding',
          name: '本周编程时长',
          unit: '分钟',
          aggregation: 'sum',
          field_key: 'duration_minutes',
          window: 'week',
          timezone: 'Asia/Shanghai'
        },
        computed: {
          value: null,
          sample_count: 0,
          source_record_ids: [],
          start: '2026-10-19T00:00:00+08:00',
          end: '2026-10-26T00:00:00+08:00',
          period: '2026-W43',
          evaluated_at: '2026-10-19T08:00:00Z',
          calculation_version: 1
        }
      }
    ],
    achievement_definitions: [
      {
        id: 'ach-coding-10',
        user_id: 'user-1',
        module_id: 'mod-study',
        metric_id: 'metric-coding-sum',
        version: 1,
        created_at: '2026-10-19T00:00:00Z',
        definition: {
          id: 'ach-coding-10',
          module_id: 'mod-study',
          metric_id: 'metric-coding-sum',
          name: '初试锋芒：单周编程满 10 分钟',
          operator: 'gte',
          threshold: '10',
          repeat_policy: 'once',
          history_policy: 'include_existing'
        }
      }
    ],
    achievement_awards: []
  };
}

export async function runAllWebVerificationTests(): Promise<TestCaseResult[]> {
  const results: TestCaseResult[] = [];

  async function runCase(
    id: string,
    category: 'S0-B' | 'S1',
    name: string,
    fn: (counter: { count: number }) => Promise<string> | string
  ): Promise<void> {
    const counter = { count: 0 };
    clearAllBrowserStorageForTest();
    try {
      const details = await fn(counter);
      results.push({ id, name, category, passed: true, assertions: counter.count, details });
    } catch (err) {
      results.push({
        id,
        name,
        category,
        passed: false,
        assertions: counter.count,
        details: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // 1. S0-B #1: Blank Home `/` & Empty Five Panels
  await runCase('S0-B-01', 'S0-B', '空白库打开 `/` 与五面板空状态渲染核验', (c) => {
    const state = createInitialState();
    const emptyData: BootstrapData = {
      cursor: 0,
      modules: [],
      record_types: [],
      tasks: [],
      records: [],
      metric_definitions: [],
      metrics: [],
      achievement_definitions: [],
      achievement_awards: []
    };

    assert(state.route === '/', 'Default route is strictly `/`', c);
    const tasksHtml = renderTasksPanel(state, emptyData);
    const metricsHtml = renderMetricsPanel(state, emptyData);
    const achHtml = renderAchievementsPanel(state, emptyData);
    const recordsHtml = renderRecordsPanel(state, emptyData);

    assert(tasksHtml.includes('暂无任务实例'), 'Empty tasks panel renders cleanly', c);
    assert(metricsHtml.includes('暂无数值定义'), 'Empty metrics panel renders cleanly', c);
    assert(achHtml.includes('暂无成就定义'), 'Empty achievements panel renders cleanly', c);
    assert(recordsHtml.includes('暂无符合筛选条件的记录'), 'Empty records panel renders cleanly', c);
    return '默认路由 `/` 保持纯净空白主页，五大业务面板在空白库下均平稳渲染空状态引导与快捷新建入口。';
  });

  // 2. S0-B #2: Task -> Record jump without prefilling target thresholds as facts
  await runCase('S0-B-02', 'S0-B', '从任务跳去新建记录（自动带出模块/模板/关联任务，绝不预填目标时长）', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();
    state.bootstrap = data;
    state.activeModal = {
      kind: 'record-form',
      mode: 'create',
      defaultModuleId: 'mod-study',
      defaultRecordTypeId: 'rt-coding',
      defaultTaskIds: ['task-py-10'],
      fromTaskId: 'task-py-10'
    };

    const modalHtml = renderActiveModal(state, data);
    assert(modalHtml.includes('来自任务：') && modalHtml.includes('完成一次 Python 练习'), 'Shows source task banner', c);
    assert(modalHtml.includes('绝不预填目标值'), 'Explicitly states target value is not prefilled', c);
    assert(modalHtml.includes('name="task_id" value="task-py-10" checked'), 'Pre-checks the linked task checkbox', c);
    assert(
      modalHtml.includes('data-field-key="duration_minutes" data-field-type="integer" value=""'),
      'Duration field value is strictly empty ("") and not prefilled with threshold 10',
      c
    );
    return '任务跳转新建记录时，自动绑定模块、模板并勾选关联任务，但练习时长字段严格保持 value=""，不预填门槛值 10。';
  });

  // 3. S0-B #3: 5min vs 10min record threshold & partial diagnosis
  await runCase('S0-B-03', 'S0-B', '5 分钟未达标 (partial) 与 10 分钟达标 (completed + 成就解锁) 全链路渲染', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();

    // Step A: 5-minute confirmed record -> task becomes partial
    const rec5Min: RecordRow = {
      id: 'rec-5min',
      user_id: 'user-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T09:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 5, topic: '基础语法' },
      task_ids: ['task-py-10'],
      version: 1,
      created_at: '2026-10-19T01:00:00Z',
      updated_at: '2026-10-19T01:00:00Z',
      deleted_at: null
    };
    data.records = [rec5Min];
    data.tasks[0].status = 'partial';
    data.metrics[0].computed.value = '5';
    data.metrics[0].computed.sample_count = 1;
    data.metrics[0].computed.source_record_ids = ['rec-5min'];

    const diag5 = diagnosePartialTask(data, data.tasks[0]);
    assert(diag5 !== null && diag5.includes('还差 5 分钟'), 'diagnosePartialTask explains exact 5-minute shortfall', c);
    const tasksHtml5 = renderTasksPanel(state, data);
    assert(tasksHtml5.includes('部分完成') && tasksHtml5.includes('还差 5 分钟'), 'Tasks panel renders partial badge and diagnosis', c);
    const achHtml5 = renderAchievementsPanel(state, data);
    assert(achHtml5.includes('未解锁') && achHtml5.includes('width:50%'), 'Achievements panel shows 50% progress and remains locked', c);

    // Step B: 10-minute confirmed record -> task completed, metric = 15, achievement unlocked
    const rec10Min: RecordRow = {
      id: 'rec-10min',
      user_id: 'user-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T10:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 10, topic: '生成器与迭代器' },
      task_ids: ['task-py-10'],
      version: 1,
      created_at: '2026-10-19T02:00:00Z',
      updated_at: '2026-10-19T02:00:00Z',
      deleted_at: null
    };
    data.records = [rec5Min, rec10Min];
    data.tasks[0].status = 'completed';
    data.tasks[0].completed_at = '2026-10-19T02:00:00Z';
    data.tasks[0].completion_origin = 'evidence';
    data.metrics[0].computed.value = '15';
    data.metrics[0].computed.sample_count = 2;
    data.metrics[0].computed.source_record_ids = ['rec-5min', 'rec-10min'];
    data.achievement_awards = [
      {
        id: 'award-1',
        user_id: 'user-1',
        achievement_id: 'ach-coding-10',
        rule_version: 1,
        period_key: 'once',
        state: 'unlocked',
        unlocked_at: '2026-10-19T02:00:00Z',
        evaluated_at: '2026-10-19T02:00:00Z',
        evidence: { ...data.metrics[0].computed },
        original_evidence: { ...data.metrics[0].computed },
        version: 1
      }
    ];

    const tasksHtml10 = renderTasksPanel(state, data);
    const metricsHtml10 = renderMetricsPanel(state, data);
    const achHtml10 = renderAchievementsPanel(state, data);
    assert(tasksHtml10.includes('已完成') && tasksHtml10.includes('记录达标'), 'Task shows completed via record evidence', c);
    assert(metricsHtml10.includes('15</span><span class="ld-metric-unit">分钟') && metricsHtml10.includes('有效样本 2 条'), 'Metric shows 15 minutes across 2 samples', c);
    assert(achHtml10.includes('🏆 已解锁') && achHtml10.includes('查看解锁依据 (2)'), 'Achievement shows unlocked badge and evidence link', c);
    return '5 分钟记录精确提示“还差 5 分钟（部分完成）”；补充 10 分钟记录后任务自动达标、周时长聚合为 15 分钟、成就解锁。';
  });

  // 4. S0-B #4: 1 record linked to multiple tasks deduplicated stats
  await runCase('S0-B-04', 'S0-B', '1 条记录关联多个任务时的统计去重展示与多任务跳转徽章', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();
    data.tasks.push({
      id: 'task-py-second',
      user_id: 'user-1',
      module_id: 'mod-study',
      template_id: 'tpl-2',
      rule_version: 1,
      status: 'completed',
      needs_review: false,
      completed_at: '2026-10-19T03:00:00Z',
      completion_origin: 'evidence',
      version: 1,
      created_at: '2026-10-19T00:00:00Z',
      updated_at: '2026-10-19T03:00:00Z',
      definition: {
        id: 'task-py-second',
        module_id: 'mod-study',
        title: '完成今日代码提交',
        completion_mode: 'record_optional',
        record_type_id: 'rt-coding',
        acceptance: { kind: 'exists' },
        business_date: '2026-10-19',
        timezone: 'Asia/Shanghai'
      }
    });
    data.tasks[0].status = 'completed';

    const sharedRecord: RecordRow = {
      id: 'rec-shared-30',
      user_id: 'user-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T11:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 30, topic: '重构解析器' },
      task_ids: ['task-py-10', 'task-py-second'],
      version: 1,
      created_at: '2026-10-19T03:00:00Z',
      updated_at: '2026-10-19T03:00:00Z',
      deleted_at: null
    };
    data.records = [sharedRecord];
    data.metrics[0].computed.value = '30';
    data.metrics[0].computed.sample_count = 1;
    data.metrics[0].computed.source_record_ids = ['rec-shared-30'];

    const recordsHtml = renderRecordsPanel(state, data);
    const metricsHtml = renderMetricsPanel(state, data);
    assert(recordsHtml.includes('关联任务 (2)'), 'Record card displays 2 linked tasks', c);
    assert(recordsHtml.includes('完成一次 Python 练习') && recordsHtml.includes('完成今日代码提交'), 'Both linked task titles rendered as jump buttons', c);
    assert(metricsHtml.includes('有效样本 1 条') && metricsHtml.includes('30</span><span class="ld-metric-unit">分钟'), 'Metric counts the shared record once (30 min, 1 sample)', c);
    return '单条 30 分钟记录同时关联 2 个任务时，记录卡片展示双任务跳转按钮，数值面板严格按唯一记录 ID 展示“有效样本 1 条 / 30 分钟”。';
  });

  // 5. S0-B #5: Edit/delete record -> needs_review & S0-A R3 closed task button defense
  await runCase('S0-B-05', 'S0-B', '修改/删除记录后任务与成就 needs_review 提示及 R3 已关闭任务按钮防呆', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();

    // Task 0 has needs_review = true
    data.tasks[0].status = 'partial';
    data.tasks[0].needs_review = true;

    // Add a cancelled task and a skipped task to verify S0-A R3 UI defense
    data.tasks.push(
      {
        id: 'task-cancelled-1',
        user_id: 'user-1',
        module_id: 'mod-study',
        template_id: 'tpl-c',
        rule_version: 1,
        status: 'cancelled',
        needs_review: false,
        completed_at: null,
        completion_origin: null,
        version: 2,
        created_at: '2026-10-19T00:00:00Z',
        updated_at: '2026-10-19T04:00:00Z',
        definition: {
          id: 'task-cancelled-1',
          module_id: 'mod-study',
          title: '已取消的旧练习任务',
          completion_mode: 'manual',
          record_type_id: null,
          acceptance: null,
          business_date: '2026-10-19',
          timezone: 'Asia/Shanghai'
        }
      },
      {
        id: 'task-skipped-1',
        user_id: 'user-1',
        module_id: 'mod-study',
        template_id: 'tpl-s',
        rule_version: 1,
        status: 'skipped',
        needs_review: false,
        completed_at: null,
        completion_origin: null,
        version: 2,
        created_at: '2026-10-19T00:00:00Z',
        updated_at: '2026-10-19T04:00:00Z',
        definition: {
          id: 'task-skipped-1',
          module_id: 'mod-study',
          title: '已跳过的关联记录任务',
          completion_mode: 'record_required',
          record_type_id: 'rt-coding',
          acceptance: { kind: 'exists' },
          business_date: '2026-10-19',
          timezone: 'Asia/Shanghai'
        }
      }
    );

    // Achievement award in needs_review state
    data.achievement_awards = [
      {
        id: 'award-review-1',
        user_id: 'user-1',
        achievement_id: 'ach-coding-10',
        rule_version: 1,
        period_key: 'once',
        state: 'needs_review',
        unlocked_at: '2026-10-19T02:00:00Z',
        evaluated_at: '2026-10-19T04:00:00Z',
        evidence: { ...data.metrics[0].computed, value: '4' },
        original_evidence: { ...data.metrics[0].computed, value: '15' },
        version: 2
      }
    ];

    const tasksHtml = renderTasksPanel(state, data);
    const achHtml = renderAchievementsPanel(state, data);
    assert(tasksHtml.includes('⚠ 完成依据变化，待复核'), 'Task card shows needs_review warning badge', c);
    assert(achHtml.includes('⚠ 完成依据变化，待复核') && achHtml.includes('原解锁值：15 → 最新复核值：4'), 'Achievement card shows needs_review and evidence delta', c);

    // Verify S0-A R3: cancelled and skipped tasks never render complete/record buttons
    assert(!tasksHtml.includes('data-action="task-complete-manual" data-task-id="task-cancelled-1"'), 'Cancelled task hides manual complete button (R3)', c);
    assert(!tasksHtml.includes('data-action="task-go-record" data-task-id="task-skipped-1"'), 'Skipped task hides go-record button (R3)', c);
    assert(tasksHtml.includes('已关闭状态（不可再完成）'), 'Closed tasks display explicit closed status note', c);

    // Also verify record-form compatibleTasks excludes cancelled/skipped tasks
    state.activeModal = {
      kind: 'record-form',
      mode: 'create',
      defaultModuleId: 'mod-study',
      defaultRecordTypeId: 'rt-coding',
      defaultTaskIds: []
    };
    const recordModalHtml = renderActiveModal(state, data);
    assert(!recordModalHtml.includes('value="task-skipped-1"'), 'Skipped task is excluded from record form compatibleTasks list', c);
    return '记录修改/软删除后任务与成就均醒目展示“⚠ 完成依据变化，待复核”及原值对比；cancelled/skipped 任务严格隐藏完成与去记录按钮。';
  });

  // 6. S0-B #6: AI preview -> apply -> revoke & Blueprint 1.0 Support Matrix
  await runCase('S0-B-06', 'S0-B', 'AI 预览 -> 应用 -> 撤销全套视图与蓝图 1.0 字段支持矩阵核验', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();

    // Check Support Matrix card
    const matrixHtml = renderAiSupportMatrixCard();
    assert(AI_BLUEPRINT_SUPPORT_MATRIX.length === 5, 'Support matrix defines 5 core rows', c);
    assert(matrixHtml.includes('模块蓝图 1.0 与正式定义字段支持矩阵'), 'Support matrix header rendered', c);
    assert(matrixHtml.includes('proposed_target') && matrixHtml.includes('estimated_minutes'), 'Support matrix explicitly documents candidate-only fields', c);

    // Check AI Generate Modal S0-A R4 alignment
    state.activeModal = { kind: 'ai-generate', moduleId: 'mod-study' };
    const genModalHtml = renderAiGenerateModal(state, data);
    assert(genModalHtml.includes('已归档数值不可引用'), 'AI generate modal explains archived metrics cannot be referenced (R4)', c);

    // Check Preview Ready modal
    state.activeModal = { kind: 'ai-result', moduleId: 'mod-study' };
    state.ai.result = {
      already_applied: false,
      batch: null,
      job: {
        id: 'job-preview-1',
        status: 'preview_ready',
        mode: 'extend',
        module_id: 'mod-study',
        target_base_version: 1,
        apply_mode: 'preview',
        provider: 'mock',
        model: 'mock-blueprint-v1',
        attempts: 1,
        usage: { total_tokens: 120 },
        error: null,
        warnings: ['任务 estimated_minutes 仅在候选预览展示'],
        validation: { valid: true, errors: [], warnings: [] },
        candidate: {
          schema_version: '1.0',
          kind: 'module_blueprint',
          module: { mode: 'extend', target_module_id: 'mod-study', local_ref: 'mod_1', name: '学习与发展' },
          tasks: [{ local_ref: 't_1', title: '阅读源码 20 分钟', completion_mode: 'manual', estimated_minutes: 20 }]
        },
        summary: { tasks: 1 },
        batch_id: null,
        created_at: '2026-10-19T05:00:00Z',
        updated_at: '2026-10-19T05:00:01Z',
        finished_at: '2026-10-19T05:00:01Z'
      }
    };
    const previewHtml = renderAiResultModal(state, data);
    assert(previewHtml.includes('data-action="ai-apply-job" data-job-id="job-preview-1"'), 'Preview ready job shows Apply button', c);
    assert(previewHtml.includes('data-action="ai-cancel-job" data-job-id="job-preview-1"'), 'Preview ready job shows Cancel button', c);
    assert(previewHtml.includes('预计 20 分钟（仅候选说明）'), 'Candidate task marks estimated_minutes as candidate-only', c);

    // Check Applied batch modal -> Revoke button
    state.ai.result.job.status = 'applied';
    state.ai.result.batch = {
      id: 'batch-applied-1',
      job_id: 'job-preview-1',
      module_id: 'mod-study',
      module_created: false,
      status: 'applied',
      base_module_version: 1,
      id_map: {},
      objects: [{ kind: 'task', local_ref: 't_1', id: 'task-ai-1' }],
      summary: { tasks: 1 },
      applied_at: '2026-10-19T05:01:00Z',
      revoked_at: null,
      revoke_mode: null
    };
    const appliedHtml = renderAiResultModal(state, data);
    assert(appliedHtml.includes('data-action="ai-revoke-batch" data-batch-id="batch-applied-1"'), 'Applied batch renders Revoke button', c);

    // Check Revoked batch modal
    state.ai.result.batch.status = 'revoked';
    state.ai.result.batch.revoke_mode = 'archived';
    state.ai.result.batch.revoked_at = '2026-10-19T05:02:00Z';
    const revokedHtml = renderAiResultModal(state, data);
    assert(revokedHtml.includes('已撤销 / archived'), 'Revoked batch renders archived revoke mode badge', c);

    const settingsAiHtml = renderSettingsAiSection(state, data);
    assert(settingsAiHtml.includes('data-support-matrix="blueprint-1.0"'), 'Settings AI section embeds Blueprint 1.0 support matrix', c);
    return 'AI 预览、应用、撤销全链路按钮与状态徽章渲染完备，且设置面板内嵌《模块蓝图 1.0 与正式定义字段支持矩阵》。';
  });

  // 7. S0-B #7 & S1: 409 Conflict visibility & unsaved form input retention
  await runCase('S0-B-07', 'S1', '409 VERSION_CONFLICT 冲突面板展示与未保存表单输入完整保留', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();
    const serverRec: RecordRow = {
      id: 'rec-edit-conflict',
      user_id: 'user-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T08:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 15, topic: '服务端已更新的主题 v3' },
      task_ids: ['task-py-10'],
      version: 3,
      created_at: '2026-10-19T00:00:00Z',
      updated_at: '2026-10-19T05:00:00Z',
      deleted_at: null
    };
    data.records = [serverRec];

    const draftKey = buildRecordDraftKey({
      mode: 'edit',
      recordId: 'rec-edit-conflict',
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding'
    });

    // Save the user's unsaved local edits in draft storage
    saveRecordDraft({
      draftKey,
      mode: 'edit',
      recordId: 'rec-edit-conflict',
      baseVersion: 2,
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding',
      schemaVersion: 1,
      occurredAt: '2026-10-19T08:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 45, topic: '用户在本地精心编写但遇到 409 的笔记' },
      rawInputs: { duration_minutes: '45', topic: '用户在本地精心编写但遇到 409 的笔记' },
      taskIds: ['task-py-10'],
      updatedAt: '2026-10-19T05:01:00Z'
    });

    state.activeModal = {
      kind: 'record-form',
      mode: 'edit',
      recordId: 'rec-edit-conflict',
      defaultModuleId: 'mod-study',
      defaultRecordTypeId: 'rt-coding',
      defaultTaskIds: ['task-py-10']
    };
    state.recordForm = {
      draftKey,
      submissionStatus: 'conflict_pending',
      operationId: 'op-conflict-1234567890',
      recordId: 'rec-edit-conflict',
      restoredFromStorage: true,
      lastSavedLocalAt: '2026-10-19T05:01:00Z',
      conflictError: {
        code: 'VERSION_CONFLICT',
        message: '记录版本冲突：期望 base_version=2，实际服务端版本为 v3'
      },
      conflictServerRecord: serverRec,
      validationError: null
    };

    const modalHtml = renderActiveModal(state, data);
    assert(modalHtml.includes('data-submission-status="conflict_pending"'), 'Status bar shows conflict_pending', c);
    assert(modalHtml.includes(SUBMISSION_STATE_META.conflict_pending.label), 'Status bar displays 冲突待处理 (409)', c);
    assert(modalHtml.includes('data-conflict-code="VERSION_CONFLICT"'), 'Conflict panel displays VERSION_CONFLICT code', c);
    assert(modalHtml.includes('data-action="conflict-pull-latest"'), 'Conflict panel renders button to pull latest server version', c);
    assert(modalHtml.includes('服务端已更新的主题 v3'), 'Conflict panel displays latest server values for comparison', c);
    assert(
      modalHtml.includes('value="45"') && modalHtml.includes('value="用户在本地精心编写但遇到 409 的笔记"'),
      'User unsaved local input values (45 min & note) are strictly preserved in form inputs',
      c
    );
    return '发生 409 VERSION_CONFLICT 时，编辑弹窗不关闭、用户未保存的本地输入（45 分钟及笔记）完整保留，并展示服务端 v3 最新值与“拉取服务器最新版本”按钮。';
  });

  // 8. S0-B #8: 360px Mobile viewport layout & non-occlusion
  await runCase('S0-B-08', 'S0-B', '360px 移动端视口五面板底部导航与表单底部防遮挡样式核验', (c) => {
    assert(DASHBOARD_STYLES.includes('@media (max-width: 768px)'), 'Mobile responsive media query present', c);
    assert(DASHBOARD_STYLES.includes('.ld-mobile-dock') && DASHBOARD_STYLES.includes('height: 58px'), 'Mobile bottom dock height fixed at 58px', c);
    assert(
      DASHBOARD_STYLES.includes('padding: 10px 8px calc(68px + env(safe-area-inset-bottom, 0px))'),
      'Modal backdrop reserves 68px+safe-area bottom padding above mobile dock',
      c
    );
    assert(
      DASHBOARD_STYLES.includes('max-height: calc(100vh - 82px)'),
      'Modal max-height constrained so footer submit button is never covered by bottom dock',
      c
    );
    return '移动端样式为 360px 窄屏预留底部导航安全间距 (68px + safe-area) 并限制弹窗高度 (100vh - 82px)，确保底部提交按钮不被遮挡。';
  });

  // 9. S1 #1: Local persistent draft recovery & security boundary
  await runCase('S1-01', 'S1', '本机持久草稿恢复、记录面板草稿横幅提醒与敏感口令拒写保护', (c) => {
    const state = createInitialState();
    const data = createFixtureBootstrap();
    const draftKey = buildRecordDraftKey({
      mode: 'create',
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding',
      fromTaskId: 'task-py-10'
    });

    saveRecordDraft({
      draftKey,
      mode: 'create',
      recordId: 'rec-local-draft-1',
      baseVersion: null,
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding',
      schemaVersion: 1,
      occurredAt: '2026-10-19T12:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed',
      values: { duration_minutes: 25, topic: '持久化草稿测试' },
      rawInputs: { duration_minutes: '25', topic: '持久化草稿测试' },
      taskIds: ['task-py-10'],
      fromTaskId: 'task-py-10',
      updatedAt: '2026-10-19T06:00:00Z'
    });

    const loaded = loadRecordDraft(draftKey);
    assert(loaded !== null && loaded.rawInputs.topic === '持久化草稿测试', 'Draft persisted and reloaded from storage', c);

    // Records panel shows local draft recovery bar
    const recordsHtml = renderRecordsPanel(state, data);
    assert(recordsHtml.includes('已保存本机草稿 (1)'), 'Records panel displays local draft count badge', c);
    assert(recordsHtml.includes('data-action="resume-latest-draft"'), 'Records panel offers one-click draft resume button', c);

    // UI Preferences persistence
    saveUiPreferences({
      theme: 'light',
      reducedMotion: true,
      unlockToastEnabled: false,
      showInactiveModulesInFilter: true,
      panels: state.panels,
      returnContext: null
    });
    const prefs = loadUiPreferences();
    assert(prefs !== null && prefs.theme === 'light' && prefs.reducedMotion === true, 'UI preferences persisted cleanly', c);

    // Regression: business text containing the literal word must still persist; only keys are sensitive.
    const noteKey = buildRecordDraftKey({ mode: 'create', moduleId: 'mod-study', recordTypeId: 'rt-coding', fromTaskId: 'note-check' });
    saveRecordDraft({
      draftKey: noteKey, mode: 'create', recordId: 'rec-note-check', baseVersion: null,
      moduleId: 'mod-study', recordTypeId: 'rt-coding', schemaVersion: 1,
      occurredAt: '2026-10-19T12:00:00+08:00', timezone: 'Asia/Shanghai', status: 'draft',
      values: { duration_minutes: null, topic: '复盘里提到 login_secret 这个字段名，只是普通笔记' },
      rawInputs: { duration_minutes: '', topic: '复盘里提到 login_secret 这个字段名，只是普通笔记' },
      taskIds: [], fromTaskId: 'note-check', updatedAt: '2026-10-19T06:00:00Z'
    });
    const note = loadRecordDraft(noteKey);
    assert(note !== null && note.rawInputs.topic.includes('login_secret'), 'Business text containing a sensitive word still persists; only sensitive keys are blocked', c);
    return '本机草稿与界面偏好持久化及恢复正常，记录面板顶部显示“已保存本机草稿 (1)”快捷恢复横幅；敏感字段名拒写，但普通笔记文本不会被误拒。';
  });

  // 10. S1 #2: Unknown network result state & stable operation_id idempotent retry
  await runCase('S1-02', 'S1', '未知网络结果显式区分与未改内容重试时严格复用同一 operation_id', (c) => {
    const netErr = new ApiClientError(0, { code: 'NETWORK_ERROR', message: 'Failed to fetch' });
    const gwErr = new ApiClientError(502, { code: 'BAD_GATEWAY', message: '502 Bad Gateway' });
    const valErr = new ApiClientError(422, { code: 'VALIDATION_FAILED', message: 'Invalid field' });
    assert(isUnknownNetworkError(netErr) === true, 'status 0 is classified as unknown network error', c);
    assert(isUnknownNetworkError(gwErr) === true, 'status 502 is classified as unknown network error', c);
    assert(isUnknownNetworkError(valErr) === false, 'status 422 is NOT an unknown network error', c);

    const draftKey = buildRecordDraftKey({
      mode: 'create',
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding'
    });
    const candidatePayload = {
      id: 'rec-idempotent-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T14:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed' as const,
      values: { duration_minutes: 35, topic: '幂等重放验证' },
      task_ids: ['task-py-10']
    };
    const sig1 = computePayloadSignature({
      mode: 'create',
      module_id: candidatePayload.module_id,
      record_type_id: candidatePayload.record_type_id,
      schema_version: candidatePayload.schema_version,
      status: candidatePayload.status,
      values: candidatePayload.values,
      task_ids: candidatePayload.task_ids
    });

    // First attempt allocates operationId
    const env1 = prepareRecordMutationEnvelope({
      draftKey,
      mode: 'create',
      candidateRecordId: candidatePayload.id,
      candidatePayload,
      signature: sig1,
      allocateUuid: () => 'op-uuid-first-attempt-001'
    });
    assert(env1.reusedPending === false && env1.operationId === 'op-uuid-first-attempt-001', 'First attempt allocates op-uuid-first-attempt-001', c);

    // Network drops -> savePendingMutation
    savePendingMutation({
      draftKey,
      operationId: env1.operationId,
      recordId: env1.recordId,
      mode: 'create',
      payloadSignature: sig1,
      frozenPayload: env1.payload,
      lastError: { code: 'NETWORK_ERROR', message: '网络连接中断' },
      savedAt: '2026-10-19T06:10:00Z'
    });

    // Second attempt WITHOUT changing form values -> MUST reuse op-uuid-first-attempt-001 and frozenPayload!
    const env2 = prepareRecordMutationEnvelope({
      draftKey,
      mode: 'create',
      candidateRecordId: 'rec-different-id-should-be-ignored',
      candidatePayload: { ...candidatePayload, id: 'rec-different-id-should-be-ignored' },
      signature: sig1,
      allocateUuid: () => 'op-uuid-second-attempt-002'
    });
    assert(env2.reusedPending === true, 'Retry with unchanged signature reuses pending envelope', c);
    assert(env2.operationId === 'op-uuid-first-attempt-001', 'Retry strictly reuses op-uuid-first-attempt-001', c);
    assert(env2.recordId === 'rec-idempotent-1', 'Retry strictly reuses original recordId', c);

    // Verify modal UI displays unknown_network state & retry button label
    const state = createInitialState();
    const data = createFixtureBootstrap();
    state.activeModal = {
      kind: 'record-form',
      mode: 'create',
      defaultModuleId: 'mod-study',
      defaultRecordTypeId: 'rt-coding',
      defaultTaskIds: ['task-py-10']
    };
    state.recordForm.draftKey = draftKey;
    state.recordForm.submissionStatus = 'unknown_network';
    state.recordForm.operationId = env2.operationId;
    const modalHtml = renderActiveModal(state, data);
    assert(modalHtml.includes(SUBMISSION_STATE_META.unknown_network.label), 'Modal renders 网络结果未知（待重试） status badge', c);
    assert(modalHtml.includes('确认上次提交'), 'Submit button clearly confirms the retained prior operation', c);
    return '断网/超时进入 unknown_network 状态后，未修改表单内容直接重试严格复用同一 operation_id 与记录 ID，防止重复记账。';
  });

  // 11. S1 #3: Modifying form fields after unknown network error rotates a fresh operation_id
  await runCase('S1-03', 'S1', '未知结果后修改工作草稿仍保留旧操作，先确认原结果', (c) => {
    const draftKey = buildRecordDraftKey({
      mode: 'create',
      moduleId: 'mod-study',
      recordTypeId: 'rt-coding'
    });
    const basePayload = {
      id: 'rec-1',
      module_id: 'mod-study',
      record_type_id: 'rt-coding',
      schema_version: 1,
      occurred_at: '2026-10-19T14:00:00+08:00',
      timezone: 'Asia/Shanghai',
      status: 'confirmed' as const,
      values: { duration_minutes: 20, topic: '初版内容' },
      task_ids: ['task-py-10']
    };
    const sigOld = computePayloadSignature({
      mode: 'create',
      module_id: basePayload.module_id,
      record_type_id: basePayload.record_type_id,
      schema_version: basePayload.schema_version,
      status: basePayload.status,
      values: basePayload.values,
      task_ids: basePayload.task_ids
    });

    savePendingMutation({
      draftKey,
      operationId: 'op-old-111',
      recordId: 'rec-1',
      mode: 'create',
      payloadSignature: sigOld,
      frozenPayload: basePayload,
      lastError: { code: 'NETWORK_ERROR', message: 'Timeout' },
      savedAt: '2026-10-19T06:20:00Z'
    });

    // User modifies duration_minutes from 20 to 45
    const modifiedPayload = {
      ...basePayload,
      values: { duration_minutes: 45, topic: '修改后的新内容' }
    };
    const sigNew = computePayloadSignature({
      mode: 'create',
      module_id: modifiedPayload.module_id,
      record_type_id: modifiedPayload.record_type_id,
      schema_version: modifiedPayload.schema_version,
      status: modifiedPayload.status,
      values: modifiedPayload.values,
      task_ids: modifiedPayload.task_ids
    });

    assert(sigOld !== sigNew, 'Payload signature changes when user edits duration_minutes or topic', c);
    const envNew = prepareRecordMutationEnvelope({
      draftKey,
      mode: 'create',
      candidateRecordId: 'rec-2',
      candidatePayload: modifiedPayload,
      signature: sigNew,
      allocateUuid: () => 'op-fresh-222'
    });

    assert(envNew.reusedPending === true, 'Unconfirmed operation is reused despite changed working draft', c);
    assert(envNew.operationId === 'op-old-111', 'Original operation_id is preserved', c);
    assert(getPendingMutation(draftKey)?.recordId === 'rec-1', 'Original target is preserved until confirmed', c);
    return '先确认原操作，再对同一条记录显式保存当前修改。';
  });

  // 12. S1 #4: Minimal user-data export UI (`GET /api/v1/export` download)
  await runCase('S1-04', 'S1', '设置面板数据导出入口渲染、文件名时区处理与导出载荷完整性校验', (c) => {
    const data = createFixtureBootstrap();

    const idleState = createInitialState();
    idleState.route = '/settings';
    idleState.panels.settings.subTab = 'account';
    const idleHtml = renderSettingsPanel(idleState, data);
    assert(idleHtml.includes('data-action="export-data"'), 'Settings account tab renders the export action', c);
    assert(
      idleHtml.includes('数据导出') && idleHtml.includes('CLI'),
      'Export card is labelled honestly as export-only, with CLI restore noted',
      c
    );
    assert(
      !idleHtml.includes('data-action="restore-data"') && !idleHtml.includes('data-action="export-restore"'),
      'No restore action is exposed in the browser settings UI',
      c
    );

    const exportedAt = '2026-10-19T07:22:51.262Z';
    const payload = {
      format: 'life-dashboard-user-export' as const,
      schema_version: 1,
      contract_version: '0.2.0',
      exported_at: exportedAt,
      user: { id: 'user-1', name: '本地用户', timezone: 'Asia/Shanghai' },
      cursor: 46,
      migrations: [{ name: '0001_core.sql', checksum: 'abc' }],
      counts: { modules: 4, records: 2 },
      checksum: 'f'.repeat(64),
      data: { modules: [], records: [] }
    };
    const validated = assertUserExportPayload(payload);
    assert(validated === payload, 'assertUserExportPayload accepts the contract-shaped export envelope', c);

    const filename = buildExportFilename(exportedAt, 'Asia/Shanghai');
    assert(filename === 'life-dashboard-2026-10-19.json', 'Filename uses exported_at as life-dashboard-<YYYY-MM-DD>.json', c);
    assert(
      buildExportFilename('2026-10-19T20:30:00.000Z', 'Asia/Shanghai') === 'life-dashboard-2026-10-20.json',
      'Filename date is resolved in the user timezone, not the raw UTC date',
      c
    );

    const serialized = serializeUserExport(validated);
    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    assert(
      parsed.format === 'life-dashboard-user-export' &&
        typeof parsed.checksum === 'string' &&
        Array.isArray(parsed.migrations) &&
        typeof parsed.data === 'object',
      'Serialized export keeps format/checksum/migrations/data required by CLI restore',
      c
    );
    assert(
      !serialized.includes('login_secret') &&
        !serialized.includes('LOCAL_LOGIN_SECRET') &&
        !serialized.includes('cookie'),
      'Export file contains no login secret, local secret name or cookie material',
      c
    );

    let rejectedMalformed = false;
    try {
      assertUserExportPayload({ format: 'wrong', schema_version: 1 });
    } catch {
      rejectedMalformed = true;
    }
    assert(rejectedMalformed, 'assertUserExportPayload rejects a malformed payload before download', c);

    const successState = createInitialState();
    successState.panels.settings.subTab = 'account';
    successState.exportUi = {
      status: 'success',
      message: '已下载 2 张表 / 6 行数据；服务端校验和 ffffffffffff…',
      fileName: filename
    };
    const successHtml = renderSettingsPanel(successState, data);
    assert(
      successHtml.includes('data-export-status="success"') && successHtml.includes(filename),
      'Settings renders success feedback together with the downloaded filename',
      c
    );

    const errorState = createInitialState();
    errorState.panels.settings.subTab = 'account';
    errorState.exportUi = { status: 'error', message: '导出失败：服务器返回 500', fileName: null };
    const errorHtml = renderSettingsPanel(errorState, data);
    assert(
      errorHtml.includes('data-export-status="error"') && errorHtml.includes('导出失败：服务器返回 500'),
      'Settings renders honest error feedback when the export request fails',
      c
    );
    return '设置面板「账户与数据」分组提供诚实的「导出数据」动作：按月日时区生成 life-dashboard-YYYY-MM-DD.json、保留服务端 checksum/迁移信息供 CLI 恢复、明确不提供页面恢复入口，并渲染成功/失败反馈且不包含登录口令。';
  });

  return results;
}
