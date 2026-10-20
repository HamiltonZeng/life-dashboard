# Gemini 崩溃后工作盘点

此文件记录接手时状态；后续已按用户授权完成修复，交付提交a60c9f0。最终证据见web/README.md。

检查日期：2026-10-20。仅查看源码并在gemini专用tools容器运行tsc，未修改Gemini源码、未提交其代码、未写数据库。工作区仍完整。

分支v02/phase2-gemini，HEAD=e5722bd，已经带入Codex完整二阶段后端；尚无Gemini二阶段功能提交。保留11个已跟踪文件改动，以及phase2-views.ts（1019行）和phase2-modals.ts（659行）两个新文件；约4267行新增、167行删除。代码快照与补丁已额外保存于Codex .runtime/reviews/gemini-crash-audit/，包括saved-source.tar.gz、uncommitted.patch、inventory.json、typecheck.log。

| 部分 | 源码已有内容 | 当前结论 |
|---|---|---|
| G0 | 新API方法、分页、组合回执operation_id校验；创建模板/系列接入旧可靠创建框架 | 有基础实现，观察写入未沿用完整冻结提交包，尚待测试 |
| G1 | 四类别/颜色/组合筛选、模板与实例弹窗、规则/进度/奖励说明、撤回取消、成就摘要/门槛/来源 | 页面及流程草稿已写，事件组包仍与契约冲突 |
| G2 | SVG趋势、范围/粒度、排除与来源、首页固定；profile/observation/derived字段和观测弹窗 | 有渲染与请求代码，但交互状态命名及观测保存不一致 |
| G3 | 首页趋势/里程碑/钱包、钱包流水、禁用AI上下文条、样式/颜色元数据 | 有实现草稿，无运行验收证据 |
| G4 | 没有新增二阶段测试/报告/开发日志 | 未见完成证据，旧stage2-web报告属于旧版S0-B/S1，不能代替本阶段验收 |

实际命令：主wrapper gemini run --rm --no-deps --pull never tools，运行node_modules/.bin/tsc --noEmit；exit2，共57条TypeScript诊断。当前不能通过类型检查或视作可合并交付。没有执行界面功能验收，不将源码存在等同功能通过。

关键缺口（行号为本次保存源码）：

1. main.ts:3409 起创建/编辑任务组包使用target/filter/op/active_from；权威契约需要threshold/filters/operator，sum还需unit，linked规则不接受filter。部分模板状态使用不支持的paused。
2. main.ts:3570 起系列保存仍按metric_id/operator/ordinal/title旧设想组包；弹窗和后端已使用record_type_id/aggregation/field_key/unit/timezone及milestones.threshold/label，需重新对齐。
3. main.ts:3660 起观测保存使用profile_field_id/mode/record_id，后端需要id/field_id；弹窗读取obs_mode但处理器读取data-obs-mode，必填context字段没有name=ctx_*，因此新增/纠错路径和必填值采集均需修复。状态字段recordId/error/lastResult亦与state.ts不一致，存在刷新/重试稳定提交风险。
4. main.ts:2301 起固定项使用pinned_tasks而非task_pins；趋势selectedBucketKey/bucket_key/allowedGrains等与类型不匹配，固定趋势还遗漏precision/view_filter。
5. phase2-views.ts:619 起API无有效结果时将指标computed值当作今天的日值生成趋势；这可能把全期间累计伪装为单日数据，应改为明确加载/错误状态。
6. main.ts:3556 撤回成功文案称“释放奖励配额”，与服务端永久保留资格、撤回不释放名额的规则相反。
7. types.ts重复声明recurring_tasks；首页系列里程碑按钮仍走旧achievement_id处理器，需要核对来源跳转。加载失败被quietly吞掉，可能保留过时数据。

恢复建议：保留现有代码，在该工作树先统一渲染字段、事件处理与冻结契约，通过tsc后补可靠提交与真实API链路测试，再做桌面/360px浏览器验收并提交。无需重写已有后端或从零重做全部UI。目前没有依据给出可靠完成百分比。
