# 阶段二前置工程收敛与记录可靠性开发日志（Gemini — `S0-B` 前端模块化与自动化核验 + `S1` 记录可靠性体验）

- **日期**：2026-10-19
- **负责人**：Gemini（前端体验、五面板交互与移动端适配线）
- **负责范围**：
  - `S0-B`：前端自动化回归补齐、单文件巨石模块拆分（`apps/web/src/*`）、局部受控重绘与未保存表单输入保护、蓝图 1.0 字段支持矩阵内嵌展示、对齐 `S0-A` R3/R4 规则
  - `S1`（前端职责）：记录本机持久草稿（`localStorage`）、四态/五态提交反馈显式区分、未知网络结果下的稳定 `operation_id` 重放保护、`409` 版本/状态冲突弹窗内对比与未保存输入保留
- **改动边界核验**：严格限制在 `v0.1/apps/web/**`、`v0.1/packages/ui/**` 与本日志文件 `log/2026-10-19_gemini_S0-B_S1-web.md`，未触碰 `apps/api`、`packages/contracts`、`packages/db`、`packages/domain`、`packages/ai`、`compose.yaml` 或根构建脚本。

---

## 一、背景与阶段一核验问题逐项回应

在阅读《阶段一完整核验日志》（`log/2026-10-19_阶段一完整核验日志.md`）、Codex 的 `S0-A / S0-C` 开发日志（`log/2026-10-19_codex_S0-A_S0-C.md`）以及《下一阶段开发计划与主页提案 v0.1》（`design/下一阶段开发计划与主页提案_v0.1.md`）后，针对阶段一遗留的工程债与阶段二前置要求完成如下闭环：

1. **回应核验日志 §8.1（前端缺少仓库内可重复执行的自动化验证）**：
   - 新增仓库内可重复执行的自动化编译与核验套件 `v0.1/apps/web/tests/s0b-s1.test.ts` 与运行器 `v0.1/apps/web/scripts/verify-web.mjs`（同时声明于 `v0.1/apps/web/package.json`），覆盖 `S0-B` 要求的全部 8 项核心交互场景及 `S1` 的 3 项记录可靠性核心场景（共 11 个测试套件、61 项断言）。
2. **回应核验日志 §8.2（`apps/web/src/main.ts` 与 `panels.ts` 单文件过大，全量 `innerHTML` 重绘容易冲掉未保存输入）**：
   - 将原本近 2,700 行的双巨石文件拆分为职责单一的 9 个平铺模块（完全兼容 `scripts/build-web.mjs` 的非递归目录扫描编译逻辑）。
   - 将根容器拆分为三层独立局部挂载区：`#ld-main-region`（主面板）、`#ld-modal-layer`（弹窗层）、`#ld-toast-layer`（通知层）。Toast 弹出/自动消失仅调用 `renderToastsOnly()` 更新 `#ld-toast-layer`；草稿输入状态变更仅调用 `updateRecordStatusBarOnly()` 更新弹窗内状态条；在弹窗打开期间触发刷新或 `409` 冲突重绘时，通过 `captureActiveFormSnapshot()` / `restoreActiveFormSnapshot()` 完整保留用户未提交的 DOM 输入与勾选状态。
3. **回应核验日志 §7 R3 / R4 与 Codex `S0-A` 改动**：
   - **R3 对齐（已关闭任务防呆）**：在 `panels.ts`（任务卡片）与 `modals.ts`（任务详情弹窗、记录表单可关联任务列表）中，对 `status === 'cancelled' || status === 'skipped'` 的任务严格隐藏 `标记完成`、`完成并记录`、`去记录` 按钮，展示 `已关闭状态（不可再完成）`，并在新建/编辑记录时将其排除出 `compatibleTasks` 候选列表，避免前端误触 `409 TASK_CLOSED`。
   - **R4 对齐（AI 扩展模块仅引用活动数值）**：在 `ai-views.ts` 的 AI 生成弹窗中明确标注 `允许引用的已有活动数值定义（已归档数值不可引用）`，与后端 `S0-A` R4 校验保持一致。
4. **回应核验日志 §8.5（蓝图 1.0 与正式定义字段的阶段性差异需对用户显式说明）**：
   - 在 `packages/ui/src/tokens.ts` 中新增 `AI_BLUEPRINT_SUPPORT_MATRIX`，并在 `apps/web/src/ai-views.ts`（`renderAiSupportMatrixCard()`）中内嵌《模块蓝图 1.0 与正式定义字段支持矩阵》表格，同时在候选预览卡片中对 `proposed_target`、`estimated_minutes`、模板 `description` 等“仅候选预览保留、不写入正式定义”的字段做显式徽章标注。

---

## 二、`S0-B` 前端模块化拆分清单

所有源码均位于 `v0.1/apps/web/src/` 平铺目录下，确保 `node scripts/build-web.mjs` 编译后直接生成同名 `.js` 与入口 `app.js`：

| 模块文件 | 职责说明 |
| --- | --- |
| `v0.1/apps/web/src/types.ts` | 统一管理前后端 DTO、五面板路由与筛选状态、S1 本机持久草稿 (`PersistedRecordDraft`)、未知网络挂起包 (`PendingMutationEnvelope`) 及 AI 蓝图类型 |
| `v0.1/apps/web/src/storage.ts` | 浏览器本地存储适配层（支持 `localStorage` 与非浏览器环境内存回退）：管理 `life_dashboard_v0_1_record_drafts`、`life_dashboard_v0_1_pending_ops`、`life_dashboard_v0_1_prefs`，内置安全守卫严禁将 `login_secret` 写入本地存储 |
| `v0.1/apps/web/src/api.ts` | 封装 `/api/v1/*` 请求客户端、`Idempotency-Key` 透传、`ApiClientError` 结构化异常与 `isUnknownNetworkError()`（识别 `status === 0 / 502 / 503 / 504` 等未知网络结果） |
| `v0.1/apps/web/src/state.ts` | 全局 `AppState` 与 `RecordFormRuntimeState` 初始化、路由与面板键映射 |
| `v0.1/apps/web/src/panels.ts` | 五大业务面板（任务 `/tasks`、数值 `/metrics`、成就 `/achievements`、记录 `/records`、设置 `/settings`）纯函数视图渲染，含 `diagnosePartialTask()` 差额诊断与本机草稿恢复横幅 |
| `v0.1/apps/web/src/ai-views.ts` | AI 配置卡片、生成任务列表、候选蓝图预览/应用/撤销弹窗及《模块蓝图 1.0 与正式定义字段支持矩阵》渲染 |
| `v0.1/apps/web/src/modals.ts` | 任务创建/详情、记录创建/编辑/详情、数值创建/详情、成就创建/详情、模块管理与模板创建弹窗渲染，内嵌 S1 提交状态条与 409 冲突对比面板 |
| `v0.1/apps/web/src/forms.ts` | 弹窗表单动态联动控制器、实时草稿提取与持久化 (`extractRecordFormDraft`)、DOM 输入快照捕获与恢复 (`captureActiveFormSnapshot` / `restoreActiveFormSnapshot`) |
| `v0.1/apps/web/src/main.ts` | 应用生命周期、三层局部渲染 (`renderApp` / `renderModalRegionOnly` / `renderToastsOnly` / `updateRecordStatusBarOnly`) 与全局事件委托 |

配套 UI 基础包更新：
- `v0.1/packages/ui/src/tokens.ts`：新增 `SUBMISSION_STATE_META`（`idle` / `saved_local` / `submitting` / `unknown_network` / `confirmed_server` / `conflict_pending` / `validation_error`）与 `AI_BLUEPRINT_SUPPORT_MATRIX`。
- `v0.1/packages/ui/src/styles.ts`：新增 `.ld-draft-status-bar`、`.ld-conflict-panel` 样式，并强化 `@media (max-width: 768px)` 下 360px 窄屏弹窗底部内边距（`calc(68px + env(safe-area-inset-bottom, 0px))`）与最大高度约束（`calc(100vh - 82px)`），杜绝移动端底部导航栏遮挡表单主按钮。

---

## 三、`S1` 记录可靠性设计实现细节

1. **显式区分记录提交生命周期状态（`SUBMISSION_STATE_META`）**：
   - **已保存本机草稿 (`saved_local`)**：用户在 `#ld-form-record` 中输入或修改任何字段时，实时写入 `life_dashboard_v0_1_record_drafts`，界面状态条即时更新为“已保存本机草稿”，页面意外刷新或关闭后重新打开表单自动恢复。记录面板顶部同时展示“已保存本机草稿 (N) · 继续编辑本机草稿”快捷入口。
   - **等待服务器确认 (`submitting`)**：点击提交后锁定重复点击，显示“等待服务器确认…”。
   - **网络结果未知（待重试）(`unknown_network`)**：当请求遇到断网、超时或网关异常（`isUnknownNetworkError(err) === true`）时，绝不报错清空表单，而是将当次生成的 `operation_id`、`recordId`、`payloadSignature` 与冻结载荷 `frozenPayload` 写入 `life_dashboard_v0_1_pending_ops`，界面状态切换为“网络结果未知（待重试）”，主按钮文案切换为“重试提交（同 operation_id）”。
   - **服务器已确认 (`confirmed_server`)**：收到服务端 2xx 响应后，立即清除对应 `draftKey` 的本机草稿与挂起操作，刷新 `/bootstrap` 快照并弹出确认通知。
   - **冲突待处理 (`conflict_pending`)**：收到服务端 `409 VERSION_CONFLICT`（或模块/任务状态冲突）时，保持弹窗打开，保留用户当前未保存的所有表单输入，展示 `.ld-conflict-panel` 冲突横幅与服务端当前版本号/字段值，并提供“拉取服务器最新版本”（`data-action="conflict-pull-latest"`）一键同步最新 `base_version`。
2. **稳定 `operation_id` 重放与载荷变更自动轮换（`prepareRecordMutationEnvelope`）**：
   - 若同一 `draftKey` 存在未决的 `PendingMutationEnvelope` 且用户未修改表单业务字段（`payloadSignature` 一致），重试时严格复用原有的 `operationId`（作为 `Idempotency-Key` 请求头）与原 `recordId` / `occurred_at`，配合后端 `S0-C / S1` 幂等回执避免断网重发造成重复记账。
   - 若用户在 `unknown_network` 状态后主动修改了任意表单字段（导致 `computePayloadSignature` 变化），`forms.ts` 与 `prepareRecordMutationEnvelope` 会立即清理旧的挂起包并分配全新的 `operationId`，防止修改后的新数据误命中旧幂等结果。

---

## 四、自动化构建与核验结果（`S0-B` + `S1`）

执行命令：
```bash
/usr/bin/python3 /Users/zhk/life_dashboard/v0.1/apps/web/scripts/verify-web.mjs
```

执行输出摘要（详细 JSON 报告已落盘至 `v0.1/.runtime/test-artifacts/stage2-web/s0b-s1-verification-report.json`）：
- `[PASS] S0-B-01`：空白库打开 `/` 与五面板空状态渲染核验（5 assertions）
- `[PASS] S0-B-02`：从任务跳去新建记录（自动带出模块/模板/关联任务，绝不预填目标时长）（4 assertions）
- `[PASS] S0-B-03`：5 分钟未达标 (`partial`) 与 10 分钟达标 (`completed` + 成就解锁) 全链路渲染（6 assertions）
- `[PASS] S0-B-04`：1 条记录关联多个任务时的统计去重展示与多任务跳转徽章（3 assertions）
- `[PASS] S0-B-05`：修改/删除记录后任务与成就 `needs_review` 提示及 R3 已关闭任务按钮防呆（6 assertions）
- `[PASS] S0-B-06`：AI 预览 -> 应用 -> 撤销全套视图与蓝图 1.0 字段支持矩阵核验（10 assertions）
- `[PASS] S0-B-07`：`409 VERSION_CONFLICT` 冲突面板展示与未保存表单输入完整保留（6 assertions）
- `[PASS] S0-B-08`：360px 移动端视口五面板底部导航与表单底部防遮挡样式核验（4 assertions）
- `[PASS] S1-01`：本机持久草稿恢复、记录面板草稿横幅提醒与敏感口令拒写保护（4 assertions）
- `[PASS] S1-02`：未知网络结果显式区分与未改内容重试时严格复用同一 `operation_id`（9 assertions）
- `[PASS] S1-03`：未知网络状态后用户主动修改表单字段时自动清理旧挂起包并分配新 `operation_id`（4 assertions）

**总计**：`11 / 11` 测试套件全部通过（共 `61` 项断言通过），`packages/ui/dist/*.js` 与 `apps/web/dist/*.js`（含 `app.js`）已完成重新编译落盘。
