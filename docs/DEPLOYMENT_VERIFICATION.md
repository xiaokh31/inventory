# 部署验证记录

日期：2026-10-02。本机验证环境：Windows Docker Desktop，Linux 容器；云端：Vercel + 独立 Neon PostgreSQL。

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

未对真实库存进行验收，也未启用自有服务器的 Caddy HTTPS 或自定义域名。Docker HTTPS 配置仅用于准备部署，实际启用需真实 DNS 和 80/443 端口条件。原图容量仍需现场核对。

## Vercel 生产发布

- 正式站点：https://inventory-chi-mauve.vercel.app/，项目 `inventory`，团队 `bestars-projects-3a180eb8`。
- 首次生产部署 `dpl_8vWy1wuyLySiqnsbx8tBDjLkz4RP` 状态 READY，两个 Node.js API 函数位于 `iad1`。
- 独立 Neon `inventory-db` 使用 Free 计划、`iad1` 区域，仅连接 Production；初始化未插入示例货物。
- 无登录 Cookie 访问首页及 `/api/health` 返回 200；`/api/inventory` 可公开读取。
- 在 Docker 中运行正式站点 HTTP 检查，使用同源 Origin：新增、双客户端读取、目的仓修改、移库、过期版本 409 和删除通过。
- 测试仅使用 `deploy-smoke-vercel-20261002`，结束后删除。复查云端记录为 0，测试记录为 0，修订号为 3。
- 浏览器直接进入工作台，显示「共享库存 · 已连接」，入库按钮可用；无登录弹窗。
- GitHub `xiaokh31/inventory` 已推送 main。Vercel Git 自动连接缺少账号的 GitHub Login Connection，目前使用 CLI 发布。
