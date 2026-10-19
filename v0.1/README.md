# 人生面板 v0.1：本机手动记录 MVP

本机 Docker 运行的单用户网站。首页保持空白，通过任务、数值、成就、记录、设置五个面板使用；默认包含学习与发展、饮食与锻炼、财富与收获、娱乐和交际四个模块，也可手动建立自定义模块。

本版保留手动配置、通用记录、关联任务、可追溯统计与成就、浏览器草稿、冲突处理和人工导出/恢复。AI、报告、同步、PWA 离线、周期调度及专业账本不作为发布功能。完整范围见 [发布说明](RELEASE_NOTES.md)、[延期清单](docs/DEFERRED_FEATURES.md)。

## 启动、停止与登录

宿主机需已启动的 Docker Desktop、shell 和 Git；无需宿主 Node/pnpm/PostgreSQL。首次运行需联网拉取固定镜像和依赖。

```sh
cd /Users/zhk/life_dashboard/v0.1
sh scripts/start.sh
```

入口：[http://localhost:18080](http://localhost:18080)，只绑定本机回环地址；数据库不映射宿主端口。健康检查 `/health/ready`。电脑休眠或 Docker 停止时不能提交服务器记录。

首次启动自动生成 `.secrets/development.env`，目录权限 700、文件 600；重复启动不覆盖。用编辑器打开该本地文件，将 `LOCAL_LOGIN_SECRET` 的值输入登录页；不要放进源码、截图或日志。会话 Cookie 为 HttpOnly、SameSite=Strict，7 天有效；设置 → 账户与数据可退出。

```sh
# 停止服务（保留数据）
docker compose stop
# 继续使用（默认 mvp 发布模式）
docker compose up -d --wait api web gateway
```

`APP_PROFILE` 默认 `mvp`，非法值拒绝 API 启动。发布模式 AI 能力为 false，直接访问 AI 写 API 也返回 `409 FEATURE_DISABLED`；不会创建生成任务或调用模型。遗留错误模型配置不会阻断手动记录，已有 AI 来源定义与历史数据不删除。

仅开发者回归旧 AI/mock 时显式切换：

```sh
APP_PROFILE=development docker compose up -d --force-recreate api web
# 恢复发布模式
APP_PROFILE=mvp docker compose up -d --force-recreate api web
```

开发模式默认 mock，不需要真实模型密钥；真实模型没有作为本版验收条件。冻结语义见 [MVP 契约](docs/MVP_CONTRACT.md)。

## 如何记录与理解状态

从任务“去记录”会带上模块、模板和任务关联，实际时长等由用户填写；也可以直接记录。单条 5 分钟不足 10 分钟门槛时真实保存、任务部分完成；改为 10 后重算。一条记录关联多个任务只统计一次。没有观测显示“暂无数据”，真实的 0 保留为 0；草稿记录不参与统计。

- **已保存本机**：当前浏览器的草稿，刷新后可恢复；尚未代表服务器收到。浏览器清理站点数据可能丢失它。
- **等待确认／结果未知**：完整操作在发请求前保存到当前浏览器。刷新后选择继续草稿，再“确认上次提交”，沿用原键和冻结载荷确认；不要另外创建一条。
- **未知后修改输入**：先确认原提交，修改仍保留为草稿；随后明确保存到同一条记录，不会自动另建事实。
- **未保存本机**：存储被阻止、满额或内容损坏。输入保留在当前页面，提供“复制输入”；可靠提交路径不会绕过持久化就发送。
- **冲突待处理**：本地输入和原编辑版本保留。先拉取最新值核对；只有点击“采用此版本作为编辑基线”后，才可按新版本提交。普通刷新不授予覆盖权限。
- **服务器已确认**：回执已经验证；后续列表刷新失败不改判写入失败，也不要求重新建记录。

软删除或修改唯一证据会重算任务/数值，并保留成就历史与“需复核”依据。已取消/跳过的任务不能重新完成。模板字段 key、类型与单位破坏性变更尚无迁移入口。

健康、财富目前是通用随记，不提供营养算法、训练处方或财务账本。手机宽度布局可用，但本版承诺限于本机浏览器，不包含手机可信 HTTPS、真正离线或跨设备恢复。

## 人工导出与恢复

设置 → 账户与数据 → **导出数据** 下载 JSON；也可在容器内执行：

```sh
docker compose run --rm --no-deps tools corepack pnpm export:data
```

默认文件位于 `.runtime/backups/`，CLI 创建/覆盖后权限为 600。导出的是服务器已落库数据：定义、记录（包含服务器草稿及软删除墓碑）、修订、成就依据、变更日志与幂等回执。它不包含浏览器草稿/未确认操作包、登录会话/凭据、AI 生成任务/批次审计。已经服务器提交但浏览器尚待确认的记录仍属于服务器数据。

备份含个人内容，请自行保管并另外存一份异机副本；同盘目录不能防设备损坏。SHA-256 只检查完整性，不是加密或防对抗签名。

恢复要求目标库为空、迁移清单完全一致；单事务校验/写入，失败回滚。下面只创建并恢复一个新库，不覆盖当前开发库：

```sh
docker compose exec postgres createdb -U life_dashboard life_dashboard_restore
docker compose run --rm --no-deps -e DATABASE_NAME=life_dashboard_restore tools corepack pnpm db:migrate
docker compose run --rm --no-deps -e DATABASE_NAME=life_dashboard_restore tools corepack pnpm restore:data --file .runtime/backups/你的备份.json
```

不要在恢复前对目标执行 seed。默认拒绝恢复到 `life_dashboard`；即使显式 `--allow-development` 也必须为空，不能合并或覆盖现有数据。恢复后不恢复登录态，需要重新登录。

若要用恢复库启动网站，创建自己的本地 Compose 覆盖文件，将 `services.api.environment.DATABASE_NAME` 指定为 `life_dashboard_restore`，再显式与 `compose.yaml` 一起启动；原库保留。恢复不是页面操作或同步协议。示例：

```yaml
# .runtime/restore.override.yaml
services:
  api:
    environment:
      DATABASE_NAME: life_dashboard_restore
```

```sh
docker compose -f compose.yaml -f .runtime/restore.override.yaml up -d --force-recreate api
```

## 一条命令发布验收

```sh
sh scripts/release/verify-mvp.sh
```

该命令执行类型/单元、旧 development/mock 集成、Web 套件、构建/契约/审计，再在独立 Compose 项目运行真实 Chromium → 同源网关 → API → PostgreSQL 的 A01–A16。包含丢回执/刷新、改值、损坏成功回执、存储失败、双页面冲突、真实导出/空库恢复与应用重启。浏览器缺失会失败，必测项无 SKIP 放行。

测试使用假口令、独立网络和临时 PostgreSQL，无外部发布端口；退出后移除隔离项目。结果在 `.runtime/test-artifacts/stage3-final/`，`run.json` 为本轮状态，`acceptance.json` 为逐项矩阵，另有日志、环境信息和桌面/360px 截图。360px 是容器 Chromium 视口模拟，没有手机实机/软键盘验收，也没有声称 CI。

浏览器库和官方镜像固定版本/摘要。浏览器可执行文件属于固定测试镜像、由 Docker Engine 保存；用户档案、下载和测试产物在当前版本目录，不读取宿主浏览器或真实登录口令。

## 目录与技术边界

`apps/web` 为原生 TypeScript/HTML UI，`build-web.mjs` 用 TypeScript compiler API；当前没有迁移 React/Vite。Fastify + Zod API、PostgreSQL 18、参数化 SQL/编号迁移、Decimal.js/Luxon 规则保留；Drizzle 使用有限。参考 [ADR 0001](docs/adr/0001-current-implementation.md)、[ADR 0002](docs/adr/0002-minimal-export-restore.md)。

| 路径 | 含义 |
| --- | --- |
| `.runtime/data/postgres` | 用户持久数据库；不要当缓存删除 |
| `.runtime/data/uploads` | 附件预留，当前无上传功能 |
| `.runtime/backups` | 人工备份文件，含个人数据 |
| `.runtime/cache`、`.runtime/tmp` | 项目可控缓存和临时文件 |
| `.runtime/test-artifacts` | 隔离验收产物，仅测试夹具 |
| `.secrets` | 服务端本地口令与配置 |
| 根目录 `log/` | 开发日志和最终验收记录 |

密钥、数据、备份、缓存、node_modules、dist 均不纳入 Git。Docker 镜像/BuildKit/容器标准输出由 Engine 管理；浏览器存储由当前设备和 Origin 管理。不要清空整棵 `.runtime`。当前是小规模个人 MVP，全量快照/逐行恢复尚未针对大数据量优化。
