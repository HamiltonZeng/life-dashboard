# v0.3 第二阶段运行与联调交接

2026-10-21补充[主要代码审查](代码审查_2026-10-21.md)：本次既有204节点及前端回归通过，但新增复现确认4项问题（3项P1、1项P2），涉及字段来源/单位、排队后授权、发生日期及静态资料撤销。业务代码尚未修复，建议先收口再进行真实API联调；原验收结果保留历史范围。

本版继续使用独立 Docker 项目 `life-dashboard-v0-3`、本地18380、独立开发库。旧版18080/18181不在实施范围。所有破坏性验证通过 `tests/v02-phase3/guard.ts` 五项保护，仅使用 postgres-test/life_dashboard_v03_test。

## 实现链路

十二动作由同一会话/候选/确认/领域事务/回执执行器处理。`ai/sources.ts`验证字段来源和冻结时间；`ai/actions.ts`复用原领域服务；`ai/compensation.ts`提供显式补偿；`reports/`负责不可变SQL事实、分析校验、持久作业和独立日程。日统计可重建，中文摘要使用受限字面检索，不使用向量库。

网络调用均经过原 DeepSeekGateway。用途为chat/plan/extract/report/reward_quote，`ai_usage`统一保存用途、父意图、版本、预留和已知/未知用量。全局供应商会话锁不持用户事务；领域预检和最终写入之间释放事务。规划/抽取最多2次，报价/报告各最多2次；父意图生命周期合计最多6次。日预算不会因新子作业重置。未知用量按预留占用。不能保证供应商计费恰好一次。

独立报价使用 reward-quote/1.1，每批最多4个任务。普通动作没有金额入口。失败或服务端关闭报价时明确 `system_fallback`；候选金额被模板版本锁定，未来实例复用。类别资格及账本冲正继续使用既有规则。

## 运行

- 启动：`sh scripts/start-existing.sh`；只用已有镜像和依赖。
- 后端完整离线验证：`sh scripts/verify-phase2.sh`。
- Chromium/实际容器重启：`sh scripts/verify-phase2-browser.sh`。与后端验证顺序运行，共用一套隔离测试库。
- 旧阶段独立验证入口仍保留；其迁移/导出版本断言已同步本阶段，其业务断言不减少。
- 冻结文件清单：`node scripts/freeze-phase2.mjs`，清单见 source-manifest.json。

运行证据保存在 `.runtime/test-artifacts/v03-phase2/`，不把原始日志、数据库、截图或密钥放入源码清单。

## 配置

密钥只放 `.secrets/development.env`，保持目录0700、文件0600。示例不包含真实值：

```env
V03_AI_ENABLED=0
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
DEEPSEEK_BASE_URL=https://api.deepseek.com
V03_AI_REWARD_PRICING=1
V03_AI_DAILY_JOBS=20
V03_AI_DAILY_INPUT_TOKENS=100000
V03_AI_DAILY_OUTPUT_TOKENS=20000
V03_AI_MAX_INPUT_TOKENS=32000
V03_AI_MAX_OUTPUT_TOKENS=4000
```

配置后重启API/worker，并在设置明确选择可发云端的模块。新增模块不会自动扩大授权。配置缺失时保留高级手动能力，不使用生产stub。报告日程默认关闭，启用须预览确认；恢复后需重新启用。

## 迁移与备份

0001～0005保持原样；新增0006_v03_workflows.sql和0007_v03_schedule_identity.sql。导出格式3包括来源修订、报价、报告/修订/作业、日程、日统计和摘要。支持旧格式1/2与匹配的旧迁移前缀；先验证原校验和，再补缺省字段和空新增表。恢复只进空库，全图事务写入，保留成功回执、真实事实、修订和账本；恢复后关闭日程，未完成收费作业标RESTORE_PAUSED，清lease及确认令牌，禁止自动收费重放。

部署前另外生成私有 pg_dump，用于整库操作回退；恢复演练使用合成测试库，避免覆盖开发数据。

## 第三阶段入口

真实脚本 `scripts/real-api-phase2.ts [plan|extract|correction|profile|report|schedule|reward_quote]` 默认只写 `not_run`。必须同时设置 `V03_REAL_API_CONFIRM=synthetic-v03-phase2`、AI启用、真实密钥/模型，以及五项合成库保护，才会初始化合成场景并调用供应商。整套脚本同一UTC日共用最多12个真实请求的持久费用计数（调用前计数，unknown不退还），进程锁拒绝并行执行；每次脚本也最多12个真实请求，可用 `V03_REAL_API_MAX_REQUESTS=1..12` 收紧；所有用途共用日token额度。每组独立运行会初始化隔离库，不能同时运行。

第三阶段用 test 服务运行该脚本，并显式传入上述配置；不要用 tools/API/worker 的开发库配置执行。先以preview_all启动；脚本只对合成数据显式应用候选。默认入口可以用 `docker compose run --rm --no-deps --pull never test node_modules/.bin/tsx scripts/real-api-phase2.ts plan` 验证关闭状态。真实凭据通过受控env_file注入，不放命令行或日志。

顺序：连通与用量→plan/extract→correction/profile→report/reward_quote→schedule→浏览器/手机/升级恢复。429、半响应、超时与unknown usage优先使用已交付协议模拟，不为制造错误反复消耗真实额度。出现越权、重复事实/账本、虚构报告数字或预算绕过立即停止该能力后续真实调用。

实际供应商结果、离线协议结果、Chromium和实机证据分开记录。本阶段不配置真实密钥，不把本地stub当真实联调。
