# 部署验证记录

日期：2026-10-02。验证环境：Windows Docker Desktop，Linux 容器。

## 已通过

- 多阶段 Docker 镜像构建；依赖安装、HTML 构建均在容器内进行。
- Compose 从空命名卷启动 PostgreSQL 18，数据库健康后执行迁移，迁移成功后应用进入 healthy。
- 测试容器：12 项模型/构建检查 + 5 项 PostgreSQL API 检查通过。
- 测试容器访问实际应用：健康检查、页面产物、无口令公开访问、双客户端读写、目的仓、移库和过期版本冲突通过。
- 取消口令后重新完成上述 17 项检查及运行中容器 HTTP 检查。浏览器刷新后直接显示「共享库存 · 已连接」，没有登录弹窗和退出按钮；入库入口可用。
- 本次公开访问测试结束后，确认 `deploy-smoke-*` 记录为 0、`inventory_test_*` schema 无残留，工作数据库货物数量为 0。
- 创建专用临时货物后执行不带 `-v` 的 Compose down，再 up；应用和数据库容器被移除并重新创建，原货物数量和目的仓仍正确。
- 在数据库容器内执行 pg_dump，把备份恢复到新建临时数据库，核对 1 条临时记录和目的仓 ONT8 一致。
- 临时记录、临时恢复数据库和临时备份已清理，工作数据库货物数量为 0。
- HTTPS 的 Compose 合并配置和 Caddyfile 校验通过，未启动公网代理或申请证书。
- 宿主机旧 Node 预览与项目专用 PostgreSQL 已停止，旧 `.env` 和 `data/postgres` 文件保留。

## 运行状态

- `app`：healthy，宿主机仅发布 `127.0.0.1:4173`。
- `db`：healthy，5432 未发布到宿主机。
- `migrate`：Exited (0)，正常完成初始化。
- 数据卷：`bestar-inventory_postgres_data`。
- 访问方式：公开读写，无需登录、口令或会话 Cookie。
- 容器测试日志：`artifacts/docker-public-test.log` 为当前无口令版；`artifacts/docker-test.log` 为此前验证记录，不包含真实库存或秘密值。

## 未执行

尚未在 Vercel 云端发布、接入真实云数据库、对真实库存进行验收，也未向真实域名签发服务器 HTTPS 证书。Docker HTTPS 配置仅用于准备部署，实际启用需真实 DNS 和 80/443 端口条件。原图容量仍需现场核对。
