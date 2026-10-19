# `@life-dashboard/web` — 前端工作台与 S0-B / S1 自动化核验说明

## 1. 模块化目录结构 (`S0-B`)

`apps/web/src/` 已从早期单文件拆分为职责清晰的平铺模块（完全兼容根目录 `scripts/build-web.mjs` 的非递归 `src/*.ts` 编译，新模块必须保持平铺）：

- `types.ts`：前后端 DTO、草稿提交状态机 (`DraftSubmissionState`)、冲突横幅、导出载荷 (`UserExportPayload`) 与全局状态类型定义
- `storage.ts`：浏览器持久化适配层（`life_dashboard_v0_1_record_drafts` 本机草稿、`life_dashboard_v0_1_pending_ops` 未知网络结果挂起操作、`life_dashboard_v0_1_prefs` 视图/筛选偏好；严禁存储 `LOCAL_LOGIN_SECRET`）
- `api.ts`：REST API 客户端、幂等头 `Idempotency-Key` 透传、网络异常 (`isUnknownNetworkError`) 与 `409` 冲突解析、`GET /api/v1/export` 导出读取
- `state.ts`：前端状态初始化、草稿同步、未保存输入快照保护 (`captureActiveFormSnapshot` / `restoreActiveFormSnapshot`) 与导出 UI 状态
- `panels.ts`：五大面板（任务 `/tasks`、数值 `/metrics`、成就 `/achievements`、记录 `/records`、设置 `/settings`）纯函数渲染
- `export.ts`：S1 最小导出的纯函数（文件名按时区生成、载荷校验、序列化），便于在无 DOM 环境下回归
- `ai-views.ts`：AI 建议预览/采纳/撤回工作流面板与 **蓝图 1.0 vs 当前正式定义支持矩阵 (`AI_BLUEPRINT_SUPPORT_MATRIX`)**
- `modals.ts`：局部挂载的弹窗渲染层 (`#ld-modal-layer`)
- `forms.ts`：S1 记录可靠提交控制器（显式区分本机草稿、等待确认、网络结果未知、服务器已确认、409 冲突待处理）
- `main.ts`：三层局部 DOM 挂载 (`#ld-main-region` / `#ld-modal-layer` / `#ld-toast-layer`)、全局事件委托入口与导出文件下载

## 2. S1 最小导出（人工备份）

设置面板 →「账户与数据」分组提供诚实的 **「导出数据」** 按钮：

- 调用 `GET /api/v1/export`（同源 `credentials: 'same-origin'`，只读），由服务端在事务中生成当前账户的完整白名单数据快照；
- 浏览器把服务端返回的导出信封原样下载为 `life-dashboard-<YYYY-MM-DD>.json`（日期按用户 IANA 时区解析），文件内保留 `format`、`schema_version`、`checksum`、`migrations` 与各数据表，**可直接作为 CLI 恢复命令的输入**；
- 页面只提供导出，**不提供恢复入口**（恢复是对空库执行的 CLI 操作，避免误合并/覆盖数据）；
- 成功后展示表数/行数/校验和前缀与文件名，失败时展示真实错误；导出内容与文件名不写入 `localStorage`，也不打印到控制台，不含任何登录口令或会话 Cookie。

## 3. 自动化构建与回归验证 (`S0-B` + `S1`)

所有项目命令都在 Docker 的 `tools` 服务内执行（宿主机不安装项目 Node 依赖），工作目录为 `v0.1`：

```bash
cd v0.1
# 构建前端产物（UI + Web + app.js 入口）
docker compose run --rm --no-deps tools corepack pnpm build:web
# TypeScript 严格类型检查
docker compose run --rm --no-deps tools corepack pnpm typecheck
# DOM-less 逻辑回归：S0-B 8 项 + S1 记录可靠性/导出（当前 12 个套件）
docker compose run --rm --no-deps tools corepack pnpm exec tsx apps/web/scripts/verify-web.ts
# 等价写法（通过 apps/web/package.json 的 verify 脚本）
docker compose run --rm --no-deps tools corepack pnpm --filter @life-dashboard/web verify
```

- 运行器：`apps/web/scripts/verify-web.ts`（Node + 仓库内已固定的 `tsx`，不再依赖 macOS JavaScriptCore；较早的 Python/JSC `verify-web.mjs` 已删除）。
- 报告落盘：`.runtime/test-artifacts/stage2-web/s0b-s1-verification-report.json`；任一失败时进程以非 0 退出。

### 3.1 诚实的能力边界（重要）

`verify-web.ts` 是 **DOM-less 逻辑核验**：它在 Node 中渲染 HTML 字符串、调用状态/存储/幂等辅助函数并做断言，因此能在 Docker 内一条命令复跑。它 **不能** 证明：

- 真实浏览器中的 CSS 布局、360px 视口与底部导航是否遮挡（只校验样式字符串存在）；
- 真实 Cookie 会话、同源请求、文件下载行为；
- 真实点击链路（事件委托、表单提交）。

这些由下面的宿主侧真浏览器冒烟单独补充，二者不能互相替代。

## 4. 宿主侧真浏览器冒烟（不在 Docker 内）

浏览器未安装进 `tools` 镜像，所以这是 **仅宿主侧** 的补充冒烟，不属于 `pnpm verify`：

```bash
cd v0.1
node apps/web/scripts/verify-browser.mjs
```

- 依赖：Node >= 22（使用内置 `fetch` + 内置 `WebSocket` 作为最小 CDP 客户端，**零 npm 依赖**）与宿主已安装的 Edge/Chrome/Chromium；找不到浏览器可执行文件时打印 `SKIP` 并以 0 退出（可用 `LD_BROWSER_PATH` 指定）。
- 目标：统一入口 `http://localhost:18080`（可用 `LD_BASE_URL` 覆盖），要求 API/Web/Gateway 已由 `docker compose up` 启动。
- 覆盖：未登录登录页渲染；通过 `POST /api/v1/session` 写入同源会话 Cookie 后首页保持空白；`/tasks` 渲染；设置面板 AI 区（配置卡、支持矩阵、发起按钮）；360px 视口 5 项底部导航可见且贴底；全程无 uncaught 页面错误/console.error；并额外真实点击「导出数据」验证下载文件 `life-dashboard-<date>.json` 的 `format/schema_version/checksum/data` 齐全。
- 口令：只从环境变量 `LOCAL_LOGIN_SECRET` 或 `.secrets/development.env` 读取，用于一次同源登录请求，**不打印、不落盘**。
