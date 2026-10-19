# 2026-10-19 DeepSeek：S0/S1 集成收口与最小导出/恢复

## 1. 依据与职责

- **输入**：`log/2026-10-19_阶段一完整核验日志.md`（R1–R5 与 §8 维护风险）、`design/下一阶段开发计划与主页提案_v0.1.md`（S0–S5 批次与退出条件）、`log/2026-10-19_codex_S0-A_S0-C.md`（S0-A/S0-C 交付）、`log/2026-10-19_gemini_S0-B_S1-web.md`（S0-B/S1 前端交付，尚未提交）。
- **本轮职责**：Codex 与 Gemini 已完成各自任务卡，剩余工作属于集成负责人：把未提交的前端交付纳入基线、补齐 S0 的“一条命令复跑”和 S1 的“最小导出/恢复”、跑完整验收并建立新基线。DeepSeek 作为本会话集成/后端负责人完成这些工作；`web-finalizer` 在 `apps/web`/`packages/ui` 独占目录内完成可移植验证器、导出按钮与浏览器冒烟；`verifier-s1` 只读独立复核。三方写作用域不重叠。
- **未修改**：`design/` 历史设计、历史日志、数据库迁移（仍 0001/0002）、契约版本（仍 0.2.0）、`pnpm-lock.yaml`、`.secrets`；没有新增 npm 依赖，没有调用真实 DeepSeek，没有向主库写入事实。
- **未宣称**：真实浏览器 CI、手机实机、IndexedDB outbox、push/pull/ack、真实模型验收、自动备份或整版发布。

## 2. 接手时的实际状态与集成阻塞

阶段一核验后的状态：

- Codex 的 S0-A 已修复 R1–R5（批次筛选、原子配额、取消任务状态、归档引用、完整模型时限）并完成 S0-C ADR/基线提交 `e1c0bbe`；后端单元 21、集成 45。
- Gemini 的 S0-B/S1-web 已在工作区：前端拆分为 9 个平铺模块、本机草稿/提交状态/稳定 operation_id、11 套 61 断言、导出入口尚未有。但这些改动**未提交**，且存在实际集成问题：

| 阻塞 | 证据 | 处理 |
| --- | --- | --- |
| 根 `typecheck` 失败 | 前端测试夹具使用 `{kind:'exists',field_key:null,threshold:null}`，与契约 `{kind:'exists'}` 不符 | 改为合法字面量；`tsc --noEmit` 0 错误 |
| Web 验证器不可复跑 | `apps/web/scripts/verify-web.mjs` 实际是 Python 脚本，依赖 macOS JavaScriptCore；`node ./scripts/verify-web.mjs` 无法运行，也不能在 Docker 内运行 | 替换为 `apps/web/scripts/verify-web.ts`（tsx），删除 Python/JSC 文件，保留同一 JSON 报告路径与结果结构 |
| 包脚本与根脚本不一致 | `apps/web/package.json` `verify` 指向不可运行的脚本 | 改为 `tsx ./scripts/verify-web.ts`，根新增 `verify:web`、`verify:all` |
| S1 导出/恢复缺失 | 计划 S1 要求“最小导出/恢复、隔离环境恢复成功”，Codex 日志明确未交付 | 新增用户级导出、隔离恢复 CLI、`GET /api/v1/export`、集成测试与 ADR |
| S1 导出无用户入口 | 前端 S1 只做记录可靠性，没有导出按钮 | 设置 → 账户与数据新增诚实的“导出数据”（只导出，不在页面恢复） |
| 缺少统一验收命令 | 后端与前端各自有脚本，没有一条命令覆盖两端 | 新增 `scripts/verify-all.sh`：后端全套 + 前端套件 + 统一入口 HTTP 矩阵 |

## 3. 本轮实现

### 3.1 前端可移植验证与真实浏览器冒烟

- `apps/web/scripts/verify-web.ts`：Node/tsx 运行，直接导入 `runAllWebVerificationTests()`，输出逐套 PASS/FAIL、断言总数，写 `.runtime/test-artifacts/stage2-web/s0b-s1-verification-report.json`，失败退非零。无 Python、无 macOS JSC、无新依赖。
- 结果为 **12/12 套、73 条断言**：原 11 套/61 条全部保留，新增 S1-04（11 条）覆盖设置面板导出入口、文件名时区、导出载荷格式/校验和/迁移信息、无登录口令、无页面恢复入口、成功/失败反馈；S1-01 增加 1 条回归：业务笔记文本包含 `login_secret` 字样仍可持久化，只有敏感字段名被拒绝。
- `apps/web/scripts/verify-browser.mjs`：host-side 真实浏览器冒烟（Node 24 内置 fetch + WebSocket CDP，零依赖；本机无浏览器时 SKIP）。覆盖登录页、Cookie 登录、空白首页、任务面板、设置 AI 区、360px 底部导航、无未捕获错误、真实点击“导出数据”并校验下载文件。**明确不属于 Docker/CI**，文档单独说明。

### 3.2 S1 最小导出/恢复

新增 `packages/db/src/backup.ts`、`GET /api/v1/export`、`scripts/export-data.ts`、`scripts/restore-data.ts`、`tests/integration/export-restore.test.ts`、[ADR 0002](docs/adr/0002-minimal-export-restore.md)。

- **导出**：白名单表/列；`format=life-dashboard-user-export`、`schema_version=1`、`contract_version`、`exported_at`、`user`、`cursor`、迁移清单、各表行数、SHA-256 校验和。覆盖模块、模板、任务模板/实例、记录（含软删除墓碑与修订）、数值、成就、授予、同步游标、变更日志、幂等回执；**不含**会话/凭据、AI 生成任务与批次审计。读事务为 `REPEATABLE READ READ ONLY`；日期/大整数在计算校验和前规范化为 JSON 值。
- **恢复**：只接受空的、迁移清单完全一致的目标库；单事务、咨询锁；校验格式/版本/校验和/行数；主键、外键、计数任一失败整体回滚；会话不恢复，恢复后重新登录。恢复保留墓碑、修订、`change_log` 与 `mutation_receipts`，避免恢复后旧幂等键重复记账。
- **CLI 安全边界**：`export:data` 默认写 `.runtime/backups/life-dashboard-<时间>.json`（0600）；`restore:data` 默认拒绝 `life_dashboard` 开发库，必须 `--allow-development` 显式覆盖。
- **前端**：设置 →「账户与数据」提供“⭳ 导出数据”，校验最小响应形状后下载完整 envelope，文件名按用户时区 `life-dashboard-YYYY-MM-DD.json`，展示校验和前缀与表/行计数；401 引导重新登录；不提供页面恢复，不在 localStorage/日志中保存导出内容或会话。
- **契约**：`GET /export` 加入 OpenAPI 与 [contracts README](packages/contracts/README.md)；`/capabilities` 增加 `user_export:true`、`user_restore:'cli'`。契约版本保持 0.2.0（附加只读端点，无既有请求变更）。

### 3.3 验收编排

- 新增 `scripts/verify-all.sh`：`verify-backend.sh`（typecheck/unit/build/contracts/audit/隔离 PostgreSQL 集成）+ `pnpm verify:web` + 统一入口页面/资源/健康/未登录边界检查。
- 根 `package.json` 新增 `export:data`、`restore:data`、`verify:web`、`verify:all`；`apps/web/package.json` `verify` 可运行。

## 4. 验证结果

| 验证 | 命令 / 方式 | 结果 |
| --- | --- | --- |
| 全量验收 | `cd v0.1 && sh scripts/verify-all.sh` | **exit 0** |
| 类型检查 | 同上 `tsc --noEmit` | 0 错误 |
| 单元 | `pnpm test` | **21/21** |
| PostgreSQL 集成 | `pnpm test:integration`（隔离 postgres-test） | **52/52**（4 父测试；含 T0/T1、AI、S0-A R1–R5、S1 导出/恢复） |
| 前端套件（Docker） | `pnpm verify:web` | **12/12 套、73 断言** |
| 前端构建 | `pnpm build:web` | UI 4 文件、Web 10 文件、app.js 入口 |
| 契约导出 | `pnpm contracts:export` | 成功；OpenAPI 含 `/api/v1/export` |
| 依赖审计 | `pnpm audit --prod` | No known vulnerabilities found |
| 统一入口 HTTP | `/` 六页面、两个 JS 资源、`/health/ready` | 全部 200（`verify-all` 断言状态码并记录 content-type；真实浏览器冒烟另验渲染）；未登录 `/api/v1/me`、`/api/v1/export` 401；证据写入 `.runtime/test-artifacts/stage2-final/http.log` |
| 真实浏览器冒烟（host） | `node apps/web/scripts/verify-browser.mjs` | **9/9** headless Edge；真实导出下载 49,793 B，format/checksum/data 校验通过；无页面错误 |
| CLI 导出/恢复 | 主库只读导出 → 独立 `life_dashboard_restore_verify` 建库、迁移、恢复、比对、删除 | 导出 50,814 B、权限 0600、cursor=46；恢复后 `modules=4, record_types=4, users=1, ai_jobs=0, sessions=0`；临时库与备份文件已删除 |
| 恢复反例 | 集成测试 | 非空目标、校验和被篡改、迁移清单不一致、外键失败均被拒绝；失败后目标保持空、整体回滚；恢复后再次导出与原数据一致 |
| 密钥与路径 | grep / `git check-ignore` | 源码与 bundle 无 Key/会话；`.secrets`、`.runtime`、`dist` 均被忽略；备份 0600 |
| 主库事实状态 | 只读 SQL | 4 模块 / 4 模板 / 0 任务 / 0 记录 / 0 数值 / 0 成就 / 0 授予 / 0 AI 任务 / 0 批次；模块“学习与发展”版本沿用历史验证痕迹（enabled） |

**S0/S1 退出条件映射**：

| 条件 | 证据 | 结论 |
| --- | --- | --- |
| S0-A R1–R5 回归 | `tests/integration/stage2-boundaries.test.ts`、`tests/ai/adapter-deadline.test.ts`；集成 52/52 | 通过 |
| S0-B 关键 UI 一条命令复跑 | `pnpm verify:web` 12/12；host 浏览器冒烟 9/9（单独命令） | Docker 内可复跑；真实浏览器为 host-side，未纳入 CI |
| S0-C 基线/架构 | ADR 0001、验证脚本、契约/README；本日志随新基线提交 | 通过 |
| S1 草稿与提交状态 | 前端 11+1 套（S1-01..S1-04）；`verify-web` 全通过 | 通过（DOM-less 渲染/存储层） |
| S1 未知网络复用 operation_id | S1-02/S1-03 | 通过 |
| S1 最小导出/恢复、隔离恢复 | 集成 S1 测试 + CLI 独立库演练 | 通过；恢复是 CLI，非页面功能 |
| S1 真实手机/离线 | 未实现 | 属 S2，不宣称 |

## 5. 已知限制

- 前端套件是 Docker 内可复跑的 **DOM-less 渲染/存储逻辑验证**；真实浏览器冒烟必须宿主机运行，仓库没有浏览器 CI 或固定数据环境。手机实机、软键盘、安全区与 PWA 仍属 S2。
- S1 只做本机草稿与稳定提交；IndexedDB outbox、设备身份、push/pull/ack、冲突合并、可信手机 HTTPS 未实现。
- 导出/恢复是**人工**能力：单文件、全量、无流式/增量；恢复要求空库与完全一致的迁移，不提供页面恢复，不做多端合并；自动备份、保留期限、异机副本、恢复演练与告警仍属 T5。备份文件含个人记录，需用户自行保管。
- 恢复不包含会话；恢复后需重新登录。AI 生成任务/批次审计不在备份内；相应定义与事实会恢复，但历史生成审计丢失。
- 主库存在历史验证遗留：模块“学习与发展”版本为 3、`change_log`/`mutation_receipts` 有验证痕迹、sessions 为测试登录；均非真实事实，未在日志中伪称干净数据库。
- 契约仍为 0.2.0；`/export` 是附加只读端点，前端未据此提升能力声明。
- 真实 DeepSeek、后台 worker、周期任务、日报周报与专业领域仍属 S3/S4/S5。

## 6. 独立复核

`verifier-s1` 只读复核结论 **PASS**（3 项 LOW，无阻断性安全问题）。复核范围与证据：

- **全量命令**：`sh scripts/verify-all.sh` exit 0；typecheck 0、unit 21/21、integration 52/52、web 12/12（当时 72，复核后 73）、build/contracts/audit/HTTP 均通过。
- **真实浏览器**：宿主侧 `node apps/web/scripts/verify-browser.mjs` 9/9；确认脚本与文档均标注“仅宿主侧、非 Docker/CI”。
- **导出/恢复**：未登录 `/export` 401；跨用户隔离、白名单排除会话/凭据/AI 审计；独立建 4 个隔离库复测篡改校验和、非空目标、迁移不符、外键失败均拒绝且回滚；恢复后再导出与原件逐字段一致；墓碑/修订/回执/游标保留；备份新建 0600；拒绝开发库分支有效。
- **集成正确性**：typecheck 0；运行器纯 Node/tsx；无 Python/JSC 残留；无新依赖/lockfile 变更；dist/.runtime/.secrets 忽略；导出 UI 全转义且不落 localStorage；bundle 无真实密钥。
- **退出条件**：S0-A R1–R5 PASS；S0-B 一条命令套件 PASS，但“真实浏览器 + 独立数据环境 + CI”整体 PARTIAL（host 冒烟非 CI、跑开发数据）；S1 导出/隔离恢复 PASS，S1 草稿/稳定 operation_id 仅按 DOM-less 口径 PARTIAL；文档未夸大真实浏览器 CI、真实 DeepSeek、完整同步或整版发布。

复核指出的 3 项 LOW 已在本轮修复并重跑：

| 发现 | 修复 |
| --- | --- |
| 草稿持久化用整串文本包含 `login_secret` 判断，会把含该词的正常笔记静默拒存 | 改为只检查结构键名（`login_secret/password/token/session/...`），新增 S1-01 回归断言业务文本仍可持久化 |
| `export-data.ts` 覆盖已存在文件时 `writeFileSync` 不改变旧权限，0600 非绝对 | 写入后显式 `chmodSync(out,0o600)`；已用 0644 旧文件实测覆盖后为 600 |
| host 浏览器冒烟的 SKIP 被计入 9/9 通过 | 汇总区分 executed/skipped，SKIP 单独打印，不计入通过数 |

同时处理复核 INFO：删除 `stage2-web/` 中旧 Python/JSC 运行器残留（`jsc_driver.js`、`jsc_test_runner.js`、`ts_sources.json`）；`verify-all.sh` 将 HTTP 证据写入 `.runtime/test-artifacts/stage2-final/http.log`；ADR 0002 状态改为“S1 导出/恢复部分已交付”。

复核指出的其余边界（不修改实现，已记录）：checksum 是无密钥 SHA-256，只能防误改/损坏、不防对抗性重算；导出全量入内存、恢复逐行 INSERT、浏览器 Blob 无上限/流式；恢复库名白名单依赖 `test/restore/verify` 命名纪律；契约导出会重写 `openapi.json` 但没有 diff 门禁；浏览器冒烟会在开发库留下 session 记录。以上均不阻断本阶段，分别归入 S2 同步/大数据优化、T5 备份运维与后续 CI 建设。

修复后重跑：typecheck 0；unit 21/21；integration 52/52；web 12/12（73 断言）；host 浏览器 9/9；`verify-all.sh` exit 0。

## 7. 基线与交接

- 上一基线：`e1c0bbe Establish v0.1 baseline with S0 backend boundary fixes`。
- 本轮在前端 S0-B/S1、S1 导出/恢复、验证器与文档全部通过后创建新基线提交；提交不包含 `.secrets`、`.runtime`、`dist`、`node_modules`。具体 hash 以 `git log -1` 为准。
- 下一阶段建议：S2 先完成“一条记录在手机断网→恢复→电脑可见”的最小闭环（PWA 缓存外壳、IndexedDB outbox、设备 push/pull/ack、显式冲突与可信 HTTPS），不要在 S2 同时重写前端框架；S3 再处理后台 worker、额度/费用台账与真实 DeepSeek 小样本验收。
- 主要交付文件：`packages/db/src/backup.ts`、`apps/api/src/app.ts`、`scripts/export-data.ts`、`scripts/restore-data.ts`、`scripts/verify-all.sh`、`apps/web/scripts/verify-web.ts`、`apps/web/scripts/verify-browser.mjs`、`apps/web/src/export.ts`、`apps/web/tests/s0b-s1.test.ts`、`tests/integration/export-restore.test.ts`、`docs/adr/0002-minimal-export-restore.md`、契约/README。
