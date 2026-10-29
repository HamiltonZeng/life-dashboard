# 人生面板 v0.2 · 0.2.0-rc.1

本机 Docker、单用户工具。记录是事实来源：确认记录会重算任务、数值、成就和奖励；编辑或删除依据后保留历史并更新复核状态。

| 面板 | 本版能力 |
| --- | --- |
| 首页 | 今日每日任务、有效固定任务（最多 5 项）、两张固定趋势、成就摘要、真实钱包、极简模式 |
| 个人资料 | 通用资料字段；观测写入来源记录；派生字段只读；绑定变更需重新确认 |
| 任务 | 主线/每日/周常/月常、当期按需生成、规则快照、手动撤回/取消、奖励资格与冲正 |
| 数值 | 日序列、自然月份、聚合粒度、零与缺失分离、视图排除与来源核查 |
| 成就 | 分级里程碑、历史依据、撤销复核与恢复原身份 |
| 记录/设置 | 模板、确认/草稿、修订/软删除、自定义模块、导出及空库恢复 |

未开放：真实 AI、3D/兑换、同步、专业健康/财务功能。旧蓝图与适配器保留供后续版本使用，默认不会调用模型。

## 已有本机环境

主工作区 `v0.2` 下运行 `sh scripts/start-existing.sh` 复用依赖和私有配置，执行增量迁移后启动 18080。**本轮没有执行主环境切换**；操作前按[升级清单](docs/v02-phase3/README.md)备份并验证恢复。不要把预览库覆盖到主库。

Codex 候选仍位于 `v0.2/.runtime/worktrees/codex/v0.2`，由主工作区的 `sh scripts/agents/compose.sh codex …` 管理，预览端口 18181。验收用独立合成数据库和无外部端口的测试服务。

## 新目录离线试运行

Docker 已启动，四个固定镜像和依赖已存在。以下命令以新克隆目录中的 `v0.2` 为工作目录：

```sh
export LIFE_DASHBOARD_DEPENDENCIES=/absolute/path/to/existing/v0.2
# 仅新目录第一次创建本机私有配置；已有文件会保留。生成结果不入 Git。
docker run --rm --pull never --network none -v "$PWD:/workspace" -w /workspace node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 node scripts/init.mjs
sh scripts/release/start-existing.sh
# http://localhost:18184 ; 口令在该目录 .secrets/development.env 的 LOCAL_LOGIN_SECRET
sh scripts/release/compose-existing.sh stop
```

该便携入口固定使用独立项目 `life-dashboard-v0-2-release`，不依赖原作者绝对路径，不安装依赖、不拉镜像。首次全新联网安装可用 `scripts/start.sh`，本轮未测试下载路径。

## 验收与数据

Codex 工作树内执行 `sh tests/v02-phase3/run.sh`，所有工具在容器中运行。旧 phase1/phase2 入口转入此入口，20+15 浏览器场景共用一份源文件；不得同时跑多个会重置合成库的验收。详见[结果与限制](docs/v02-phase3/README.md)。

私有目录 `.secrets`、`.runtime`、依赖、数据库、dump 和个人导出均不入 Git。JSON 导出保存事实、配置、修订、回执、奖励链；恢复要求对应迁移和空目标。迁移 0001–0004 原样保留。协议增加观测绑定指纹，无新增表结构或备份格式迁移。

v0.1 容器继续停止保留；旧物理路径已迁移，回滚前读 [ENVIRONMENT_ARCHIVE](../v0.1/ENVIRONMENT_ARCHIVE.md)，禁止两个 PostgreSQL 进程同时打开同一数据目录。
