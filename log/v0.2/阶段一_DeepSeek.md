# v0.2 第一阶段 DeepSeek 验收任务执行日志

日期：2026-10-20（Asia/Shanghai）。用户本轮授权：“请一并完成 deepseek 负责的部分”。由 Codex 在 DeepSeek 专用工作树代执行；没有调用 DeepSeek 模型、委派另一 agent 或宣称不同人员独立审查。

## 基线与工作范围

阅读第一阶段规划、接口契约、DeepSeek/Gemini 任务卡和 Codex 交付日志。DeepSeek 干净工作树从 `7fda7f4` 快进至后端交付基线 `f3203a7`（实现提交 `4ecd665`），确保测试 profile/home API 的实际实现。验收分支 `v02/phase1-deepseek`，仓库 `/Users/zhk/life_dashboard/v0.2/.runtime/worktrees/deepseek`。

本轮只新增 `v0.2/tests/v02-phase1/**`、`v0.2/docs/v02-phase1/**` 和本日志，没有修改业务实现、旧测试、公共契约、根依赖/lockfile 或共享 Compose。新增测试目录内的浏览器 overlay 用作验收夹具，经主 `scripts/agents/compose.sh deepseek` 追加；没有裸调用 Compose 或旧发布脚本。

## 交付

- `support.ts`：显式四重环境校验、合成夹具、真实 Fastify/PostgreSQL 调用和结果写出。
- `api.test.ts`：按契约另写 8 个 API 场景，不引用 Codex 的测试；覆盖 401/403/400/409/422、并发原键回执、不同载荷、版本竞争、所有资料类型、自定义模块、跨用户引用、归档、pin 顺序与极简持久化、无事实副作用及备份恢复。
- `browser.test.ts`：现有 Playwright 镜像内实际 Chromium 操作；10 个必需场景；失败/缺失 UI 记录 FAIL/BLOCKED、截图并让命令非零，未使用 SKIP。
- `compose.browser.yaml`：仅测试目录内的 overlay，API/browser 使用 DeepSeek 专用 `postgres-test/life_dashboard_test`，内部 Origin=http://gateway，公开合成口令，浏览器全新 context。主共享 Compose 和业务 Origin 校验未改动。
- `run.sh`：一条命令顺序跑迁移、原基线、独立 API、真实浏览器；失败不被吞掉，写 run.json。无依赖安装或镜像/浏览器下载。
- `docs/v02-phase1/`：接入/复跑说明、P1-01–P1-10 逐项矩阵、问题报告与验收结果 JSON 快照。

## 实际执行与结果

完整命令：

```sh
sh /Users/zhk/life_dashboard/v0.2/.runtime/worktrees/deepseek/v0.2/tests/v02-phase1/run.sh
```

| 检查 | 实际结果 |
| --- | --- |
| TypeScript | PASS |
| 单元 | 26/26 PASS |
| 原后端集成（含 Codex 第一阶段新增） | 63/63 PASS，0 skip |
| 原 Web DOM-less 基线 | 12/12 套，73 断言 PASS |
| 前端构建 | PASS |
| 另写 API 验收 | 8 场景 PASS；Node 含父测试 9/9，0 skip |
| 实际浏览器 | 2 PASS、2 FAIL、6 BLOCKED；Node 含父测试 11 项为 2 pass/9 fail/0 skip |
| 浏览器未捕获页面错误 | 0 |
| 一条命令总结果 | FAIL，exit 1，符合必需场景不能跳过放行的要求 |

运行环境：Node v24.21.0，Chromium 156.0.8078.4，PostgreSQL 18.6。所有数据重置先断言 NODE_ENV=test、DATABASE_HOST=postgres-test、DATABASE_NAME=life_dashboard_test、PHASE1_ACCEPTANCE=deepseek。没有访问或清理主库、18181/18182 数据库，没有使用宿主私人浏览器档案。

D08 通过真实备份函数和迁移数据库验证：新 profile/fields/preferences/configuration_revisions、旧 records/record_revisions/tombstones/awards、mutation_receipts 和 change_log 恢复后逐表一致；会话不恢复；恢复后旧资料写入原键返回原 v2 回执而不覆盖较新资料；非空库、篡改、迁移不符、外键错误均拒绝，失败恢复整体回滚。未对真实用户数据做恢复演练。

原始日志、JSON、失败截图位于专用 `v0.2/.runtime/test-artifacts/v02-phase1-deepseek/`，不入 Git。文档中提交了不含真实个人数据/口令/Cookie 的实际状态快照。

## 发现与真实边界

1. DS-01 / B01：合法业务 `values.session` 被 storage 的递归敏感键检查拒绝，页面出现 LOCAL_STORAGE_FAILED，records 数量为 0。后端合法字段通过，因此问题归前端持久化 DTO 分类。
2. DS-02 / B02：服务器已提交后丢回执，同一模块表单重试生成不同操作键和实体 ID；确认两次 route.fetch 完成后，实际同名模块数量为 2。问题归前端冻结配置操作包，后端原键原包幂等测试通过。
3. DS-03 / B03–B08：被测 Web 仍为空首页，无资料表单、极简开关或 AI/3D 新容器，标记 BLOCKED 并令测试失败。新 UI 的后续流程虽然已写测试代码，但未执行到，不计为通过。
4. B09：原记录丢回执后刷新恢复、沿原键原包确认一次 PASS；B10：存储失败阻止发送且保留输入 PASS。

运行过程中浏览器首次命令漏带 test profile，Compose 报依赖服务未定义；补齐 profile 后启动成功，没有更改业务实现。复核夹具发现 B02 的 DOM 等待不能证明第二次服务器事务已完成，补强为明确等待两次请求处理结束；再次完整运行全部 10 个浏览器子场景，结果相同且稳定记录重复模块=2，类型检查也通过。

当前 Gemini 工作树已出现前端开发改动，但尚未提交；本次没有覆盖、拷贝或提前验收其未提交内容。新 UI 暂用定位约定写在 docs README，待 Gemini 交付后按实际可访问定位调整，再集成完整复跑。没有通过更改断言或放宽要求制造通过结果。

## 结论与后续

DeepSeek 角色的测试代码、矩阵、实际执行和缺陷交接已交付；**v0.2 第一阶段未通过，完整前端集成后的最终复验仍待交付**。DS-01/02 需由 Gemini 修复，DS-03 需其新 UI 提交；Codex 集成后，DeepSeek 专用工作树应更新到真实集成基线再复跑。当前 API PASS 不能替代主页/资料的浏览器验收。

本轮无新依赖、真实 AI、外部消息、远端推送、主工作区合并、手机实机、离线或 CI 发布。验收提交以本分支 `git log -1` 为准；历史 Codex 日志保持原样。
