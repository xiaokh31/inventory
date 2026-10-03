// Uses a fresh schema in the configured database, drops only that schema on completion.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { Pool } = require('pg');
require('../server/config.cjs').loadEnv();
const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!baseUrl) throw new Error('请先配置 TEST_DATABASE_URL 或本地 DATABASE_URL，再运行数据库检查。');
const schema = 'inventory_test_' + crypto.randomBytes(8).toString('hex');
let admin, server, origin, handler, closeStore;
let snapshot;
const record = { id: 'shared-test-1', location: 'A-01', section: 'upper', sku: '', name: '数据库隔离测试', shipment: '', container: 'TEST-CONTAINER-001', owner: '', destination: 'ONT8', pallets: 2, cartons: 12, status: 'stored', notes: '', updatedAt: new Date().toISOString() };
async function request(route, method = 'GET', body, headers = {}) {
  if (body && typeof body === 'object') body = { clientLayoutVersion: 3, ...body };
  const response = await fetch(origin + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
before(async () => {
  admin = new Pool({ connectionString: baseUrl, connectionTimeoutMillis: 5000 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(baseUrl); url.searchParams.set('options', '-c search_path=' + schema);
  process.env.DATABASE_URL = url.toString(); delete process.env.APP_ORIGIN;
  // Old deployment settings must not re-enable the retired login gate.
  process.env.AUTH_MODE = 'password'; process.env.INVENTORY_PASSWORD = 'obsolete'; process.env.SESSION_SECRET = 'obsolete';
  const setup = new Pool({ connectionString: url.toString() });
  try { await setup.query(fs.readFileSync(path.join(__dirname, '../db/migrations/001_inventory.sql'), 'utf8')); } finally { await setup.end(); }
  ({ handler } = require('../server/http.cjs')); ({ closeStore } = require('../server/database.cjs'));
  server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  if (closeStore) await closeStore();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end(); }
});
test('public access needs no cookie; malformed and cross-origin writes are rejected', async () => {
  const health = await request('/api/health');
  assert.equal(health.status, 200); assert.deepEqual(health.data, { status: 'ok' });
  assert.equal((await request('/api/health', 'POST', {})).status, 405);
  const publicRead = await request('/api/inventory');
  assert.equal(publicRead.status, 200); assert.equal(publicRead.cookie, undefined);
  assert.equal((await request('/api/session')).status, 404);
  assert.equal((await request('/api/inventory', 'POST', 'null')).status, 400);
  assert.equal((await request('/api/inventory', 'POST', '{')).status, 400);
  assert.equal((await request('/api/inventory', 'POST', {}, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await request('/api/inventory', 'GET', undefined, { Cookie: 'bestar_inventory_session=expired.invalid' })).status, 200);
  snapshot = publicRead.data;
  assert.deepEqual(snapshot.records, []);
});
test('two anonymous clients share committed records, including destination and movements', async () => {
  const created = await request('/api/inventory', 'POST', { action: 'upsert', record, expectedVersion: 0 });
  assert.equal(created.status, 200); snapshot = created.data;
  const readByB = await request('/api/inventory', 'GET', undefined);
  assert.equal(readByB.data.records[0].destination, 'ONT8'); assert.equal(readByB.data.versions[record.id], snapshot.versions[record.id]);
  assert.equal(readByB.data.records[0].section, 'upper'); assert.equal(readByB.data.records[0].sku, ''); assert.equal(readByB.data.records[0].shipment, '');
  assert.equal(readByB.data.records[0].container, 'TEST-CONTAINER-001');
  const moved = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, location: 'C-15', section: 'lower', container: 'TEST-CONTAINER-002', destination: 'LAX9' }, expectedVersion: snapshot.versions[record.id] });
  assert.equal(moved.status, 200); snapshot = moved.data;
  assert.equal((await request('/api/inventory', 'GET', undefined)).data.records[0].location, 'C-15');
  assert.equal((await request('/api/inventory')).data.records[0].section, 'lower');
  assert.equal((await request('/api/inventory')).data.records[0].container, 'TEST-CONTAINER-002');
});
test('concurrent writes have exactly one winner and stale deletion/import cannot erase changes', async () => {
  const expectedVersion = snapshot.versions[record.id], expectedRevision = snapshot.revision;
  const results = await Promise.all([0, 1].map(index => request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, cartons: 20 + index }, expectedVersion })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  snapshot = results.find(r => r.status === 200).data;
  assert.equal((await request('/api/inventory', 'POST', { action: 'delete', id: record.id, expectedVersion })).status, 409);
  assert.equal((await request('/api/inventory', 'POST', { action: 'replace', records: [], expectedRevision })).status, 409);
  assert.equal((await request('/api/inventory', 'GET', undefined)).data.revision, snapshot.revision);
});
test('invalid replacement is atomic; new records do not overwrite unrelated changes', async () => {
  assert.equal((await request('/api/inventory', 'POST', { action: 'replace', records: [record, { ...record, id: 'invalid', pallets: -1 }], expectedRevision: snapshot.revision })).status, 400);
  assert.equal((await request('/api/inventory', 'GET', undefined)).data.revision, snapshot.revision);
  const added = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, id: 'unrelated' }, expectedVersion: 0 });
  assert.equal(added.status, 200); assert.equal(added.data.records.length, 2); snapshot = added.data;
});
test('delete/reimport and process reconnect preserve versions and reject old drafts', async () => {
  const oldVersion = snapshot.versions[record.id];
  const deleted = await request('/api/inventory', 'POST', { action: 'delete', id: record.id, expectedVersion: oldVersion });
  assert.equal(deleted.status, 200);
  const imported = await request('/api/inventory', 'POST', { action: 'replace', records: [record], expectedRevision: deleted.data.revision });
  assert.equal(imported.status, 200); snapshot = imported.data;
  assert.ok(snapshot.versions[record.id] > oldVersion);
  assert.equal((await request('/api/inventory', 'POST', { action: 'upsert', record, expectedVersion: oldVersion })).status, 409);
  await closeStore();
  const reconnected = await request('/api/inventory', 'GET', undefined);
  assert.deepEqual(reconnected.data.records, snapshot.records); assert.deepEqual(reconnected.data.versions, snapshot.versions);
  const emptied = await request('/api/inventory', 'POST', { action: 'replace', records: [], expectedRevision: snapshot.revision });
  assert.equal(emptied.status, 200); assert.deepEqual(emptied.data.records, []);
});

test('layout upgrade reads legacy rows unchanged and blocks old pages before any write', async () => {
  const legacy = await request('/api/inventory', 'POST', { action: 'upsert', record, expectedVersion: 0 });
  assert.equal(legacy.status, 200);
  const saved = legacy.data.records[0], revision = legacy.data.revision;
  assert.equal(saved.location, 'A-01'); assert.equal(Object.hasOwn(saved, 'layoutVersion'), false);
  const rejected = await request('/api/inventory', 'POST', { action: 'upsert', record, expectedVersion: legacy.data.versions[record.id], clientLayoutVersion: undefined }, { 'Accept-Language': 'en' });
  assert.equal(rejected.status, 400); assert.equal(rejected.data.code, 'LAYOUT_UPDATED'); assert.match(rejected.data.error, /Reload/);
  for (const action of ['upsert', 'delete', 'replace']) {
    const outdated = await request('/api/inventory', 'POST', { action, record, id: record.id, records: [], expectedVersion: legacy.data.versions[record.id], expectedRevision: revision, clientLayoutVersion: 2 });
    assert.equal(outdated.status, 400); assert.equal(outdated.data.code, 'LAYOUT_UPDATED');
  }
  const afterRead = await request('/api/inventory');
  assert.deepEqual(afterRead.data.records, legacy.data.records);
  assert.deepEqual(afterRead.data.versions, legacy.data.versions); assert.equal(afterRead.data.revision, revision);
  const { placementForEdit } = require('../src/app.js');
  const edited = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...saved, ...placementForEdit(saved, 'A-01', 'upper'), container: 'DETAILS-ONLY' }, expectedVersion: legacy.data.versions[record.id] });
  assert.equal(edited.status, 200); assert.equal(edited.data.records[0].location, 'A-01'); assert.equal(Object.hasOwn(edited.data.records[0], 'layoutVersion'), false);
  const added = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, id: 'new-layout', location: 'C-19', layoutVersion: 2 }, expectedVersion: 0 });
  assert.equal(added.status, 200); assert.equal(added.data.records.find(r => r.id === 'new-layout').layoutVersion, 2);
  assert.deepEqual(added.data.records.find(r => r.id === record.id), edited.data.records[0]);
  const invalid = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, layoutVersion: 3 }, expectedVersion: 0 }, { 'Accept-Language': 'en' });
  assert.equal(invalid.status, 400); assert.doesNotMatch(invalid.data.error, /[\u4e00-\u9fff]/);
  const clean = await request('/api/inventory', 'POST', { action: 'replace', records: [], expectedRevision: added.data.revision });
  assert.equal(clean.status, 200);
});
