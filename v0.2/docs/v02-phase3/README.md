# 第三阶段候选验收与运维

执行者 Codex；独立完成，没有启动或委派其他开发 agent。候选分支 `codex/v0.2-release`，起点 d9ab408；来源与资源见 [resources.md](resources.md)，缺陷和 PRD 见 [acceptance.md](acceptance.md)。18080 主环境未升级。

## 重跑

在本机 Codex 工作树的 `v0.2` 目录运行 `sh tests/v02-phase3/run.sh`。使用项目 `life-dashboard-v0-2-codex` 的 `postgres-test/life_dashboard_test`，另建 api-test/web-test/gateway-test，测试服务无主机端口；18181 业务预览不切换测试库。必须同时满足 NODE_ENV=test、PHASE3_ACCEPTANCE=codex-phase3、ACCEPTANCE_PROJECT=life-dashboard-v0-2-codex、DATABASE_HOST=postgres-test、DATABASE_NAME=life_dashboard_test，保护检查不匹配先失败再连接。

旧入口 phase1/run.sh、phase2/run.sh、phase2/run-web.sh 均转至此处。浏览器用例唯一实现位于 tests/web/，不读 Gemini/DeepSeek 目录。每组独立浏览器验收间重启测试 API 清除合成登录的内存限流窗口；生产限流未削弱。重启验收另保留资料/偏好/记录/极简模式、任务原回执/余额/导出一致性检查。

日志和合成截图位于 `.runtime/test-artifacts/v02-phase3/`；总入口任何步骤失败都会返回非零，最终 run.json=FAIL。并发运行多个重置数据库的入口不受支持。四个固定镜像、只读共享依赖、--pull never；无安装器、audit 联网或镜像拉取。初始化或迁移失败时不得继续宣布通过。

## 备份与升级验证

本轮分别保存 18080 PostgreSQL custom dump 和 18181 JSON 导出（0600）。18080 dump 恢复至测试服务器独立库 phase3_main_restore，原两项迁移升级为四项；3 条原记录和全部 mutation_receipts 的内容摘要前后相同，升级无历史钱包补发。主数据库未写入。私有副本只留在 .runtime，不入库。

合成用例 `tests/v02-phase2/upgrade.test.ts` 读取 e6ff267 的旧源码，执行旧版备份→同版空库恢复→当前增量迁移→原键回执重放，旧任务不补奖励。`profile-wallet.test.ts` 检验新版全图空库恢复（资格、流水、里程碑、修订、回执）。`edges.test.ts` 从 d9ab408 真正生成无绑定指纹的旧成功观测回执，在新引擎重放，不依靠伪造回执。原 0001–0004 校验和与基线一致，无表结构或备份格式变化。

## 18080 切换清单（本轮未执行）

1. 记录主库逻辑备份、当前源码 SHA、原 Compose 配置和当前镜像摘要。私有文件留本机，权限 0600。
2. 在独立 PostgreSQL 数据目录恢复备份，验证事实/修订/回执与配置身份；用候选应用迁移验证并保留原备份。
3. 明确维护窗口，停止主 API/Web，切换经核验的候选代码和原主库配置，运行增量迁移，再启动主服务。预览 JSON 不作为主库来源。
4. 验证就绪、登录、GET 首页/任务/资料；如要写入验收，使用可撤销、明确标记的数据并确认实际结果。对照旧记录、回执、净账本。
5. 失败时停止新服务；保留失败库供诊断，另目录恢复原 dump，切回原源码/镜像/配置。禁止旧代码直接写已升级库，禁止两进程共用 PG 物理目录。

## 约定延期与未测范围

AI、3D、兑换和同步仍未开放。360px 是 Chromium 触摸/减少动效模拟，未做真实手机、软键盘或移动系统验证。性能是本机 Docker 合成数据的少量样本，不是容量承诺；不代表联网首次安装、跨设备同步或完整断网运行。普通 GitHub 候选分支上传不等于合并 main 或发布正式 Release。
