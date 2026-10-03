/* BESTAR warehouse: source-image coordinates, inventory located by lane and half. */
(function () {
  'use strict';
  const I18n = typeof module !== 'undefined' && module.exports ? require('./i18n.js') : globalThis.BestarI18n;
  let initialLocale = 'zh-CN';
  if (typeof document !== 'undefined') {
    try { initialLocale = I18n.readBrowserLocale(localStorage, document.cookie, navigator.language); }
    catch { initialLocale = I18n.normalizeLocale(navigator.language); }
  }
  const translator = I18n.createTranslator(initialLocale);
  const ui = translator.ui;
  const PX_PER_M = 201 / 12;
  const LEGACY_LANE_WIDTH = 1.6 * PX_PER_M;
  const LANES_PER_ZONE = 19;
  const LANE_WIDTH = 201 / 9;
  const PALLET_WIDTH = PX_PER_M;
  const PALLET_DEPTH = 1.2 * PX_PER_M;
  const ZONES = [
    { id: 'A', x: 610, y: 1286, width: 402, height: 221, description: ui('靠近办公室 · 图纸下部') },
    { id: 'B', x: 610, y: 1013, width: 402, height: 216, description: ui('中央作业区') },
    { id: 'C', x: 610, y: 752, width: 402, height: 187, description: ui('图纸上部') }
  ];
  const COLUMN_X = [6, 208, 409, 610, 811, 1012, 1207];
  const COLUMN_Y = [284, 561, 837, 1114, 1391, 1667];
  const SECTIONS = { get upper() { return ui('上半区'); }, get lower() { return ui('下半区'); }, get unspecified() { return ui('未标注半区'); } };
  const sectionOf = record => record.section || 'unspecified';
  const locationLabel = record => `${recordLaneId(record)} · ${SECTIONS[sectionOf(record)]}`;
  const COLUMNS = COLUMN_Y.flatMap(y => COLUMN_X.map(x => ({ x, y })));
  const DOCKS = Array.from({ length: 12 }, (_, i) => ({ number: 23 + i, x: 1160, y: 1321 - i * 92.2, width: 50, height: 45 }));
  const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  function createLanes(legacy = false) {
    const width = legacy ? LEGACY_LANE_WIDTH : LANE_WIDTH;
    return ZONES.flatMap(zone => Array.from({ length: legacy ? 15 : LANES_PER_ZONE }, (_, index) => {
      const x = legacy ? zone.x + (14 - index) * width : zone.x + zone.width - index * width - width / 2;
      const lane = { id: `${zone.id}-${String(index + 1).padStart(2, '0')}`, zone: zone.id, number: index + 1, x, y: zone.y, width, height: zone.height };
      lane.splitY = COLUMN_Y.find(y => y > zone.y && y < zone.y + zone.height);
      lane.sections = Object.fromEntries(['upper', 'lower'].map(section => {
        const y = section === 'upper' ? zone.y : lane.splitY;
        const height = section === 'upper' ? lane.splitY - zone.y : zone.y + zone.height - lane.splitY;
        const rows = Math.floor(height / PALLET_DEPTH), padding = (height - rows * PALLET_DEPTH) / 2;
        const positions = Array.from({ length: rows }, (_, row) => ({ section, x: lane.x + (width - PALLET_WIDTH) / 2, y: y + height - padding - (row + 1) * PALLET_DEPTH, width: PALLET_WIDTH, height: PALLET_DEPTH }))
          .filter(pallet => !COLUMNS.some(column => intersects(pallet, { x: column.x - 5, y: column.y - 5, width: 10, height: 10 })));
        return [section, { y, height, positions, capacity: positions.length }];
      }));
      lane.positions = ['lower', 'upper'].flatMap(section => lane.sections[section].positions);
      lane.capacity = lane.positions.length;
      return lane;
    }));
  }
  const LANES = createLanes();
  const LANE_BY_ID = Object.fromEntries(LANES.map(lane => [lane.id, lane]));
  const LEGACY_LANES = createLanes(true);
  const LEGACY_LANE_BY_ID = Object.fromEntries(LEGACY_LANES.map(lane => [lane.id, lane]));
  function recordLaneId(record) {
    // Stored lane numbers identify the real warehouse lanes, regardless of record age.
    return record.location;
  }
  function placementForEdit(original, location, section) {
    // Metadata and half-only edits retain the stored lane number and record format.
    return original && recordLaneId(original) === location
      ? { location: original.location, ...(original.layoutVersion === undefined ? {} : { layoutVersion: original.layoutVersion }) }
      : { location, layoutVersion: 2 };
  }
  function palletFigures(records) {
    const figures = [];
    // All batches share the current grid and the same per-half position allocator.
    for (const lane of LANES) for (const section of ['upper', 'lower']) {
      const batches = records.filter(r => r.location === lane.id && sectionOf(r) === section);
      const positions = lane.sections[section].positions;
      let index = 0;
      for (const record of batches) for (let n = 0; n < record.pallets && index < positions.length; n++) {
        figures.push({ record, location: lane.id, section, position: positions[index++] });
      }
    }
    return figures;
  }
  const STATUS = { get stored() { return ui('在库'); }, get outbound() { return ui('待出库'); }, get reserved() { return ui('预留'); }, get empty() { return ui('空闲'); } };
  const colorKey = value => (value || '').trim().normalize('NFKC').toUpperCase();
  function colorHash(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
    return (hash ^ (hash >>> 16)) >>> 0;
  }
  const colorId = record => JSON.stringify([colorKey(record.destination), colorKey(record.container)]);
  function cargoColor(record, palette) {
    if (palette?.has(colorId(record))) return palette.get(colorId(record));
    // Name-seeded candidates are stable; the full inventory palette separates close colors.
    const destination = colorKey(record.destination), container = colorKey(record.container);
    const hue = destination ? Number((colorHash('destination:' + destination) / 4294967296 * 360).toFixed(3)) : 0;
    const variant = colorHash('container:' + container);
    const saturation = destination ? 60 + variant % 17 : 0;
    const lightness = container ? Number((44 + (variant >>> 8) / 16777216 * 30).toFixed(3)) : 60;
    return { hue, saturation, lightness, fill: `hsl(${hue} ${saturation}% ${lightness}%)`, base: `hsl(${hue} ${destination ? 68 : 0}% 56%)`, stroke: `hsl(${hue} ${destination ? 48 : 0}% 32%)` };
  }
  function createCargoPalette(records) {
    const groups = new Map(), palette = new Map(), hues = [];
    for (const record of records) {
      const destination = colorKey(record.destination), container = colorKey(record.container);
      if (!groups.has(destination)) groups.set(destination, new Map());
      groups.get(destination).set(container, record);
    }
    const stableOrder = (a, b) => colorHash(a) - colorHash(b) || (a < b ? -1 : a > b ? 1 : 0);
    const gap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
    for (const destination of [...groups.keys()].sort(stableOrder)) {
      const containers = groups.get(destination), example = containers.values().next().value;
      let hue = cargoColor(example).hue;
      // Keep the common small set of warehouses visibly distinct before the hue space fills up.
      if (destination && hues.length && hues.length < 24) {
        const distance = candidate => Math.min(...hues.map(other => gap(candidate, other)));
        if (distance(hue) < 32) hue = Array.from({ length: 72 }, (_, i) => (hue + i * 5) % 360).reduce((best, candidate) => distance(candidate) > distance(best) ? candidate : best, hue);
      }
      hue = Number(hue.toFixed(3));
      if (destination) hues.push(hue);
      const shades = [];
      for (const container of [...containers.keys()].sort((a, b) => a === '' ? -1 : b === '' ? 1 : stableOrder(a, b))) {
        const record = containers.get(container), color = cargoColor(record);
        let lightness = color.lightness;
        if (shades.length && shades.length < 8) {
          const distance = candidate => Math.min(...shades.map(other => Math.abs(candidate - other)));
          if (distance(lightness) < 8) lightness = Array.from({ length: 61 }, (_, i) => 44 + i * .5).reduce((best, candidate) => distance(candidate) > distance(best) ? candidate : best, lightness);
        }
        shades.push(lightness);
        palette.set(colorId(record), { ...color, hue, lightness, fill: `hsl(${hue} ${color.saturation}% ${lightness}%)`, base: `hsl(${hue} ${destination ? 68 : 0}% 56%)`, stroke: `hsl(${hue} ${destination ? 48 : 0}% 32%)` });
      }
    }
    return palette;
  }
  function validateRecords(input) {
    if (!Array.isArray(input) || input.length > 10000) throw new Error(ui('库存必须是数组，且不超过 10,000 条。'));
    const ids = new Set();
    return input.map((record, index) => {
      const fail = message => { throw new Error(ui`第 ${index + 1} 条：${message}`); };
      if (!record || typeof record !== 'object' || Array.isArray(record)) fail(ui('记录格式不正确。'));
      if (record.layoutVersion !== undefined && ![1, 2].includes(record.layoutVersion)) fail(ui('库位布局版本不正确。'));
      if (!Object.hasOwn(record.layoutVersion === 2 ? LANE_BY_ID : LEGACY_LANE_BY_ID, record.location)) fail(ui('纵列编号与布局版本不匹配。'));
      if (!['stored', 'outbound', 'reserved'].includes(record.status)) fail(ui('状态应为 stored、outbound 或 reserved。'));
      record = { ...record, sku: record.sku === undefined ? '' : record.sku, shipment: record.shipment === undefined ? '' : record.shipment, section: record.section === undefined ? 'unspecified' : record.section };
      if (typeof record.section !== 'string' || !Object.hasOwn(SECTIONS, record.section)) fail(ui('半区应为 upper、lower 或 unspecified。'));
      for (const [field, limit, required] of [['id', 100, true], ['sku', 80, false], ['name', 100, true], ['shipment', 80, false], ['owner', 80, false], ['notes', 500, false]]) {
        if (typeof record[field] !== 'string' || record[field].length > limit || (required && !record[field].trim())) fail(ui`${field} 格式或长度不正确。`);
      }
      const destination = record.destination === undefined ? '' : record.destination;
      if (typeof destination !== 'string' || destination.length > 80) fail(ui('目的仓必须是 80 字以内的文字。'));
      const container = record.container === undefined ? '' : record.container;
      if (typeof container !== 'string' || container.length > 80) fail(ui('柜号必须是 80 字以内的文字。'));
      if (ids.has(record.id)) fail(ui('记录 ID 重复。'));
      ids.add(record.id);
      if (!Number.isSafeInteger(record.pallets) || record.pallets < 1 || record.pallets > 10000) fail(ui('托盘数必须是 1–10,000 的整数。'));
      if (!Number.isSafeInteger(record.cartons) || record.cartons < 1 || record.cartons > 1000000) fail(ui('箱数必须是 1–1,000,000 的整数。'));
      if (typeof record.updatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(record.updatedAt) || !Number.isFinite(Date.parse(record.updatedAt))) fail(ui('更新时间不是有效的 ISO 日期。'));
      return { id: record.id, location: record.location, ...(record.layoutVersion === undefined ? {} : { layoutVersion: record.layoutVersion }), section: record.section, sku: record.sku.trim(), name: record.name.trim(), shipment: record.shipment.trim(), container: container.trim(), owner: record.owner.trim(), destination: destination.trim(), cartons: record.cartons, pallets: record.pallets, status: record.status, notes: record.notes.trim(), updatedAt: record.updatedAt };
    });
  }
  function renumberLegacyRecords(records) {
    // Preserve physical locations when converting the old left-to-right labels.
    return records.map(record => ({ ...record, location: record.location.slice(0, 2) + String(16 - Number(record.location.slice(2))).padStart(2, '0') }));
  }
  function parseBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(ui('文件不是有效的 JSON。')); }
    if (!data || data.format !== 'bestar-warehouse-lanes' || ![1, 2, 3, 4, 5].includes(data.version)) throw new Error(ui('请选择此页面导出的库存备份（version 1 至 5）。'));
    if (data.version < 5 && Array.isArray(data.records) && data.records.some(record => record?.layoutVersion === 2)) throw new Error(ui('新布局记录需要 version 5 备份。'));
    const records = validateRecords(data.records);
    return { records: data.version < 3 ? renumberLegacyRecords(records) : records, mode: data.mode === 'demo' ? 'demo' : 'local', renumbered: data.version < 3 };
  }
  function queryRecords(records, zone = 'all', status = 'all', query = '') {
    const term = query.trim().toLocaleLowerCase();
    return records.filter(record => (zone === 'all' || record.location.startsWith(zone + '-')) && (status === 'all' || status === record.status) && (!term || [record.location, recordLaneId(record), locationLabel(record), record.sku || '', record.name, record.shipment || '', record.container || '', record.owner, record.destination || ''].some(value => value.toLocaleLowerCase().includes(term))));
  }
  function summaries(records) {
    const occupied = new Set(records.map(recordLaneId)).size;
    return { total: LANES.length, occupied, empty: LANES.length - occupied, pallets: records.reduce((n, r) => n + r.pallets, 0), cartons: records.reduce((n, r) => n + r.cartons, 0) };
  }
  function csvCell(value) { return '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"'; }
  function loadInventory(storage) {
    // Remove only the retired demo workspace; retain the existing local inventory key.
    storage.removeItem('bestar-warehouse-lanes-v1:demo');
    storage.removeItem('bestar-warehouse-lanes-v1:mode');
    const raw = storage.getItem('bestar-warehouse-lanes-v1:local');
    if (!raw) return [];
    const data = JSON.parse(raw);
    // Legacy storage is an array. Do not rewrite it until the next explicit save.
    return Array.isArray(data) ? renumberLegacyRecords(validateRecords(data)) : parseBackup(raw).records;
  }
  function rotatePoint(point, angle) {
    const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
    const dx = point.x - 692.5, dy = point.y - 978;
    return { x: 692.5 + dx * cos - dy * sin, y: 978 + dx * sin + dy * cos };
  }
  function rotateBounds(rect, angle) {
    const points = [[rect.x, rect.y], [rect.x + rect.w, rect.y], [rect.x, rect.y + rect.h], [rect.x + rect.w, rect.y + rect.h]].map(([x, y]) => rotatePoint({ x, y }, angle));
    const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
    return { x, y, w: Math.max(...points.map(p => p.x)) - x, h: Math.max(...points.map(p => p.y)) - y };
  }
  const model = { PX_PER_M, LANE_WIDTH, LEGACY_LANE_WIDTH, LANES_PER_ZONE, PALLET_WIDTH, PALLET_DEPTH, ZONES, COLUMNS, DOCKS, LANES, LANE_BY_ID, LEGACY_LANES, LEGACY_LANE_BY_ID, recordLaneId, placementForEdit, palletFigures, STATUS, SECTIONS, sectionOf, locationLabel, colorKey, cargoColor, createCargoPalette, intersects, validateRecords, parseBackup, queryRecords, summaries, csvCell, loadInventory, rotatePoint, rotateBounds };
  if (typeof module !== 'undefined' && module.exports) module.exports = model;
  if (typeof document === 'undefined') return;

  const $ = id => document.getElementById(id);
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmt = value => value.toLocaleString(translator.locale);
  const translateStatic = I18n.bindStatic(document.documentElement, translator);
  const NS = 'http://www.w3.org/2000/svg';
  const state = { records: [], versions: {}, revision: -1, loaded: false, online: false, rotation: 0, selected: 'A-01', selectedSection: null, dock: null, zone: 'all', status: 'all', query: '', view: 'map', page: 0, extent: 'fba', viewport: { x: -35, y: 685, w: 1390, h: 1270 } };
  let toastTimer;
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4800); }
  let syncPending = false;
  function syncStatus(online, message) {
    state.online = online;
    $('connection-label').textContent = online ? ui('共享库存 · 已连接') : ui('共享库存 · 未连接');
    $('connection-label').dataset.status = online ? 'online' : 'offline';
    $('mode-title').textContent = online ? ui('数据库共享库存') : state.loaded ? ui('同步中断') : ui('等待连接数据库');
    $('mode-description').textContent = message || ui('每 5 秒自动同步 · 所有成员共享同一份库存');
    $('save-status').textContent = online ? ui`最近同步 ${new Date().toLocaleTimeString(translator.locale)} · 版本 ${state.revision}` : message;
    ['add-button', 'import-button', 'legacy-import-button'].forEach(id => { $(id).disabled = !online; });
    ['export-button', 'csv-button'].forEach(id => { $(id).disabled = !state.loaded; });
    document.querySelectorAll('[data-edit],[data-add],[data-remove],#add-to-lane').forEach(button => { button.disabled = !online; });
  }
  async function api(path, method = 'GET', data) {
    let response;
    try { response = await fetch(path, { method, credentials: 'omit', cache: 'no-store', headers: { 'Accept-Language': translator.locale, ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(20000) }); }
    catch { throw Object.assign(new Error(method === 'GET' ? ui('网络连接失败，正在等待重试。') : ui('未收到服务器确认，请恢复连接后核对库存再操作。')), { status: 0 }); }
    let result;
    try { result = await response.json(); } catch { throw new Error(ui('服务未就绪，请通过已配置数据库的站点访问。')); }
    if (!response.ok) throw Object.assign(new Error(result.error || ui('请求失败，请重试。')), { status: response.status, code: result.code });
    return result;
  }
  function applySnapshot(data) {
    if (data.revision < state.revision) return;
    const changed = data.revision !== state.revision;
    state.records = validateRecords(data.records); state.versions = data.versions; state.revision = data.revision; state.loaded = true;
    if (changed) render();
    syncStatus(true);
  }
  async function refreshInventory() {
    if (syncPending) return;
    syncPending = true;
    try { applySnapshot(await api('/api/inventory')); }
    catch (error) { syncStatus(false, error.message + (state.loaded ? ui(' 当前显示上次同步内容，暂不可修改。') : '')); }
    finally { syncPending = false; }
  }
  async function mutateInventory(payload) {
    if (!state.online) throw new Error(ui('数据库未连接，请同步成功后再保存。'));
    try { applySnapshot(await api('/api/inventory', 'POST', { ...payload, clientLayoutVersion: 3 })); }
    catch (error) {
      if (error.status === 409 && error.code !== 'LAYOUT_UPDATED') { await refreshInventory(); error.message = ui('这条货物或共享库存已被他人修改。草稿已保留，请复制需要保留的内容，关闭后重新打开最新记录核对。'); }
      else if (!error.status || error.status >= 500) { syncStatus(false, error.message); void refreshInventory(); }
      throw error;
    }
  }
  $('sync-button').onclick = () => void refreshInventory();
  setInterval(() => { if (!document.hidden) void refreshInventory(); }, 5000);
  window.addEventListener('focus', () => void refreshInventory());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refreshInventory(); });
  function svgNode(tag, attrs = {}, text = '') {
    const node = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text) node.textContent = text;
    return node;
  }
  function add(parent, tag, attrs, text) { const node = svgNode(tag, attrs, text); parent.append(node); return node; }
  function drawStructure() {
    const layer = $('structure-layer');
    add(layer, 'rect', { x: 3, y: 10, width: 1208, height: 1924, rx: 1, fill: 'none', stroke: '#7e9184', 'stroke-width': 3 });
    add(layer, 'rect', { id: 'rack-area', x: 3, y: 752, width: 592, height: 1175, rx: 2, fill: '#e8eee6', 'fill-opacity': .72, stroke: '#b9cbbb', 'stroke-width': 2 });
    add(layer, 'text', { x: 299, y: 1305, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 28 }, ui('货架区'));
    if (translator.locale === 'zh-CN') add(layer, 'text', { x: 299, y: 1336, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 12 }, 'RACK STORAGE');
    add(layer, 'text', { x: 299, y: 1364, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 11 }, ui('非 FBA 地面堆货区'));
    add(layer, 'rect', { x: 610, y: 1667, width: 600, height: 267, fill: '#eaf0eb', 'fill-opacity': .7, stroke: '#a8bbae', 'stroke-width': 2 });
    add(layer, 'text', { x: 910, y: 1775, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 27 }, ui('办公室'));
    if (translator.locale === 'zh-CN') add(layer, 'text', { x: 910, y: 1805, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 11 }, 'OFFICE');
    add(layer, 'path', { d: 'M1210 1390 L1116 1483 L1210 1575', fill: '#f0f3ef', stroke: '#b4c3b7', 'stroke-width': 2 });
    add(layer, 'text', { x: 1200, y: 1485, 'text-anchor': 'end', class: 'structure-text', 'font-size': 11 }, 'DRIVE IN');
    add(layer, 'text', { x: 1200, y: 1506, 'text-anchor': 'end', class: 'structure-text', 'font-size': 10 }, ui('不计入 dock'));
    add(layer, 'path', { d: 'M422 1925 L510 1838 L595 1925', fill: '#f6f8f2', stroke: '#b4c3b7', 'stroke-width': 2 });
    add(layer, 'text', { x: 510, y: 1900, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 11 }, 'DRIVE IN');
    add(layer, 'rect', { x: 1140, y: 1585, width: 70, height: 61, fill: '#f2efe7', stroke: '#c5bea8', 'stroke-width': 2 });
    add(layer, 'text', { x: 1121, y: 1604, 'text-anchor': 'end', class: 'structure-text', 'font-size': 13 }, ui('仓库进出门'));
    add(layer, 'text', { x: 1121, y: 1627, 'text-anchor': 'end', class: 'structure-text', 'font-size': 11 }, '12′w × 14′h');
    for (const zone of ZONES) {
      add(layer, 'rect', { x: zone.x - LANE_WIDTH / 2 - 2, y: zone.y - 2, width: zone.width + LANE_WIDTH + 4, height: zone.height + 4, fill: '#f7faf6', stroke: '#bccfc1', 'stroke-width': 1.4 });
      add(layer, 'text', { x: 1055, y: zone.y + zone.height / 2, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 30, fill: '#59866e' }, zone.id);
      add(layer, 'text', { x: 1055, y: zone.y + zone.height / 2 + 23, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 10 }, ui('FBA 区'));
      const splitY = LANE_BY_ID[zone.id + '-01'].splitY;
      add(layer, 'text', { x: 1055, y: (zone.y + splitY) / 2, 'text-anchor': 'middle', class: 'half-direction', 'font-size': 10, fill: '#647b6c' }, ui('上半区'));
      add(layer, 'text', { x: 1055, y: (splitY + zone.y + zone.height) / 2, 'text-anchor': 'middle', class: 'half-direction', 'font-size': 10, fill: '#647b6c' }, ui('下半区'));
    }
    for (const y of [978, 1262]) {
      add(layer, 'path', { d: `M642 ${y} H736 M897 ${y} H982`, stroke: '#d4ddd3', 'stroke-width': 1.4, 'stroke-dasharray': '5 5' });
      add(layer, 'text', { x: 814, y: y + 4, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 12 }, ui('← 叉车通道 →'));
    }
    add(layer, 'text', { x: 1097, y: 1140, transform: 'rotate(-90 1097 1140)', 'text-anchor': 'middle', class: 'structure-text', 'font-size': 11, 'letter-spacing': 3 }, ui('DOCK 作业通道'));
    add(layer, 'text', { x: 1262, y: 235, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 12 }, 'DOCK');
    add(layer, 'text', { x: 1262, y: 256, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 10 }, '34 ↓ 23');
    for (const dock of DOCKS) {
      const g = add(layer, 'g', { class: 'dock', 'data-dock': dock.number, role: 'button', tabindex: 0, 'aria-label': ui`Dock ${dock.number}，查看位置` });
      add(g, 'rect', { x: dock.x, y: dock.y, width: dock.width, height: dock.height, rx: 3 });
      add(g, 'text', { x: 1260, y: dock.y + 28, 'text-anchor': 'middle' }, String(dock.number));
      add(g, 'path', { d: `M1214 ${dock.y + 22} H1236`, stroke: '#b8cfc1', 'stroke-width': 1.4 });
      add(g, 'title', {}, `Dock ${dock.number} · 9′w × 10′h`);
    }
    for (const column of COLUMNS) {
      add($('columns-layer'), 'rect', { x: column.x - 5, y: column.y - 5, width: 10, height: 10, rx: .8, fill: '#f6f8f3', stroke: '#697b6d', 'stroke-width': 1.5 });
      add($('columns-layer'), 'rect', { x: column.x - 2, y: column.y - 2, width: 4, height: 4, fill: '#5a6c5e' });
    }
    add(layer, 'text', { x: 740, y: 500, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 24 }, ui('仓库其他区域'));
    add(layer, 'text', { x: 740, y: 532, 'text-anchor': 'middle', class: 'structure-text', 'font-size': 13 }, ui('当前 FBA 库存位于 A / B / C 区'));
    // Rotate multiline labels as blocks so their lines remain stacked after a quarter turn.
    const groups = new Map();
    layer.querySelectorAll('.structure-text').forEach(node => { const x = node.getAttribute('x'); if (!groups.has(x)) groups.set(x, []); groups.get(x).push(node); });
    for (const [x, nodes] of groups) {
      nodes.sort((a, b) => Number(a.getAttribute('y')) - Number(b.getAttribute('y')));
      const blocks = []; for (const node of nodes) { const last = blocks.at(-1); if (last && Number(node.getAttribute('y')) - Number(last.at(-1).getAttribute('y')) < 65) last.push(node); else blocks.push([node]); }
      for (const block of blocks) { const y = block.reduce((sum, node) => sum + Number(node.getAttribute('y')), 0) / block.length; block.forEach(node => { node.dataset.rotateX = x; node.dataset.rotateY = y; }); }
    }
  }
  const recordsIn = id => state.records.filter(record => recordLaneId(record) === id);
  function matchingLanes() {
    const term = state.query.trim().toLocaleLowerCase();
    const matched = new Set(queryRecords(state.records, state.zone, state.status, state.query).map(recordLaneId));
    return LANES.filter(lane => {
      if (state.zone !== 'all' && lane.zone !== state.zone) return false;
      const records = recordsIn(lane.id);
      if (state.status === 'empty') return records.length === 0 && (!term || lane.id.toLowerCase().includes(term));
      if (!records.length) return state.status === 'all' && (!term || lane.id.toLowerCase().includes(term));
      return matched.has(lane.id);
    });
  }
  function laneStatus(records) {
    if (!records.length) return 'empty';
    if (records.some(r => r.status === 'outbound')) return 'outbound';
    if (records.some(r => r.status === 'stored')) return 'stored';
    return 'reserved';
  }
  function renderLanes() {
    const layer = $('slots-layer'); layer.replaceChildren();
    const matches = new Set(matchingLanes().map(lane => lane.id));
    for (const lane of LANES) {
      const records = recordsIn(lane.id);
      const selected = state.selected === lane.id && !state.dock;
      const g = add(layer, 'g', { class: `lane${selected ? ' selected' : ''}${matches.has(lane.id) ? '' : ' dimmed'}`, role: 'group', 'aria-label': ui`${lane.id} 纵列` });
      for (const section of ['upper', 'lower']) {
        const area = lane.sections[section], halfRecords = records.filter(record => sectionOf(record) === section);
        const active = selected && (!state.selectedSection || state.selectedSection === section);
        const half = add(g, 'g', { class: `lane-half${active ? ' selected' : ''}`, 'data-location': lane.id, 'data-section': section, role: 'button', tabindex: 0, 'aria-label': ui`${lane.id} ${SECTIONS[section]}，${halfRecords.reduce((n, r) => n + r.pallets, 0)} 托盘，${halfRecords.length} 批货物`, 'aria-pressed': active });
        add(half, 'rect', { x: lane.x + 1.5, y: area.y + 1.5, width: lane.width - 3, height: area.height - 3, rx: 1.6, class: 'lane-hit' });
        area.positions.forEach(position => {
          const rect = { x: position.x + .4, y: position.y + .7, width: position.width - .8, height: position.height - 1.4 };
          add(half, 'rect', { ...rect, rx: 1, class: 'pallet-empty', 'pointer-events': 'none' });
        });
        add(half, 'title', {}, ui`${lane.id} · ${SECTIONS[section]} · ${halfRecords.length} 批货物`);
      }
      add(g, 'line', { x1: lane.x, y1: lane.splitY, x2: lane.x + lane.width, y2: lane.splitY, class: 'lane-divider', 'pointer-events': 'none' });
      if (records.some(record => sectionOf(record) === 'unspecified')) add(g, 'text', { x: lane.x + lane.width / 2, y: lane.splitY + 4, class: 'unassigned-marker', 'pointer-events': 'none' }, '?');
      for (const column of COLUMNS) {
        if (intersects(lane, { x: column.x - 5, y: column.y - 5, width: 10, height: 10 })) add(g, 'rect', { x: Math.max(lane.x + 2, column.x - 6), y: column.y - 7, width: Math.min(lane.width - 4, 12), height: 14, fill: 'url(#blocked-pattern)', opacity: .55, 'pointer-events': 'none' });
      }
      add(g, 'text', { x: lane.x + lane.width / 2, y: lane.y - 8, class: 'lane-label', visibility: $('show-labels').checked ? 'visible' : 'hidden' }, String(lane.number).padStart(2, '0'));
      add(g, 'title', {}, ui`${lane.id} · ${records.length} 批货物 · ${records.reduce((n, r) => n + r.pallets, 0)} 托`);
    }
    // Draw cargo above its matching lane grid, using the same current positions.
    for (const item of palletFigures(state.records)) {
      const { record, position, location, section } = item, color = cargoColor(record, state.colors);
      const group = add(layer, 'g', { class: `cargo-figure${matches.has(location) ? '' : ' dimmed'}`, 'data-location': location, 'data-section': section });
      const rect = { x: position.x + .4, y: position.y + .7, width: position.width - .8, height: position.height - 1.4 };
      add(group, 'rect', { ...rect, rx: 1, class: 'pallet-occupied', fill: color.fill, stroke: color.stroke, 'data-status': record.status, 'data-cargo-id': record.id });
      for (const fraction of [.33, .66]) add(group, 'line', { x1: rect.x + 2, y1: rect.y + rect.height * fraction, x2: rect.x + rect.width - 2, y2: rect.y + rect.height * fraction, class: 'pallet-slat' });
    }
    $('selection-layer').replaceChildren();
    if (state.selected && !state.dock) {
      const lane = LANE_BY_ID[state.selected];
      add($('selection-layer'), 'path', { d: `M${lane.x + lane.width / 2 - 5} ${lane.y + lane.height + 6} l5 -5 l5 5 Z`, fill: '#116d51' });
      add($('selection-layer'), 'text', { x: lane.x + lane.width / 2, y: lane.y + lane.height + 20, 'text-anchor': 'middle', fill: '#116d51', 'font-size': 10, 'font-weight': 700 }, lane.id);
    }
  }
  function renderStats() {
    const summary = summaries(state.records);
    $('stat-total').textContent = fmt(summary.total);
    $('stat-occupied').textContent = fmt(summary.occupied);
    $('stat-percent').textContent = Math.round(summary.occupied / summary.total * 100) + '%';
    $('occupancy-bar').style.width = summary.occupied / summary.total * 100 + '%';
    $('stat-cartons').textContent = fmt(summary.cartons);
    $('stat-pallets').textContent = fmt(summary.pallets);
    $('stat-empty').textContent = fmt(summary.empty);
    for (const zone of ZONES) $('count-' + zone.id).textContent = new Set(state.records.filter(r => r.location.startsWith(zone.id)).map(recordLaneId)).size + '/' + LANES_PER_ZONE;
    $('zone-overview').innerHTML = ZONES.map(zone => {
      const records = state.records.filter(r => r.location.startsWith(zone.id));
      const occupied = new Set(records.map(recordLaneId)).size;
      return ui`<button class="zone-card" data-zone="${zone.id}"><span class="zone-letter">${zone.id}</span><span class="zone-card-body"><span class="zone-card-title">${zone.id} 区<span>${occupied} / ${LANES_PER_ZONE} 列已用</span></span><span class="zone-card-bar"><i style="width:${occupied / LANES_PER_ZONE * 100}%"></i></span><span class="zone-card-bottom"><span>${records.reduce((n, r) => n + r.pallets, 0)} 托盘 · ${records.length} 批货物</span><span>${LANES_PER_ZONE - occupied} 列空闲</span></span></span><span class="zone-card-arrow">↗</span></button>`;
    }).join('');
  }
  function colorSwatch(record, base = false) {
    const color = cargoColor(record, state.colors);
    return `<i class="cargo-swatch" style="background:${base ? color.base : color.fill};border-color:${color.stroke}" aria-hidden="true"></i>`;
  }
  function renderColorLegend() {
    const groups = new Map();
    for (const record of queryRecords(state.records, state.zone, state.status, state.query)) {
      const key = colorKey(record.destination), container = colorKey(record.container);
      if (!groups.has(key)) groups.set(key, { record, containers: new Map() });
      const group = groups.get(key);
      if (!group.containers.has(container)) group.containers.set(container, { record, pallets: 0 });
      group.containers.get(container).pallets += record.pallets;
    }
    $('destination-legend').innerHTML = groups.size ? ui`<div class="color-legend-heading">目的仓 / 柜号配色 <span>同仓同色系 · 不同柜号以深浅区分 · 状态见货物详情</span></div><div class="color-legend-list">${[...groups].sort(([a], [b]) => a.localeCompare(b)).map(([, group]) => `<div class="destination-color-group"><strong>${colorSwatch(group.record, true)}${esc(group.record.destination || ui('目的仓未填写'))}</strong><div>${[...group.containers].sort(([a], [b]) => a.localeCompare(b)).map(([, item]) => ui`<span class="container-color-key">${colorSwatch(item.record)}<span>${esc(item.record.container || ui('柜号未填写'))}</span><small>${fmt(item.pallets)} 托</small></span>`).join('')}</div></div>`).join('')}</div>` : `<p class="color-legend-empty">${state.records.length ? ui('当前筛选没有货物配色') : ui('登记货物后显示目的仓与柜号颜色图例')}</p>`;
  }
  function cargoCard(record) {
    return ui`<article class="cargo-card colored-cargo" style="--cargo-color:${cargoColor(record, state.colors).fill}"><div class="cargo-card-top"><h3>${esc(record.name)}</h3><span class="badge ${record.status}">${STATUS[record.status]}</span></div>${record.layoutVersion !== 2 ? ui`<p class="legacy-location">库位 ${esc(record.location)} · 已对齐当前网格</p>` : ''}<p class="cargo-sku">${esc(record.sku || ui('SKU 未填写'))}</p><div class="cargo-field"><span>所在半区</span><strong>${SECTIONS[sectionOf(record)]}</strong></div><div class="cargo-field"><span>货件号</span><strong>${esc(record.shipment || '—')}</strong></div><div class="cargo-field"><span>柜号</span><strong>${colorSwatch(record)}${esc(record.container || ui('未填写'))}</strong></div><div class="cargo-field"><span>目的仓</span><strong>${colorSwatch(record, true)}${esc(record.destination || ui('未填写'))}</strong></div><div class="cargo-field"><span>货主</span><strong>${esc(record.owner || '—')}</strong></div><div class="cargo-field"><span>数量</span><strong>${fmt(record.pallets)} 托 / ${fmt(record.cartons)} 箱</strong></div>${record.notes ? `<p class="cargo-notes">${esc(record.notes)}</p>` : ''}<div class="cargo-card-actions"><button data-edit="${esc(record.id)}">编辑 / 移库 ↗</button><button class="remove-cargo" data-remove="${esc(record.id)}">移出此批</button></div></article>`;
  }
  function renderDetail() {
    if (state.dock) {
      $('detail-content').innerHTML = ui`<div class="detail-location-heading"><h2>Dock ${state.dock}</h2><span class="badge empty">装卸口</span></div><p class="detail-subtitle">仓库右侧 · 编号由下向上递增</p><div class="dock-detail">门洞：9′w × 10′h<br>共 12 个 dock：23–34<br><br>12′w × 14′h 仓库进出门与 drive-in 独立标记，不占用 dock 编号。</div><button class="button detail-primary" id="return-lane">返回纵列详情</button>`;
      $('return-lane').onclick = () => { state.dock = null; render(); };
      return;
    }
    const lane = LANE_BY_ID[state.selected], allRecords = recordsIn(lane.id);
    const records = state.selectedSection ? allRecords.filter(record => sectionOf(record) === state.selectedSection) : allRecords;
    const pallets = records.reduce((n, r) => n + r.pallets, 0), cartons = records.reduce((n, r) => n + r.cartons, 0);
    const status = laneStatus(records), sectionName = SECTIONS[state.selectedSection] || ui('整条纵列');
    const filters = [[null, ui('整列')], ['upper', ui('上半区')], ['lower', ui('下半区')]];
    if (allRecords.some(record => sectionOf(record) === 'unspecified') || state.selectedSection === 'unspecified') filters.push(['unspecified', ui('未标注')]);
    const tabs = filters.map(([section, label]) => ui`<button data-section-filter="${section || ''}" aria-pressed="${state.selectedSection === section}">${label}<small>${(section ? allRecords.filter(r => sectionOf(r) === section) : allRecords).length} 批</small></button>`).join('');
    const capacity = lane.sections[state.selectedSection]?.capacity ?? lane.capacity;
    const overCapacity = state.selectedSection ? state.selectedSection !== 'unspecified' && pallets > capacity : ['upper', 'lower'].some(section => allRecords.filter(r => sectionOf(r) === section).reduce((n, r) => n + r.pallets, 0) > lane.sections[section].capacity) || pallets > capacity;
    const unknownCount = allRecords.filter(r => sectionOf(r) === 'unspecified').length;
    $('detail-content').innerHTML = ui`<div class="detail-location-heading"><h2>${lane.id}</h2><span class="badge ${status}">${sectionName}</span></div><p class="detail-subtitle">${lane.zone} 区 · 从右向左第 ${String(lane.number).padStart(2, '0')} 列<br>柱间 9 等分 · 上下以原图立柱横线为界</p><div class="section-tabs" role="group" aria-label="所在纵列半区">${tabs}</div>${unknownCount ? ui`<p class="section-notice">${unknownCount} 批旧货物未标注半区，请编辑核对；地图以 ? 标记。</p>` : ''}<div class="detail-metrics"><div><small>${sectionName}托盘</small><strong>${fmt(pallets)}<span>托</span></strong></div><div><small>库存箱数</small><strong>${fmt(cartons)}<span>箱</span></strong></div></div><div class="cargo-heading">${sectionName}货物<span>${records.length} 批记录</span></div><div class="cargo-list">${records.length ? records.map(cargoCard).join('') : ui('<div class="empty-detail">暂无货物<br>可登记新到货物或安排移库</div>')}</div><button class="button primary detail-primary" id="add-to-lane">＋ 向${['upper', 'lower'].includes(state.selectedSection) ? sectionName : ui('此列')}登记货物</button><p class="capacity-note${overCapacity ? ' warning' : ''}">${overCapacity ? ui('⚠ 已超出建议容量，请现场核对。<br>') : ''}图纸估算：上半区 ${lane.sections.upper.capacity} 托，下半区 ${lane.sections.lower.capacity} 托。<br>旋转不改变上下方位；未标注货物不分配托盘图形。</p>`;
    $('add-to-lane').onclick = () => openEditor(null, lane.id);
  }

  function tableItems() {
    if (state.status === 'empty') return matchingLanes().map(lane => ({ location: lane.id, empty: true }));
    return queryRecords(state.records, state.zone, state.status, state.query);
  }
  function renderTable() {
    const items = tableItems();
    state.page = Math.min(state.page, Math.max(0, Math.ceil(items.length / 15) - 1));
    const start = state.page * 15;
    $('table-caption').textContent = ui`${state.status === 'empty' ? ui('空闲纵列') : ui('按货物批次列出')} · 当前筛选 ${items.length} 条`;
    $('inventory-body').innerHTML = items.slice(start, start + 15).map(r => r.empty ? ui`<tr><td><button class="location-link" data-locate="${r.location}">${r.location}</button></td><td colspan="6">暂无货物</td><td><span class="badge empty">空闲</span></td><td>—</td><td><button class="table-edit" data-add="${r.location}">登记货物</button></td></tr>` : ui`<tr><td><button class="location-link" data-locate="${recordLaneId(r)}" data-section="${sectionOf(r)}">${locationLabel(r)} ↗</button></td><td>${esc(r.sku || "—")}<small>${esc(r.name)}</small></td><td>${esc(r.shipment || '—')}</td><td>${colorSwatch(r)}${esc(r.container || ui('未填写'))}</td><td>${esc(r.owner || '—')}</td><td>${colorSwatch(r, true)}${esc(r.destination || ui('未填写'))}</td><td>${fmt(r.pallets)}<small>${fmt(r.cartons)} 箱</small></td><td><span class="badge ${r.status}">${STATUS[r.status]}</span></td><td>${new Date(r.updatedAt).toLocaleDateString(translator.locale, { timeZone: 'Asia/Shanghai' })}</td><td><button class="table-edit" data-edit="${esc(r.id)}">编辑</button></td></tr>`).join('') || ui('<tr><td colspan="10" class="table-empty">没有符合条件的货物或纵列</td></tr>');
    $('pagination-info').textContent = items.length ? ui`${start + 1}–${Math.min(start + 15, items.length)} / 共 ${items.length} 条` : ui('共 0 条');
    $('prev-page').disabled = state.page === 0;
    $('next-page').disabled = start + 15 >= items.length;
  }
  function renderSearch() {
    const visible = Boolean(state.query || state.status !== 'all');
    $('search-summary').hidden = !visible;
    if (!visible) return;
    const lanes = matchingLanes();
    $('search-summary').innerHTML = ui`<span>${lanes.length ? ui`匹配 ${lanes.length} 条纵列` : ui('未找到匹配的纵列')}</span>${lanes.slice(0, 9).map(lane => `<button data-locate="${lane.id}">${lane.id} ↗</button>`).join('')}${lanes.length > 9 ? ui('<span>更多结果见库存台账</span>') : ''}<button id="clear-search">清除筛选</button>`;
    $('clear-search').onclick = () => { state.query = ''; state.status = 'all'; $('search-input').value = ''; $('status-filter').value = 'all'; state.page = 0; render(); };
  }
  function render() {
    state.colors = createCargoPalette(state.records);
    renderStats(); renderLanes(); renderDetail(); renderTable(); renderSearch(); renderColorLegend();
    orientLabels();
    document.querySelectorAll('[data-edit],[data-add],[data-remove],#add-to-lane').forEach(button => { button.disabled = !state.online; });
    if (!state.loaded) {
      for (const id of ['stat-occupied', 'stat-percent', 'stat-cartons', 'stat-pallets', 'stat-empty']) $(id).textContent = '—';
      $('inventory-body').innerHTML = ui('<tr><td colspan="10" class="table-empty">连接数据库后显示库存</td></tr>');
    }
    document.querySelectorAll('.dock').forEach(node => node.classList.toggle('active', Number(node.dataset.dock) === state.dock));
    document.querySelectorAll('.zone-tabs button').forEach(button => { button.classList.toggle('active', button.dataset.zone === state.zone); button.setAttribute('aria-pressed', button.dataset.zone === state.zone); });
  }
  function setView(view) {
    state.view = view; $('map-view').hidden = view !== 'map'; $('inventory-view').hidden = view !== 'inventory';
    document.querySelectorAll('[data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false'); });
    if (view === 'map') requestAnimationFrame(updateScale);
  }
  function setExtent(extent) {
    state.extent = extent;
    state.viewport = rotateBounds(extent === 'overview' ? { x: -90, y: -75, w: 1540, h: 2110 } : { x: -35, y: 685, w: 1390, h: 1270 }, state.rotation);
    $('overview-button').classList.toggle('active', extent === 'overview');
    $('fba-button').classList.toggle('active', extent === 'fba');
    $('map-caption').textContent = extent === 'overview' ? ui('全仓总览 · 右侧 12 个 dock：由下向上 23–34') : ui('立柱横线分上下半区 · 点击半区查看货物');
    updateViewport();
  }
  function updateViewport() {
    const v = state.viewport;
    $('warehouse-map').setAttribute('viewBox', `${v.x} ${v.y} ${v.w} ${v.h}`);
    $('zoom-label').textContent = Math.round((state.rotation % 180 ? 1390 : 1270) / v.h * 100) + '%';
    updateScale();
  }
  function updateScale() {
    const svg = $('warehouse-map');
    const matrix = svg.getScreenCTM();
    if (matrix) document.querySelector('.map-scale>span').style.width = Math.max(1, 201 * matrix.a) + 'px';
  }
  function point(clientX, clientY) {
    const svg = $('warehouse-map'), p = svg.createSVGPoint(); p.x = clientX; p.y = clientY;
    return p.matrixTransform(svg.getScreenCTM().inverse());
  }
  function zoom(factor, focus) {
    const v = state.viewport;
    const nextHeight = Math.min(3000, Math.max(200, v.h * factor));
    const actual = nextHeight / v.h;
    const center = focus || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
    state.viewport = { x: center.x - (center.x - v.x) * actual, y: center.y - (center.y - v.y) * actual, w: v.w * actual, h: nextHeight };
    updateViewport();
  }
  function focusZone(zone) {
    const area = ZONES.find(item => item.id === zone);
    state.viewport = rotateBounds({ x: area.x - 100, y: area.y - 135, w: 790, h: area.height + 270 }, state.rotation);
    updateViewport();
  }
  function orientLabels() {
    $('map-content').querySelectorAll('text').forEach(node => {
      if (!node.hasAttribute('data-base-transform')) node.setAttribute('data-base-transform', node.getAttribute('transform') || '');
      const x = node.dataset.rotateX || node.getAttribute('x') || 0, y = node.dataset.rotateY || node.getAttribute('y') || 0;
      node.setAttribute('transform', `rotate(${-state.rotation} ${x} ${y}) ${node.getAttribute('data-base-transform')}`);
    });
  }
  function rotateMap(delta) {
    state.rotation = (state.rotation + delta + 360) % 360;
    state.viewport = rotateBounds(state.viewport, delta);
    $('map-content').setAttribute('transform', `rotate(${state.rotation} 692.5 978)`);
    $('rotation-label').textContent = state.rotation + '°';
    $('orientation-arrow').style.transform = `rotate(${state.rotation}deg)`;
    $('map-tooltip').hidden = true; orientLabels(); updateViewport();
  }
  function selectLane(id, focus = false, section = null) {
    if (!LANE_BY_ID[id]) return;
    state.selected = id; state.selectedSection = Object.hasOwn(SECTIONS, section) ? section : null; state.dock = null; setView('map');
    if (focus) focusZone(LANE_BY_ID[id].zone);
    render();
    if (focus) $('map-view').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  let editorVersion = 0, editorOriginal = null;
  function laneOptions() {
    return LANES.map(lane => ui`<option value="${lane.id}">${lane.id} · 已登记 ${recordsIn(lane.id).reduce((n, r) => n + r.pallets, 0)} 托</option>`).join('');
  }
  function editorLabels() {
    $('editor-title').textContent = editorOriginal ? ui('编辑货物 / 移库') : ui('货物入库');
    $('editor-description').textContent = ui('以原图立柱横线为界选择上半区或下半区；旋转不改变方位。修改纵列或半区即可移库。');
  }
  function openEditor(recordId = null, location = state.selected, section = location === state.selected ? state.selectedSection : null) {
    if (!state.online) { toast(ui('数据库未连接，请先同步。')); return; }
    const record = recordId ? state.records.find(r => r.id === recordId) : null;
    if (recordId && !record) { toast(ui('此批货物已被移出，请查看最新库存。')); return; }
    editorVersion = record ? state.versions[record.id] : 0;
    editorOriginal = record;
    $('cargo-form').reset(); $('form-error').hidden = true;
    $('editor-locale').value = translator.locale;
    editorLabels();
    $('edit-original').value = record?.id || '';
    $('cargo-location').innerHTML = laneOptions();
    $('cargo-location').value = record ? recordLaneId(record) : location || 'A-01';
    $('cargo-section').value = record ? sectionOf(record) === 'unspecified' ? '' : record.section : ['upper', 'lower'].includes(section) ? section : '';
    for (const field of ['sku', 'name', 'shipment', 'container', 'owner', 'destination', 'notes']) $('cargo-' + field).value = record?.[field] || '';
    $('cargo-cartons').value = record?.cartons || 1;
    $('cargo-pallets').value = record?.pallets || 1;
    $('cargo-status').value = record?.status || 'stored';
    $('editor-dialog').showModal();
  }
  let pendingConfirmation;
  function confirmAction(title, message, action, label = ui('确认')) {
    $('confirm-title').textContent = title; $('confirm-message').textContent = message; $('confirm-action').textContent = label;
    $('confirm-error').hidden = true;
    pendingConfirmation = action; $('confirm-dialog').showModal();
  }
  $('confirm-action').onclick = async () => {
    const action = pendingConfirmation; if (!action) return;
    $('confirm-action').disabled = true;
    try { await action(); $('confirm-dialog').close(); }
    catch (error) { $('confirm-error').textContent = error.message; $('confirm-error').hidden = false; }
    finally { $('confirm-action').disabled = false; }
  };
  $('confirm-dialog').addEventListener('close', () => { pendingConfirmation = null; });
  $('cargo-form').addEventListener('submit', async event => {
    event.preventDefault();
    const submit = $('cargo-form').querySelector('[type="submit"]'); submit.disabled = true; $('form-error').hidden = true;
    try {
      const id = $('edit-original').value || (globalThis.crypto?.randomUUID?.() || `cargo-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      $('edit-original').value = id;
      const record = { id, ...placementForEdit(editorOriginal, $('cargo-location').value, $('cargo-section').value), section: $('cargo-section').value, status: $('cargo-status').value, cartons: Number($('cargo-cartons').value), pallets: Number($('cargo-pallets').value), updatedAt: new Date().toISOString() };
      for (const field of ['sku', 'name', 'shipment', 'container', 'owner', 'destination', 'notes']) record[field] = $('cargo-' + field).value.trim();
      validateRecords([record]);
      await mutateInventory({ action: 'upsert', record, expectedVersion: editorVersion }); state.selected = recordLaneId(record); state.selectedSection = record.section; state.dock = null;
      $('editor-dialog').close(); render();
      toast(ui('货物已保存到 ') + locationLabel(record) + (recordsIn(recordLaneId(record)).filter(r => sectionOf(r) === record.section).reduce((n, r) => n + r.pallets, 0) > LANE_BY_ID[recordLaneId(record)].sections[record.section].capacity ? ui('，该半区托盘数超出图纸建议容量，请现场核对。') : ui('，其他成员将自动同步。')));
    } catch (error) { $('form-error').textContent = error.message; $('form-error').hidden = false; }
    finally { submit.disabled = false; }
  });
  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $('export-button').onclick = () => download(`bestar-inventory-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ format: 'bestar-warehouse-lanes', version: 5, mode: 'shared', revision: state.revision, exportedAt: new Date().toISOString(), records: state.records }, null, 2), 'application/json');
  $('csv-button').onclick = () => {
    const rows = [[ui('纵列'), ui('原编号'), ui('布局版本'), ui('半区'), 'SKU', ui('商品'), ui('货件号'), ui('柜号'), ui('货主'), ui('目的仓'), ui('托盘数'), ui('箱数'), ui('状态'), ui('更新时间')]];
    for (const r of tableItems()) rows.push(r.empty ? [r.location, '', 2, '', '', '', '', '', '', '', 0, 0, ui('空闲'), ''] : [recordLaneId(r), r.location, r.layoutVersion || 1, SECTIONS[sectionOf(r)], r.sku, r.name, r.shipment, r.container, r.owner, r.destination, r.pallets, r.cartons, STATUS[r.status], r.updatedAt]);
    download('bestar-inventory.csv', '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  };
  $('import-button').onclick = () => { $('import-file').value = ''; $('import-file').click(); };
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 4 * 1024 * 1024) { toast(ui('文件过大，请选择 4 MB 以内的 JSON 备份。')); return; }
    try {
      const parsed = parseBackup(await file.text());
      previewImport(parsed.records, ui`文件包含 ${parsed.records.length} 批货物${parsed.mode === 'demo' ? ui('（此文件来自旧版演示模式）') : ''}。${parsed.renumbered ? ui('旧编号会按原位置换算为从右向左编号。') : ''}`);
    } catch (error) { toast(error.message); }
  });
  function previewImport(records, message) {
    const expectedRevision = state.revision;
    confirmAction(ui('替换共享库存'), ui`${message} 确认后将替换数据库中的 ${state.records.length} 条记录，并同步至所有成员。建议先导出备份。`, async () => {
      await mutateInventory({ action: 'replace', records, expectedRevision });
      state.query = ''; state.status = 'all'; state.zone = 'all'; state.page = 0; $('search-input').value = ''; $('status-filter').value = 'all'; render(); toast(ui`已导入 ${records.length} 条记录至共享库存。`);
    }, ui('确认替换共享库存'));
  }
  let legacyRecords = [];
  try { legacyRecords = loadInventory(localStorage); } catch { $('legacy-notice').hidden = false; $('legacy-description').textContent = ui('发现旧浏览器库存但无法解析，原数据保留，请使用原版页面导出备份。'); }
  if (legacyRecords.length) { $('legacy-notice').hidden = false; $('legacy-description').textContent = ui`此浏览器还有 ${legacyRecords.length} 条旧库存，可手动导入数据库；原浏览器数据会保留。`; }
  $('legacy-import-button').hidden = !legacyRecords.length;
  $('legacy-import-button').onclick = () => previewImport(legacyRecords, ui`旧浏览器库存包含 ${legacyRecords.length} 条记录。`);
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.close) $(button.dataset.close).close();
    if (button.dataset.view) setView(button.dataset.view);
    if (button.dataset.zone) {
      state.zone = button.dataset.zone; state.page = 0;
      if (state.zone === 'all') setExtent('fba'); else focusZone(state.zone);
      render();
    }
    if (button.dataset.locate) selectLane(button.dataset.locate, true, button.dataset.section);
    if (button.hasAttribute('data-section-filter')) { state.selectedSection = button.dataset.sectionFilter || null; render(); }
    if (button.dataset.edit) openEditor(button.dataset.edit);
    if (button.dataset.add) openEditor(null, button.dataset.add);
    if (button.dataset.remove) {
      const record = state.records.find(r => r.id === button.dataset.remove);
      if (!record) return;
      const expectedVersion = state.versions[record.id];
      confirmAction(ui('移出此批货物'), ui`将从 ${locationLabel(record)} 移出「${record.name}」共 ${record.pallets} 托、${record.cartons} 箱，并同步至所有成员。`, async () => { await mutateInventory({ action: 'delete', id: record.id, expectedVersion }); render(); toast(ui('此批货物已移出。')); }, ui('确认移出'));
    }
  });
  $('add-button').onclick = () => openEditor();
  $('layout-info-button').onclick = () => $('info-dialog').showModal();
  $('prev-page').onclick = () => { state.page--; renderTable(); };
  $('next-page').onclick = () => { state.page++; renderTable(); };
  $('search-input').addEventListener('input', event => { state.query = event.target.value; state.page = 0; renderLanes(); renderSearch(); renderTable(); renderColorLegend(); });
  $('search-input').addEventListener('keydown', event => { if (event.key === 'Enter') { const first = matchingLanes()[0]; if (first) selectLane(first.id, true); } });
  $('status-filter').onchange = event => { state.status = event.target.value; state.page = 0; render(); };
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !document.querySelector('dialog[open]')) { event.preventDefault(); $('search-input').focus(); }
  });
  document.querySelector('.brand').onclick = event => { event.preventDefault(); setView('map'); state.zone = 'all'; setExtent('fba'); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('overview-button').onclick = () => setExtent('overview');
  $('fba-button').onclick = () => setExtent('fba');
  $('reset-view').onclick = () => setExtent(state.extent);
  $('zoom-in').onclick = () => zoom(.8);
  $('zoom-out').onclick = () => zoom(1.25);
  $('rotate-left').onclick = () => rotateMap(-90);
  $('rotate-right').onclick = () => rotateMap(90);
  $('rotate-reset').onclick = () => rotateMap(-state.rotation);
  $('show-original').onchange = event => { $('original-plan').style.display = event.target.checked ? '' : 'none'; };
  $('show-columns').onchange = event => { $('columns-layer').style.display = event.target.checked ? '' : 'none'; };
  $('show-labels').onchange = event => document.querySelectorAll('.lane-label').forEach(label => label.setAttribute('visibility', event.target.checked ? 'visible' : 'hidden'));
  const svg = $('warehouse-map');
  let drag = null, moved = false;
  svg.addEventListener('wheel', event => { event.preventDefault(); zoom(event.deltaY > 0 ? 1.12 : .89, point(event.clientX, event.clientY)); $('map-tooltip').hidden = true; }, { passive: false });
  svg.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    const p = point(event.clientX, event.clientY);
    drag = { pointer: event.pointerId, startX: event.clientX, startY: event.clientY, point: p, viewport: { ...state.viewport }, target: event.target.closest('[data-location],[data-dock]') };
    moved = false; svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener('pointermove', event => {
    if (drag) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 5) moved = true;
      if (moved) {
        const scale = svg.getScreenCTM().a;
        state.viewport = { ...drag.viewport, x: drag.viewport.x - (event.clientX - drag.startX) / scale, y: drag.viewport.y - (event.clientY - drag.startY) / scale };
        updateViewport(); svg.classList.add('dragging'); $('map-tooltip').hidden = true;
      }
      return;
    }
    const laneNode = event.target.closest('[data-location]');
    if (!laneNode || event.pointerType === 'touch') { $('map-tooltip').hidden = true; return; }
    const records = recordsIn(laneNode.dataset.location).filter(r => sectionOf(r) === laneNode.dataset.section);
    $('map-tooltip').innerHTML = ui`<strong>${laneNode.dataset.location} · ${SECTIONS[laneNode.dataset.section]}</strong> · ${records.length} 批货物<br>${records.reduce((n, r) => n + r.pallets, 0)} 托盘 · 点击查看半区`;
    const stage = $('map-stage').getBoundingClientRect();
    $('map-tooltip').hidden = false;
    $('map-tooltip').style.left = Math.max(8, Math.min(event.clientX - stage.left + 16, stage.width - 200)) + 'px';
    $('map-tooltip').style.top = Math.max(8, Math.min(event.clientY - stage.top - 50, stage.height - 65)) + 'px';
  });
  function activateMapNode(node) {
    if (!node) return;
    if (node.dataset.location) selectLane(node.dataset.location, false, node.dataset.section);
    else if (node.dataset.dock) { state.dock = Number(node.dataset.dock); render(); }
  }
  svg.addEventListener('pointerup', event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    const target = drag.target; const wasMoved = moved; drag = null; svg.classList.remove('dragging');
    if (svg.hasPointerCapture(event.pointerId)) svg.releasePointerCapture(event.pointerId);
    if (!wasMoved) { $('map-tooltip').hidden = true; activateMapNode(target); }
  });
  svg.addEventListener('pointercancel', () => { drag = null; svg.classList.remove('dragging'); });
  svg.addEventListener('pointerleave', () => { $('map-tooltip').hidden = true; });
  svg.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateMapNode(event.target.closest('[data-location],[data-dock]')); } });
  new ResizeObserver(updateScale).observe($('map-stage'));
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  let theme = 'system'; try { theme = localStorage.getItem('bestar-inventory-theme') || 'system'; } catch {}
  function applyTheme() { document.documentElement.dataset.theme = theme === 'system' ? colorScheme.matches ? 'dark' : 'light' : theme; document.querySelectorAll('[data-theme-choice]').forEach(button => button.setAttribute('aria-pressed', button.dataset.themeChoice === theme)); }
  document.querySelectorAll('[data-theme-choice]').forEach(button => { button.onclick = () => { theme = button.dataset.themeChoice; try { localStorage.setItem('bestar-inventory-theme', theme); } catch {} applyTheme(); }; });
  colorScheme.addEventListener('change', applyTheme); applyTheme();
  function applyLanguage() {
    const pendingText = Object.fromEntries(['confirm-title', 'confirm-message', 'confirm-action', 'confirm-error', 'form-error', 'toast', 'legacy-description'].map(id => [id, translator.retranslate($(id).textContent)]));
    translateStatic();
    document.documentElement.lang = translator.locale;
    $('editor-locale').value = translator.locale;
    document.querySelectorAll('[data-locale]').forEach(button => button.setAttribute('aria-pressed', button.dataset.locale === translator.locale));
    for (const [id, text] of Object.entries(pendingText)) if (text) $(id).textContent = text;
    $('structure-layer').replaceChildren(); $('columns-layer').replaceChildren(); drawStructure(); render();
    if ($('editor-dialog').open) {
      const selected = $('cargo-location').value;
      $('cargo-location').innerHTML = laneOptions(); $('cargo-location').value = selected;
      editorLabels();
    }
    syncStatus(state.online);
    $('map-caption').textContent = state.extent === 'overview' ? ui('全仓总览 · 右侧 12 个 dock：由下向上 23–34') : ui('立柱横线分上下半区 · 点击半区查看货物');
    $('map-tooltip').hidden = true;
  }
  document.querySelectorAll('[data-locale]').forEach(button => { button.onclick = () => { translator.setLocale(button.dataset.locale); I18n.persistBrowserLocale(translator.locale); applyLanguage(); }; });
  $('editor-locale').onchange = event => { translator.setLocale(event.target.value); I18n.persistBrowserLocale(translator.locale); applyLanguage(); };
  applyLanguage(); updateViewport(); syncStatus(false, ui('正在连接数据库…')); void refreshInventory();
})();
