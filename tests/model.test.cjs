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

test('57 lanes with pillar centers aligned to lanes 01, 10 and 19', () => {
  assert.equal(m.LANES.length, 57);
  assert.equal(new Set(m.LANES.map(l => l.id)).size, 57);
  assert.ok(Math.abs(9 * m.LANE_WIDTH - 201) < 1e-8);
  for (const z of m.ZONES) {
    const lanes = m.LANES.filter(l => l.zone === z.id);
    assert.equal(lanes.length, 19);
    assert.equal(lanes[0].id, z.id + '-01');
    assert.equal(lanes[18].id, z.id + '-19');
    assert.ok(Math.abs(lanes[0].x + lanes[0].width / 2 - (z.x + z.width)) < 1e-8);
    assert.ok(Math.abs(lanes[18].x + lanes[18].width / 2 - z.x) < 1e-8);
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
  assert.ok(Math.abs(m.LANE_BY_ID['A-10'].x + m.LANE_WIDTH / 2 - 811) < 1e-8);
});
test('12 docks are numbered 23 to 34 from bottom to top', () => {
  assert.deepEqual(m.DOCKS.map(d => d.number), Array.from({ length: 12 }, (_, i) => i + 23));
  for (let i = 1; i < m.DOCKS.length; i++) assert.ok(m.DOCKS[i].y < m.DOCKS[i - 1].y);
  assert.ok(m.DOCKS[0].y < 1390);
});
test('batch records aggregate by whole lane and round-trip unchanged in a v3 backup', () => {
  const data = m.validateRecords(fixtures.records());
  const summary = m.summaries(data);
  assert.equal(summary.total, 57);
  assert.ok(data.length > summary.occupied);
  assert.equal(summary.occupied + summary.empty, 57);
  const backup = JSON.stringify({ format: 'bestar-warehouse-lanes', version: 3, mode: 'local', records: data });
  assert.deepEqual(m.parseBackup(backup).records, data);
  assert.equal(m.parseBackup(backup).renumbered, false);
  assert.deepEqual(m.summaries([]), { total: 57, occupied: 0, empty: 57, pallets: 0, cartons: 0 });
});
test('search combines zone, status and SKU/location/shipment/destination fields', () => {
  const records = fixtures.records();
  const one = records.find(r => r.location === 'B-03');
  assert.ok(one);
  assert.equal(m.queryRecords(records, 'B', one.status, one.shipment).length, 1);
  assert.equal(m.queryRecords(records, 'A', 'all', one.shipment).length, 0);
  assert.ok(m.queryRecords(records, 'all', 'all', 'a-05').every(r => r.location === 'A-05' || m.recordLaneId(r) === 'A-05'));
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
  const oldRecords = m.LEGACY_LANES.map((lane, i) => ({ ...fixtures.records()[0], id: 'old-' + i, location: lane.id }));
  for (const version of [1, 2]) {
    const result = m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version, records: oldRecords }));
    assert.equal(result.renumbered, true);
    for (let i = 0; i < oldRecords.length; i++) {
      const old = oldRecords[i];
      const current = result.records[i];
      const zone = m.ZONES.find(z => z.id === old.location[0]);
      const oldX = zone.x + (Number(old.location.slice(2)) - 1) * m.LEGACY_LANE_WIDTH;
      assert.ok(Math.abs(m.LEGACY_LANE_BY_ID[current.location].x - oldX) < 1e-8);
      assert.deepEqual({ ...current, location: old.location }, { ...old, section: 'unspecified', container: '' });
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

test('container number is optional for old records and survives search and backup round trips', () => {
  const [old] = fixtures.records();
  assert.equal(m.validateRecords([old])[0].container, '');
  for (const version of [1, 2, 3, 4]) {
    assert.equal(m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version, records: [old] })).records[0].container, '');
  }
  const data = m.validateRecords([{ ...old, container: '  TEST-CONTAINER-001  ' }]);
  assert.equal(data[0].container, 'TEST-CONTAINER-001');
  assert.equal(m.queryRecords(data, 'all', 'all', 'test-container-001').length, 1);
  assert.equal(m.queryRecords(data, 'B', 'all', 'test-container-001').length, 0);
  assert.deepEqual(m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 4, records: data })).records, data);
  for (const container of [null, 123, [], 'x'.repeat(81)]) assert.throws(() => m.validateRecords([{ ...old, container }]));
});

test('destination colors stay stable across refresh inputs, quantities, status and movements', () => {
  const record = { destination: 'ONT8', container: 'CONT-001', status: 'stored', location: 'A-01' };
  const color = m.cargoColor(record);
  assert.deepEqual(m.cargoColor({ ...record, destination: '  ｏｎｔ８  ', container: ' cont-001 ' }), color);
  assert.deepEqual(m.cargoColor({ ...record, location: 'C-15', section: 'lower', status: 'outbound', pallets: 20 }), color);
  assert.notEqual(m.cargoColor({ ...record, destination: 'LAX9' }).hue, color.hue);
  assert.match(color.fill, /^hsl\([\d.]+ [\d.]+% [\d.]+%\)$/);
});

test('containers share a destination hue with distinct shades; missing destinations use gray', () => {
  const colors = Array.from({ length: 40 }, (_, i) => m.cargoColor({ destination: 'ONT8', container: 'CONT-' + i }));
  assert.equal(new Set(colors.map(color => color.hue)).size, 1);
  assert.equal(new Set(colors.map(color => color.fill)).size, colors.length);
  assert.ok(colors.every(color => color.lightness >= 44 && color.lightness <= 74 && color.saturation >= 60));
  assert.deepEqual(m.cargoColor({}), m.cargoColor({ destination: ' ', container: '' }));
  assert.equal(m.cargoColor({ container: 'CONT-001' }).saturation, 0);
  assert.notEqual(m.cargoColor({ container: 'CONT-001' }).fill, m.cargoColor({ container: 'CONT-002' }).fill);
  assert.equal(m.cargoColor({ destination: 'ONT8' }).lightness, 60);
});

test('the shared inventory palette separates close warehouses and containers independent of record order', () => {
  const records = [
    { destination: 'ONT8', container: 'CONT-001' },
    { destination: 'ONT8', container: 'CONT-002' },
    { destination: 'LAX9', container: 'CONT-003' }
  ];
  const palette = m.createCargoPalette(records), reversed = m.createCargoPalette([...records].reverse());
  const colors = records.map(record => m.cargoColor(record, palette));
  assert.equal(colors[0].hue, colors[1].hue);
  assert.ok(Math.abs(colors[0].lightness - colors[1].lightness) >= 8);
  const difference = Math.abs(colors[0].hue - colors[2].hue);
  assert.ok(Math.min(difference, 360 - difference) >= 32);
  for (const record of records) assert.deepEqual(m.cargoColor(record, palette), m.cargoColor(record, reversed));
  const changed = m.createCargoPalette([...records, { ...records[0], destination: ' ont8 ', container: 'cont-001', location: 'C-15', pallets: 8 }]);
  for (const record of records) assert.deepEqual(m.cargoColor(record, palette), m.cargoColor(record, changed));
});

test('legacy inventory retains its stored lane ID and snaps to that same lane in the current grid', () => {
  for (const lane of m.LEGACY_LANES) for (const section of ['upper', 'lower']) {
    const original = { ...fixtures.records()[0], location: lane.id, section, pallets: 100 };
    const serialized = JSON.stringify(original);
    const figures = m.palletFigures([original]);
    const current = m.LANE_BY_ID[lane.id];
    assert.deepEqual(figures.map(item => item.position), current.sections[section].positions);
    assert.ok(figures.every(item => item.location === original.location));
    for (const item of figures) assert.ok(Math.abs(item.position.x + item.position.width / 2 - (current.x + current.width / 2)) < 1e-8);
    assert.deepEqual(m.palletFigures([{ ...original, layoutVersion: 1 }]).map(item => item.position), figures.map(item => item.position));
    assert.deepEqual(m.palletFigures([{ ...original, layoutVersion: 2 }]).map(item => item.position), figures.map(item => item.position));
    assert.equal(JSON.stringify(original), serialized);
    assert.equal(m.validateRecords([original])[0].location, lane.id);
    assert.equal(Object.hasOwn(m.validateRecords([original])[0], 'layoutVersion'), false);
  }
  assert.deepEqual(m.LEGACY_LANES.map(lane => m.recordLaneId({ location: lane.id })), m.LEGACY_LANES.map(lane => lane.id));
  assert.equal(m.recordLaneId({ location: 'A-01' }), 'A-01');
  assert.equal(m.recordLaneId({ location: 'C-15' }), 'C-15');
});

test('metadata and half-only edits preserve stored lane IDs; explicit lane moves use layout 2', () => {
  const old = { ...fixtures.records()[0], location: 'A-01', section: 'upper' };
  assert.deepEqual(m.placementForEdit(old, 'A-01', 'upper'), { location: 'A-01' });
  assert.deepEqual(m.placementForEdit(old, 'A-01', 'lower'), { location: 'A-01' });
  assert.deepEqual(m.placementForEdit(old, 'A-02', 'upper'), { location: 'A-02', layoutVersion: 2 });
  assert.deepEqual(m.placementForEdit(old, 'A-19', 'upper'), { location: 'A-19', layoutVersion: 2 });
  assert.deepEqual(m.placementForEdit(null, 'C-19', 'lower'), { location: 'C-19', layoutVersion: 2 });
});

test('mixed layouts round-trip in v5 backups without changing positions or inventory totals', () => {
  const old = { ...fixtures.records()[0], location: 'A-01', section: 'upper', pallets: 1 };
  const fresh = { ...old, id: 'new-grid', location: 'A-02', layoutVersion: 2 };
  const data = m.validateRecords([old, fresh]);
  const backup = m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 5, records: data })).records;
  assert.deepEqual(backup, data);
  assert.deepEqual(m.palletFigures(backup), m.palletFigures(data));
  assert.equal(m.summaries(data).occupied, 2);
  assert.equal(m.summaries(data).pallets, 2);
  const figures = m.palletFigures(data);
  assert.equal(figures.length, 2);
  assert.equal(m.intersects(figures[0].position, figures[1].position), false);
  assert.throws(() => m.validateRecords([{ ...old, location: 'A-19' }]));
  assert.throws(() => m.validateRecords([{ ...old, layoutVersion: 3 }]));
  assert.equal(m.validateRecords([{ ...fresh, location: 'C-19' }])[0].location, 'C-19');
  assert.throws(() => m.parseBackup(JSON.stringify({ format: 'bestar-warehouse-lanes', version: 4, records: data })));
});

test('mixed-age batches in the same half allocate consecutive non-overlapping current slots', () => {
  const base = { ...fixtures.records()[0], location: 'A-03', section: 'upper', pallets: 1 };
  const records = [base, { ...base, id: 'new', layoutVersion: 2 }, { ...base, id: 'v1', layoutVersion: 1 }];
  const figures = m.palletFigures(records);
  assert.deepEqual(figures.map(item => item.record.id), records.map(item => item.id));
  assert.deepEqual(figures.map(item => item.position), m.LANE_BY_ID['A-03'].sections.upper.positions.slice(0, 3));
  assert.equal(m.summaries(records).occupied, 1);
  assert.equal(m.queryRecords(records, 'all', 'all', 'A-04').length, 0);
  assert.equal(m.queryRecords(records, 'all', 'all', 'A-03').length, 3);
});
