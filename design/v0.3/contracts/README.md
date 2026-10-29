# v0.3 机器数据契约

版本：v0.3-design/1.0；JSON Schema Draft 2020-12。此处定义待开发的数据边界，未在主环境注册运行端点。Schema的life-dashboard.local/$id仅为标识，不是需要请求的服务。

| 文件 | 生产者→消费者 | 用途 |
| --- | --- | --- |
| [ai-decision.schema.json](ai-decision.schema.json) | 模型→编译/校验服务 | 结构化意图、最小追问、目标/模板/任务/指标/系列/记录等动作；普通动作无奖励与余额 |
| [public-api.schema.json](public-api.schema.json) | 客户端↔业务API | 精确请求体与TurnResponse；路由只选对应$defs，root联合仅用于样例验证 |
| [report-facts.schema.json](report-facts.schema.json) | 统计服务→报告模型/渲染器 | 不可变事实包、精确数值、周期/截止、来源/覆盖与内容hash |
| [report-narrative.schema.json](report-narrative.schema.json) | 报告模型→校验/渲染器 | 有事实引用的观察/推断/建议；不接收模型自填数值表 |
| [internal-reward-quote.schema.json](internal-reward-quote.schema.json) | 内部报价模型→奖励服务 | reward-quote/1.1与reward-policy-ai-v1；独立于普通apply，类别整数上限校验 |

## 校验层次

1. JSON/Schema：类型、长度、未知字段、日期/UUID、动作白名单等。
2. 本地图/来源：ref唯一、依赖无环且齐全、引用类型、证据与事实包引用。
3. 领域：存在/归属、授权、版本/绑定、单位、规则兼容、日程路径kind、日期先后/时区、真实字段来源。
4. 执行：服务端授权/确认令牌、幂等、单事务、影响/奖励和回执。

Schema无法代替第3/4层，也不能证明自然语言理解正确。实例动态values字典必须按所绑定模板进一步校验；普通scalar字典不是任意字段授权。报告引用存在也不证明全部推断可靠，定量卡片必须由服务器填值。

public-api.schema.json各$defs分别为ConversationCreateInput、ChatMessageInput、ClarificationInput、CancelInput、ProposalPreviewInput、ApplyInput、UndoInput、AiPreferencesInput、ReportGenerateInput、ReportSchedulePreviewInput、ReportScheduleInput和TurnResponse。path ID、会话身份、Idempotency-Key和Origin不从JSON正文信任或覆盖。

报价文件是**内部模型响应**，provider/model/真实报价ID/有效性由服务端及传输元信息补齐，不信任模型自称。绑定模板的规则hash、类别与服务器请求一致后，才允许锁入新任务版本。该Schema不构成任何公开钱包写入接口。

## 可重复的设计验证

从本机主应用v0.2目录运行：

```sh
docker compose run --rm --no-deps --pull never \
  -e COREPACK_ENABLE_NETWORK=0 \
  -e DESIGN_VALIDATION_OUTPUT=/design/contracts/validation-result.json \
  -v /Users/zhk/life_dashboard/design/v0.3:/design \
  tools node /design/contracts/validate.mjs
```

validate.mjs使用已安装Fastify依赖中的Ajv 2020/ajv-formats编译Schema，验证examples/manifest.json的10份样例，并检查15个反例及依赖/报告引用与快照hash。不会访问数据库、供应商或安装依赖。

反例包括：直接改奖励/余额动作/直接解锁、记录完成状态、嵌套SQL对象、非法时间/日期、缺应用回执ID、循环/重复/悬空引用、未知报告事实、日报价超上限及改报价策略。结果见validation-result.json。

应用Schema**不是可直接提交DeepSeek strict的兼容声明**。严格工具模式的子集、可选字段及动态模板字典需适配编译；仍须本地完整校验。当前只做设计验证，未进行真实模型联调。
