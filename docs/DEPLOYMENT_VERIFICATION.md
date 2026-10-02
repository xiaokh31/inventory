# 部署验证记录

日期：2026-10-02。本机验证环境：Windows Docker Desktop，Linux 容器；云端：Vercel + 独立 Neon PostgreSQL。

## 柜号与托盘优先显示

- 新增选填柜号，保存于记录 JSONB，无需修改表结构。缺少该字段的旧记录显示未填写；支持编辑、搜索、JSON 备份和 CSV 导出。
- 库存概览大号数字显示托盘数，箱数移至下方；入库表单托盘在前、箱数在后，台账以托盘数为主、箱数为补充。
- Docker：15 项模型/构建检查、5 项真实 PostgreSQL API 检查及运行中应用 HTTP 检查通过。日志：`artifacts/docker-container-number-test.log`。
- 浏览器：临时记录保存柜号并编辑后重新搜索命中；核对概览 4 托 / 20 箱及表单字段顺序。实际 CSV 下载包含正确柜号和数量。
- 本地唯一浏览器临时货物和下载的测试 CSV 均已核对并单独删除，本地库存恢复为 0 条。

## 上下半区升级（前次）

- A/B/C 共 45 列，按各区域中间立柱横线分为 90 个半区。上、下半区的托盘图形分别统计，旋转后方位定义不变。
- Docker 测试容器：14 项模型/构建检查、5 项真实 PostgreSQL API 检查及运行中应用 HTTP 检查通过。覆盖半区边界、v4 备份、旧版本兼容、空 SKU/FBA、半区移库和并发冲突。
- 浏览器访问 Docker 页面：B-03 上半区直接点击入库；SKU/FBA 留空保存成功；编辑为下半区；旋转 90° 后点击定位及台账显示正确。
- 浏览器临时货物 `UI-HALF-CHECK-20261002` 已单独核对并删除；本机库存恢复为 0 条。接口测试仅创建并删除自己的唯一 ID，数据库测试仅使用随机隔离 schema。
- 旧记录没有半区时保留为「未标注半区」，不默认分配上下区；编辑时再核对选择。JSONB 保存新增字段，无需修改表结构。
- Vercel API 已确认 GitHub `xiaokh31/inventory` 连接，生产分支 `main`。生产发布由该分支推送触发，正式域名为 [inventory.bestarcca.com](https://inventory.bestarcca.com/)。
- 升级前正式库已有 7 批业务库存。本次不批量导入、清空或改写已有记录；临时检查仅操作自身 ID。
- 本次容器日志：`artifacts/docker-halves-test.log`。以下是较早的首次部署验证记录，其 0 条库存状态仅指当时。

## 初始 Docker 部署检查（历史）

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

## Docker 运行状态

- `app`：healthy，宿主机仅发布 `127.0.0.1:4173`。
- `db`：healthy，5432 未发布到宿主机。
- `migrate`：Exited (0)，正常完成初始化。
- 数据卷：`bestar-inventory_postgres_data`。
- 访问方式：公开读写，无需登录、口令或会话 Cookie。
- 早期测试日志：`artifacts/docker-public-test.log`、`artifacts/docker-test.log`；最新半区版日志见上文。

## 未执行

未对真实库存进行现场验收，也未启用自有服务器的 Caddy HTTPS。Docker HTTPS 配置仅用于准备部署，实际启用需真实 DNS 和 80/443 端口条件。Vercel 正式站点已使用自定义域名；原图容量仍需现场核对。

## Vercel 首次生产发布（历史）

- 正式站点：https://inventory-chi-mauve.vercel.app/，项目 `inventory`，团队 `bestars-projects-3a180eb8`。
- 首次生产部署 `dpl_8vWy1wuyLySiqnsbx8tBDjLkz4RP` 状态 READY，两个 Node.js API 函数位于 `iad1`。
- 独立 Neon `inventory-db` 使用 Free 计划、`iad1` 区域，仅连接 Production；初始化未插入示例货物。
- 无登录 Cookie 访问首页及 `/api/health` 返回 200；`/api/inventory` 可公开读取。
- 在 Docker 中运行正式站点 HTTP 检查，使用同源 Origin：新增、双客户端读取、目的仓修改、移库、过期版本 409 和删除通过。
- 测试仅使用 `deploy-smoke-vercel-20261002`，结束后删除。复查云端记录为 0，测试记录为 0，修订号为 3。
- 浏览器直接进入工作台，显示「共享库存 · 已连接」，入库按钮可用；无登录弹窗。
- 首次发布使用 CLI；其后 GitHub 登录连接已完成，当前 Git 自动部署状态见上文。
