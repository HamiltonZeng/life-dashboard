# 2026-10-19 DeepSeek 开发日志：T2/T3 AI 生成、统一入口与前端联调

## 1. 依据与职责

- **用户授权**：阅读 `design/` 文档与 `log/` 日志，完成本阶段开发，开发日志存入 `log/`；Docker 容器已运行。
- **采用顺序**：本地开发与 Agent 协作规划 → 产品设计文档 v0.2 → 蓝图 Schema 1.0 与样例 → 技术架构参考 → PRD 背景。
- **前置交付**：`log/2026-10-19_codex_T0-T1.md` 的 T0/T1 后端（契约 0.1.0）与 `log/2026-10-19_gemini_T1-web.md` 的 T1 前端已存在，但统一入口尚未接入、T2/T3 尚未实现。
- **本阶段范围（T2 的 AI 相关部分 + T3）**：模块蓝图 1.0 的五层校验、DeepSeek/mock 适配层、生成任务生命周期、原子应用、幂等重放、受控重试/取消、批次撤销、按周期成就；把前端纳入 Caddy 统一入口并接入 AI 生成界面；补充单元与 PostgreSQL 集成测试。
- **协作方式**：本会话由 Lead（DeepSeek Harness）担任集成与后端/AI 实现；`web-integrator` 在其独占目录内完成统一入口与 AI UI（`apps/web`、`packages/ui`、`compose.yaml`、Caddy、启动脚本）；`verifier` 只读独立复核。三方写作用域不重叠。
- **未修改**：`design/` 文档；`pnpm-lock.yaml` 与依赖清单（未新增依赖）；主数据库既有用户事实；`.secrets` 内容。
- **未调用真实 DeepSeek**：默认 `AI_PROVIDER=mock`，全程无 API Key、无付费请求、无真实模型响应。真实适配器已实现，但尚未用真实账号验收。

## 2. 数据模型与迁移

新增 `packages/db/migrations/0002_ai.sql`（主库已应用；测试库每次重建）：

- `ai_generation_jobs`：生成请求、幂等键、状态机、目标模块/基准版本、provider/model、候选蓝图、五层校验结果、warnings、错误、attempts、usage、时间戳。唯一 `(user_id, operation_id)` 保证同一生成请求只建一个任务；`(user_id, id)` 支持按用户隔离查询。
- `ai_generation_batches`：应用批次、模块创建标记、基准版本、`local_ref → 正式 ID` 映射、objects 列表、撤销状态与方式。唯一 `(user_id, job_id)` 保证同一生成结果只应用一次。
- `metric_definitions.archived_at`、`achievement_definitions.archived_at`：撤销已引用批次时停用定义但保留历史；活动快照查询自动过滤。
- 批次 `module_id` 外键使用 `ON DELETE SET NULL (module_id)`，使“无引用撤销”可物理删除 AI 新建模块，同时保留批次审计行；生成任务的 `module_id` 仍为普通外键。

## 3. `packages/ai` 实现

### 3.1 蓝图结构（`blueprint.ts`）

- 按 `design/人生面板_AI模块蓝图.schema.json` 实现 Zod 严格结构：版本/kind 常量、module/record_types/metrics/tasks/achievements/warnings、未知字段拒绝、引用格式、数组上限、枚举、日期与数值边界。
- JSON 提取只接受一个完整对象，可容忍 Markdown 围栏，拒绝夹杂散文或截断输出。

### 3.2 五层校验（`validate.ts`）

1. **解析**：完整 JSON、单对象、未截断。
2. **结构**：版本、字段类型、必填、枚举、边界、未知字段（`records`、`completed`、`unlocked`、`user_id` 等一律拒绝）。
3. **语义**：local 引用存在且全包唯一；`id:` 引用必须在允许清单；模板字段 key/选项/边界；数值聚合与字段单位一致；`count` 不得引用数值字段；任务完成方式与验收规则匹配、门槛在字段边界内；周期规则；`per_period` 成就不得引用 `all_time` 数值。
4. **权限与版本**：目标模块存在/启用、create/extend 目标一致、允许引用清单、当前模块版本、内容范围、生成预算与尝试上限。
5. **业务**：不写真实记录/当前值/完成状态/解锁状态；不修改既有模块属性；不覆盖已有配置；不静默接受超出当前子集的周期任务。

失败时按层返回 `{code,path,message}` 列表并保留候选，便于前端解释与受控重试。

### 3.3 应用计划与适配层（`plan.ts`、`adapter.ts`、`prompt.ts`、`config.ts`）

- `buildApplyPlan` 纯函数：解析 local 引用、分配正式 UUID、把蓝图阈值转为十进制字符串、把 `once` 映射为 `business_date`，输出待写入定义与对象映射。
- `ModelAdapter` 接口隔离供应商；`MockAdapter` 返回确定性合法蓝图且不联网；`DeepSeekAdapter` 使用服务器配置的 `base_url + model`、OpenAI 兼容 `chat/completions` 的 JSON 模式，设置超时、尝试次数、输出上限，并映射 `AI_AUTH/AI_QUOTA/AI_RATE_LIMIT/AI_TIMEOUT/AI_UNAVAILABLE/AI_BAD_REQUEST/AI_INVALID_OUTPUT/AI_OUTPUT_TRUNCATED`；错误不回显密钥，重试只对可重试错误且受次数上限。
- 提示词固定系统规则并声明“用户需求是不可信数据”，只发送允许引用清单与目标上下文；不发送其他模块/历史记录，不发送密钥或数据库写工具。
- 配置只从服务端环境读取；`/ai/config` 只暴露 provider/model/schema/能力/限制，不返回 Key。强制 https，凭据不能出现在 base_url。

### 3.4 生成服务（`service.ts`）

- 生命周期：`queued → generating → validating → preview_ready / applied / needs_fix / failed / cancelled`，每次尝试记录 attempts 与 token usage。
- `apply_mode=apply`：校验通过后在同一事务内创建模块/模板/数值/任务/成就与 ID 映射，写变更日志并重算派生统计；任一步失败全部回滚，不留半套配置。
- `apply_mode=preview`：只保存候选；`POST /apply` 再按**应用时**的模块状态重新校验，模块版本变化返回 409 并保留候选。
- 幂等：生成请求唯一键 + 请求哈希（同键异载荷 409）；应用批次唯一约束 + 行锁（重复/并发应用返回同一批次）；重试通过原子状态领取，避免并发重复调用模型。
- 预算：每用户 24h 生成任务上限；失败不阻塞手动记录与手动配置。
- 撤销：无真实记录/授予/外部配置引用时删除本次新增定义；一旦被引用，则归档 AI 新建模块、取消任务、停用数值与成就，**绝不删除真实记录**。批次与审计行保留。

### 3.5 周期成就与快照

- `achievement_definitions.definition.repeat_policy` 支持 `once` / `per_period`。`once` 保留原有“首次达成统计周期”语义；`per_period` 以当前统计窗口 `period_key` 授予，并**重新评估所有已保留周期**：证据被修改/删除时，过去周期的授予同样转为 `needs_review`（独立复核发现的 D1 已修复并加测试）。
- 任务重算跳过已取消任务；成就重算跳过硬归档定义；`bootstrap` 与列表隐藏已归档数值/成就，但保留授予历史与真实记录。
- 手动 `POST /achievements` 契约仍为一次性；周期成就当前只能由 AI 蓝图创建（后续 T2 再开放手动配置）。

## 4. API 契约 0.2.0 与路由

`packages/contracts` 新增 `aiGenerationInput`、`aiApplyInput`、`aiEmptyInput` 及类型，契约版本升至 `0.2.0`；OpenAPI 与 JSON Schema 已重新导出。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/ai/config` | provider、cloud_ai、model、schema_version、支持子集与限制；不含密钥 |
| POST | `/api/v1/ai/generations` | 发起生成（需会话、Origin、Idempotency-Key）；apply 原子应用，preview 保留候选 |
| GET | `/api/v1/ai/generations`、`/{id}` | 列表（不含候选）/详情（含候选、校验与批次） |
| POST | `/api/v1/ai/generations/{id}/apply` | 应用 preview 候选；重复应用返回同一批次 |
| POST | `/api/v1/ai/generations/{id}/retry` | 受次数/预算限制的重新生成 |
| POST | `/api/v1/ai/generations/{id}/cancel` | 取消未应用候选 |
| GET | `/api/v1/ai/batches`、`/{id}` | 批次与 ID 映射 |
| POST | `/api/v1/ai/batches/{id}/revoke` | 删除无引用定义，或归档/停用有引用配置 |

`/capabilities` 新增 `ai_generation=true`、`ai_provider`、`ai_schema_version`、`ai_preview=true`，`cloud_ai` 仅在真实 DeepSeek 已配置时为 true；本阶段返回 `stage=T2/T3-ai`。

## 5. 统一入口与前端

- `compose.yaml` 新增 `web` 服务（构建后运行同域静态/代理服务器），`gateway` 依赖 web；`infra/gateway/Caddyfile` 将 `/api/*`、`/health/*` 转给 api，其余转给 web；`scripts/start.sh` 同时拉起 `api web gateway`。
- `scripts/build-web.mjs` 用 TypeScript compiler API 从源码可复现构建 `packages/ui/dist` 与 `apps/web/dist`（改写浏览器 import），dist 仍被 gitignore；`web` 容器启动时自动构建。
- 前端新增 AI 配置/任务/批次类型与客户端、设置面板实时配置与最近任务、create/extend 生成弹窗（内容类型、提示词、apply/preview、引用清单、时区）、候选/校验错误/warnings/批次摘要、预览应用、撤销、重试/取消；任务/数值/成就面板与设置提供入口。mock 被明确标注为“本地确定性模拟供应商”，不接触 Key，不写 localStorage/sessionStorage。
- 「AI 复盘」子视图保持明确未实现，不伪造报告。

## 6. 验证结果

所有命令均在 `/Users/zhk/life_dashboard/v0.1` 执行，项目工具链在 Docker 容器内。

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 类型检查 | `docker compose run --rm tools corepack pnpm typecheck` | 通过（0 错误，含前后端与测试） |
| 单元测试 | `docker compose run --rm tools corepack pnpm test` | 16/16 通过（蓝图结构/语义/权限、设计样例校验和、mock 边界、计划映射、配置、既有领域规则） |
| PostgreSQL 集成 | `docker compose --profile test run --rm test` | 2 个测试文件、33 个 `✔`、0 失败；AI 子测试 16 项 + 既有 T0/T1 验收 15 项 |
| 契约导出 | `docker compose run --rm tools corepack pnpm contracts:export` | 成功；OpenAPI 含 9 条 AI 路径，schema 含 `AiGenerationInput`/`AiApplyInput` |
| 前端构建 | `docker compose run --rm tools corepack pnpm build:web` | 成功：ui 4 文件、web 5 文件、app.js 入口 |
| 依赖审计 | `docker compose run --rm tools corepack pnpm audit --prod` | No known vulnerabilities found |
| 统一入口 | `curl` 六个页面路由、两个 JS 资源、`/health/ready` | 全部 200 且 content-type 正确；未登录 `/api/v1/me`、`/api/v1/ai/config` 均 401 |
| 真实 HTTP 闭环 | 经 `http://localhost:18080` 登录（口令未回显）→ mock 生成 apply → 撤销 | 生成前 4 模块/0 记录；应用后 5 模块/5 模板/2 数值/1 任务/2 成就/0 记录；撤销后恢复 4 模块/0 记录；重复应用返回同一批次 |
| 浏览器 E2E | 无头 Edge + CDP 访问统一入口（`web-integrator` 当次执行；脚本未纳入仓库，属可复现性缺口） | 27/27 通过：登录、设置 AI 配置、preview→apply→bootstrap→revoke；另 5/5 负向路径：目标模块被归档后应用，服务端 409 在界面可见且无假候选 |
| 幂等/冲突 | 集成测试覆盖 | 同键同载荷复用任务；同键异载荷 409；重复/并发应用单批次；模块版本变化 409 并保留候选 |
| 无事实/无泄漏 | bootstrap 与 SQL 检查、`grep`/`git check-ignore` | 主库最终 4 模块/4 模板/0 任务/0 记录/0 AI 任务/0 批次；源码与 bundle 无 Key；`.secrets` 与 dist 均被忽略 |
| 独立复核 | `verifier` 只读复核（详见第 8 节） | 首轮通过，提出 1 个 MEDIUM + 5 个 LOW；D1-D4 修复后复核 PASS，D2 残余边界已补修并复测 |

**验收项映射（产品设计 §15）**：

| 编号 | 证据 |
| --- | --- |
| P12 | 集成测试 `apply creates the whole blueprint atomically…`；真实 HTTP 闭环；浏览器 E2E |
| P13 | 集成测试 `model output with unknown references is rejected without partial writes`（422、无残留、候选保留） |
| P14 | 集成测试 `model output with factual or privileged fields is rejected`（`records`、`unlocked` 等被结构层拒绝） |
| P15 | 集成测试 `repeated apply is idempotent: one batch, no duplicate configuration` |
| P16 | 集成测试 `module version changes keep the candidate and refuse a stale apply`（409 + needs_fix） |
| P17 | 集成测试 `revoking a referenced batch archives configuration but keeps real records` |
| P18 | 集成测试 `provider failures are explicit and manual features keep working`（503/明确错误码，手动记录可用） |
| P21 | 集成测试与 `tests/ai/design-example.json`（与 `design/人生面板_AI模块蓝图.example.json` 字节一致、SHA-256 固定）创建模块/模板/数值/任务/成就与引用链，不自动写入任何现实事实 |

## 7. 已知边界与限制

- **同步生成**：本阶段在请求内完成（受 15s API 超时与 6s×2 模型超时约束），尚未接入 pg-boss worker、排队恢复与后台取消；进程崩溃可能留下 `generating` 状态，重试领取对超过 2 分钟的陈旧任务做了恢复。
- **真实 DeepSeek 未验收**：适配器按 Chat Completions JSON 模式实现；本次没有真实 Key，因此模型兼容性、费用、限流与真实错误分布均未实测。`cloud_ai=false` 如实反映。
- **周期任务未实现**：蓝图中的 `daily/weekly` 任务会被明确拒绝；`once` 可映射为单日任务实例。周期调度属 T2 剩余。
- **手动周期成就未开放**：周期成就仅由蓝图创建；前端成就面板当前按定义展示，多个周期授予的完整列表仍待 UI 完善。
- **撤销语义**：已被真实记录/授予/外部配置引用时使用归档/停用而非删除；归档定义从活动列表隐藏，授予历史与真实记录保留。
- **前端 E2E 边界**：浏览器验收覆盖桌面 Chromium 内核；手机 PWA、离线、HTTPS 与多设备同步属 T4，未在本轮宣称。
- **主库验证痕迹**：验证过程对默认模块“学习与发展”做过归档/恢复，模块版本因此为 3（状态 enabled，无数据丢失）；AI 任务/批次验证行已从主库清理，恢复为 4 模块/4 模板/0 任务/0 记录。未创建任何真实记录、完成状态或成就授予。
- **未创建 Git 提交**：仓库仍未提交；本轮只改工作区文件。

## 8. 独立复核

`verifier` 在只读边界内独立完成命令、网关、真实 HTTP、对抗检查与代码走查，结论为“本阶段可接受，但 D1 的 P08 缺口应先修复或明确记录”。发现与处理：

| 编号 | 级别 | 发现 | 处理 |
| --- | --- | --- | --- |
| D1 | MEDIUM | 按周期成就只复核当前周期；过去周期授予在证据被删除后仍保持 `unlocked` | 已修复：`recompute` 重新评估所有已保留周期（以 `original_evidence.evaluated_at` 还原周期），新增集成测试 `deleting evidence re-evaluates past-period achievements (P08/D1)` |
| D2 | LOW | mock 对无单位数值字段生成 sum 指标（单位不匹配）、对 `minimum>10` 的字段生成越界门槛 | 已修复：无单位字段只生成 count 指标；门槛夹在字段 `[minimum, maximum]` 内；新增单元测试 |
| D3 | LOW | 外部成就引用 AI 批次数值时，撤销后外部成就仍启用而来源数值被归档 | 已修复：归档路径同时归档引用批次数值的外部成就；`recompute` 跳过已归档数值；P17 集成测试增加断言 |
| D4 | LOW | 同一幂等键重放一个已取消/失败的生成任务时仍返回 `already_applied=true` | 已修复：只有已存在应用批次时 `already_applied` 才为 true；取消/失败重放返回 false |
| D5 | LOW | README 指向的本日志当时尚未写入 | 已随本日志交付解决 |
| D6 | LOW | 历史 Gemini 日志中的部分表述（“P20 已验收”“P01~P11 单测全部通过”）在仓库中没有对应测试文件 | 不改写历史日志；本轮交付与 README 不依赖这些表述，本日志如实区分“前端已有视图”与“仓库可复现测试” |

复核同时指出：P16 的“生成期间模块被归档”子场景、P18 的“同步仍可用”、P12 的“首页仍空白”自动化断言存在证据缺口。处理：P16 归档子场景已补集成测试；P18 的同步能力本阶段明确为 `sync:false`，不宣称支持；P12/P01 的首页空白由前端 E2E 与既有 P01 验收覆盖，不由后端集成测试伪称。复核确认未发现密钥泄漏、跨用户泄漏、幂等漏洞或撤销删除真实记录的问题。

**修复后复核（verifier 第二次只读复核）**：

| 复核项 | 结论 |
| --- | --- |
| D1 过去周期证据删除后复核 | PASS：verifier 用独立构造的“真实过去周期记录 + 证据”复现，证据未变时保持 `unlocked`，删除后 `needs_review`、`value=null`、版本递增 |
| D2 mock 单位/门槛 | 报告场景 PASS；复核又发现 `maximum=null 且 minimum>10` 的残余边界，Lead 已补修为取 `max(10, minimum)` 并增加 3 组单元用例，复测通过 |
| D3 外部成就悬挂 | PASS：代码 + P17 断言均确认随批次数值一起归档，且从活动列表消失 |
| D4 非已应用任务重放 | PASS：真实网关 preview→cancel→同键重放返回同一任务、`cancelled`、`batch=null`、`already_applied=false`；随后按任务 ID 清理，主库 AI 表回到 0/0 |
| P16 归档子场景 | PASS：新增断言“归档后应用旧候选返回 409 `MODULE_CONFLICT`” |
| P21 设计样例 | PASS：`tests/ai/design-example.json` 与 `design/` 原件逐字节一致（SHA-256 固定），单元测试直接加载并校验/计划 |
| 命令复跑 | PASS：typecheck 0 错误；单元 16/16；集成 33/33（AI 16 + T0/T1 15 + 2 父测试）；audit 无已知漏洞；build:web 成功 |
| 日志诚实性 | 复核认可实质结论；已修正 LOW 计数、D2 夹取表述、为未入库的浏览器 E2E 标注可复现性缺口，并补上本节复验结论 |

最终主库状态（复核结束）：4 模块 / 4 模板 / 0 任务 / 0 记录 / 0 数值 / 0 成就 / 0 授予 / 0 AI 任务 / 0 批次；默认模块“学习与发展”状态 enabled、版本 3（验证归档/恢复所致，已在 §7 披露）。

## 9. 下一阶段接手

- **T2 剩余**：完整配置编辑/模板迁移与依赖迁移工具、周期模板调度与实例生成（解除 `daily/weekly` 拒绝）、手动周期成就配置与成就面板多周期展示。
- **T3 剩余**：配置真实 `DEEPSEEK_API_KEY` 后做少量付费验收（记录模型、用量、费用、失败类型）、接入 worker 与预算/费用台账、真实模型不兼容时的降级路径。
- **T4/T5**：Better Auth、设备会话、离线 outbox、同步 push/pull/ack、手机可信 HTTPS；pg-boss、日报周报、备份恢复演练与发布验收。
- **交接文件**：`packages/ai/src/*`、`packages/db/migrations/0002_ai.sql`、`apps/api/src/app.ts`、`packages/contracts/*`、`tests/ai/*`、`tests/integration/ai.test.ts`、`scripts/build-web.mjs`、`compose.yaml`、`infra/gateway/Caddyfile`；说明见 `v0.1/README.md` 与 `packages/contracts/README.md`。
