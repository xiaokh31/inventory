const test = require('node:test');
const assert = require('node:assert/strict');
const m = require('../src/app.js');
const fixtures = require('./fixtures.cjs');

test('quarter-turn bounds preserve every map point and reverse without coordinate drift', () => {
  const rect = { x: -35, y: 685, w: 1390, h: 1270 };
  for (const angle of [0, 90, 180, 270]) {
    const bounds = m.rotateBounds(rect, angle);
    assert.ok(Math.abs(bounds.w - (angle % 180 ? rect.h : rect.w)) < 1e-8);
    assert.ok(Math.abs(bounds.h - (angle % 180 ? rect.w : rect.h)) < 1e-8);
    for (const lane of m.LANES) {
      const point = m.rotatePoint(lane, angle), restored = m.rotatePoint(point, -angle);
      assert.ok(point.x >= bounds.x && point.x <= bounds.x + bounds.w);
      assert.ok(point.y >= bounds.y && point.y <= bounds.y + bounds.h);
      assert.ok(Math.abs(restored.x - lane.x) < 1e-8 && Math.abs(restored.y - lane.y) < 1e-8);
    }
  }
});

test('45 whole-lane locations numbered right to left, with 7.5 lanes per 12 m column bay', () => {
  assert.equal(m.LANES.length, 45);
  assert.equal(new Set(m.LANES.map(l => l.id)).size, 45);
  assert.ok(Math.abs(7.5 * m.LANE_WIDTH - 201) < 1e-8);
  for (const z of m.ZONES) {
    const lanes = m.LANES.filter(l => l.zone === z.id);
    assert.equal(lanes.length, 15);
    assert.equal(lanes[0].id, z.id + '-01');
    assert.equal(lanes[14].id, z.id + '-15');
    assert.ok(Math.abs(lanes[0].x + lanes[0].width - (z.x + z.width)) < 1e-8);
    assert.ok(Math.abs(lanes[14].x - z.x) < 1e-8);
    for (let i = 1; i < lanes.length; i++) assert.ok(lanes[i].x < lanes[i - 1].x);
  }
});
test('pallet figures are vertical, inside ABC zones, and do not touch expanded column footprints', () => {
  for (const lane of m.LANES) {
    assert.ok(lane.capacity > 0);
    for (const p of lane.positions) {
      assert.ok(p.height > p.width);
      assert.ok(p.x >= lane.x && p.x + p.width <= lane.x + lane.width + 1e-8);
      assert.ok(p.y >= lane.y && p.y + p.height <= lane.y + lane.height + 1e-8);
      assert.ok(!m.COLUMNS.some(c => m.intersects(p, { x: c.x - 5, y: c.y - 5, width: 10, height: 10 })));
    }
  }
  assert.ok(m.LANE_BY_ID['A-08'].capacity < m.LANE_BY_ID['A-05'].capacity);
});
test('12 docks are numbered 23 to 34 from bottom to top', () => {
  assert.deepEqual(m.DOCKS.map(d => d.number), Array.from({ length: 12 }, (_, i) => i + 23));
  for (let i = 1; i < m.DOCKS.length; i++) assert.ok(m.DOCKS[i].y < m.DOCKS[i - 1].y);
  assert.ok(m.DOCKS[0].y < 1390);
});
test('batch records aggregate by whole lane and round-trip unchanged in a v3 backup', () => {
  const data = m.validateRecords(fixtures.records());
  const summary = m.summaries(data);
  assert.equal(summary.total, 45);
  assert.ok(data.length > summary.occupied);
  assert.equal(summary.occupied + summary.empty, 45);
  const backup = JSON.stringify({ format: 'bestar-warehouse-lanes', version: 3, mode: 'local', records: data });
  assert.deepEqual(m.parseBackup(backup).records, data);
  assert.equal(m.parseBackup(backup).renumbered, false);
  assert.deepEqual(m.summaries([]), { total: 45, occupied: 0, empty: 45, pallets: 0, cartons: 0 });
});
test('search combines zone, status and SKU/location/shipment/destination fields', () => {
  const records = fixtures.records();
  const one = records.find(r => r.location === 'B-03');
  assert.ok(one);
  assert.equal(m.queryRecords(records, 'B', one.status, one.shipment).length, 1);
  assert.equal(m.queryRecords(records, 'A', 'all', one.shipment).length, 0);
  assert.ok(m.queryRecords(records, 'all', 'all', 'a-05').every(r => r.location === 'A-05'));
  assert.equal(m.queryRecords(records, 'all', 'empty').length, 0);
  assert.equal(m.queryRecords(records, 'all', 'all', 'ont8').length, 1);
  assert.equal(m.queryRecords(records, 'B', 'outbound', '中转仓').length, 1);
  assert.equal(m.queryRecords(records, 'A', 'outbound', '中转仓').length, 0);
});
test('import rejects non-existent positions, duplicate IDs and invalid quantities atomically', () => {
  const data = fixtures.records();
  for (const patch of [{ location: 'D-01' }, { location: 'A-01-01' }, { location: '__proto__' }, { pallets: 0 }, { cartons: -1 }, { pallets: 1.5 }, { status: 'unknown' }, { name: '' }, { updatedAt: 'not-date' }, { destination: null }, { destination: 123 }, { destination: 'x'.repeat(81) }]) {
    assert.throws(() => m.validateRecords([{ ...data[0], ...patch }]));
  }
  assert.throws(() => m.validateRecords([data[0], data[0]]));
  assert.throws(() => m.parseBackup('{'));
  assert.throws(() => m.parseBackup(JSON.stringify({ records: data, version: 99 })));
});
test('old records and v1 backups remain readable without a destination', () => {
  const [old] = fixtures.records();
  delete old.destination;
  const data = m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 1, records: [old] }));
  assert.equal(data.records[0].destination, '');
  assert.equal(data.records[0].location, 'A-11');
  assert.equal(m.validateRecords([{ ...old, destination: '  ONT8  ' }])[0].destination, 'ONT8');
});
test('startup clears retired demo storage and retains actual local records and unrelated data', () => {
  const prefix = 'bestar-warehouse-lanes-v1';
  const old = fixtures.records();
  delete old[0].destination;
  const values = new Map([[prefix + ':demo', '["retired sample"]'], [prefix + ':mode', 'demo'], [prefix + ':local', JSON.stringify(old)], ['other-app', 'keep']]);
  const storage = { getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key) };
  const migrated = m.loadInventory(storage);
  assert.equal(migrated.length, old.length);
  assert.equal(migrated[0].location, 'A-11');
  assert.equal(values.has(prefix + ':demo'), false);
  assert.equal(values.has(prefix + ':mode'), false);
  assert.equal(values.get(prefix + ':local'), JSON.stringify(old));
  assert.equal(values.get('other-app'), 'keep');
  values.set(prefix + ':local', JSON.stringify({ format: 'bestar-warehouse-lanes', version: 3, records: migrated }));
  assert.deepEqual(m.loadInventory(storage), migrated);
  assert.deepEqual(m.loadInventory({ getItem: () => null, removeItem: () => {} }), []);
  values.set(prefix + ':local', 'damaged');
  assert.throws(() => m.loadInventory(storage));
  assert.equal(values.get(prefix + ':local'), 'damaged');
});
test('v1/v2 backups retain every physical lane and quantity when reversing the labels', () => {
  const oldRecords = m.LANES.map((lane, i) => ({ ...fixtures.records()[0], id: 'old-' + i, location: lane.id }));
  for (const version of [1, 2]) {
    const result = m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version, records: oldRecords }));
    assert.equal(result.renumbered, true);
    for (let i = 0; i < oldRecords.length; i++) {
      const old = oldRecords[i];
      const current = result.records[i];
      const zone = m.ZONES.find(z => z.id === old.location[0]);
      const oldX = zone.x + (Number(old.location.slice(2)) - 1) * m.LANE_WIDTH;
      assert.ok(Math.abs(m.LANE_BY_ID[current.location].x - oldX) < 1e-8);
      assert.deepEqual({ ...current, location: old.location }, { ...old, section: 'unspecified' });
    }
  }
});
test('CSV output neutralizes formula prefixes and escapes quotes/newlines', () => {
  assert.equal(m.csvCell('=1+1'), '"\'=1+1"');
  assert.equal(m.csvCell('hello,"world"'), '"hello,""world"""');
  assert.equal(m.csvCell('two\nlines'), '"two\nlines"');
});

test('each lane is split at its zone pillar row and pallet figures stay within their half', () => {
  for (const lane of m.LANES) {
    assert.equal(lane.splitY, { A: 1391, B: 1114, C: 837 }[lane.zone]);
    assert.equal(lane.sections.upper.y + lane.sections.upper.height, lane.splitY);
    assert.equal(lane.sections.lower.y, lane.splitY);
    assert.equal(lane.sections.lower.y + lane.sections.lower.height, lane.y + lane.height);
    assert.equal(lane.capacity, lane.sections.upper.capacity + lane.sections.lower.capacity);
    for (const section of ['upper', 'lower']) {
      assert.ok(lane.sections[section].capacity > 0);
      for (const position of lane.sections[section].positions) {
        assert.equal(position.section, section);
        assert.ok(section === 'upper' ? position.y + position.height <= lane.splitY : position.y >= lane.splitY);
      }
    }
  }
});

test('halves and optional SKU/FBA round-trip in v4; legacy records remain unassigned', () => {
  const [old] = fixtures.records();
  const upper = { ...old, section: 'upper', sku: '', shipment: '' };
  const lower = { ...old, id: 'lower', section: 'lower', sku: undefined, shipment: undefined };
  const data = m.validateRecords([upper, lower, { ...old, id: 'legacy' }]);
  assert.equal(data[0].sku, ''); assert.equal(data[1].shipment, ''); assert.equal(data[2].section, 'unspecified');
  assert.deepEqual(m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 4, records: data })).records, data);
  assert.equal(m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 3, records: [old] })).records[0].section, 'unspecified');
  assert.equal(m.queryRecords(data, 'all', 'all', '上半区').length, 1);
  assert.equal(m.queryRecords(data, 'all', 'all', '下半区')[0].id, 'lower');
  for (const patch of [{ section: 'middle' }, { section: '' }, { section: null }, { section: ['upper'] }, { sku: 12 }, { shipment: null }]) assert.throws(() => m.validateRecords([{ ...upper, ...patch }]));
});
