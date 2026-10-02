# Vercel 部署指南

适用：BESTAR 仓库库存与货物定位 2.0。更新：2026-10-02。

另一套为 [Docker 部署方案](DOCKER_DEPLOYMENT.md)。本机开发和测试统一在 Docker 中完成；本页说明 Vercel 的独立云端部署，不使用 Docker 数据卷作为云数据库。

## 1. 部署组成

本版包含 `dist/index.html` 前端、`api/inventory.js`、`api/health.js` 两个服务端函数及独立 PostgreSQL 数据库。不能只上传 HTML；API 将库存写入数据库，所有成员通过同一站点共享数据。

Vercel 支持项目根目录 `api/` 中的 Node.js 函数，本项目使用 CommonJS 请求处理函数。参见 [Node.js Runtime](https://vercel.com/docs/functions/runtimes/node-js)。Vercel 的 PostgreSQL 由外部服务商提供，可以通过 Marketplace 连接；本项目使用标准 PostgreSQL 连接串。参见 [Postgres on Vercel](https://vercel.com/docs/postgres)。

## 2. 准备并初始化云数据库

1. 准备本项目专用的 PostgreSQL 数据库，可使用已有服务或 Vercel Marketplace 的 PostgreSQL 集成。
2. 获取服务商提供的连接串。函数运行建议使用适合短连接的连接池端点；初始化可使用服务商允许执行 DDL 的直接连接端点。
3. 保留服务商要求的 SSL 参数和证书校验。不要把连接串放入前端、Git 仓库或聊天。
4. 生产与预览部署连接不同数据库，避免预览测试修改正式库存。

示例仅为占位格式：

```text
postgresql://USERNAME:PASSWORD@HOST:5432/DATABASE?sslmode=require
```

项目不会创建云数据库，也不自动上传旧浏览器库存。本地 `data/postgres` 不能上传到 Vercel 充当线上数据库。

将目标连接串通过本地 `.env` 或终端环境变量传入 `DATABASE_URL`，再执行：

```powershell
npm ci
npm run db:migrate
```

这一步是明确初始化目标云数据库，不是启动宿主机数据库。若希望连迁移命令也在 Docker 中执行，可创建仅含云端 `DATABASE_URL` 的 `.env.vercel-migrate`（已被 `.gitignore` 忽略），使用已构建的镜像：

```powershell
docker run --rm --env-file .env.vercel-migrate bestar-inventory:local node scripts/migrate.cjs
```

不要把 `.env.docker` 的 `db:5432` 内网连接串填写到 Vercel。迁移成功后移除本地临时云连接配置，正式值保存在 Vercel 环境变量中。

迁移对应 `db/migrations/001_inventory.sql`，事务内创建 `warehouse_inventory_meta` 和 `warehouse_inventory_records`。可重复运行，不清空已有库存，不插入测试数据。也可在服务商 SQL 控制台执行该文件。初始化不在构建时自动运行，避免每次预览部署触碰正式库。

## 3. Vercel 项目设置

Root Directory 指向同时包含 `package.json`、`vercel.json`、`api/` 的项目目录。

| 设置 | 值 |
| --- | --- |
| Framework Preset | Other |
| Node.js Version | 24.x |
| Install Command | `npm ci` 或默认 npm 安装 |
| Build Command | `npm run build` |
| Output Directory | `dist` |

`package.json` 已指定 Node.js 24，参见 [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)。`vercel.json` 同时配置 API 执行时间。不要将 `npm start` 设为构建命令。

保留 `api/`、`server/`、`src/`、`scripts/build.cjs`、`assets/brand-wordmark.png`、底图 PNG、`package.json`、`package-lock.json`、`vercel.json`，`db/` 用于初始化。`.vercelignore` 排除密钥、本地数据库、截图、测试和文档，部署时重新生成 dist。

## 4. 环境变量

在 Vercel 项目中按 Production / Preview 分别填写，修改后重新部署。

| 名称 | 设置方式 |
| --- | --- |
| `DATABASE_URL` | 对应环境 PostgreSQL 连接串，含服务商要求的 SSL 参数 |
| `APP_ORIGIN` | 正式站点来源，例如 `https://inventory.example.com`；Preview 可留空，按当前请求域名校验 |

`HOST`、`PORT` 仅用于容器/常驻 Node 服务，Vercel Functions 不需要设置。集成若生成 `POSTGRES_URL` 等其他名称，需要将对应连接串配置为本应用识别的 `DATABASE_URL`。

站点公开访问，无需登录口令，所有访问者均可查看、入库、编辑、移出及导入共享库存。本版没有个人账号、角色分级或个人审计。无需设置 `AUTH_MODE`、`INVENTORY_PASSWORD` 或 `SESSION_SECRET`；旧配置可以删除，应用不会读取它们。

正式域名变更时更新 `APP_ORIGIN` 后部署，否则写入可能被来源校验拒绝。

## 5. 部署

Git 方式：源码仓库为 [xiaokh31/inventory](https://github.com/xiaokh31/inventory)，生产分支为 `main`。在 Vercel 导入该仓库，配置环境变量后部署。

CLI 方式：

```powershell
docker compose --env-file .env.docker --profile test run --build --rm test
npm run build
npx vercel login
npx vercel
```

在自己的账号中关联项目，配置 Preview 环境，检查通过后执行：

```powershell
npx vercel --prod
```

不要上传 `.env`、`data/` 或库存备份。线上函数不使用本机 PostgreSQL 程序，而是连接 `DATABASE_URL` 对应的云数据库。

## 6. 验收和旧库存迁移

1. 直接打开页面后顶部显示「共享库存 · 已连接」，不应持续显示连接错误。
   可先访问 `/api/health`，预期 HTTP 200 且只返回 `{"status":"ok"}`；数据库不可用或缺表返回 503。
2. 空数据库显示 45 列、0 批货物；已有数据库显示其实际记录，更新部署不会生成示例库存。
3. 在设备一新增临时记录并填写目的仓，设备二打开同一站点，约 5 秒后可见相同内容。
4. 两端同时打开同一批货物编辑，先保存成功，后保存提示冲突并保留草稿；关闭后重新打开最新记录核对。
5. 检查 90°/270° 旋转、复位、搜索、点击定位、目的仓编辑及导出。刷新两个设备确认持久保存。
6. 移出自己新增的临时记录，确认两端同步恢复。

旧浏览器库存不会自动上传。原地址新页面可检测旧库存并提供导入按钮；跨域迁移需从旧地址导出 JSON，再在新站点导入。导入替换所有成员共享库存，先导出当前数据库备份。旧 v1/v2 编号按物理位置转换，v3 不重复转换。缺少目的仓的记录显示未填写。

更换域名但连接同一数据库时库存仍共享；更换数据库则需迁移数据。不再使用旧版“各浏览器分别保存”的模式。

## 7. 排查与维护

| 现象 | 检查 |
| --- | --- |
| 页面正常，API 404 | 是否只部署 dist；Root Directory 必须含 api、server、package.json |
| 503 / 数据库不可用 | DATABASE_URL、网络、SSL、权限、是否运行 db:migrate，查看 Functions 日志 |
| 403 / 来源不匹配 | APP_ORIGIN 是否匹配当前域名；Preview 不填生产域名 |
| 409 / 已被他人修改 | 复制需保留草稿，关闭后重新打开最新记录核对 |
| 两设备内容不同 | 是否相同环境、数据库，点击立即同步并检查断线提示 |
| 旧库存未出现 | 从旧地址导出 JSON 或使用旧浏览器库存迁移入口 |

断线时保留上次读取内容并禁止修改，网络恢复自动重试。保存未收到确认时先同步核对服务器结果，避免重复登记。生产库配置数据库备份；网页 JSON 导出用于业务备份。

## 8. 当前验证范围

本机已改为 Docker，应用和 PostgreSQL 均在容器内运行。测试容器中的 12 项模型/构建检查、5 项真实数据库接口检查及运行中容器 HTTP 检查通过。已验证移除并重建容器后库存持久保留，以及数据库备份恢复；详情见 [部署验证记录](DEPLOYMENT_VERIFICATION.md)。

尚未创建 Vercel 项目、连接云数据库或执行线上部署；未导入真实库存、未校核现场库容。配置真实云端 DATABASE_URL 并部署后，仍需按第 6 节进行跨设备线上验收。
