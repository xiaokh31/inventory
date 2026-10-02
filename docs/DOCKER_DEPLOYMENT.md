# Docker 部署指南

适用本机测试、仓库局域网及自有服务器。应用、数据库和自动检查均在容器中运行，无需宿主机安装 PostgreSQL。

## 1. 准备

Windows/macOS 安装并启动 Docker Desktop，使用 Linux 容器；Linux 服务器安装 Docker Engine 和 Compose 插件。确认 `docker version` 同时显示 Client 和 Server、`docker compose version` 可执行。

首次准备配置，可手动复制 `.env.docker.example` 为 `.env.docker`，设置数据库口令。已有 Node.js 时也可运行：

```powershell
node scripts/docker-env.cjs
```

此脚本只生成独立随机配置，不启动或测试宿主机应用。重复执行保留现有文件。无 Node.js 的服务器可用官方 Node 容器运行同一脚本，或直接手动编辑示例文件。

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_PASSWORD` | 数据库口令；使用至少 32 位随机十六进制字符，避免连接串转义问题 |
| `BIND_ADDRESS` | 默认 `127.0.0.1`，仅本机可访问 |
| `APP_PORT` | 默认 4173，宿主机网页端口 |
| `APP_ORIGIN` | 可留空按当前域名校验；固定域名可填完整来源 |
| `PUBLIC_HOST` | 启用 HTTPS 配置时填写域名，不带协议或路径 |

Docker Compose 明确读取 `.env.docker`，不会使用旧 `.env` 中的宿主机数据库连接。密钥、本地数据库、备份、截图不进入镜像构建上下文；运行镜像只包含运行文件，使用非 root 用户和只读文件系统。

## 2. 本机启动

在项目根目录执行：

```powershell
docker compose --env-file .env.docker up -d --build --wait app
docker compose --env-file .env.docker ps --all
```

打开 `http://127.0.0.1:4173/`，无需登录即可查看、入库、编辑、移出和导入共享库存。

容器状态应为：`db` healthy，`migrate` Exited (0)，`app` healthy。`migrate` 是一次性建表任务，正常退出表示成功。`GET /api/health` 在数据库可连接、表已初始化时返回 `{"status":"ok"}`；不返回库存或连接凭据。

启动顺序依赖 Compose 的健康检查和任务成功条件，依据 [Docker Compose 启动顺序文档](https://docs.docker.com/compose/how-tos/startup-order/)。数据库使用 PostgreSQL 18，其命名卷挂载到 `/var/lib/postgresql`，依据 [PostgreSQL 官方镜像说明](https://hub.docker.com/_/postgres)。

默认卷名为 `bestar-inventory_postgres_data`。不要把旧宿主机 `data/postgres` 直接挂载进去。网页只发布到本机 4173，数据库 5432 仅容器网络可访问。

## 3. 本机测试

```powershell
docker compose --env-file .env.docker --profile test run --build --rm test
```

依次运行：模型/构建检查 14 项、真实 PostgreSQL API 检查 5 项、运行中应用的 HTTP 检查。包含无口令访问、双客户端读写、上下半区定位与移库、SKU/FBA 选填、目的仓、并发冲突和临时数据清理。测试容器结束后自动移除；应用和数据库继续运行。

数据库测试仅操作随机隔离 schema。应用 HTTP 测试仅操作自身 `deploy-smoke-*` 唯一 ID 的货物，结束后移除。测试期间其他用户可能短暂看到该测试货物，因此该命令用于本机验收环境。

有 Node.js 时也可使用 `npm run docker:up`、`npm run docker:test`、`npm run docker:down`，它们只是上述 Compose 命令的快捷入口。

## 4. 局域网访问

将 `.env.docker` 的 `BIND_ADDRESS` 改为 `0.0.0.0`，然后重新执行启动命令。按所在网络要求放行网页端口，让设备访问 `http://服务器局域网IP:4173/`。数据库仍不发布宿主机端口。所有成员访问同一服务器，库存保存在同一个数据卷。

如果固定 `APP_ORIGIN`，它必须与用户实际访问的完整来源一致；同一站点使用多个局域网地址时可留空。

## 5. 服务器 HTTPS

提供 `compose.https.yaml` 和 `deploy/Caddyfile`。将真实域名 DNS 指向服务器，开放 80/443，确保没有其他程序占用；在 `.env.docker` 填写 `PUBLIC_HOST=inventory.example.com`，并保持 `BIND_ADDRESS=127.0.0.1`。

```sh
docker compose --env-file .env.docker -f compose.yaml -f compose.https.yaml up -d --build --wait app proxy
```

该附加配置自动将应用 `APP_ORIGIN` 设为 `https://PUBLIC_HOST`，Caddy 转发到 app:4173；用户直接从 HTTPS 域名访问。Caddy 自动申请及续期证书，需要域名、端口和持久存储条件成立，参见 [Caddy Automatic HTTPS](https://caddyserver.com/docs/automatic-https)。证书数据另存于命名卷。

本机验证只校验该配置，不会使用占位域名申请证书。已有反向代理时，可复用它，保留原始 Host，并设置 `X-Forwarded-Proto: https`，以便来源校验使用正确的站点地址。

## 6. 更新和停止

更新前做好备份，取回新源码后重新构建并启动：

```powershell
docker compose --env-file .env.docker up -d --build --wait app
docker compose --env-file .env.docker logs --tail 80 app migrate
```

使用 HTTPS 方案时，命令继续带上两个 `-f` 文件。当前迁移可重复运行，不清空已有库存。PostgreSQL 保持 18 主版本，跨主版本升级需单独迁移，不能只改镜像大版本。

停止应用和数据库、保留数据：

```powershell
docker compose --env-file .env.docker down
```

日常停止不要加 `-v`；它会删除命名卷中的库存。改名项目或改变 `COMPOSE_PROJECT_NAME` 会使用不同卷，表现为“空数据库”，应先核对卷名。

已有数据库卷时，不要只改 `POSTGRES_PASSWORD` 或重新生成 `.env.docker`：初始化变量不会自动修改已有数据库用户的口令。网页已取消口令和会话，旧的 `AUTH_MODE`、`INVENTORY_PASSWORD`、`SESSION_SECRET` 可从部署环境中移除，应用不会读取它们。

## 7. 数据库备份

Windows PowerShell 示例，先生成容器内文件再复制到宿主机，避免二进制备份经过文本管道。每次使用新文件名，并将备份另存到其他设备或备份服务。

```powershell
New-Item -ItemType Directory -Path backups -Force
docker compose --env-file .env.docker exec -T db pg_dump -U inventory -d inventory -Fc -f /tmp/inventory-backup.dump
docker compose --env-file .env.docker cp db:/tmp/inventory-backup.dump ./backups/inventory-backup.dump
docker compose --env-file .env.docker exec -T db rm /tmp/inventory-backup.dump
```

`backups/` 已排除 Git、Vercel 上传和 Docker 构建。数据卷本身不是异机备份。网页 JSON 备份可用于业务迁移，但不能替代数据库备份。

## 8. 恢复

先将备份恢复到新数据库验证，不覆盖当前库存：

```powershell
docker compose --env-file .env.docker cp ./backups/inventory-backup.dump db:/tmp/inventory-restore.dump
docker compose --env-file .env.docker exec -T db createdb -U inventory inventory_restore
docker compose --env-file .env.docker exec -T db pg_restore -U inventory -d inventory_restore --no-owner --no-acl --exit-on-error /tmp/inventory-restore.dump
docker compose --env-file .env.docker exec -T db psql -U inventory -d inventory_restore -c "SELECT count(*) FROM warehouse_inventory_records;"
```

确认备份无误后，如需恢复到当前 `inventory` 数据库，先备份现状并安排停用。下面的恢复命令会用备份覆盖当前库存表：

```powershell
docker compose --env-file .env.docker stop app
docker compose --env-file .env.docker exec -T db pg_restore -U inventory -d inventory --clean --if-exists --no-owner --no-acl --exit-on-error /tmp/inventory-restore.dump
```

恢复会回退备份中的修订号。执行 `docker compose --env-file .env.docker up -d --wait app` 恢复服务，并让所有成员刷新整个网页（不能只点「立即同步」），关闭恢复前的草稿，再读取恢复后的库存。恢复期间应暂停全部库存操作。核对网页记录后，再清理自己创建的恢复临时库及临时备份文件。

## 9. 排查

| 现象 | 检查 |
| --- | --- |
| 找不到 Docker 引擎 | 启动 Docker Desktop，确认 Linux 容器模式 |
| 4173 端口占用 | 停止旧宿主机预览，或修改 APP_PORT 后重新创建容器 |
| app unhealthy | 查看 app 和 migrate 日志；`/api/health` 是否返回 503 |
| migrate 非零退出 | 数据库口令、网络和权限，确认未在已有卷上直接换 DB 口令 |
| 重建后库存为空 | 项目名、卷名是否改变，是否错误执行 down -v |
| HTTPS 写入失败 | PUBLIC_HOST、APP_ORIGIN、代理 Host 和 X-Forwarded-Proto |

实际验证与未验证部分见 [部署验证记录](DEPLOYMENT_VERIFICATION.md)。
