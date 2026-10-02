const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const file = path.resolve(__dirname, '../.env.docker');
if (fs.existsSync(file)) {
  console.log('.env.docker 已存在，保留现有数据库和网络配置。');
} else {
  const random = bytes => crypto.randomBytes(bytes).toString('hex');
  fs.writeFileSync(file, `POSTGRES_PASSWORD=${random(24)}\nBIND_ADDRESS=127.0.0.1\nAPP_PORT=4173\nAPP_ORIGIN=\nPUBLIC_HOST=\n`, { flag: 'wx', mode: 0o600 });
  console.log('已生成 .env.docker，使用随机数据库凭据；文件不提交且不进入镜像。网页直接公开访问，无需登录。');
}
