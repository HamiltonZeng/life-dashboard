# life_dashboard 设计文档索引

整理日期：2026-10-19。本目录包含当前对话生成的设计文档、AI 格式规范和新增开发规划。原会话输出副本保留；Markdown 中的文件链接已改为本目录对应文件。

## 采用顺序

1. **应用实施与运行约束：首版本地开发与 Agent 协作规划 v0.1。** 应用与数据先放本地 Docker，版本可控缓存保存在 v0.1 内；DeepSeek 云端 API 单独配置。
2. **页面与交互：产品设计文档 v0.2。** 首页空白，五个独立面板，四个默认模块与自定义模块。
3. **AI 配置契约：模块蓝图 Schema 1.0 及配套样例。** 样例不是实际记录，也不是已经调用成功的 API 响应。
4. **技术参考：技术架构与选型 v0.1。** PostgreSQL、独立 API、同步和归档方向保留；VPS 优先部署部分暂缓，以本地开发规划覆盖。
5. **需求背景：PRD v0.1。** 保留个人需求分析；旧首页和导航方案不覆盖产品设计文档 v0.2。

应用版本 v0.1 与文档版本 v0.2 不是同一编号体系。设计材料是参考依据；任务范围仍以用户在开发会话中的最新请求为准。

## 文件

- [人生面板_AI模块蓝图.example.json](/Users/zhk/life_dashboard/design/人生面板_AI模块蓝图.example.json)
- [人生面板_AI模块蓝图.schema.json](/Users/zhk/life_dashboard/design/人生面板_AI模块蓝图.schema.json)
- [人生面板_PRD_v0.1.md](/Users/zhk/life_dashboard/design/人生面板_PRD_v0.1.md)
- [人生面板_产品设计文档_v0.2.md](/Users/zhk/life_dashboard/design/人生面板_产品设计文档_v0.2.md)
- [人生面板_技术架构与选型_v0.1.md](/Users/zhk/life_dashboard/design/人生面板_技术架构与选型_v0.1.md)
- [人生面板_首版本地开发与Agent协作规划_v0.1.md](/Users/zhk/life_dashboard/design/人生面板_首版本地开发与Agent协作规划_v0.1.md)

上述设计文档保留各自生成时的阶段说明。当前应用已完成第一批开发，实际状态与新发现问题以最新核验日志为准。

## 阶段核验与后续规划（2026-10-19）

- [阶段一完整开发与核验日志](/Users/zhk/life_dashboard/log/2026-10-19_阶段一完整核验日志.md)：汇总三份开发日志、核对主要实现、重新执行验证，并列出 5 项已复现问题。
- [下一阶段开发计划与主页提案 v0.1](/Users/zhk/life_dashboard/design/下一阶段开发计划与主页提案_v0.1.md)：质量收口、手机可靠记录、同步、AI 报告与轻量营地首页方案；属于待开发提案。
