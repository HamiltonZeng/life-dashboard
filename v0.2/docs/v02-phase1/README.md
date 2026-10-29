# v0.2 第一阶段集成验收

日期：2026-10-20（Asia/Shanghai）。结论：**第一阶段在隔离环境验收通过**。

业务基线 `0496660`：后端 `4ecd665`，Gemini 原交付 `eda3dcd`，三方集成 `6030a31`，集成可靠性修复 `ea18962` / `0496660`。执行人：Codex 代执行 DeepSeek 验收；测试单独编写，但后端与验收由同一会话处理，不构成不同人员或不同模型的独立审查。

- TypeScript、构建 PASS；单元 26/26，原后端集成 63/63。
- Web 逻辑/渲染 18/18 套、134 断言。
- 另写 API 8/8 场景（Node 含父测试 9/9）。
- 真实 Chromium 20/20 场景（Node 含父测试 21/21），0 FAIL/BLOCKED/SKIP，未捕获页面错误为 0。
- API/Web 实际重启后，资料/偏好/记录与极简界面持久性 R01 PASS。
- 完整入口 exit 0，详见 [验收矩阵](验收矩阵.md)、[问题报告及解决状态](问题报告.md)、[实际结果快照](验收结果.json)。[初验失败快照](验收结果_初验.json) 保留历史证据。

## 一条命令复跑

```sh
sh /Users/zhk/life_dashboard/v0.2/.runtime/worktrees/deepseek/v0.2/tests/v02-phase1/run.sh
```

执行顺序：专用 postgres-test → 迁移 → 类型/单元/Web/构建 → 原后端集成 → 独立 API → 真实浏览器 → 准备重启探针 → restart api/web → readiness → 重启后读取和界面验证。任一步失败整体非零，不以 SKIP 放行。

测试始终经主目录 `scripts/agents/compose.sh deepseek`，专用项目 `life-dashboard-v0-2-deepseek`。测试目录内 `compose.browser.yaml` 是独立夹具 overlay，不修改共享 Compose；API/browser 显式绑定 `postgres-test/life_dashboard_test`，内部 Origin=http://gateway，使用公开合成口令。重置必须同时断言 NODE_ENV=test、DATABASE_HOST=postgres-test、DATABASE_NAME=life_dashboard_test、PHASE1_ACCEPTANCE=deepseek。

不安装包、下载浏览器或镜像，不使用旧发布脚本，不接触 18080 主库，也不重置 18181/18182 数据库。数据库用例顺序执行，不要并发运行。通过测试 overlay 启动的 18183 是可重置验收环境，不存个人数据。

## 实际定位与覆盖

定位器已按 Gemini 实际交付校正，没有修改业务预期来迁就失败：

- 标准/极简首页：`#ld-home-standard`、`#ld-home-minimal`；AI=`#ld-home-ai-box`，静态形象=`#ld-home-avatar-slot`。
- 显示子标签 `[data-subtab=display]`，极简切换 `[data-action=toggle-minimal-mode]`；个人资料子标签 `[data-subtab=profile]`，表单 `#ld-form-profile`，保存 `#ld-profile-save-btn`。
- 冲突采用 `[data-action=profile-conflict-adopt]`；配置恢复 `[data-action=resume-pending-config]`；配置状态 `[data-config-submission-status]`，提交 `#ld-config-submit-btn`。
- 首页来源使用实际详情按钮 `[data-action=home-metric-detail]` / `[data-action=home-task-detail]`。

B01–B10 为原必需浏览器场景；B11–B20 补验资料未知结果后的修改、偏好存储故障、其余四类配置的损坏回执/刷新/原包确认、归档资料、360px、真实空首页和实际资料表单七类型/删除。五类配置确认旧操作后保留后续工作草稿；已确认的新建配置不会再次创建，草稿可复制或显式丢弃；资料可基于确认后的版本继续保存到同一用户资料。

## 证据与限制

专用 `v0.2/.runtime/test-artifacts/v02-phase1-deepseek/` 中包含 `run.json`、`checks.log`、`baseline-integration.log`、`api.log/api.json`、`browser.log/browser.json`、`environment.json`、`restart*.log/restart.json`、`mobile.png`、`empty-home.png`、`restart-minimal.png`。被忽略的原始产物不入 Git；入库 JSON 仅含合成测试信息，没有口令、Cookie 或真实个人数据。较早失败截图仅属历史运行，不代表当前结果，以当前 JSON/日志及入库快照为准。

当前通过是第一阶段的隔离集成验收；未部署到 18080 主用户环境，未对真实用户数据库迁移/恢复演练。360px 为 Chromium 视口，非手机实机；未做离线、同步、真实 AI、3D 引擎/资源、钱包、周期、完整 v0.2 发布或 CI 验收。
