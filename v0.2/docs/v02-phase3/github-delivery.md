# GitHub 候选交付

目标：[HamiltonZeng/life-dashboard · codex/v0.2-release](https://github.com/HamiltonZeng/life-dashboard/tree/codex/v0.2-release)。没有创建 PR、合并 main、发布 Release 或切换18080。

源码冻结并冷启动验证：`13bff27950e57aa3253fe62a352cd1fed9395dec`。

首次完整候选上传后重新 Fetch，读取 origin/codex/v0.2-release，与本地 HEAD 均为 `30f74a7aa5e8ed45ba7cc18921e3b981faa75e77`。GitHub Desktop 明确返回 push complete、fetch complete，并显示分支已发布。分支 upstream 为 origin / refs/heads/codex/v0.2-release。origin/main 回读仍为 `c91eee95f41cd3238a8619e75e4675bc9231b98e`。

使用 Desktop 已有账号的正常发布/推送和 Fetch；终端 HTTPS 无凭据，未从磁盘或进程提取 token，也未索要 PAT、安装 gh、强推或修改仓库隐私。

本发布回执仅增加文档，产品源码与冻结版本相同；文档提交后再次普通 push 和 Fetch 核对最终本地/远端 HEAD。最终 SHA 在交付答复与本机 `.runtime/phase3-safety/github-delivery.json`，由真实 Git 引用生成。保留第一次完整候选 SHA 便于独立追溯；不把文档自身 SHA 写入其自身。

推送前检查完整 tracked tree 和本阶段 diff：无 .runtime/.secrets/node_modules/dist/dump/.env，无凭据特征，无大于2MB的跟踪文件；合成性能样本和浏览器回执不含个人记录或口令。main 用户 README 改动、所有私有备份/归档及缓存留在本机。
