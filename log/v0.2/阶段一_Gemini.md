# v0.2 第一阶段开发日志 · Gemini（前端与可靠性）

- **日期**：2026-10-19
- **执行角色**：Gemini（前端与可靠性）
- **所属工作树**：`/Users/zhk/life_dashboard/v0.2/.runtime/worktrees/gemini`
- **应用目录**：`/Users/zhk/life_dashboard/v0.2/.runtime/worktrees/gemini/v0.2`
- **Git 分支**：`v02/phase1-gemini`（基线提交 `7fda7f4`）
- **隔离运行入口**：`http://localhost:18182`（Compose 项目 `life-dashboard-v0-2-gemini`）
- **阶段状态**：已完成（18/18 前端验证套件通过，134 项断言全绿，TypeScript 0 错误）

## 1. 变更文件范围与所有权核验

本次修改严格限制在 Gemini 独占写权限范围（`v0.2/apps/web/**`、`v0.2/packages/ui/**`、`log/v0.2/阶段一_Gemini.md`），未触碰后端（`apps/api`、`packages/contracts`、`packages/db`、`packages/domain`、`packages/ai`）、根 `package.json` / `pnpm-lock.yaml`、`compose*.yaml`、`scripts/build-web.mjs` 或其他 agent 的工作树与日志：

- `v0.2/packages/ui/src/tokens.ts`：新增 `AVATAR_ACTION_IDS`（`idle` / `greeting` / `celebrate` / `focus`）、`AvatarInputState`、`AvatarEnvironmentConfig`、`AvatarEventMap`、`AvatarRendererPort` 契约接口与零网络请求的 `StaticAvatarRenderer`（`createStaticAvatarRenderer`）。
- `v0.2/packages/ui/src/components.ts`：新增 `renderStaticAvatarSlot()` 静态形象占位卡片渲染函数。
- `v0.2/packages/ui/src/styles.ts`：新增标准首页双栏网格（`.ld-home-grid`）、极简模式居中舞台（`.ld-home-minimal` / `.ld-minimal-ai-stage`）、受控禁用 AI 容器（`.ld-ai-disabled-box`）、3D 静态占位槽（`.ld-avatar-static-slot`）、失效固定提醒横幅（`.ld-home-warning-banner`）、个人资料未保存栏与离开拦截横幅（`.ld-profile-unsaved-bar` / `.ld-unsaved-leave-guard`）及 360px 移动端适配样式。
- `v0.2/apps/web/src/types.ts`：新增 `ProfileFieldRow`、`ProfileData`、`ProfileInput`、`HomePreferencesData`、`HomePreferencesInput`、`HomeWarning`、`HomeAchievementRow`、`HomeData`、`ConfigMutationKind`、`PersistedConfigDraft`、`PendingConfigMutationEnvelope`、`ConfigFormRuntimeState`、`PersistedProfileDraft`、`ProfileFormRuntimeState`、`AiDraftScope`、`PersistedAiDrafts`，并扩展 `CapabilitiesData` 阶段一能力标识。
- `v0.2/apps/web/src/storage.ts`：
  - 修复 **P1-02** 递归敏感键误判：区分结构级认证凭据键（`STRUCTURAL_SENSITIVE_KEY` / `ALWAYS_CREDENTIAL_KEY`）与用户业务字段值字典（`values`、`rawInputs`、`fieldValues`、`rawFieldInputs`）内的基本类型业务值。合法业务字段名 `session`、`token` 在记录草稿、个人资料草稿和待确认写回队列中正常保存；`login_secret`、`password` 及顶层结构中的 `session` / 嵌套对象仍严格拒写。
  - 实现 **P1-03** 配置创建与更新可靠性队列：`buildConfigDraftKey`、`loadConfigDraft`、`saveConfigDraft`、`clearConfigDraft`、`getPendingConfigMutation`、`savePendingConfigMutation`、`clearPendingConfigMutation`、`computeConfigPayloadSignature`、`prepareConfigMutationEnvelope`。
  - 实现个人资料草稿（`saveProfileDraft` / `loadProfileDraft` / `clearProfileDraft`）与受控禁用 AI 输入框本地草稿（`loadAiDraft` / `saveAiDraft` / `clearAiDraft`）。
- `v0.2/apps/web/src/api.ts`：对接 Codex 阶段一真实 API（`GET/PATCH /api/v1/profile`、`GET/PATCH /api/v1/home-preferences`、`GET /api/v1/home`），并在 `request()` 中校验幂等回执 `operation_id`、`version` 与核心字段完整性（回执异常归类为 `BAD_RECEIPT` 未知网络结果）。
- `v0.2/apps/web/src/state.ts`：扩展 `AppState`（`home`、`profile`、`homePreferences`、`configForm`、`profileForm`）与 `syncProfileFormFromServer`。
- `v0.2/apps/web/src/forms.ts`：新增配置创建表单实时草稿提取（`extractConfigFormDraft`）、个人资料表单提取（`extractProfileFormToState`）、受控禁用 AI 输入框实时草稿保存，以及重绘焦点快照保持。
- `v0.2/apps/web/src/modals.ts`：为全部 5 类配置创建弹窗（`create-task`、`create-metric`、`create-achievement`、`create-module`、`create-template`）接入 `resolveConfigModalContext` 与 `renderConfigSubmissionStatusPill`。
- `v0.2/apps/web/src/home-profile.ts`：新增平铺模块（无需修改 `scripts/build-web.mjs`），实现标准首页（`#ld-home-standard`）、极简模式首页（`#ld-home-minimal`）、受控禁用 AI 容器（`renderDisabledAiContainer`）与设置面板个人信息详情页（`#ld-profile-settings` / `#ld-form-profile`）。
- `v0.2/apps/web/src/panels.ts`：集成首页渲染、任务/数值面板固定与取消固定按钮、记录面板顶部受控禁用「与 AI 记录」容器、设置面板「个人信息详情」子标签及极简模式开关。
- `v0.2/apps/web/src/main.ts`：接入 `StaticAvatarRenderer` 生命周期管理（标准首页挂载、极简模式与非首页路由自动 `pause`/`dispose`）、个人资料未保存离开拦截与 `409 VERSION_CONFLICT` 基线采用、配置创建幂等提交 `submitConfigCreationReliably`、首页固定/排序/清理失效固定项及来源跳转。
- `v0.2/apps/web/tests/s0b-s1.test.ts`：保留原有 12 项 S0-B / S1 测试用例并新增 6 项 v0.2 第一阶段专项测试套件（`V02-P1-02` 至 `V02-P1-08`），共 18 个测试套件、134 项断言。
- `v0.2/apps/web/scripts/verify-browser.mjs`：更新宿主机真实浏览器冒烟脚本，覆盖标准首页、极简模式切换与刷新保持、记录页禁用 AI 框、设置页个人信息详情区及 360px 移动端底部导航。

## 2. 核心任务完成情况

1. **P1-02 合法业务字段名 `session` 误拦截修复**：
   - `hasSensitiveKey` 保持对 `login_secret`、`password`、`authorization`、`cookie`、`api_key` 等凭据键的全层级拦截，并保持对 DTO 顶层结构键 `session`/`token` 的拦截；
   - 在业务字段字典（`values`、`rawInputs`、`fieldValues`、`rawFieldInputs`）内部且值为原始类型（`string | number | boolean | null`）时允许 `session` 等合法业务字段名持久化。
2. **P1-03 配置创建与更新幂等恢复**：
   - 五类配置创建表单（模块、记录模板、任务、数值、成就）在打开时分配并持久化稳定 `entityId`，提交时通过 `prepareConfigMutationEnvelope` 冻结载荷与 `operation_id`；
   - 当响应丢失或网络中断进入 `unknown_network` 时，即使刷新页面或修改输入框，未确认操作继续复用原 `operation_id` 与冻结载荷，避免重复创建配置。
3. **P1-04 主页标准模式（`#ld-home-standard`）**：
   - 聚合展示个人摘要、最多 4 项固定/可用数值（严格区分 `computed.value === null` 的「暂无数据」与 `"0"` 的 `0`）、最多 5 项今日与固定去重任务、最多 3 项近期有效解锁成就（过滤 `needs_review`）；
   - 当固定引用指向已归档模块/已取消任务时展示 `#ld-home-pin-warnings`（`PIN_UNAVAILABLE`）及一键清理按钮 `data-action="home-clean-unavailable-pins"`；
   - 显式标注 `wallet = null` 与 `pinned_trends = []`，不伪造 0 余额或假趋势图；支持从首页跳回数值、任务、成就来源面板与证据详情。
4. **P1-05 极简模式（`#ld-home-minimal`）**：
   - 首页与设置页均提供极简模式切换按钮，通过 `PATCH /api/v1/home-preferences` 持久化 `minimal_mode`；
   - 开启后主内容区仅渲染居中的 `#ld-home-ai-box` 与退出按钮 `#ld-minimal-exit-btn`，隐藏形象槽位、个人摘要、数值、趋势、任务与成就卡片，并自动暂停/卸载 `AvatarRendererPort`；切回标准模式后原固定顺序与本地 AI 草稿完整保留。
5. **P1-06 & P1-07 个人信息详情页与字段边界（`#ld-profile-settings`）**：
   - 支持编辑 `nickname`、`bio`（含勾选设为 `null` 清空）、`timezone`（IANA 时区），以及在四个默认模块和自定义启用模块下新增、编辑、删除 7 类 `kind = "profile"` 字段（`text`、`textarea`、`integer`、`decimal`、`date`、`boolean`、`single_select`）；
   - 未保存修改切换路由或子标签时弹出 `#ld-profile-leave-confirm` 离开确认横幅（支持继续编辑或放弃修改离开）；
   - 发生 `409 VERSION_CONFLICT` 时保留当前未保存输入，展示服务端最新基线 `details.current` 并提供 `data-action="profile-conflict-adopt"` 显式采用新基线；
   - 设有 `[data-profile-boundary="observation-derived-disabled"]` 卡片，明示第一阶段不支持直接手改 `observation` / `derived` 统计值。
6. **P1-08 受控禁用 AI 容器与 3D 静态占位契约**：
   - 首页 `#ld-home-ai-box` 与记录页 `#ld-records-ai-box` 发送按钮均处于 `disabled` 状态，明示 `AI 将在 v0.3 开放`，输入内容独立保存在本地浏览器；
   - `StaticAvatarRenderer` 实现 `mount`、`update`、`pause`、`dispose`、`on('ready' | 'error' | 'interaction')`，支持 `reduced_motion` 降级与非白名单动作回退 `idle`，且 `network_requests === 0`。

## 3. 供 DeepSeek 验收的稳定页面定位器（Selectors）

- **主页（标准模式 / 极简模式）**：
  - 标准首页主容器：`#ld-home-standard`（`data-home-mode="standard"`）
  - 极简首页主容器：`#ld-home-minimal`（`data-home-mode="minimal"`）
  - 极简模式切换按钮：`#ld-home-minimal-toggle-btn`、极简内退出按钮 `#ld-minimal-exit-btn`、设置页切换按钮 `#ld-settings-minimal-toggle-btn`（均带 `data-action="toggle-minimal-mode"`）
  - 失效固定提醒横幅：`#ld-home-pin-warnings`、一键清理按钮 `[data-action="home-clean-unavailable-pins"]`
  - 首页区块：`#ld-home-metrics`、`#ld-home-trends`、`#ld-home-profile-summary`、`#ld-home-tasks`、`#ld-home-achievements`
  - 首页卡片与操作：`[data-home-metric-card="<id>"]`、`[data-home-task-card="<id>"]`、`[data-home-achievement-card="<id>"]`、固定切换 `[data-action="home-toggle-pin-metric"]` / `[data-action="home-toggle-pin-task"]`、排序 `[data-action="home-move-pin-metric"]` / `[data-action="home-move-pin-task"]`、来源跳转 `[data-action="home-metric-detail"]` / `[data-action="home-task-detail"]` / `[data-action="home-achievement-detail"]`
- **受控禁用 AI 容器与 3D 静态槽位**：
  - 首页 AI 容器：`#ld-home-ai-box`、输入框 `#ld-home-ai-input`、禁用发送按钮 `#ld-home-ai-send-btn[disabled]`
  - 记录页 AI 容器：`#ld-records-ai-box`、输入框 `#ld-records-ai-input`、禁用发送按钮 `#ld-records-ai-send-btn[disabled]`
  - 3D 静态形象槽位：`#ld-home-avatar-slot`（挂载后带 `data-avatar-renderer="static"`、`data-avatar-mounted="true"`、`data-model-asset-ref="null"`）
- **设置面板个人信息详情与配置创建状态**：
  - 个人信息详情子标签按钮：`[data-action="panel-subtab"][data-subtab="profile"]`
  - 个人信息详情容器：`#ld-profile-settings`、表单 `#ld-form-profile`、状态栏 `#ld-profile-status-bar`
  - 基础字段：`#ld-profile-nickname`、`#ld-profile-timezone`、`#ld-profile-bio`、`#ld-profile-bio-null`
  - 模块字段行：`[data-profile-field-row]`、新增字段按钮 `[data-action="profile-add-field"]`、删除字段按钮 `[data-action="profile-remove-field"]`、保存按钮 `#ld-profile-save-btn`
  - 未保存离开提醒横幅：`#ld-profile-leave-confirm`（继续编辑 `[data-action="profile-stay"]`、放弃并离开 `[data-action="profile-discard-and-leave"]`）
  - 409 冲突面板：`[data-conflict-code="VERSION_CONFLICT"]`、拉取最新 `[data-action="profile-conflict-pull"]`、采用新基线 `[data-action="profile-conflict-adopt"]`
  - 配置创建状态条：`[data-config-submission-status]`、提交按钮 `#ld-config-submit-btn`

## 4. 验证结果摘要

1. **TypeScript 严格类型检查（TypeScript 5.9.3 `strict: true`）**：`PASS (0 errors)`
2. **Web 构建（`packages/ui/dist` + `apps/web/dist`）**：
   - `packages/ui/dist`：生成 4 个 ES Module 文件
   - `apps/web/dist`：生成 11 个 ES Module 文件（含 `home-profile.js` 与 `app.js` 入口），`../../../packages/ui/src/index.js` 导入全部重写为 `/packages/ui/dist/index.js`
3. **Web 逻辑与渲染验证套件（`apps/web/tests/s0b-s1.test.ts`）**：
   - 既有回归套件：`S0-B-01` ~ `S0-B-08`、`S1-01` ~ `S1-04`（12/12 PASS）
   - v0.2 第一阶段新增套件：`V02-P1-02`、`V02-P1-03`、`V02-P1-04`、`V02-P1-05`、`V02-P1-06`、`V02-P1-08`（6/6 PASS）
   - 汇总：**18/18 测试套件通过，共 134 项断言全部通过**
   - 报告产物：`v0.2/.runtime/test-artifacts/stage2-web/s0b-s1-verification-report.json`

## 5. 契约对齐与未完成项说明

- **契约对齐**：已核对 Codex 在 `v02/phase1-codex`（提交 `4ecd665`）落地的 `/api/v1/profile`、`/api/v1/home-preferences`、`/api/v1/home` 与 `/api/v1/capabilities` 实现，请求方法（`GET` / `PATCH`）、`Idempotency-Key` 与 `operation_id` 回执、`base_version` 乐观锁、`409 VERSION_CONFLICT` 的 `details.current` 结构及 `PIN_UNAVAILABLE` 警告格式完全一致。
- **未完成项**：无（本阶段不开放真实 AI 对话/记录解析、不开放趋势折线引擎、不开放代币账本与 3D 模型下载，均已按契约实现受控静态/禁用状态）。
