# v0.3 第一阶段交付

2026-10-21。状态：第一阶段功能已实现；离线与浏览器验收结果见[验收矩阵](acceptance.md)。真实 DeepSeek 状态单独记录，不能用离线供应商替代。

同日主要代码复核：既有回归通过，但新增边界复现确认4项问题（2项P1、2项P2），涉及追问授权、撤销版本保护、等待计时与任务续期。详见[代码审查报告](代码审查_2026-10-21.md)；四项问题已在同日收口中修复并加入正式回归；详见[收口记录](closeout.md)。原审查文档保留复现时状态。

后续[收口代码复核](收口复核_2026-10-21.md)已通过。下一步见[第二阶段任务](../../../design/v0.3/第二阶段开发规划.md)，本版主要功能代码（含报告调度/长期分析）在第二阶段完成，第三阶段集中真实API及整版测试。

## 启动与使用

在 `/Users/zhk/life_dashboard/v0.3` 执行：

```sh
sh scripts/start-existing.sh
```

入口 http://localhost:18380；Compose项目 `life-dashboard-v0-3`，开发库 `life_dashboard_v03`。登录使用本目录 `.secrets/development.env` 的 `LOCAL_LOGIN_SECRET`。Node/PG/Caddy/Playwright采用既有固定digest，依赖只读复用 `../v0.2/node_modules`；所有新缓存和输出写入本版。启动不会安装依赖或拉取镜像。

新增独立worker处理持久队列。API写入消息后返回202；页面以轮询读取真实作业/回执，不因受理就显示保存成功。SSE提供有限事件批次，重连携带Last-Event-ID；GET作业始终为权威恢复入口。

首页标准/极简共用会话控制器。新建任务默认一句话入口，高级手动设置仍可用。设置中的AI连接区保存可读模块与执行偏好，明示云端发送范围与有限额度。规划可创建目标、模板、指标、四类任务和从启用后统计的系列成就；配套对象通过回执查看。当前不接受AI真实记录、历史纠错、资料更新、自然语言调整已有计划、新模块、报告/日程或AI报价。

## DeepSeek配置

服务端私有文件 `.secrets/development.env` 需要以下变量。API密钥不写入Git、页面或本机对话：

```dotenv
V03_AI_ENABLED=1
DEEPSEEK_API_KEY=<your-private-api-key>
DEEPSEEK_MODEL=<a-model-id-enabled-for-your-account>
# 可选，默认https://api.deepseek.com
DEEPSEEK_BASE_URL=https://api.deepseek.com
V03_AI_DAILY_JOBS=20
V03_AI_DAILY_INPUT_TOKENS=100000
V03_AI_DAILY_OUTPUT_TOKENS=20000
V03_AI_MAX_INPUT_TOKENS=32000
V03_AI_MAX_OUTPUT_TOKENS=4000
```

更改私有文件后运行 `docker compose up -d --force-recreate --pull never --no-build api worker`，随后在设置中保存允许发送的模块范围。未配置或配置非法时AI不可用，手动功能继续工作。配置状态区分implemented、enabled、configured、授权范围；后续能力独立为false。

模型名由部署配置提供，不沿用旧名称。当前路径采用Chat Completions + JSON Output +完整本地Schema/引用/领域校验；没有启用供应商strict或工具执行。对照[官方JSON Output说明](https://api-docs.deepseek.com/guides/json_mode/)和[官方接口](https://api-docs.deepseek.com/api/create-chat-completion/)实现，仍需账户真实联调验证模型效果。

每作业最多两次供应商尝试，网络/格式重试共用额度；单次60秒、累计执行预算180秒。进入追问时持久化剩余执行预算并暂停期限，收到回答后从worker重新领取时恢复剩余预算；等待用户和续接排队不消耗预算，调用次数与每日token占用不重置。一个全局活跃模型作业。每次先预留输入上界与最大输出；输入按完整UTF-8字节长度保守约束，实际usage单独结算。供应商未返回usage、崩溃或网络结果未知时占用预留额度，不计零。每日预算以UTC自然日计；剩余额度在配置中提供，不显示人民币估价。取消已发出调用不保证退费。

显式真实冒烟：在合成测试库、无其他验收同时运行时执行：

```sh
docker compose run --rm --no-deps --pull never -e V03_RUN_REAL_SMOKE=1 test node_modules/.bin/tsx scripts/real-planning-smoke.ts
```

没有密钥/模型/启用配置时仅记录not_run；配置齐全时最多两次尝试、只预览，不自动应用。结果 `.runtime/test-artifacts/v03-phase1/real-provider.json` 不含密钥。

## 验收入口

```sh
sh scripts/verify-phase1.sh
sh scripts/verify-phase1-browser.sh
```

两者必须顺序运行，共用一个合成测试库 `postgres-test/life_dashboard_v03_test`。五项保护拒绝错误项目、NODE_ENV、host和库名；任何重置前先检查。浏览器测试使用额外无宿主端口的API/Web/Gateway/worker，退出后删除临时服务；不替换18380服务，更不访问18080或18181数据库。

第一入口执行类型、构建、契约导出、原单元/前端验证、历史API/领域/旧成功回执/趋势/奖励回归、新规划测试及5份设计Schema/10样例/15反例。历史实现仅从本地Git提取到本版.runtime作为只读测试夹具。第二入口覆盖真实Chromium登录、授权、规划/查看对象/手动记录20分钟/奖励联动/刷新、防注入/回滚、360px布局和API/worker真实重启恢复。证据在 `.runtime/test-artifacts/v03-phase1/`。

## 迁移、备份与恢复

新增 `0005_v03_planning.sql`；原0001～0004逐字节保留。新增会话、消息、作业/事件、上下文、方案、应用回执、授权偏好、usage/预算预留及目标/修订/计划关联。任务调度元数据作为模板definition中的版本化schedule保存；原实例快照不变。在当前已锁实例结束后先激活到期的新定义，再判断有效期/适用星期；旧定义不可用但新定义尚未到期时仍返回其生效时刻供客户端继续检查。模板/系列新增归档状态。

导出格式schema_version从1升为2，白名单增加13张AI/目标/计划表及归档列，仍排除会话Cookie、供应商密钥和原始供应商响应。确认token/hash在导出中清空，作业检查点不导出。恢复必须空目标并验证checksum/迁移；原v0.2格式1、原四份迁移的导出允许升级恢复至当前五份迁移库，旧事实/回执保持。后续运行/应用中作业恢复后转为RESTORE_PAUSED失败状态，不自动重新收费；清除lease与确认/撤销令牌，事件/消息identity序列修复。历史已提交回执优先返回。

撤销预览绑定每个实际新增对象的版本、归档状态、当前/待生效定义指纹和真实依赖集合。预览后再编辑或改变引用会返回409并要求新预览；预览前已有修改则显示当前版本、待生效名称和节奏，须明确确认。确认后归档实际新增配置；复用对象不动。已有记录、其他计划或手动依赖的对象保留，补偿结果明确列出。原实例、事实、奖励流水和审计不删除。

升级前备份仅针对v0.3：`.runtime/backups/pre-phase1/`。若回滚，应停v0.3服务并在独立空PG目录恢复逻辑dump，再启动匹配的旧代码；不要让旧代码写已升级库，不要让两个PG共用物理数据目录。v0.2主/候选服务继续保留。

## 第二阶段接入点

复用 `PlanningService.command/context/tick/applyInside`、通用Gateway、canonical Schema、会话/事件与前端ConversationController。新增动作必须同时扩展能力白名单、上下文权限、领域写入口、事务/备份/验收，不解除旧development总开关。普通动作不能写奖励、余额、事实当前值或解锁；AI报价仍须独立受限通道。报告和日程要继续区分只读统计、模型分析与收费授权。

真实手机/系统软键盘、长期压力和真实供应商效果不由桌面模拟替代。当前文档不宣称整版v0.3完成。
