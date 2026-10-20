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
