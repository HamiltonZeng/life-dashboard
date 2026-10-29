# Git 来源、私有归档与资源处理

## 来源与保存现场

| 来源 | SHA | 处理 |
| --- | --- | --- |
| 主工作区 main | 7fda7f41ce3df1a831964ba666eaa7e2e00f0b42 | 不切换、不提交、不覆盖用户未提交文件；18080 仍运行原代码/主库 |
| Codex 二阶段 | d9ab4085c05ec121bfe2fd03cd6fac071741b530 | 从此创建 codex/v0.2-release，旧分支保留 |
| Gemini 交付 | a60c9f0aa442e55d2c3f01e4ad460083f586709c | 已是 d9ab408 祖先，无独立待合并提交，不重复 merge |
| DeepSeek 验收 | b63e77f9482dc0c6a8361df379a5a3f4ae162531 | 已是候选祖先，统一回归保留其断言 |
| 一阶段升级夹具 | e6ff267 | 只读 git archive，旧迁移与回执兼容验证 |

启动前保存主工作区 README 二进制 diff 和未跟踪设计/日志文档的私有归档；本轮三份新规划/审查文档选择性纳入候选。候选的 v0.1/README.md 完整保留用户主工作区版本；根 README 重写为 v0.2 导航，未在 main 擅自恢复或删除文件。

## 工作树和容器

统一入口实际通过后，确认 Gemini/DeepSeek 两工作树均 clean、源提交均已合入，app list_artifacts 返回无托管工作树。用普通 git worktree remove（无 --force）归档两个 checkout，保留两个来源分支。

移除前：分别 pg_dump 保存其合成测试库；停止 8 个旧工作流运行容器；把完整 .runtime、.secrets、空 node_modules 挂载目录、已编译 dist 以及 Gemini .DS_Store 移至主工作区 `v0.2/.runtime/phase3-retired/{gemini,deepseek}`。保留了 DeepSeek 已停止 PG 的物理目录、私有配置、缓存、日志和截图；父目录 0700，dump/清单 0600。没有 rm -rf 数据目录或清理共享依赖。

实际移除 9 个特定容器：两个旧工作流各自 api/web/gateway/postgres-test，共 8 个；另 1 个已停止 DeepSeek postgres。随后确认两个旧项目 default 网络均零连接，删除这 2 个网络。没有移除 volumes、v0.1 容器、18080 或 18181 的业务容器，没有触碰 xmu-localbot。

归档占用约 Gemini 6.88 MiB、DeepSeek 54.21 MiB（以本机 du 实测为准）；只是移动保存，不作为释放空间。删除 checkout 释放少量重复源码，容器可写层未精确计量，不宣称回收镜像大小。旧工作流测试不再依赖原路径；清理后再次完整离线验收。

如需恢复旧工作流：用保留分支在原路径 git worktree add，再按归档 manifest.json 把私有目录恢复对应相对路径；先检查配置/端口与 Docker 卷绑定。逻辑 dump 可恢复至新隔离库；停止物理 PG 后才允许搬回物理目录，不同时启动两个进程读写同目录。不要把归档密钥上传 GitHub。

## 镜像与缓存

| 必需镜像 ID | 本机显示大小 | 引用与保留原因 |
| --- | --- | --- |
| a5f4366e8346 | 352 MB | 主/预览 API、Web、tools、Node 测试；回滚和离线启动 |
| afc7e2d44132 | 661 MB | 主/预览持久 PG、独立测试 PG；备份恢复 |
| d8542f48d34a | 89.2 MB | 主/预览/测试 Caddy；v0.1 停止容器也引用 |
| 7852dc5a7d72 | 3.52 GB | Playwright Chromium；浏览器、重启和冻结验收 |

Compose 固定上述 digest。已逐个检查运行和停止容器的镜像引用，四个全部保留。**可删项目冗余镜像 0 个，实际删除镜像 0 个，镜像释放空间 0 B。** 没有 system/image/container/volume/builder prune。

xmu-localbot/napcat、Rust、Ubuntu、来源不明 dangling Node/Caddy 不属于已确认安全候选，全部保留。共享 node_modules、Corepack/浏览器缓存、旧环境归档、v0.1 的 5 个停止容器和备份不动。Docker 8 核、约 7.75 GiB、aarch64；性能数据另见 performance.md。

## 代码删改证据

| 对象 | 检索/原因 | 替代与验证 |
| --- | --- | --- |
| phase1/browser 与 phase2/legacy-browser、support 副本 | 相同 B01–B20 和夹具；运行入口重复 | tests/web/legacy-browser.ts、support.ts 单一实现；原路径薄兼容入口；20 场景均跑 |
| phase1/phase2 三个旧 runner、两个 browser overlay | 硬编码其他工作树/项目，rg 引用仅历史文档/日志 | 唯一 phase3 runner/overlay；旧 runner 转发；旧 overlay 删除；历史日志不改 |
| phase2/browser、restart 实现位置 | 固定 Gemini 部署的重复入口 | 移至 tests/web/；旧路径 import 兼容，15 步及两组重启保留 |
| rewardSummaryFor、每实例 DTO/同 Client Promise.all | rg 仅内部调用；列表 N+1 和驱动弃用警告 | 批量 instanceViews、资格/流水查询；分页 SQL；无驱动并发警告 |
| main.ts 新功能事件块 | 单文件耦合任务/趋势/观测/钱包 | 四个功能文件，统一 phase2-submit 冻结提交；构建、134 断言和浏览器回归 |
| 首页 bootstrap 任务猜测 | 缺模板状态/完整周期时可能绕过 R04 规则 | 以服务端 home 为准，GET 失败明确报错；保留真实 profile/metric 降级与无假钱包测试 |
| 年趋势逐日全扫/来源逐项 find | 10k 记录测得秒级退化 | 按当地日分组、ID 索引；32 组旧引擎结果对照与相同规模重测 |

保留所有已提交迁移、事实/修订/回执/钱包历史，以及默认禁用的 AI 蓝图、适配器、候选/Avatar 接口；没有为了减少代码删除业务审计数据或降低断言。

## 冻结冷启动后的临时资源

另从 13bff27950e57aa3253fe62a352cd1fed9395dec 检出新目录，未复用 Codex dist/数据库，四个本地镜像、只读共享依赖、--pull never 启动独立 release 项目/18184；类型/构建、26 单元、18 套134断言、原4+新4前端单元再通过。真实 Chromium 登录、保存新记录、原键重放、刷新唯一记录和360px均通过；主机18184首页/就绪200，未登录API401。

验收后停止并移除该临时项目4个容器、其零连接网络1个；把整个私有运行目录/新密钥/PG数据/编译产物保存至 .runtime/phase3-retired/frozen-13bff27，随后无 --force 移除临时 checkout。另移除已完成测试的 Codex api-test/web-test/gateway-test 3个临时容器，保留 Codex postgres-test 及独立主库恢复副本。

总计：旧工作流9 + 临时验证7 =16个容器；旧项目空网络2 + 临时验证空网络1 =3个网络；旧工作树2 + 临时冻结检出1 =3个checkout。当前仅保留 main 与 Codex 开发checkout。所有私有目录均保存；0镜像删除。主18080、预览18181和v0.1停止容器未受影响。
