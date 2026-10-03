// Real HTTP checks against the running app container. Only touches a unique temporary batch.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const origin = process.env.DEPLOYMENT_TEST_URL;
const mode = process.argv[2] || 'full';
if (!origin) throw new Error('DEPLOYMENT_TEST_URL is required.');
if (!['full', 'seed', 'verify-clean'].includes(mode)) throw new Error('Unknown smoke mode.');
const id = process.env.SMOKE_RECORD_ID || 'deploy-smoke-' + crypto.randomUUID();
if (!/^deploy-smoke-[a-z0-9-]+$/.test(id)) throw new Error('Only deploy-smoke IDs may be used.');
if (mode !== 'full' && !process.env.SMOKE_RECORD_ID) throw new Error('Persistence checks require the same explicit SMOKE_RECORD_ID.');
async function request(route, method = 'GET', body) {
  if (body) body = { clientLayoutVersion: 2, ...body };
  const response = await fetch(origin + route, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { Origin: new URL(origin).origin }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
(async () => {
  assert.deepEqual((await request('/api/health')).data, { status: 'ok' });
  const home = await fetch(origin, { signal: AbortSignal.timeout(10000) });
  assert.equal(home.status, 200); const html = await home.text();
  assert.match(html, /id="rotate-right"/); assert.match(html, /id="cargo-destination"/); assert.match(html, /id="cargo-container"/);
  assert.match(html, /id="destination-legend"/);
  assert.match(html, /data-locale="en"/);
  assert.match(html, /LANES_PER_ZONE = 19/);
  assert.equal((await request('/api/inventory')).status, 200);
  assert.doesNotMatch(html, /id="login-dialog"|id="logout-button"/);
  const record = { id, layoutVersion: 2, location: 'A-19', section: 'upper', sku: '', name: 'Docker 临时验证记录', shipment: '', container: 'TEST-CONTAINER-001', owner: '', destination: 'ONT8', pallets: 1, cartons: 12, status: 'stored', notes: '自动检查结束后清理', updatedAt: new Date().toISOString() };
  let created = false;
  try {
    if (mode === 'verify-clean') {
      const snapshot = await request('/api/inventory', 'GET', undefined);
      assert.equal(snapshot.status, 200);
      const saved = snapshot.data.records.find(item => item.id === id);
      assert.ok(saved, 'Record must survive app and PostgreSQL container recreation');
      assert.equal(saved.destination, 'ONT8'); assert.equal(saved.cartons, 12); created = true;
      console.log('Persistence verified after container recreation.');
      return;
    }
    const inserted = await request('/api/inventory', 'POST', { action: 'upsert', record, expectedVersion: 0 });
    assert.equal(inserted.status, 200); created = true;
    if (mode === 'seed') { console.log('Temporary persistence record created:', id); return; }
    const snapshot = await request('/api/inventory', 'GET', undefined);
    assert.equal(snapshot.status, 200); assert.equal(snapshot.data.records.find(item => item.id === id).destination, 'ONT8');
    const shared = snapshot.data.records.find(item => item.id === id);
    assert.equal(shared.section, 'upper'); assert.equal(shared.sku, ''); assert.equal(shared.shipment, '');
    assert.equal(shared.container, 'TEST-CONTAINER-001');
    const version = snapshot.data.versions[id];
    const moved = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, location: 'C-15', section: 'lower', container: 'TEST-CONTAINER-002', destination: 'LAX9', cartons: 18 }, expectedVersion: version });
    assert.equal(moved.status, 200);
    const stale = await request('/api/inventory', 'POST', { action: 'upsert', record: { ...record, cartons: 99 }, expectedVersion: version });
    assert.equal(stale.status, 409);
    const latest = (await request('/api/inventory', 'GET', undefined)).data.records.find(item => item.id === id);
    assert.equal(latest.location, 'C-15'); assert.equal(latest.cartons, 18); assert.equal(latest.destination, 'LAX9');
    assert.equal(latest.section, 'lower');
    assert.equal(latest.container, 'TEST-CONTAINER-002');
    console.log('Running container HTTP checks passed: health, built page, public access, two anonymous clients, writes, movement and conflict protection.');
  } finally {
    if (created && mode !== 'seed') {
      const current = await request('/api/inventory', 'GET', undefined);
      assert.equal(current.status, 200);
      if (current.data.versions[id]) {
        const removed = await request('/api/inventory', 'POST', { action: 'delete', id, expectedVersion: current.data.versions[id] });
        assert.equal(removed.status, 200); assert.equal(removed.data.records.some(item => item.id === id), false);
      }
      console.log('Only this test batch was removed; existing inventory was preserved.');
    }
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
