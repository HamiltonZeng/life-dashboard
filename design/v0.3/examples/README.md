# v0.3 合成协议样例

所有UUID、消息、记录、数值、时间、报价和令牌均为格式夹具，未写入个人数据库，也未调用模型。manifest.json明确指定每份样例的校验Schema；不要把这些样例作为启动seed或真实个人资料。

| 样例 | 演示内容 |
| --- | --- |
| [chat-message.json](chat-message.json) | 用户一句话请求；入口和执行偏好不等于服务器授权 |
| [goal-plan.json](goal-plan.json) | 30天英语目标，依赖完整的记录模板/指标/主线/每日/累计日成就，无真实学习记录 |
| [record-running.json](record-running.json) | 跑步3公里/20分钟自述、字段来源、日期精度；假定上下文已授权相应模板和单位 |
| [clarification.json](clarification.json) | 缺实际时长时只追问一个问题，没有可执行动作 |
| [auto-applied-turn.json](auto-applied-turn.json) | 服务端真实提交后的示意回执；模型不能自造此DTO当成功依据 |
| [report-generate.json](report-generate.json) | 请求上一个完整周的报告 |
| [weekly-schedule.json](weekly-schedule.json) | 周一08:00、上一完整周、错过只补最新；令牌是不可生效的合成字符串 |
| [report-facts.json](report-facts.json) | 服务器准备的140分钟/4学习日期事实包、来源/覆盖/不可变hash |
| [report-narrative.json](report-narrative.json) | 定量表达引用fact占位，分析/建议分开，没有模型另算的数值表 |
| [internal-reward-quote.json](internal-reward-quote.json) | 独立的合成每日报价8代币，仍需服务器匹配规则/类别/策略，非用户可设金额 |

goal-plan的成就是“累计学习日”，不是连续天数，也不等价于每天20分钟达标日；主线完成方式为手动。计划结束日2026-11-18包含当日，归档/截止采用次日零点的半开边界。样例新建模板用于演示local_ref，生产中应优先复用相容模板。

record-running假设消息接收于2026-10-20 18:00（Asia/Shanghai）。用户只说“今天”，所以time_precision=day，18:00为示意归档时间，不证明实际跑步发生于18:00。现实调用从服务器冻结消息锚解析，不从本文件取日期。

Schema通过仅证明格式与少量引用关系有效；这些样例不能证明真实账户权限、模板单位兼容、模型输出质量或业务实现已完成。
