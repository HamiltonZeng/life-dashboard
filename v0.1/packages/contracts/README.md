# API 契约 0.2.0（T0/T1 后端 + T2/T3 AI 生成）

请求权威定义为 `src/index.ts`；导出文件 `request-schemas.json`、`openapi.json` 可供非 TypeScript 客户端读取。重新导出必须在 tools 容器运行 `corepack pnpm contracts:export`。API 冻结的是本阶段可用子集；模块蓝图 1.0 的权威 Schema 仍是 `design/人生面板_AI模块蓝图.schema.json`，它是模型输出规范，不是直接对外提交的任意配置写入接口。

## 基础约定

- 同域前缀 `/api/v1`；成功 `{data: ...}`，列表另含 `page:{limit,offset,total}`；错误 `{error:{code,message,details?,request_id}}`。
- ID 为 UUID，写入对象 ID 可以由客户端生成。用户身份从会话读取，业务请求拒绝未知的 `user_id` 等字段。
- 除登录/登出外，所有写入必须带 `Idempotency-Key: UUID`。重试用相同键和相同载荷；更换载荷必须新键。相同键但不同操作返回 409 `IDEMPOTENCY_MISMATCH`。
- 模块修改、记录更新/删除、手动完成任务传 `base_version`。旧版本返回 409 `VERSION_CONFLICT`，不能自动覆盖；删除记录不能被旧修改复活。
- cancelled/skipped 任务完成返回 409 `INVALID_TASK_TRANSITION`；前端应隐藏完成按钮，服务端仍强制检查。已完成的 manual/record_optional 用最新版本再次完成为 no-op，保留版本、首次完成时间和完成来源；旧版本仍返回冲突。
- 新成就和 AI 允许引用清单共用活动数值检查：必须属于当前用户、当前启用模块且未归档。已归档数值不能建立新的活动依赖，失败不留下定义或幂等回执。
- 时间为有偏移的 ISO 8601，另传合法 IANA `timezone`。`occurred_at` 是实际发生时间，`created_at` 是录入时间。字段未知可空；草稿不参与事实统计。
- decimal 字段、聚合结果与门槛使用十进制字符串；integer 字段用安全整数。数值样本数与来源记录 ID 随结果返回。
- 400 请求格式/字段错误；401 未登录；403 Origin 不匹配；404 对象不可访问；409 状态/版本/归档/幂等冲突；422 规则/引用不兼容；429 登录限速或 AI 任务配额超限；502 无效模型输出；503 AI 供应商不可用/未配置；504 `AI_TIMEOUT`。

## 登录（本地开发边界）

本地用户已由种子安装。开发者在自己的 `.secrets/development.env` 查看 `LOCAL_LOGIN_SECRET`，通过登录表单输入。
`POST /session` 请求 `{"login_secret":"输入的本地口令"}`，携带 `Origin: http://localhost:18080`，返回服务端设置的 `life_session` HttpOnly、SameSite=Strict Cookie，7 天有效。
浏览器默认发送真实 Origin；跨域开发不要添加 `CORS:*`，应通过 Vite `/api` 代理到同域入口。不要把登录口令存 localStorage 或编译进 bundle。线上 HTTPS 配置会附加 Secure；本地 HTTP 只是开发入口。
`DELETE /session` 撤销当前会话；`GET /me` 返回本地账户信息。前端未登录先进入独立登录流程，登录成功后首页内容仍空白。

## 路由

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/capabilities` | 阶段、契约版本和未实现能力（含 AI 配置摘要） |
| GET | `/bootstrap` | 一致性快照：modules、record_types、tasks、records、metric_definitions、metrics、achievement_definitions、achievement_awards、cursor |
| GET | `/modules`、`/record-types`、`/tasks`、`/records`、`/metrics`、`/achievements`、`/awards` | 各面板列表，支持 `module_id`、`limit=1..100`、`offset` |
| GET | 上述各列表路径 `/{id}` | 稳定对象详情；不可访问或已删除记录返回 404 |
| POST | 上述路径（除 `/awards`） | 新建定义或真实记录；不可直接授予成就 |
| PATCH | `/modules/{id}` | `{base_version,name?,status?}`；status 为 enabled/disabled/archived |
| PUT | `/records/{id}` | 完整替换记录内容，传 schema 中 RecordUpdate，不能更换模块/模板 |
| DELETE | `/records/{id}` | `{base_version}`；软删除并保留历史证据，触发复核 |
| POST | `/tasks/{id}/complete` | `{base_version}`；仅 manual/record_optional |
| GET | `/ai/config` | AI 供应商、模型、结构化能力与预算边界；不返回密钥 |
| POST | `/ai/generations` | 发起一次模块蓝图生成；`apply_mode=apply` 在原子事务中应用，`preview` 只保留候选 |
| GET | `/ai/generations` | 生成任务列表，不含完整候选 |
| GET | `/ai/generations/{id}` | 生成任务详情，含候选、校验错误和已应用批次 |
| POST | `/ai/generations/{id}/apply` | 应用 `preview` 候选（重复应用返回同一批次） |
| POST | `/ai/generations/{id}/retry` | 对失败且可重试的任务重新生成，受尝试次数和预算限制 |
| POST | `/ai/generations/{id}/cancel` | 取消未应用的候选 |
| GET | `/ai/batches`、`/ai/batches/{id}` | 已应用生成批次与 ID 映射 |
| POST | `/ai/batches/{id}/revoke` | 撤销批次；无引用时删除定义，有引用时归档/停用并保留真实记录 |

不提供破坏性定义删除和模板字段类型修改，避免失效依赖。当前不支持同步端点；bootstrap 中的 cursor 是服务端日志基础，不表示客户端已经同步。

## 任务 → 记录

任务行 `definition` 包含 `module_id`、`record_type_id`、`business_date`、`timezone`、完成方式与验收条件。任务行 `id` 是**实例 ID**，`template_id` 与 `rule_version` 保留其定义来源。
“去记录”打开记录表单，带 module_id、record_type_id、task_ids=[实例 ID] 和前端自己的返回地址。实际时长和完成事实留给用户填写。
新记录示例（只演示载荷，不会自动写库）：

```json
{
  "id": "30000000-0000-4000-8000-000000000001",
  "module_id": "10000000-0000-4000-8000-000000000001",
  "record_type_id": "20000000-0000-4000-8000-000000000001",
  "schema_version": 1,
  "occurred_at": "2026-10-19T14:00:00+08:00",
  "timezone": "Asia/Shanghai",
  "status": "confirmed",
  "values": {"topic": "用户实际填写的内容", "duration_minutes": null},
  "task_ids": []
}
```

保存接口只返回记录回执；成功后刷新关联任务、数值和成就列表（或 bootstrap），事务中的派生更新已完成。单条未达门槛也保存，任务显示 `partial`；无有效证据为 `pending`。`needs_review=true` 时显示“完成依据变化，待复核”。
任一符合条件的已确认关联记录即可完成任务，多条 5 分钟不能合成单条 10 分钟达标。只有用户明确选择关联才更新对应任务，数值按记录唯一 ID 计数。
手动任务 binding/acceptance 必须 null；其余两种完成方式必须指定模板与 `{kind:"exists"}` 或 `{kind:"field_gte",field_key,threshold:"10"}`。

## 数值与成就

数值行的 `definition` 保存定义，`computed` 含 `value:string|null`、`sample_count`、`source_record_ids`、`start`、`end`、`period`、`evaluated_at` 和 `calculation_version`。平均只统计有效字段样本；空数据统一显示“暂无数据”，不能替换为 0。
sum/avg/latest 只允许数值字段，单位必须与字段定义一致；count 的 field_key 必须 null。支持的窗口按定义 timezone 计算，周从周一开始。
成就定义与 `/awards` 授予分开。授予包含规则版本、首次解锁评估时间、原始依据及最新复核依据；手动创建接口当前只支持一次性；AI 蓝图可创建按统计周期重复达成的成就。日/周窗口成就跨日周后仍根据首次达成时的窗口复核，不因自然翻页丢失历史授予。
`history_policy=include_existing` 默认可追溯已确认历史；`from_activation` 只统计发生时间在成就创建之后的记录。解锁时间是实际评估时间，不编造历史解锁日期。

## AI 生成（T2/T3）

生成结果统一为模块蓝图 1.0（`schema_version:"1.0"`、`kind:"module_blueprint"`）。服务端执行五层校验：解析、结构（完整 JSON Schema 子集）、语义（引用、单位、条件）、权限与版本（用户、目标模块、允许引用、模块版本、预算）、业务（不写真实记录、不直接授予成就、不覆盖已有配置）。任何一层失败都不会留下半套对象。

`POST /ai/generations` 请求（`aiGenerationInput`）：

```json
{
  "mode": "create",
  "module_id": null,
  "prompt": "给我设计一套每次十分钟起步的编程练习任务，配记录模板、学习时长统计和一个成就",
  "content_types": ["record_types", "metrics", "tasks", "achievements"],
  "apply_mode": "apply",
  "timezone": "Asia/Shanghai",
  "reference": {"record_type_ids": [], "metric_ids": []}
}
```

- `mode=extend` 必须给出现有且启用模块的 `module_id`；`mode=create` 必须为 null。模型输出不能改变生成任务约定的目标。
- `apply_mode=apply` 立即在同一事务内创建配置与引用映射；`preview` 只返回候选，用户随后 `POST /ai/generations/{id}/apply`。重复应用、并发应用和网络重放只产生一个批次。
- `reference` 是本次允许引用的已有对象白名单；蓝图里的 `id:<uuid>` 必须同时格式合法且在当前用户、目标模块的可访问清单中。
- 生成响应统一为 `{data:{job,batch,already_applied}}`；`job` 含 `status`、`candidate`、`validation`、`error`、`usage`、`attempts` 和批次摘要，`batch` 为已应用批次或 null。列表接口不含完整候选。
- 本阶段同步执行，单次供应商请求（含成功/错误响应体）受 `timeout_ms` 控制，所有尝试与退避共用 `task_timeout_ms`；不依赖 Fastify 请求接收超时。数据库等待/应用事务不包含在模型运行总时限内。异步 worker 与排队恢复属 S3。
- `/ai/config` 增量返回 `task_timeout_ms`、`quota_window_hours=24`、`quota_unit=generation_jobs`、`quota_refund_policy=reserved_jobs_count_until_window_expiry`、`monetary_budget_enforced=false`。目标/输入校验失败不预留；已预留任务失败/取消不自动退名额，直到窗口过期；重放不另占名额。任务配额不代表人民币费用上限，缺失的供应商用量也不代表零费用。
- 当前可应用的蓝图子集：通用记录模板（`renderer_kind=generic`）、`count/sum/avg/latest` 数值、`unscheduled`/`once` 任务、一次性或按周期（`per_period`）成就；按周期成就必须引用非 `all_time` 数值。`daily/weekly` 周期任务若出现在蓝图中会被明确拒绝并保留候选，不会静默降级。首版不调用真实付费模型：默认 `AI_PROVIDER=mock` 返回确定性模拟蓝图；只有显式配置 `AI_PROVIDER=deepseek` 与 `DEEPSEEK_API_KEY` 才访问 DeepSeek，`/capabilities.cloud_ai` 才为 true。

批次撤销：无真实记录或其他配置引用时删除本次新增定义；一旦被记录、授予或外部配置引用，则归档模块、取消任务、停用数值与成就定义，绝不级联删除真实记录。

## 前端接手范围

`apps/web`、`packages/ui` 已交付 T1 前端（空白首页、五面板、模块筛选、记录表单、关联跳转、响应式与错误状态），并接入本契约的 AI 生成入口。修改共享依赖与 lockfile 仍由集成负责人合并。
测试假数据只在 `tests` 与独立测试数据库使用。`tests/integration/api.test.ts`、`tests/integration/ai.test.ts` 提供完整请求与验收例子，不应用到用户数据库。
