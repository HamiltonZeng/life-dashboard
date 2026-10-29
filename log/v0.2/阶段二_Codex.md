# v0.2 第二阶段 Codex 开发日志

日期：2026-10-20（Asia/Shanghai）。用户授权：阅读二阶段规划并完成 Codex 开发任务。仅 Codex/Gemini 两角色，不调用 DeepSeek 开发、模型或验收。主用户环境18080及主工作区用户 README 改动保留。

## C0 契约交接

从干净的共同基线 e6ff267 创建 v02/phase2-codex，保留阶段一分支。将主工作区第二阶段规划、两张任务卡和第一阶段复核原文同步进入本分支。接口冻结于 design/v0.2/第二阶段接口契约.md，权威请求Schema为 packages/contracts/src/phase2.ts；原CONTRACT_VERSION=0.2.0兼容，阶段修订 v0.2-phase2/1.0。

冻结：四类周期模板/实例、迟到补录与固定奖励日历、七种趋势合法范围粒度、资料来源、系列阈值/授予、只读钱包/账本、类型化首页固定及AI禁用。奖励开发默认 reward-policy-v1：main100/月1，daily10/日3，weekly50/周3，monthly200/月2，补录截止周期结束后7天含截止点。普通UI/API无金额设置。

C0时新增端点尚未实现，不凭Schema声明可用；后续逐检查点补充实际测试和能力状态。组合写入回执必须先匹配 operation_id，再验证其 template/instance/record 子对象，不能套用单实体 id/version 校验。接口意见经本文件/提交协调，不修改 Gemini 的 api.ts/types.ts。

新增 Codex 专用后端验收入口 tests/v02-phase2/run.sh，所有容器调用使用主 agents wrapper，显式PHASE2_ACCEPTANCE=codex与测试库保护；不复用硬编码 DeepSeek 的旧runner。不装依赖或下载镜像，不改Web/UI。

## C1 / C2 领域实现检查点

新增0004迁移，未改0001–0003。周期模板按当前周期物化、锁定快照和固定奖励日历；未来时区变更裁剪到旧周期结束。GET无物化，手动撤回有原因与历史。系列里程碑支持count/distinct_days/sum和跨级授予，证据恢复保留award ID。旧任务与旧成就保留，不自动补发奖励。

新增phase2领域与API模块，避免继续堆积Service。趋势按日值→全范围一次筛选→等权日均→Decimal HALF_UP，保留原值/来源；观测字段经统一records核心新增/带版本更正，派生只读，配置不造事实。导出白名单包含全部新表、绑定及偏好。

实际隔离命令：主wrapper codex run --rm --no-deps --pull never -e PHASE2_ACCEPTANCE=codex test，执行tsc及tests/v02-phase2/*.test.ts、tests/integration/*.test.ts。2026-10-20本次77/77通过、0失败/0SKIP（含63旧集成、6任务成就、4趋势、3观测钱包、1环境保护）。钱包初版一并验证：并发5任务仅3资格，冲正/恢复链、SQL拒绝改删、空库恢复后旧操作重放数据一致。后续补全AI协议、升级演练及首页集成后再做最终回归。

## C3 系统奖励与离线 AI 协议

奖励资格按首次有效完成永久锁定，四类别独立限额；周期实例用物化时锁定的奖励日历周期，主线首次完成决定月份。用户资料/模板切换时区不重开额度。grant/reversal/reinstatement形成root/previous链，账本SQL触发器禁止改删，资格/任务/流水/钱包/回执同事务。奖励摘要变更另增任务版本并发布一致的change_log投影。取消为新实例终态，原因与历史保留，不可被重算复活。

严格action-proposal/1.0独立模块、上下文ID白名单、普通动作判别Schema、preview/apply请求Schema及独立internalRewardQuote已补齐；不支持任意patch、直接完成/授予/改余额。mvp在provider构造和载荷解析前拒绝所有执行端口；旧development mock回归不代表新版运行能力。已发布实际recurring_tasks/trends/achievement_milestones/token_wallet/profile_observations能力，AI分项、3D/兑换仍false。

## C4 已完成的后端集成与恢复

新增完整图备份测试同时覆盖绑定、系列授予、任务快照、资格、流水与幂等回执。该测试发现profile_fields.value的JSON null被旧恢复助手转成SQL NULL，现仅对该非空JSON列正确编码null，不放宽checksum/迁移/空目标校验。另修复新旧固定引用重复warnings，以及升级后旧pinned_task_ids在只改minimal_mode时丢失的问题；均有回归。

旧版升级演练从e6ff267只读提取原代码，在postgres-test独立schema（不含public搜索路径）运行0001–0003、原Service造合成任务/回执、原导出恢复，再用新代码新增0004；原ID和回执保留，旧任务完成不产生奖励资格/流水。新版完整空库恢复后旧观察操作重放不增发。

18181隔离预览升级前以原代码只读备份到私有.runtime/backups/pre-phase2-preview.json（0600，不提交）。原备份在独立测试schema逐data字段核对恢复后升级通过，再对Codex预览执行0004；15条既有记录保留，未补发历史奖励。真实gateway登录/home/export/capabilities通过，重启仅Codex API后导出事实/回执全等，钱包0、AI禁用。证据preview-backup.json/restart.json在.runtime/test-artifacts/v02-phase2-codex。没有触碰18080主库/主部署。

本轮中间失败均已定位修正：协议循环依赖改独立模块导入；候选测试补显式schema_version；git archive从仓库根定位；备份用户ID使用data.users[0].id；直接Service回执测试按HTTP JSON标准化日期；重启探测等待健康再登录。没有以SKIP/删断言绕过失败。

## 尚待 Gemini 交付的 C4 条目

最后检查Gemini仍为v02/phase1-gemini、eda3dcd，未有第二阶段干净交付；没有合并未交付代码、没有修改Web/UI或Gemini日志。后端PRD V02-01–27映射和启动/升级/回滚说明在v0.2/docs/v02-phase2；界面布局、来源跳转、手机/键盘、候选容器、输入保留/冲突等需第二阶段UI合入后浏览器验收。因此本轮交付Codex后端，C4整版合并/发布仍待前端，不宣称整版完成、第三方审计或主环境已上线。主工作区README用户改动保留，无GitHub推送。

## 最终离线结果

`sh tests/v02-phase2/run.sh` 最终exit0：database PASS、migration PASS、checks PASS（tsc、26/26单元、契约导出）、integration PASS（63/63）、phase2 PASS（21/21），合计110项、fail0、skip0。git diff --check通过。重启一致性与隔离预览备份恢复演练另外PASS。上述最终结果覆盖所有本轮代码修复；无需安装依赖/下载镜像/调用真实AI。

## 用户授权接续 Gemini 与最终 C4 收口

用户报告Gemini崩溃后，检查发现其v02/phase2-gemini已带入e5722bd后端，13个文件未提交、57条类型错误。先保存原源码和补丁（.runtime/reviews/gemini-crash-audit），未重置工作树。用户明确授权“帮我完成Gemini的收尾工作”后，Codex在原工作树修复前端并补测试/日志；原目录作者边界因此由用户授权覆盖，不是冒称Gemini本人完成或独立审计。

接续交付a60c9f0：真实任务/系列/观测/固定/趋势契约，冻结操作可靠保存，冲突显式采用，趋势读取失败不造假，未来规则编辑、派生来源、钱包分页、移动触摸/键盘和首页。原18套134断言保留、新4项单元；旧20个真实Chromium场景与新15个业务场景全部通过。完整UI入口run-web.sh只允许Gemini工作树，主wrapper gemini项目、18182、postgres-test/life_dashboard_test，未调用DeepSeek或模型。API/web重启后原创建/完成回执与导出全等，无重复奖励。手机仅360px模拟，实机/系统键盘未测。

将Gemini干净提交a60c9f0快进合入v02/phase2-codex，随后Codex后端入口再次全部PASS：26单元+63旧集成+21二阶段=110项，0失败/0跳过。旧tests/v02-phase1保留原件，新的旧浏览器回归副本只更换隔离守卫/名称/产物位置，不修改旧断言。新UI最终日志、截图和证据在docs/v02-phase2/web与Gemini.runtime/test-artifacts/v02-phase2-web。

更新18181前通过scripts/export-data.ts只读备份到私有0600的pre-ui-integration.json，再仅重启Codex web构建UI。实际gateway读home/export/capabilities与五个前端JS文件成功；与更新前备份比较data/migrations逐字段相同，15条原记录、修订、回执、账本均保留。ui-integration.json为本次产物。无主18080切换、DB重置、GitHub推送或依赖下载。

此前日志中“C4待Gemini交付”是历史状态，本节替代：现已由用户授权接续完成前端、验收和集成，README/PRD V02-01–27矩阵已更新。崩溃审计报告保留为历史证据，标明已解决。
