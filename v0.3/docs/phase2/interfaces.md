# 第二阶段接口与能力

完整精确请求及响应Schema见 `packages/contracts/v03/`，路由见 `packages/contracts/openapi.json`。全部业务写入仍需本地会话、正确Origin和UUID Idempotency-Key，同键异包409。

| 工作流 | 入口/最终查询 | 关键错误 |
| --- | --- | --- |
| 十二动作 | conversations/:id/messages → runs/:id → proposals/:id/preview/apply | 来源/单位/版本/绑定/确认/预算；缺项和多候选可追问 |
| 追问/取消 | runs/:id/clarifications、cancel | question/version不符409；取消不撤回已提交业务 |
| 补偿 | applications/:id/undo-preview、undo | 后续对象/实例/资料/记录指纹变化409；发布报告保留 |
| 事实与来源 | 原records/profile/observations领域接口；GET records/:id/sources | 估算不能填真实值；观测绑定428/409；派生拒写 |
| 报告 | POST reports/generate →202；GET reports、reports/:id?revision= | 范围未授权409；空报告ready无调用；queued非完成 |
| 报告取消 | POST reports/:id/cancel {base_version,revision} | 保留已发布结果，未发布明确CANCELLED |
| 日程 | GET report-schedules；POST :kind/preview；PATCH :kind | kind/config组合/版本/预览token严格匹配；默认关闭 |
| 统计/摘要 | GET statistics/daily；GET ai/context/search?q= | 原始事实权威；检索仅当前授权模块，不包含过时摘要 |
| 用量与能力 | GET ai/config、capabilities、ai/usage | implemented、server enabled、configured、module authorized分别表示；不返回秘密 |

原独立ai/generations为旧开发兼容入口，使用legacy_ai_generation标志，普通页面使用统一会话。未开放3D/兑换等仍明确关闭，旧占位AI卡不再出现在本版业务页面。

实现的12动作：goal.create、module.create、record_type.create、metric.create、task_template.create、task_template.change、achievement_series.create、record.create、record.correct、profile.patch、report.generate、report_schedule.change。奖励金额仅内部reward-quote/1.1通道可返回；不会开放钱包写API。

报告数字来自SQL快照；自由文本只作受限分析。带数字的表述须引用本快照fact占位，未供给比较基期时拒绝比较断言。Schema和规则检查不声称证明所有自然语言推论正确，真实模型表达效果在第三阶段验证。
