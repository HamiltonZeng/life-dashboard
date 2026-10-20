# v0.2 第二阶段后端交付

日期：2026-10-20。基线 e6ff267；分支 v02/phase2-codex。C0契约 f407b27，领域检查点1f16692；后续提交见git log。本交付是Codex后端，不是整版前端发布。

已实现周期模板/实例、未来规则生效与时区快照、count/sum/distinct_days、取消/手动撤回、系列多门槛与证据复核；精确小数趋势及纯展示筛选；资料绑定/来源观测/只读派生；固定奖励日历、永久资格、追加式发放/冲正/恢复、只读钱包；首页同快照聚合；离线严格AI动作协议。mvp真实AI、3D和兑换均禁用。

接口权威文档为仓库design/v0.2/第二阶段接口契约.md；请求和返回基础Schema在packages/contracts，生成OpenAPI。观察值使用POST /api/v1/profile/observations，纠错必须同时传来源ID与版本；配置和观测分开提交。组合回执按operation_id匹配，再校验子对象。

奖励默认reward-policy-v1：主线100/月1，每日10/日3，周常50/周3，月常200/月2，首次资格期限为周期结束后7天含截止点。资格否决不重开，撤回不释放额度；恢复沿原资格和原发放关联，不增加累计有效收益。所有金额由服务端设置。旧任务不补发。

## 重跑验收

在Codex应用目录执行：

```sh
sh tests/v02-phase2/run.sh
```

入口使用主scripts/agents/compose.sh codex，禁止裸Compose和依赖安装；自动从e6ff267只读提取旧源码夹具，不重置任何工作区。仅postgres-test/life_dashboard_test允许合成数据重置；旧版本恢复升级使用该库内独立schema，search_path不包含public。输出.runtime/test-artifacts/v02-phase2-codex/。旧AI测试只运行本地适配器或计数夹具，不联网调用模型。

## 隔离启动、升级和回滚

18181是Codex隔离预览，18080主环境未升级。已有缓存/私有配置/依赖必须复用。先检查干净代码、已验证的备份，再通过主wrapper启动postgres、用tools跑packages/db/src/migrate.ts，最后启动api/web/gateway；不seed虚构事实、不重建或清空持久库。

0001–0003未修改，只新增0004。升级前使用旧版本导出到权限0600的私有.runtime/backups文件；用相同旧版本代码和相同迁移在空隔离目标恢复，逐表核对后才应用新迁移。新版备份也只能恢复到同版、同迁移空目标。不要修改checksum、移除迁移匹配检查或向非空目标合并。

本次18181升级前备份为.runtime/backups/pre-phase2-preview.json（含个人数据，不提交）；先在postgres-test独立schema用e6ff267恢复并核对全部data，再升级成功，保留15条原记录；新奖励零补发。升级后通过真实gateway登录、home/export/capabilities，并重启API核对导出数据和回执不变。证据preview-backup.json和restart.json在验收目录。

回滚先停止隔离API写入，保留新版备份及新写入；使用独立空目标、旧代码、旧迁移恢复升级前备份并验收，再切换实例。不能把旧API直接指向新迁移库当作完整回滚，不能覆盖现有数据；升级后的新增事实需人工核对转移。本轮未执行主环境切换、数据库降级或GitHub推送。

## Gemini 集成事项

最后检查Gemini工作树仍为v02/phase1-gemini，提交eda3dcd，无第二阶段交付可合入。未改apps/web、packages/ui或Gemini日志。请基于冻结契约交付第二阶段干净提交；之后继续合并并跑浏览器全链路、手机布局/软键盘、失败保留/冲突、来源跳转和发布验收。目前18181网页仍是第一阶段UI，新增功能可用API，不声称界面已经完成。
