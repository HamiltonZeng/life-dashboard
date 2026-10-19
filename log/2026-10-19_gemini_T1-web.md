# 2026-10-19 Gemini 开发日志：T1 前端与移动体验 (`apps/web`、`packages/ui`)

## 1. 依据与职责边界

- **任务依据**：按照《人生面板：首版本地开发与 Agent 协作规划 v0.1》《人生面板：产品设计文档 v0.2》《T0/T1 API 契约 0.1.0》以及 `log/2026-10-19_codex_T0-T1.md` 的下一阶段交接要求，完成 Gemini 负责的 T1 前端与移动体验开发。
- **允许修改的路径**：`v0.1/apps/web`、`v0.1/packages/ui`、`log/2026-10-19_gemini_T1-web.md`。
- **严禁修改的路径（已严格保持原状）**：`v0.1/apps/api`、`v0.1/packages/contracts`、`v0.1/packages/db`、`v0.1/packages/domain`、`v0.1/tests`、`v0.1/scripts`、`v0.1/infra`、`v0.1/compose.yaml`、`v0.1/package.json`、`v0.1/pnpm-lock.yaml`、`v0.1/.secrets`、`design/`。
- **安全与密钥边界**：未读取、未硬编码、未向 `localStorage` 或前端 bundle 写入 `LOCAL_LOGIN_SECRET`；未向数据库写入任何虚构个人事实数据。

## 2. 本次实现内容

### 2.1 共享 UI 组件库 (`v0.1/packages/ui`)

- `src/tokens.ts`：定义 7 套模块色彩令牌（学习蓝 `blue`、活力绿 `green`、财富琥珀 `amber`、灵感紫 `violet`、珊瑚红 `rose`、晴空青 `cyan`、沉稳灰 `slate`）、10 种内置 SVG 图标令牌、任务状态、三种完成方式（`manual` / `record_optional` / `record_required`）、数值聚合与窗口、字段类型及模块状态元数据。
- `src/components.ts`：提供防 XSS 的 `escapeHtml`、模块徽章 `renderModuleBadge`、矢量图标 `renderIcon`、模块筛选栏 `renderModuleFilterBar`、面板空状态 `renderEmptyState`（仅用于五个业务面板，绝不用于空白首页）及错误横幅 `renderErrorBanner`。
- `src/styles.ts`：提供完整游戏面板视觉样式表，默认深色主题并支持切换浅色高对比主题、支持 `Reduced Motion`（减少动态效果），桌面端采用左侧固定导航栏，移动端（`≤ 768px`）采用顶部当前面板标题栏（含独立首页入口）与底部五面板主导航栏。

### 2.2 前端主应用 (`v0.1/apps/web`)

- `src/types.ts`：严格对齐 `packages/contracts/src/index.ts` 与 `/api/v1/bootstrap` 响应结构。
- `src/api.ts`：封装同域 `/api/v1` 请求客户端：
  - 登录与退出走 `POST /api/v1/session`、`DELETE /api/v1/session`，携带 `credentials: 'same-origin'` 配合服务端 `HttpOnly; SameSite=Strict` Cookie。
  - 所有非会话写操作（`POST` / `PUT` / `PATCH` / `DELETE`）自动生成并携带 `Idempotency-Key: UUID`，对模块编辑、记录更新/软删除、手动完成任务严格传递 `base_version`。
- `src/state.ts`：实现五面板各自独立的筛选状态存储（`moduleId`、`subTab`、`selectedId`、`scrollY`、记录面板的模板/状态/来源记录筛选），支持跨面板显式携带关联与一键「返回原位置」（恢复原面板筛选、选中项与滚动位置）。
- `src/panels.ts` 与 `src/main.ts`：
  1. **独立登录界面**：未登录（`/api/v1/me` 返回 401）时展示本地开发口令登录页，登录成功后获取 `/api/v1/me`、`/api/v1/capabilities` 与 `/api/v1/bootstrap` 一致性快照。
  2. **空白首页 (`/`)**：登录后仅展示通用导航外壳，`<main id="ld-home-blank">` 主内容区域完全留空（无欢迎语、无汇总卡片、无今日任务、无数值概览、无 AI 对话框、无占位文案、不自动跳转到任务面板，严格满足验收项 **P01**）。
  3. **任务面板 (`/tasks`)**：支持模块筛选、范围筛选（全部 / 今日 / 部分完成 / 已完成 / 待复核）、新建任务（支持 `manual`、`record_optional`、`record_required` 及 `exists` / `field_gte` 验收规则）。点击「去记录」跳转到记录面板并自动携带 `module_id`、`record_type_id`、`task_ids=[实例ID]` 与返回上下文，**不预填实际时长或完成事实**（验收项 **P04**）。当单条关联记录未达门槛（如要求 ≥ 10 分钟、实际填写 5 分钟）时，卡片与详情明确诊断并展示差额（验收项 **P05**）。
  4. **记录面板 (`/records`)**：支持模块、记录模板、确认状态（`confirmed` / `draft`）及来源证据筛选；支持**列表视图**、**时间线视图**与 **AI 复盘（日报/周报）子视图**切换（验收项 **P20**）。动态表单按模板字段生成控件，选填字段留空时保持 `null`（不伪装为 `0`），支持单条记录关联多项同模块同模板任务（验收项 **P06**），支持编辑（`PUT`）与软删除（`DELETE`），删除唯一完成证据后自动刷新并展示任务与成就的「完成依据变化，待复核」状态（验收项 **P08**）。
  5. **数值面板 (`/metrics`)**：支持新建 `count / sum / avg / latest` 与 `day / week / month / all_time` 数值定义（非 `count` 聚合自动对齐数值字段单位）。当 `computed.value === null` 时如实展示「暂无数据」，绝不替换为 `0`；真实观测值 `0` 正常显示为 `0`。支持从数值卡片一键「查看来源记录」或「＋ 记一条」添加观测。
  6. **成就面板 (`/achievements`)**：分离展示成就定义与授予记录（`unlocked` / `needs_review` / 未解锁），展示进度条、`include_existing` / `from_activation` 历史范围策略、首次解锁评估时间、规则版本，以及原解锁依据 `original_evidence` 与最新复核依据 `evidence` 对比；支持一键跳转关联数值或筛选解锁依据记录（验收项 **P11**）。
  7. **设置面板 (`/settings`)**：按设计文档第 8 节分为五个子视图——模块管理（四个默认模块 + 新建自定义模块 + 改名/启停/归档，验收项 **P09、P10**）、内容配置与依赖检查（新建通用记录模板 + 模板→任务/数值、数值→成就引用依赖表）、AI 设置与自动填充（如实读取并展示 `cloud_ai: false` 与模块蓝图 1.0 边界）、显示与反馈（深浅主题、减少动效、解锁提示开关）、账户与数据（当前用户、同步游标 `cursor`、阶段能力矩阵、退出登录）。
- `vite.config.mjs`、`dev-server.mjs`、`dev-server.py`：提供本地同域开发服务与 `/api`、`/health` 反向代理（自动转发至 `http://localhost:18080` 并附带 `Origin: http://localhost:18080`），零外部运行时依赖即可在容器内（Node）或宿主机（Python 3）直接运行。

## 3. 验证与测试结果

| 验证项 | 验证方式 | 结果 |
| --- | --- | --- |
| TypeScript 严格模式类型检查 | 使用 `v0.1/node_modules/typescript` 对 `packages/ui/src/*.ts` 与 `apps/web/src/*.ts` 执行 `NodeNext + strict` 完整程序诊断 | **通过（0 错误）** |
| ES 模块构建产物生成 | 编译输出 `packages/ui/dist/*.js` 与 `apps/web/dist/*.js` (`app.js`) | **通过** |
| P01~P11 核心视图与边界单测 | 验证空白首页零内容、单条 5 分钟记录对应 10 分钟任务的差额说明、`null` 显示「暂无数据」而 `"0"` 显示 `0`、待复核徽章、去记录不预填时长 | **全部断言通过** |
| 与运行中 Docker 后端联调 | 通过 `http://localhost:5173` 代理访问运行中的 Docker `gateway` (`http://localhost:18080`) | `/health/ready` 返回 `200 {"status":"ok"}`；未登录访问 `/api/v1/*` 返回 `401`；`/`、`/tasks`、`/metrics`、`/achievements`、`/records`、`/settings` 独立加载均返回 `200` |

## 4. 致集成负责人（Codex）的合并与网关接入说明

按《首版本地开发与 Agent 协作规划 v0.1》第 1、5、7 节约定，前端未修改根 `package.json`、`pnpm-lock.yaml`、`compose.yaml` 与 `infra/gateway/Caddyfile`。目前前端已通过 `http://localhost:5173` 启动并同域代理 `/api/*` 与 `/health/*` 到 `http://localhost:18080`。

后续集成负责人合并主工作区时，如需将前端纳入 `http://localhost:18080` 统一容器入口，可做以下最小变更：
1. 在 `compose.yaml` 中新增 `web` 服务（复用 `*node` 锚点，执行 `node apps/web/dev-server.mjs` 并设置 `WEB_HOST=0.0.0.0`、`API_PROXY_TARGET=http://api:3001`）。
2. 在 `infra/gateway/Caddyfile` 的默认 `handle` 块中将 `respond ... 404` 替换为 `reverse_proxy web:5173`。
