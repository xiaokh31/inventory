const { getStore } = require('./database.cjs');
function json(res, status, data) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff'); res.end(JSON.stringify(data)); }
async function body(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('请求必须使用 JSON。'), { status: 415 });
  if (Number(req.headers['content-length'] || 0) > 4 * 1024 * 1024) throw Object.assign(new Error('请求过大，请使用 4 MB 以内的备份。'), { status: 413 });
  if (req.body !== undefined) {
    if (Buffer.byteLength(JSON.stringify(req.body)) > 4 * 1024 * 1024) throw Object.assign(new Error('请求过大。'), { status: 413 });
    try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch { throw Object.assign(new Error('JSON 格式不正确。'), { status: 400 }); }
  }
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) throw Object.assign(new Error('请求过大。'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('JSON 格式不正确。'), { status: 400 }); }
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true;
  const expected = process.env.APP_ORIGIN;
  try { return expected ? req.headers.origin === new URL(expected).origin : new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
async function handler(req, res) {
  try {
    if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); return json(res, 405, { error: '不支持的请求方法。' }); }
    if (req.method !== 'GET' && !sameOrigin(req)) return json(res, 403, { error: '请求来源不匹配，请从本站页面操作。' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/health') {
      if (req.method !== 'GET') return json(res, 405, { error: '健康检查仅支持 GET。' });
      try { return json(res, 200, await getStore().health()); }
      catch { return json(res, 503, { status: 'unavailable' }); }
    }
    if (pathname !== '/api/inventory') return json(res, 404, { error: '接口不存在。' });
    if (req.method === 'GET') return json(res, 200, await getStore().read());
    if (req.method !== 'POST') return json(res, 405, { error: '此接口仅支持 GET 和 POST。' });
    return json(res, 200, await getStore().mutate(await body(req)));
  } catch (error) {
    const status = error.status || 503;
    if (!error.status) console.error('Inventory API unavailable:', error.code || error.name);
    return json(res, status, { error: error.status ? error.message : '数据库暂不可用，请检查连接与初始化状态后重试。' });
  }
}
module.exports = { handler, sameOrigin };
