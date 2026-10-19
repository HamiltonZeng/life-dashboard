# v0.1 发布冻结契约（C1）

`APP_PROFILE=mvp|development`，未配置默认 `mvp`；其他值拒绝 API 启动。Compose 通过宿主同名变量选择，默认 mvp；不修改现有秘密配置。契约仍 0.2.0，迁移仍 0001/0002。

登录后的 `/api/v1/capabilities` 增加 `profile`。mvp 返回 `stage=v0.1-mvp`，`ai_generation=false`、`ai_preview=false`、`cloud_ai=false`、`ai_provider=disabled`；手动流程、导出与 CLI 恢复继续可用，sync/recurring_tasks/professional_ledger=false。

MVP `/api/v1/ai/config` GET 返回 200 的诚实禁用对象：`profile=mvp,enabled=false,provider=disabled,cloud_ai=false,configured=false,model="",schema_version=1.0,supported_content_types=[]`。其他 AI GET 和全部 AI 写路由统一 409 `{error:{code:"FEATURE_DISABLED",message,request_id}}`。鉴权与 Origin 检查仍先于功能检查。拒绝发生在请求业务校验、job 创建、配额预留与适配器调用之前；遗留错误模型配置不参与初始化。

旧 AI 创建的模板/任务/指标/授予与实际记录继续由手动面板及导出读取，不因禁用而删除。AI 审计保留在数据库，MVP 不提供其产品入口。

development 保留此前 AI API，默认 mock。旧 AI 集成测试显式 `APP_PROFILE=development AI_PROVIDER=mock`；MVP 独立测试显式 `profile:mvp`。开发启用示例：`APP_PROFILE=development docker compose up -d --force-recreate api web`；发布恢复：`APP_PROFILE=mvp docker compose up -d --force-recreate api web`。不为了测试配置真实模型密钥。

前端只依赖 capability，隐藏 AI 生成/AI 设置；报告/同步入口不发布。旧 records 的 `ai-review` 子页和 settings 的 `ai` 子页回退默认可用页，首页继续空白。

可靠写入载荷及回执保持原契约：请求发出前持久化完整操作；结果未知仅按原键/原完整载荷重放；2xx 但回执损坏仍未知；确定 400/409/422 不提交事实；任何网络错误或 5xx 不能证明未提交。编辑基线固定，409 需用户明确选择后才能采用新基线。
