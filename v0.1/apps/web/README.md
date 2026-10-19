# 人生面板 v0.1：T1 前端 + T2/T3 AI 生成接入 (`apps/web` & `packages/ui`)

本目录包含按《产品设计文档 v0.2》《首版本地开发与 Agent 协作规划 v0.1》及 `packages/contracts/README.md` 契约实现的 T1 前端与移动体验层，并接入 T2/T3 的 AI 生成配置（模块蓝图 1.0）界面。

## 职责与文件所有权边界

- **所属目录**：`v0.1/apps/web`、`v0.1/packages/ui`。
- **契约遵循**：严格对接 `/api/v1` 契约，不修改 `apps/api`、`packages/contracts`、`packages/ai`、`packages/db`、`packages/domain`、主 `package.json` 或 `pnpm-lock.yaml`。
- **安全边界**：绝不读取或内嵌 `.secrets/development.env`，不将 `LOCAL_LOGIN_SECRET` 存入 `localStorage` 或前端构建产物；通过 `POST /api/v1/session` 与同域代理交换 `HttpOnly; SameSite=Strict` 会话 Cookie。AI API Key 只存在于服务端，前端不提供 Key 输入、不读取、不缓存。

## 路由与页面

| 路由 | 页面 | 核心能力 |
| --- | --- | --- |
| `/` | 空白首页 | 仅保留通用导航外壳；主内容区域无欢迎语、无卡片、无占位文案、无示例数据、不自动跳转（验收项 P01） |
| `/tasks` | 任务面板 | 模块筛选、状态筛选、新建任务（`manual` / `record_optional` / `record_required`）、去记录关联跳转、单条门槛差异诊断、待复核标记、`✦ AI 生成` 入口 |
| `/metrics` | 数值面板 | 模块与时间窗口筛选、`count / sum / avg / latest` 精确统计展示、空值如实显示「暂无数据」（不替换为 0）、查看来源记录、快捷添加观测、`✦ AI 生成` 入口 |
| `/achievements` | 成就面板 | 定义与授予分离、进度条、历史追溯策略、首次解锁时间与依据、唯一完成证据变更后的「待复核」核查、`✦ AI 生成` 入口 |
| `/records` | 记录面板 | 列表视图 / 时间线视图 / AI 复盘子视图切换、动态模板表单、未知值留空保持 `null`、草稿与已确认分离、多任务关联、软删除与版本冲突处理；「AI 复盘」如实标注报告尚未实现，不伪造内容 |
| `/settings` | 设置面板 | 模块管理、记录模板创建与内容依赖检查表、**AI 设置与自动填充（实时 `/ai/config`、最近生成任务、发起生成）**、深浅主题与减动效切换、本地会话管理 |

## AI 生成界面

- **设置 → AI 设置与自动填充**：实时读取 `GET /api/v1/ai/config`，展示 provider、`cloud_ai`、configured、model、蓝图 schema 版本、尝试/超时/每日上限与支持子集；列出 `GET /api/v1/ai/generations` 最近任务并从服务端读取真实状态。`provider=mock` 或 `cloud_ai=false` 时明确标注“本地确定性模拟供应商 / 不调用 DeepSeek / 无云端费用”。
- **生成弹窗**：`create` / `extend` 两种模式；create 可填写新模块名称/图标/主题色（作为明确要求写入提示，契约本身只接收 prompt 等字段），extend 选择启用中的目标模块并可选 `reference` 白名单；勾选 `record_types / metrics / tasks / achievements` 内容类型；填写 4000 字内需求；选择“生成并添加”或“仅预览候选”；时区取自当前用户资料。
- **结果与校验**：按服务端返回渲染 `job.status`、`validation.errors`（解析/结构/语义/权限/业务各层的 code、path、message，含类型错误）、warnings、候选蓝图摘要与逐项计数；预览候选显示“应用候选配置”，应用后显示批次摘要与“撤销本次添加”。网络重放/重复应用显示同一批次，不叠加。
- **诚实边界**：不生成或虚构真实记录，不声称已解锁/已完成；mock 结果不描述为真实 DeepSeek 调用；422（含 `details.job_id`）与 409/429/503 等错误按服务端原文展示，失败时保留候选与错误，不部分应用。

## 构建与本地运行

统一入口由 Caddy 提供：`http://localhost:18080` 的 `/api/*`、`/health/*` 转发到 api，其余路径转发到 web 服务（`apps/web/dev-server.mjs`，容器内监听 `0.0.0.0:5173`，配置 `API_PROXY_TARGET=http://api:3001`、`APP_ORIGIN=http://localhost:18080`）。

前端源码构建（在 tools 容器内，无需宿主机 Node）：

```sh
# 输出 packages/ui/dist/*.js、apps/web/dist/*.js 与入口 apps/web/dist/app.js
docker compose run --rm tools corepack pnpm build:web
```

`scripts/build-web.mjs` 使用 TypeScript compiler API 编译两个源码目录，并把浏览器端 import 从 `../../../packages/ui/src/index.js` 改写为静态服务可访问的 `/packages/ui/dist/index.js`。`dist/` 已 gitignore，`web` 容器每次启动会先构建再提供服务。

只启动前端相关服务：

```sh
docker compose up -d --wait api web gateway
```

单独调试 web 服务（容器/宿主机均可，需 Node 24）：

```sh
WEB_HOST=127.0.0.1 WEB_PORT=5173 API_PROXY_TARGET=http://localhost:18080 APP_ORIGIN=http://localhost:18080 node apps/web/dev-server.mjs
# 或使用仓库内无依赖的 Python 版本
python3 apps/web/dev-server.py
```
