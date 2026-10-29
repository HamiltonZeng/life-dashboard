# 第三阶段协议补充

冻结基础契约仍见第二阶段接口文档。本补充随 `PHASE2_CONTRACT_VERSION=v0.2-phase2/1.1` 发布，无表结构变化、无迁移重写，导出格式不变。

## 观测绑定前提

GET profile/home 的 observation 字段返回 `binding_fingerprint`：SHA-256 对用户、字段 ID、模块、kind、type、unit、来源模板和字段键的固定序列求摘要。profile 的整体版本不作为观测前提，因此不相关的昵称修改不必冲突。服务端在用户写锁内核验指纹，再验证并写来源记录。

POST profile/observations 增加 `binding_fingerprint`（64 位十六进制）。协议 schema 为兼容旧成功回执允许缺失，执行新命令时缺失返回 428 `BINDING_PRECONDITION_REQUIRED`；不匹配返回 409 `BINDING_CONFLICT`。两者 details.current 含最新 field_id/module_id/kind/type/unit/binding/binding_fingerprint，无事实、修订、资格或账本部分写入。其他时间、版本、类型、必填上下文和模块规则保持。

幂等回执检查优先于新命令解析与绑定验证。因此旧版无指纹但已经成功的原 operation_id + 原完整 payload 仍得到原回执；不能给旧操作补指纹重放，否则违反原请求摘要。旧未成功的无指纹草稿须明确采用最新绑定后生成新操作。浏览器保留输入和原映射快照；确认新映射不会自动保存，用户需再次检查类型/单位/上下文并提交。

## 完整物化与刷新

POST task-instances/materialize 的空输入处理当前用户所有模块与模板均启用的 phase2 模板，按 created_at/id 排序，在同一用户锁事务中完整执行；不再默认截断 50。显式 template_ids 列表仍限制 50，422/400 等原 schema 拒绝规则不放宽。无隐式后台补齐历史周期，无 GET 写入。

结果保留 instances/reused；增加 total_templates、scope=all|explicit、server_time、next_check_at（最近未来周期终点；无未来终点为 null）。客户端按服务器时间差安排下一次检查，不能把本机日期当作服务器周期。登录初始化、相关路由、恢复前台强制确认；可见标签页每 30 秒轻量检查到期条件。多个调用共用进行中 Promise；每个标签页独立待确认键，服务端唯一约束和用户锁防重复。

旧未知物化操作先用原键与冻结载荷确认，随后用新键获取当前周期。存储失败不发命令；网络未知结果保留待确认；失败有显式重试。刷新成功后 GET bootstrap/home/任务等投影。GET 失败会显示未确认状态，不能用空任务或旧回执声称完成当前刷新。

## 首页任务

服务端判断有效模块/模板与当前半开周期，先按用户固定顺序选有效任务并去重，再补当前每日及旧版当地今日任务，最后截取五项，同时给出 task_count。已结束周期、取消、跳过、归档模块/模板、终结主线和过期旧今日任务不占显示槽位。未固定的主线/周常/月常不会挤入首页。没有完整首页投影时，前端不从不完整 bootstrap 重新猜任务集合。
