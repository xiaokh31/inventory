// Read-only smoke test. Inventory writes are covered by isolated database tests.
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
const url = process.env.BROWSER_TEST_URL;
if (!url) throw new Error('Set BROWSER_TEST_URL explicitly. This test never writes inventory.');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(url);
    assert.equal(await page.locator('#login-dialog, #logout-button').count(), 0);
    await page.locator('#connection-label[data-status=online]').waitFor();
    assert.equal(await page.locator('.lane').count(), 45); assert.equal(await page.locator('.dock').count(), 12);
    assert.equal(await page.locator('.lane-half').count(), 90);
    for (const expected of ['90°', '180°', '270°', '0°']) {
      await page.locator('#rotate-right').click(); assert.equal(await page.locator('#rotation-label').textContent(), expected);
      await page.locator('[data-location="B-03"][data-section="upper"]').click(); assert.equal(await page.locator('.detail-location-heading h2').textContent(), 'B-03');
      assert.equal(await page.locator('[data-section-filter="upper"]').getAttribute('aria-pressed'), 'true');
    }
    await page.getByRole('button', { name: '库存台账', exact: true }).click(); assert.ok(await page.locator('#inventory-view').isVisible());
    await page.getByRole('button', { name: '仓库地图', exact: true }).click();
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
    assert.deepEqual(errors, []); console.log('Read-only browser smoke checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
