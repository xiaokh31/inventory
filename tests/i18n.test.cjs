const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../src/i18n.js');
const { localizeError } = require('../src/errors.cjs');

test('Chinese and English catalogs cover the complete static UI and preserve all interpolation parameters', () => {
  const zh = i18n.catalogs['zh-CN'], en = i18n.catalogs.en;
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort());
  const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of Object.keys(zh)) {
    assert.ok(en[key].trim(), key);
    assert.deepEqual(placeholders(zh[key]), placeholders(en[key]), key);
    if (key !== '中文') assert.doesNotMatch(en[key], /[\u4e00-\u9fff]/, key);
  }
  for (const key of i18n.messageKeys(fs.readFileSync(path.join(__dirname, '../src/template.html'), 'utf8'))) assert.ok(Object.hasOwn(en, key), key);
});

test('language switching translates labels and formats while preserving user text and markup escapes verbatim', () => {
  const t = i18n.createTranslator('zh-CN');
  const product = '在库 <script>中文</script> {0}', escaped = '在库 &lt;script&gt;中文&lt;/script&gt; {0}';
  const message = () => t.ui`<strong>${escaped}</strong><span>目的仓</span>`;
  assert.equal(message(), `<strong>${escaped}</strong><span>目的仓</span>`);
  t.setLocale('en');
  assert.equal(message(), `<strong>${escaped}</strong><span>Destination</span>`);
  assert.equal(t.ui`第 ${2} 条：${product}`, 'Record 2: ' + product);
  assert.equal(t.t('最近同步 {0} · 版本 {1}', { 0: '12:30', 1: 80 }), 'Last sync 12:30 · Revision 80');
  t.setLocale('zh-CN');
  assert.equal(t.t('目的仓'), '目的仓');
  assert.throws(() => t.t('missing-key'), /Missing/);
});

test('locale preference follows reference cookie, saved preference and browser fallback without a database write', () => {
  const storage = { getItem: () => 'zh-CN' };
  assert.equal(i18n.readBrowserLocale(storage, 'bestar_locale=en; other=1', 'zh-CN'), 'en');
  assert.equal(i18n.readBrowserLocale(storage, '', 'en-US'), 'zh-CN');
  assert.equal(i18n.readBrowserLocale({ getItem: () => null }, '', 'en-US'), 'en');
  assert.equal(i18n.readBrowserLocale({ getItem() { throw Error(); } }, 'bestar_locale=%', 'zh-TW'), 'zh-CN');
});

test('API validation, stale-layout and conflict errors are localized per request', () => {
  assert.equal(localizeError('第 2 条：pallets 格式或长度不正确。', 'en'), 'Record 2: Invalid format or length for pallets.');
  assert.match(localizeError('库位布局已更新，请刷新页面后再操作。', 'en'), /Reload/);
  assert.equal(localizeError('库位布局已更新，请刷新页面后再操作。', 'zh-CN'), '库位布局已更新，请刷新页面后再操作。');
  assert.match(localizeError('库存已被其他用户修改，请刷新核对后再保存。', 'en'), /Another user/);
});
