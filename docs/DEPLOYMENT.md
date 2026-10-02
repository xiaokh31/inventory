# 两套部署方案

本机开发验收统一使用 Docker。项目支持以下两种部署方式，功能和 PostgreSQL 数据结构一致。

| 项目 | Docker 部署 | Vercel 部署 |
| --- | --- | --- |
| 用途 | 本机测试、仓库局域网、自有服务器 | 云端 HTTPS 网页与跨设备访问 |
| 应用运行 | Node.js 24 容器 | Vercel 静态前端 + Node.js Functions |
| 数据库 | PostgreSQL 18 容器、命名数据卷 | 外部托管 PostgreSQL |
| 配置 | `.env.docker` | Vercel 环境变量，`.env.example` 为参考 |
| 初始化 | Compose 等待 DB 健康后执行 migrate | 发布前明确执行 SQL 迁移 |
| HTTPS | 可选 Caddy 配置 | Vercel 域名与 HTTPS |
| 数据备份 | pg_dump + 外部保存 | 数据库服务商备份 + JSON 业务导出 |
| 当前状态 | 已在本机实际运行并验证 | 已上线，独立 Neon PostgreSQL，公开读写验证通过 |

- [Docker 部署、测试、备份和恢复](DOCKER_DEPLOYMENT.md)
- [Vercel 云数据库和发布步骤](VERCEL_DEPLOYMENT.md)
- [本次部署验证记录](DEPLOYMENT_VERIFICATION.md)

正式站点：[inventory.bestarcca.com](https://inventory.bestarcca.com/)。Vercel 已连接 GitHub `xiaokh31/inventory`，生产分支 `main`；推送该分支后自动构建并发布到正式域名。CLI 可用于手动发布。

两个部署连接不同数据库时，库存独立。要在方案之间切换，先备份，再迁移到目标数据库；两个站点只有连接同一数据库才共享库存。

两套方案均公开访问，无需登录口令；所有能访问站点的人均可读写全部库存。均支持每 5 秒同步和并发版本检查。库存不会退回 localStorage 保存，数据库故障时会禁止修改。
