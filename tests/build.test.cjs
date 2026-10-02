const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('Vercel build contains embedded UI assets and shared API client without seeded records or credentials', () => {
  execFileSync(process.execPath, ['scripts/build.cjs'], { cwd: root });
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist')), ['index.html']);
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert.equal(html, fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.match(html, /id="cargo-destination"/);
  assert.match(html, /id="rotate-right"/);
  assert.match(html, /api\/inventory/);
  assert.doesNotMatch(html, /id="login-dialog"|id="logout-button"|api\/session|access-password/);
  assert.doesNotMatch(html, /function demoRecords|id="mode-button"|test-batch-1|FBA18\d{6}|星辰贸易|INLINE_APP|INLINE_STYLES|__FLOORPLAN__|__BRAND__|postgresql:\/\//);
  const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.deepEqual([...app.matchAll(/localStorage\.setItem\(([^,]+)/g)].map(match => match[1]), ["'bestar-inventory-theme'"]);
  if (fs.existsSync(path.join(root, '.env'))) {
    const secretLines = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(line => /^(DATABASE_URL|INVENTORY_PASSWORD|SESSION_SECRET)=/.test(line));
    for (const line of secretLines) { const value = line.slice(line.indexOf('=') + 1); if (value.length > 8) assert.equal(html.includes(value), false, 'Build must not include server credentials'); }
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json')));
  assert.equal(config.framework, null);
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.buildCommand, 'npm run build');
});
