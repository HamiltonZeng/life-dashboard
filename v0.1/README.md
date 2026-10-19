# 人生面板 v0.1：五面板前端 + T2/T3 AI 生成

本目录是本地开发工作区，当前已包含 T0/T1 后端、T1 前端（空白首页与五面板）以及 T2/T3 AI 生成配置（模块蓝图 1.0）。固定入口 `http://localhost:18080` 由 Caddy 统一提供：`/api/*`、`/health/*` 反向代理到 Fastify，其余路径（SPA 路由、`/dist/*.js`、`/packages/ui/dist/*.js`）由 web 服务提供。首版默认 AI 供应商为本地确定性 mock，不是真实 DeepSeek 调用。本交付不是整版发布。

## 启动

宿主机只需已启动的 Docker Desktop 和 shell。所有项目命令在容器中执行，无需在宿主机安装 Node/pnpm/PostgreSQL。

```sh
cd /Users/zhk/life_dashboard/v0.1
sh scripts/start.sh
```

启动流程会 frozen 安装依赖、执行迁移与无事实种子，然后拉起 `api`、`web`、`gateway`。`web` 容器启动时先运行 `corepack pnpm build:web`（TypeScript compiler API 编译 `packages/ui/src` 与 `apps/web/src` 到各自 `dist`，再改写浏览器 import 到 `/packages/ui/dist/index.js`），随后用 `apps/web/dev-server.mjs` 提供静态文件并同域代理 `/api`、`/health` 到 `api:3001`。`dist/` 已被 gitignore，可随时由源码重建。

固定入口 `http://localhost:18080`，健康检查 `/health/ready`，业务接口 `/api/v1`。默认只绑定 `127.0.0.1`，数据库不映射宿主端口。
首次启动随机生成 `.secrets/development.env`，目录 700、文件 600；重复启动保留密钥与数据。不要把该文件传给前端代码或纳入版本库。

停止：`docker compose stop`。继续：`docker compose up -d --wait api web gateway`。
`docker compose down` 不删除绑定目录，但不要删除 `.runtime/data`；不要将整个 `.runtime` 当缓存清空。

## 已实现

- 四个默认模块和基础通用模板；初始任务、记录、数值定义与成就授予为空。
- 无欢迎语、无卡片、无示例数据的空白首页；五个独立面板与跨面板关联跳转。
- 新建模块/模板/任务/数值/成就；模块改名与启停归档；模板与数值/成就依赖检查。
- 手动、记录可选、记录必需三种完成方式；不定日期或单日任务实例。
- 记录新增、读取、修改、软删除，模板/字段/关联与日期校验；未知值保持 null、草稿不计入统计。
- 确认且未删除的唯一记录驱动 count/sum/avg/latest；当地自然日、周一开始的周、月、累计窗口。
- 十进制字符串保证精确聚合；无有效样本返回 null，观测值 0 保留为 0；成就定义与授予分离、待复核标记。
- 服务端写锁、UUID 幂等键、版本冲突、审计修订与同步变更日志基础。
- 本地单账户开发登录、7 天 HttpOnly/SameSite 会话、Origin 校验、登录限速、退出撤销。
- AI 生成配置（`packages/ai`、T2/T3）：`GET /api/v1/ai/config` 如实返回 provider / cloud_ai / model / 蓝图版本与支持子集；生成任务支持 create/extend、四类内容、apply/preview、失败保留候选、预览应用、受控重试、取消、幂等重放与批次撤销（无引用删除定义，有引用归档/停用且不删除真实记录）。
- 模块蓝图 1.0 五层校验：完整 JSON 解析、结构（未知字段/枚举/边界）、语义（引用/单位/字段/周期）、权限与版本（用户、目标模块、允许引用、模块版本）、业务（不写真实事实、不直接授予成就、不覆盖已有配置）。
- 可应用蓝盘子集：通用记录模板、`count/sum/avg/latest` 数值、`unscheduled` 或 `once` 任务、一次性或按统计周期（`per_period`）成就。`daily/weekly` 周期任务与超出子集的规则会被明确拒绝并保留候选，不会静默降级。
- 设置面板展示实时 AI 配置与最近任务；任务/数值/成就面板与设置提供「✦ AI 生成」入口。

学习模板的 `duration_minutes` 可空：用户只知道学了什么时可以保存，累计次数增加但分钟数保持未知。娱乐、健康、财富初始模板只记文本；不是营养计算器、训练量算法或正式账本。AI 只生成配置定义，不生成真实记录，也不会直接完成或解锁任何任务与成就。

## AI 配置与边界

默认 `AI_PROVIDER=mock`：服务端使用本地确定性模拟供应商，返回可校验的蓝图但不访问任何模型 API，`/capabilities.cloud_ai=false`，前端明确标注“本地确定性模拟供应商”。这保证开发与测试不产生云端费用，也不把模拟输出说成真实 DeepSeek 响应。

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `AI_PROVIDER` | `mock` | `mock` 或 `deepseek`；仅显式设置才会访问真实接口 |
| `DEEPSEEK_API_KEY` | 空 | 只从 `.secrets/development.env` 读取，不返回浏览器、不写日志/蓝图/导出 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型 ID 可配置，不把某一代模型名写进产品规则 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 必须为 https；仅本地测试可显式允许 http |
| `AI_TIMEOUT_MS` / `AI_MAX_ATTEMPTS` | `6000` / `2` | 一次供应商调用的完整时限（含响应体）与每任务累计尝试上限；单次配置范围 1000–10000ms，最多 3 次 |
| `AI_TASK_TIMEOUT_MS` | `12500` | 本次生成或显式重试的模型运行总时限，含尝试与退避；配置范围 1000–13000ms，不等于整个 HTTP handler 的保证 |
| `AI_DAILY_JOB_LIMIT` | `100` | 每用户滚动 24h 新建任务数上限；事务内预留，超限返回 429，手动功能不受影响；不是人民币费用预算 |
| `AI_MAX_OUTPUT_TOKENS` | `4096` | 结构化输出上限；截断会作为 `AI_OUTPUT_TRUNCATED` 明确失败 |

生成 API（均需同域会话；写入需要 `Idempotency-Key` 与 `Origin`）：`POST /api/v1/ai/generations`、`GET /api/v1/ai/generations[/{id}]`、`POST /api/v1/ai/generations/{id}/apply`、`/retry`、`/cancel`、`GET /api/v1/ai/batches[/{id}]`、`POST /api/v1/ai/batches/{id}/revoke`。生成失败返回 `BLUEPRINT_*`、`AI_AUTH`、`AI_QUOTA`、`AI_TIMEOUT`、`AI_UNAVAILABLE` 等明确错误并保留候选；不会留下半套配置。

本阶段生成请求同步执行，模型尝试与退避受独立业务时限约束；数据库锁等待与配置应用不是这个模型时限的一部分。Fastify `requestTimeout` 不是 handler 执行总时限。尚未接入 pg-boss worker 与排队恢复；真实 DeepSeek 适配器存在但没有付费验收，模型兼容性与费用留待 S3。日报/周报仍未实现。

配额语义：目标/输入预检失败时事务回滚，不占任务名额；预留成功的任务无论供应商失败、候选取消或批次撤销，都保留名额直到滚动 24h 过期，避免未知模型扣费被当成免费。相同幂等键重放不占新名额；显式重试沿用同一任务和累计尝试上限，已报告 token 用量累计保留。供应商失败且未返回用量的调用费用仍未知，不能将记录中的 0 当作零费用；本阶段未实现货币预算与实际账单结算。

## 验证

S0-A 后端、既有规则、构建与审计可统一运行，输出写入 `.runtime/test-artifacts/stage2-codex`：

```sh
sh scripts/verify-backend.sh
```

该命令不是浏览器 E2E 验收；前端 S0-B 与 S1 草稿/稳定提交仍由对应任务交付。当前技术实现与保留理由见 [ADR 0001](docs/adr/0001-current-implementation.md)。

```sh
docker compose run --rm tools corepack pnpm typecheck
docker compose run --rm tools corepack pnpm build:web
docker compose run --rm tools corepack pnpm test
docker compose --profile test run --rm test
docker compose run --rm tools corepack pnpm audit --prod
```

统一入口自查（无需额外工具）：

```sh
for p in / /tasks /metrics /achievements /records /settings /dist/app.js /packages/ui/dist/index.js /health/ready; do
  printf '%s -> ' "$p"; curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' "http://localhost:18080$p"
done
curl -sS -o /dev/null -w 'unauth /api/v1/me -> %{http_code}\n' http://localhost:18080/api/v1/me
```

数据库测试使用 `postgres-test / life_dashboard_test` 的 tmpfs，三重环境保护后才允许清理测试表；不会清理主数据库。

持久化验证在**独立的 `life_dashboard_persistence_test` 数据库**写入测试夹具，强制重建主 PostgreSQL 容器后读回，成功后删除该测试库：

```sh
sh scripts/verify-persistence.sh
```

此命令会短暂中断 API 数据库连接，请在本地开发空闲时执行。失败会保留探针库供检查，不自动覆盖后重试。
初始空库的实际 HTTP 验收：`docker compose run --rm tools corepack pnpm exec tsx scripts/smoke.ts`；已有自己的数据时不要再用这个要求初始为空的脚本。

## 目录与路径

| 路径 | 内容 |
| --- | --- |
| `apps/api` | Fastify 服务与统一事务命令处理 |
| `apps/web` | T1 前端（空白首页、五面板、AI 生成弹窗）与同域静态/代理开发服务器 |
| `packages/ui` | 共享 UI 令牌、组件、样式与 AI 状态元数据 |
| `packages/ai` | T2/T3 模型适配层（默认 mock）、蓝图解析/校验/应用与批次撤销 |
| `packages/contracts` | Zod 请求定义、导出 JSON Schema/OpenAPI、前端接入说明 |
| `packages/domain` | 纯规则：校验、精确统计、时区窗口、任务验收 |
| `packages/db` | node-postgres/Drizzle 连接、编号 SQL 迁移与无事实种子 |
| `scripts/build-web.mjs` | 用 TypeScript compiler API 构建 `packages/ui/dist` 与 `apps/web/dist`（含 import 改写） |
| `infra/gateway/Caddyfile` | 统一入口：`/api`、`/health` 到 api，其余到 web |
| `.runtime/cache` | pnpm/Corepack/npm/Caddy/浏览器等项目可控缓存 |
| `.runtime/tmp` | tsx、项目临时文件 |
| `.runtime/data/postgres` | PostgreSQL 18 真实持久数据，容器挂 `/var/lib/postgresql` |
| `.runtime/data/uploads` | 附件预留目录，上传 API 尚未实现 |
| `.runtime/backups` | 备份预留目录，恢复流程待 T5 |
| `.runtime/test-artifacts` | 验收产物和持久化探针标识 |
| `.secrets` | 本地服务端私密配置 |

Docker 镜像与 BuildKit 缓存属于 Docker 全局存储；浏览器 IndexedDB/Service Worker 缓存由设备与 Origin 管理。这些不宣称存于本目录。容器 `/tmp` 为临时 tmpfs；项目 TMPDIR 指向版本目录。
API 当前输出到容器标准输出，使用 `docker compose logs api` 查看，Docker 自身日志也由 Engine 管理；`.runtime/logs` 是应用文件日志预留目录。开发任务日志单独保存在根目录 `log`。
镜像已锁定拉取时的 manifest 摘要；依赖已锁 `pnpm-lock.yaml`，启动只允许 frozen 安装。主数据库和测试数据库分离；不得让其他版本共享当前数据目录。

## 后续阶段与限制

前端与统一入口已接入：`http://localhost:18080/` 与五个面板路由均由同一 Caddy 入口提供，`/dist/app.js`、`/packages/ui/dist/index.js` 来自源码构建的 dist（gitignored）。当前接口只保证小规模本地开发；列表虽然分页，内部仍读取一致性快照，后续需按数据规模改为 SQL 分页。

T2 剩余：完整配置编辑/模板迁移与依赖迁移工具、周期模板调度与实例生成（当前蓝图中的 `daily/weekly` 任务会被明确拒绝）、更多周期成就配置入口。T3 剩余：真实 DeepSeek 账号联调与模型能力/费用实测、异步 worker 与排队恢复、真实失败重试的模型侧兼容验证；已交付适配器隔离、五层校验、原子应用、幂等、重试/取消与撤销。T4：Better Auth 正式账号/设备会话、离线 outbox、同步 push/pull/ack、手机可信 HTTPS。T5：pg-boss worker、日报周报、备份恢复演练与发布验收。

AI 生成只写配置定义（记录模板、数值、unscheduled/once 任务、一次性或按周期成就），从不写入真实记录、当前数值、完成状态或成就解锁；模型输出中的这些字段会被严格拒绝。批次撤销不会级联删除真实记录。`/capabilities` 如实返回未实现能力为 false；`cloud_ai` 只在真实 DeepSeek 已配置时为 true。当前本地登录入口只供开发；未采用 Better Auth，不可据此宣称满足正式多设备鉴权。本轮 T2/T3 交付日志：`log/2026-10-19_deepseek_T2-T3-ai.md`。

实施核对资料：[Fastify](https://fastify.dev/docs/latest/Reference/Server/)、[Drizzle](https://orm.drizzle.team/docs/get-started-postgresql)、[PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)。阶段日志在项目根目录 `log/`。
