const { Pool } = require('pg');
const { validateRecords } = require('../src/app.js');
class ConflictError extends Error { constructor() { super('库存已被其他用户修改，请刷新核对后再保存。'); this.status = 409; } }
function createStore(pool) {
  async function snapshot(client) {
    const { rows: [meta] } = await client.query('SELECT revision FROM warehouse_inventory_meta WHERE singleton = 1');
    if (!meta) throw new Error('Inventory schema has not been initialized');
    const { rows } = await client.query('SELECT id, data, version FROM warehouse_inventory_records ORDER BY id');
    return { records: rows.map(row => row.data), versions: Object.fromEntries(rows.map(row => [row.id, Number(row.version)])), revision: Number(meta.revision), serverTime: new Date().toISOString() };
  }
  async function transaction(action, readOnly = false) {
    const client = await pool.connect();
    try {
      await client.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      const result = await action(client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return {
    async health() {
      const { rows } = await pool.query('SELECT singleton FROM warehouse_inventory_meta WHERE singleton = 1');
      await pool.query('SELECT id FROM warehouse_inventory_records LIMIT 0');
      if (!rows.length) throw new Error('Inventory schema has not been initialized');
      return { status: 'ok' };
    },
    read: () => transaction(snapshot, true),
    async mutate(input) {
      if (!input || !['upsert', 'delete', 'replace'].includes(input.action)) throw Object.assign(new Error('不支持的库存操作。'), { status: 400 });
      // Use a validation error so the old UI does not replace this reload message with its generic 409 conflict text.
      if (input.clientLayoutVersion !== 3) throw Object.assign(new Error('库位布局已更新，请刷新页面后再操作。'), { status: 400, code: 'LAYOUT_UPDATED' });
      let records;
      try {
        if (input.action === 'upsert') records = validateRecords([{ ...input.record, updatedAt: new Date().toISOString() }]);
        if (input.action === 'replace') records = validateRecords(input.records);
      } catch (error) { error.status = 400; throw error; }
      if (input.action === 'delete' && (typeof input.id !== 'string' || input.id.length > 100)) throw Object.assign(new Error('货物 ID 不正确。'), { status: 400 });
      if (input.action === 'replace' ? !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 : !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) throw Object.assign(new Error('缺少有效的数据版本，请刷新后重试。'), { status: 400 });
      return transaction(async client => {
        const { rows: [meta] } = await client.query('SELECT revision FROM warehouse_inventory_meta WHERE singleton = 1 FOR UPDATE');
        if (!meta) throw new Error('Inventory schema has not been initialized');
        const nextVersion = Number(meta.revision) + 1;
        if (input.action === 'replace') {
          if (Number(meta.revision) !== input.expectedRevision) throw new ConflictError();
          // Global versions also protect against deleting and re-importing the same ID.
          await client.query('DELETE FROM warehouse_inventory_records');
          await client.query("INSERT INTO warehouse_inventory_records(id, data, version) SELECT entry->>'id', entry, $2 FROM jsonb_array_elements($1::jsonb) AS entry", [JSON.stringify(records), nextVersion]);
        } else {
          const id = input.action === 'upsert' ? records[0].id : input.id;
          const { rows: [existing] } = await client.query('SELECT version FROM warehouse_inventory_records WHERE id = $1', [id]);
          if (Number(existing?.version || 0) !== input.expectedVersion || (input.action === 'delete' && !existing)) throw new ConflictError();
          if (input.action === 'upsert') {
            const { rows: [count] } = await client.query('SELECT count(*) AS total FROM warehouse_inventory_records');
            if (!existing && Number(count.total) >= 10000) throw Object.assign(new Error('最多可保存 10,000 批货物。'), { status: 400 });
            await client.query('INSERT INTO warehouse_inventory_records(id, data, version) VALUES ($1, $2::jsonb, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, version = EXCLUDED.version, updated_at = now()', [id, JSON.stringify(records[0]), nextVersion]);
          } else await client.query('DELETE FROM warehouse_inventory_records WHERE id = $1', [id]);
        }
        await client.query('UPDATE warehouse_inventory_meta SET revision = revision + 1 WHERE singleton = 1');
        return snapshot(client);
      });
    }
  };
}
let pool, store;
function getStore() {
  if (!process.env.DATABASE_URL) throw Object.assign(new Error('数据库尚未配置，请设置 DATABASE_URL 并初始化数据库。'), { status: 503 });
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3, idleTimeoutMillis: 10000, connectionTimeoutMillis: 8000, statement_timeout: 15000, application_name: 'bestar-inventory' });
    pool.on('error', error => console.error('Inventory idle connection closed:', error.code || error.name));
    store = createStore(pool);
  }
  return store;
}
async function closeStore() { if (pool) await pool.end(); pool = undefined; store = undefined; }
module.exports = { createStore, getStore, closeStore, ConflictError };
