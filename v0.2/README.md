# 人生面板 v0.2 开发工作区

当前为从 v0.1 原样迁入的运行基线，**v0.2 新业务功能尚未开发**。默认仍是已有手动 MVP、空白首页和禁用 AI；页面内旧版本标识留待第一阶段业务实现统一处理。

## 已准备

- 源码、node_modules、缓存、私有配置及数据库移到本目录，未重新安装依赖。
- Compose 项目改为 `life-dashboard-v0-2`，隔离发布项目为 `life-dashboard-v0-2-release`。
- 主入口 `http://localhost:18080`；原 v0.1 容器已停止并保留。
- v0.1 文档保留在 [历史目录](../v0.1/)，开发日志继续保留在根 `log/`。

## 不安装依赖的启动与停止

```sh
cd /Users/zhk/life_dashboard/v0.2
sh scripts/start-existing.sh
docker compose stop
```

该脚本只使用本地镜像与现有依赖，执行迁移/无事实种子并启动服务；缺少依赖或已有私有配置会退出，不重新生成口令。保留的旧 `scripts/start.sh` 是初次安装流程，本次复用环境不必调用。

## 并行开发

先读 [第一阶段规划](../design/v0.2/第一阶段开发规划.md) 和 [接口契约](../design/v0.2/第一阶段接口契约.md)。三个独立工作树位于 `.runtime/worktrees/{codex,gemini,deepseek}`，只读共享依赖，单独使用数据库/密钥/端口。

在本目录用 `sh scripts/agents/start.sh <agent>` 启动自己的环境。不要在工作树内裸用 Compose；所有操作走 `scripts/agents/compose.sh <agent> ...`，避免控制到主集成环境。

依赖只在容器内挂载到 `/workspace/node_modules`，不要求工作树宿主目录再装一份。只读共享树禁止安装器修改；如确需依赖变更由集成负责人处理，本阶段默认不新增依赖。

## 数据与归档

`.runtime/data/postgres` 是当前唯一主数据库物理目录，不是缓存。迁移前备份 `.runtime/migration-v02/v0.1-before-move.dump` 权限 600，内含个人数据；同目录保存源码/依赖哈希、数据指纹、原 Compose 及容器元数据，不入 Git。

旧 v0.1 容器的绑定路径已经迁出，不要直接 Restart 旧项目；回退见 [v0.1 环境归档说明](../v0.1/ENVIRONMENT_ARCHIVE.md)。不能同时用两个 PostgreSQL 进程打开同一物理数据目录。

个人信息、极简模式和新 homepage API 按任务卡开发；周期/趋势/里程碑/代币后续逐阶段接入。真实 AI、3D 和兑换继续只预留接口。
