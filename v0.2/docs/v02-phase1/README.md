# v0.2 第一阶段验收包

日期：2026-10-20（Asia/Shanghai）。执行人：Codex 代执行原 DeepSeek 验收任务。业务实现与验收代码由同一会话编写，测试未复用原后端测试断言，但**不构成不同人员或不同模型的独立审查**。

被测业务基线为 `f3203a7`（后端实现 `4ecd665`）。验收分支 `v02/phase1-deepseek` 已从准备基线快进到该提交。当前被测 Web 为原基线；Gemini 工作树已出现开发中改动，但尚无交付提交，本轮未复制其未提交文件。

**结论：阶段未通过。** 独立 API 8 场景通过；真实浏览器 2 PASS、2 FAIL、6 BLOCKED，必需用例没有被跳过放行。完整入口返回 exit 1，原因见 [问题报告](问题报告.md) 与 [验收矩阵](验收矩阵.md)。

## 复跑

从主仓库任意目录运行：

```sh
sh /Users/zhk/life_dashboard/v0.2/.runtime/worktrees/deepseek/v0.2/tests/v02-phase1/run.sh
```

入口只操作 DeepSeek 专用项目，按顺序执行：专用 postgres-test → 迁移 → 类型/26 项单元/73 条 Web 断言/构建 → 原 63 项集成 → 独立 API 8 场景 → 实际 Chromium 浏览器 10 场景。任一步失败最终返回非零；不会安装包、下载浏览器/镜像、推送或部署。

`tests/v02-phase1/compose.browser.yaml` 是测试目录内的专用夹具 overlay，不修改共享 Compose。它将 DeepSeek API 的数据库绑定到 `postgres-test/life_dashboard_test`，Origin 设为容器内部 `http://gateway`，供 Chromium 使用；测试口令是公开合成值。业务代码的 Origin 校验未被关闭，独立 API D01 另测跨 Origin 403。切勿把此 overlay 用于主环境；通过此 overlay 运行时 18183 是验收环境，不是个人数据服务。

所有 Docker 命令都经主目录 `scripts/agents/compose.sh deepseek`，不直接使用旧发布脚本。数据库重置必须同时满足 `NODE_ENV=test`、`DATABASE_HOST=postgres-test`、`DATABASE_NAME=life_dashboard_test`、`PHASE1_ACCEPTANCE=deepseek`。不连接或清理 18080/18181/18182 数据库。

独立 API 单独运行：

```sh
sh /Users/zhk/life_dashboard/v0.2/scripts/agents/compose.sh deepseek run --rm --no-deps --pull never -e PHASE1_ACCEPTANCE=deepseek test node_modules/.bin/tsx --test tests/v02-phase1/api.test.ts
```

需先启动专用 postgres-test 并完成迁移。不要让 API 测试、基线数据库测试和浏览器测试并发执行；它们顺序使用同一可重置测试库。

## 浏览器接入约定与限制

当前旧 Web 的记录/配置定位使用真实已有 ID：`#ld-record-template-select`、`#ld-record-submit-btn`、`#ld-form-create-module`。新 UI 尚未交付，临时接入定位信息如下，**不是额外产品需求**：

- 首页 AI：`[data-testid=home-ai-container]` 或 `[data-home-ai-container]`。
- 3D 静态回退：`[data-testid=home-avatar]` 或 `[data-avatar-placeholder]`。
- 资料：表单包含 `[name=nickname]`、`[name=bio]`；入口按“个人信息/个人资料”可访问名称定位。
- 极简开关：`input[name=minimal_mode]` 或 `[data-action=toggle-minimal-mode]`。
- 冲突采用基线、未知配置恢复和来源跳转按按钮/链接可访问名称定位。

Gemini 交付后应根据实际稳定定位信息调整测试选择器，再在本工作树集成该提交并完整复跑。当前 B03–B08 在检查缺失界面后以 BLOCKED 失败，后续断言是已编写但未实际执行的用例，不算测试通过。选择器不匹配本身不能作为产品缺陷定论；本轮缺失判断还由业务基线 `main.ts` 的空首页与不存在资料/极简逻辑交叉确认。

浏览器执行覆盖：合法 session 字段；配置提交成功丢回执后沿原键/ID/完整载荷确认及刷新恢复入口；标准首页；资料失败保留/409 显式采用基线；未保存离开提醒；极简偏好刷新保留/居中/固定顺序；指标与任务来源跳转；AI 草稿/发送禁用、3D 资源不下载；旧记录丢回执刷新恢复；存储失败不发送。当前未执行到的新界面场景，不能代替未来端到端验收。

## 证据

运行产物：专用 `v0.2/.runtime/test-artifacts/v02-phase1-deepseek/`。

- `run.json`：一条命令整体退出状态。
- `checks.log`、`baseline-integration.log`、`api.log`、`browser.log`：实际命令输出。
- `api.json`、`browser.json`：逐项状态；BLOCKED 在 Node 测试器中按失败计，0 skip。
- `environment.json`：Node/Chromium/PostgreSQL 版本、专用库、页面定位约定。
- `B01.png`–`B08.png`：失败/阻断截图；`browser-errors.json` 为未捕获浏览器错误列表。
- [验收结果.json](验收结果.json)：本次逐项结果的入库快照，只包含合成验收信息；原始截图和运行产物不提交。

浏览器使用新建 Playwright context，不借用宿主个人档案。没有真实 AI、手机实机、离线、外网部署或 CI 验收。已通过备份/空库恢复验证；未对真实用户数据库迁移或备份做演练。
