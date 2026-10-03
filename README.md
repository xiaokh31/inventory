# BESTAR 仓库库存与货物定位

版本 2.0：可旋转仓库地图、PostgreSQL 共享库存、stripSystem 风格工作台。

源码仓库：[xiaokh31/inventory](https://github.com/xiaokh31/inventory)，主分支 `main`。

正式站点：[inventory.bestarcca.com](https://inventory.bestarcca.com/)。Vercel 连接独立 Neon PostgreSQL，公开访问，无需口令；云端与本机 Docker 的库存相互独立。GitHub 已连接 Vercel，推送 `main` 会自动构建并更新正式站点。

本机统一使用 Docker 测试，部署支持 Docker 和 Vercel 两套方案，参见 [部署方案总览](docs/DEPLOYMENT.md)。HTML 内嵌原图、样式和脚本，但库存读写需要同站点 API 和数据库，不能双击 HTML 离线登记。

## 功能

- A/B/C 各 19 条纵列，以原图从右向左编号；最右柱、中柱、左柱中心分别对齐 01、10、19 列，每跨 9 个间隔。货架区延伸至左墙；办公室、叉车道、柱位和 23–34 dock 保留。
- 左右旋转 90°、方向复位、缩放、拖动、区域聚焦。旋转只改变查看方向，编号及物理位置不变，文字保持可读。
- 每条纵列以中间立柱横线划分上半区、下半区，共 114 个半区；地图可分别点击和查看。入库必须选择半区，旋转不改变以原图为准的上下方位。
- 每个半区可登记多批货物：名称、SKU（选填）、FBA 货件号（选填）、柜号（选填）、货主、目的仓、托盘数、箱数、状态及备注；支持编辑、跨列或上下半区移库、移出、搜索和台账。柜号支持搜索、JSON 备份及 CSV 导出，旧记录缺少柜号时显示未填写。
- 库存概览以大号数字优先显示托盘数，箱数显示在下方；入库表单和库存台账同样优先展示托盘数。
- 地图按目的仓分配随机主色，同目的仓不同柜号使用同色系的不同深浅；详情、台账与地图下方图例同步显示色块。未填写目的仓使用灰色。配色由当前库存的目的仓/柜号组合确定，刷新、筛选和跨设备查看保持一致；新增或移除分组时可能为拉开近色而调整配色。
- 支持中文 / English 即时切换，沿用参考项目的集中词典、语言按钮和浏览器偏好管理；表单内也可切换，草稿、筛选及业务原文保留。
- 旧 15 列库存的存储编号、数量、原托盘坐标保持不变；页面按实际坐标对应到新列号，详情保留原编号。编辑信息或半区不改变横向位置，明确选择其他列才移库。
- 数据每 5 秒自动同步，切回页面或点击「立即同步」也会更新。其他设备访问同一站点即可共享库存。
- 保存以服务器确认为准；断线禁止修改并显示上次同步内容。并发修改、过期删除或覆盖导入提示冲突，防止覆盖他人修改。
- JSON v5 备份包含半区及布局版本，CSV 同时列出当前列号和原编号；v1/v2 备份先反转旧编号，v3/v4 按旧 15 列布局读取。导入会替换所有成员共享的库存。
- 公开访问，无需登录口令。所有能访问站点的人均可查看和修改共享库存；不区分个人权限或记录个人操作身份。
- 深色侧栏和顶栏、青绿色主按钮、琥珀色选中条、方形面板，支持浅色/深色/系统主题。见 [UI 参考来源](docs/UI_REFERENCE.md)。

## 本机 Docker 启动与测试

先启动 Docker Desktop，使用 Linux 容器。已有 Node.js 时，用辅助脚本生成独立的 Docker 配置；此脚本只生成文件，应用和测试均在容器中运行：

```powershell
node scripts/docker-env.cjs
docker compose --env-file .env.docker up -d --build --wait app
docker compose --env-file .env.docker --profile test run --build --rm test
```

打开 [本地工作台](http://127.0.0.1:4173/)。无需登录，打开即可查看和操作库存。Docker 配置与旧 `.env` 独立。脚本不会覆盖已有 `.env.docker`。没有本机 Node.js 时，可手动复制 `.env.docker.example` 并设置随机数据库口令，详见 [Docker 部署指南](docs/DOCKER_DEPLOYMENT.md)。

Compose 包含 `app`、`db`、一次性 `migrate` 和按需 `test` 容器。等待 PostgreSQL 健康且建表成功后启动应用。数据库使用命名数据卷，默认不暴露 5432 端口；网页仅监听宿主机 `127.0.0.1:4173`。停止时使用 `docker compose --env-file .env.docker down`，保留数据卷。

之前的宿主机 PostgreSQL 已停止，原 `data/postgres` 和 `.env` 保留，不挂载到 Docker，也不会自动迁移。Docker 使用新的独立数据库，初始化不写入示例库存。需要历史数据时，通过原环境导出 JSON 或数据库备份，再明确导入。

局域网、服务器 HTTPS、备份/恢复和升级见 [Docker 部署指南](docs/DOCKER_DEPLOYMENT.md)。Vercel 的云数据库、环境变量、初始化和发布见 [Vercel 部署指南](docs/VERCEL_DEPLOYMENT.md)。两套方案使用同一代码和数据结构，连接不同数据库时不会自动同步彼此的数据。

## 旧版迁移和备份

新版不会自动上传旧浏览器库存。同一浏览器、同一地址打开时会检测旧库存，提供「导入旧浏览器库存」；确认后替换共享库存，旧浏览器数据保留。其他地址的旧数据需先导出 JSON，再在新版导入。

旧 v1/v2 编号按 01 ↔ 15、02 ↔ 14、…、08 不变转换，保留物理位置。缺少目的仓时显示未填写。新备份为 v5，兼容 v1–v4 导入。旧记录缺少布局版本时按原 15 列坐标显示，新入库记录使用 layoutVersion=2；不批量改写旧记录。旧货物缺少半区时保留为「未标注半区」，地图用 `?` 提示，编辑时必须核对选择上半区或下半区；不会擅自移动旧库存。导入上限 4 MB、10,000 批，服务端再次校验。CSV 用于查看，不能导入。

库存保存在 `warehouse_inventory_records`，全仓修订号位于 `warehouse_inventory_meta`。半区字段保存于记录 JSONB，升级无需修改表结构或清空数据。事务内校验版本：单批操作检查记录版本，整库导入检查全仓修订号。删除后重新导入同一 ID 也不会让旧草稿覆盖新记录。网络中断不会退回浏览器保存；浏览器本地仅保存主题和语言偏好、保留待迁移旧库存。

数据库连接串只在服务端，网页无需口令。生产数据库应配置备份，网页 JSON 导出用于业务备份，不能代替数据库恢复策略。

## 图纸与容量依据

两张原图保持原样，尺寸 1385 × 1956。ABC 边界依据 `区域说明.png`，底图为 `unit23_available_area_clean_no_text.png`。新横向网格依据现场计数：柱中心为第 01、10、19 列，201 图纸像素的柱跨分为 9 个间隔，即中心距 22.333… 像素。第一列和第十九列各向柱中心外延半个间隔。纵向托盘示意保留原尺度，不以此次横向计数重新推算实际柱距米数。托盘为 1 × 1.2 米，长边沿原图竖向，图形只表示数量，不建立逐托编号。

建议容量按纵深、托盘长度和柱位扣减估算，未计额外作业间隙，需要现场校核。超过估算容量仍保留实际数量并提示。办公室、货架区及通道不计入 FBA 地面纵列，方向均以原始图纸为准。

## 源码和检查

| 路径 | 用途 |
| --- | --- |
| `src/template.html` / `src/app.js` | 页面、坐标、模型、旋转、同步及库存交互 |
| `src/styles.css` / `src/office-theme.css` | 基础布局及 stripSystem 风格 |
| `server/http.cjs` / `server/database.cjs` | 公开 API、事务和并发校验 |
| `api/` | Vercel Functions 入口 |
| `db/migrations/001_inventory.sql` | 空数据库初始化 |
| `scripts/build.cjs` | 生成根目录及 dist 中的 HTML |
| `Dockerfile` / `compose.yaml` | 容器构建、应用、数据库、初始化和测试 |
| `compose.https.yaml` / `deploy/Caddyfile` | 可选服务器 HTTPS 反向代理 |

```powershell
docker compose --env-file .env.docker --profile test run --build --rm test
```

测试容器依次运行 25 项模型/多语言/构建检查、6 项真实 PostgreSQL API 检查和实际应用 HTTP 检查，覆盖中英文完整性、旧版全量坐标基准、19 列布局、混合布局备份、旧客户端写入阻断、目的仓/柜号配色及并发冲突。数据库检查创建随机隔离 schema；HTTP 检查只创建并移除自身唯一 ID 的临时货物，保留已有库存。不要在日常生产环境运行此测试服务。

`tests/browser.cjs` 为可选只读浏览器检查，需要 Playwright，并显式设置 `BROWSER_TEST_URL`，访问 Docker 提供的网页，不启动宿主机应用。已验证容器重建持久化，以及备份恢复到临时数据库；临时数据均清理。Vercel 已上线，升级保留已有业务库存；验证边界见 [部署验证记录](docs/DEPLOYMENT_VERIFICATION.md)。

库位版本兼容和翻译词典维护说明见 [布局与多语言管理](docs/LAYOUT_AND_I18N.md)。
