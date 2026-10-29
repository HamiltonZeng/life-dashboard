# v0.2 第一阶段 Codex 开发日志

日期：2026-10-19（Asia/Shanghai）。本次依据用户“阅读开发文档和 log，完成 Codex 负责开发任务并写日志”的请求执行。

## 范围、基线与结论

已读取 `design/v0.2/第一阶段开发规划.md`、`第一阶段接口契约.md`、`tasks/Codex_后端与集成.md`、应用 v0.2 PRD，以及环境迁移、Codex 前期交付、DeepSeek 集成和阶段三日志。PRD 的“本轮不开发”属于此前规划会话记录；本次执行范围以当前用户开发授权和第一阶段任务卡为准，没有把历史状态当作当前禁止开发指令。

- 共同起点：`7fda7f4`。
- 开发分支：`v02/phase1-codex`。
- 专用仓库：`/Users/zhk/life_dashboard/v0.2/.runtime/worktrees/codex`。
- 业务代码提交：`4ecd665`（feat: implement v0.2 phase-one profile and home backend）。
- 运行项目：`life-dashboard-v0-2-codex`，入口 `http://localhost:18181`。

**Codex 后端补丁已完成并通过本轮验证；第一阶段整体尚未完成。** 检查时 Gemini、DeepSeek 分支均仍位于准备基线且工作树无变更，尚无可集成的 Web 或独立验收提交。当前交付等待它们完成后依序集成；本次没有替其他 agent 修改 Web/UI、编造独立审查或宣布完整阶段验收。

## 实现

1. 新增 GET/PATCH `/api/v1/profile`：昵称、简介、时区、默认/自定义模块资料字段；七种已有受限类型，支持 null，decimal 使用字符串。`session` 等合法业务字段可保存；kind=observation/derived 和任意统计/余额属性无法进入资料写入。显式删除、同模块 key 唯一、字段 ID 不能跨用户/模块使用，归档/停用模块不可编辑。简介未传保持、null 清空，昵称 null 拒绝。
2. 新增 GET/PATCH `/api/v1/home-preferences`：极简模式及有序 pin；数值最多 4、任务最多 5，超限 422，重复 ID 400，他人/失效对象 422。切换模式不清空 pin，pinned_trends=[] 只读。
3. 新增 GET `/api/v1/home`：同一 REPEATABLE READ READ ONLY 事务读取 cursor、资料、偏好、指标事实、任务及有效授予。固定顺序优先，今日任务按用户时区，固定与今日去重；归档来源排除，保留偏好 ID 并返回 PIN_UNAVAILABLE 提示。保留原 definition/computed/evidence 和来源 ID，wallet=null、avatar 禁用；GET 不写示例事实或配置。
4. 新配置写入沿用 Service.mutate 的用户时钟锁、事务、哈希、幂等回执和变更日志；新增完整配置修订，旧版本 409 并提供 details.current。资料/偏好不触发 recompute，不因改简介而修改任务/授予。未知结果可以重放同键同包，无需新增恢复端点或改前端 api.ts。
5. 仅新增 `0003_v02_phase1.sql`：user_profiles/profile_fields/home_preferences/configuration_revisions。0001/0002 与起点无 diff，不覆盖既有事实或历史奖励。GET 默认版本为 1，首次 PATCH 为 2，缺省资料取真实 users。
6. 导出/恢复白名单纳入所有新表、修订及原回执。保留原备份格式/schema_version=1、契约 0.2.0 和严格迁移比对；旧备份先在旧代码环境恢复再升级。旧导出测试仅将预期迁移清单增加 0003，原断言未删。
7. capabilities 新增 home/home_preferences/profile_fields=true，未来 AI/3D/周期能力 false，钱包保持 null；未来受控写路径返回 FEATURE_DISABLED。默认 MVP 不初始化供应商；显式 development 保留旧 mock/AI 测试入口，未启用或调用真实模型。默认 stage 更新为 v0.2-phase1。
8. 更新统一请求 Schema、导出器、OpenAPI、request-schemas 和 contracts README。未改第一阶段协作输入中的既有字段；实现细节包括每包最多 120 资料字段、近期有效授予最多 10 条和 warnings 响应，均记录在 contracts README。

## 验证结果

所有应用执行命令均经主目录 `scripts/agents/compose.sh codex`。Docker 访问使用执行工具审批通道获准；未安装依赖、修改 lockfile、联网下载镜像或调用付费服务。

| 检查 | 结果 |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS，最终补测后再次通过 |
| 单元 `tsx --test tests/*.test.ts tests/ai/*.test.ts` | 26/26 PASS |
| PostgreSQL 全量集成（专用 postgres-test） | 63/63 PASS，0 skip；原 53 基线保留，新增阶段父测试及 9 子场景 |
| 最后补充恢复后旧键重放断言 | 阶段定向 10/10 PASS，包含父测试；旧回执返回 v2，当前较新资料不被覆盖 |
| 原 Web DOM-less 验证 | 12/12 套、73 断言 PASS |
| Web 构建 / 契约导出 | PASS，无依赖新增 |
| 实际 Gateway HTTP | PASS；登录、401、ready、空首页、偏好写入和同键重放 |
| 专用 API 重启持久性 | PASS；minimal_mode=true 与版本保持一致 |
| `git diff --check`、迁移差异检查 | PASS；0001/0002 无改动 |

新增集成测试 `v0.2/tests/integration/v02-home-profile.test.ts` 覆盖：空首页不造数据；并发同键重放/异载荷；旧版本及冲突基线；session 业务名；非法类型与派生值整包回滚；跨用户模块/资料/pin；自定义模块七种字段类型、显式移除；真实事实统计与 null；今日任务及 pin 顺序去重；资料不改变事实/任务/授予；有效成就来源和待复核排除；归档失效提示；新表/修订/版本/回执完整恢复。全量旧测试另继续覆盖零值、证据修改与鉴权边界。

复跑示例（工作目录主版本 `/Users/zhk/life_dashboard/v0.2`）：

```sh
sh scripts/agents/compose.sh codex --profile test up -d --wait --pull never postgres-test
sh scripts/agents/compose.sh codex run --rm --no-deps --pull never test sh -c 'node_modules/.bin/tsx packages/db/src/migrate.ts && node_modules/.bin/tsx --test --test-concurrency=1 tests/integration/*.test.ts'
sh scripts/agents/compose.sh codex run --rm --no-deps --pull never tools node_modules/.bin/tsc --noEmit
sh scripts/agents/compose.sh codex run --rm --no-deps --pull never tools node_modules/.bin/tsx apps/web/scripts/verify-web.ts
```

运行证据在专用业务目录 `v0.2/.runtime/test-artifacts/v02-phase1-codex/`：`integration.log`、`restore-replay.log`、`http.json`；旧 Web 报告在 `stage2-web/s0b-s1-verification-report.json`。这些被忽略的运行产物不入 Git。HTTP 冒烟脚本保存在专用 `.runtime/codex-http.mjs` 和 `codex-restart.mjs`，只读取容器已有环境口令，不打印/保存 Cookie 或口令。

## 修正与边界

开发期间类型检查发现 requireThat 不接受 details 参数，改为直接抛出 DomainError；新增测试辅助函数的 unknown payload/UUID 推断导致重载错误，改正类型后通过。没有跳过失败测试。补查近期成就时把模块启用筛选移入 LIMIT 前的 SQL，避免归档项占满返回数量。

- 未访问或清空 18080 主库；测试只在 Codex postgres-test 使用合成数据。18181 运行库为本次专用初始库：默认模块/模板、极简偏好和测试登录会话，无业务事实；未往主库写夹具。
- 未修改根主工作区原有 README 删除或 v0.1 README 改动；未修改 Gemini、DeepSeek 文件或历史日志；无全仓格式化、远端推送或自动合并到 main。
- 后端默认资料与偏好、版本/修订/回执、导出/恢复已完成；前端的配置未知结果恢复、资料表单、来源点击跳转、极简布局、AI 草稿/3D Port，以及真实浏览器故障注入由 Gemini 交付；独立端到端验收由 DeepSeek 交付。
- 尚未做本阶段真实浏览器交互验收、主用户迁移演练、移动实机或独立人员审查；当前运行的 Web 是原 v0.1 基线。不能用原 12 套 Web 通过替代新增主页/资料的浏览器验收。
- 下一步集成顺序：后端 `4ecd665` → Gemini Web 提交 → DeepSeek 阶段验收提交；集成负责人处理实际冲突并在专用库跑完整阶段退出条件。当前第一阶段整体状态仍为“未完成，待前端与独立验收交付”。
