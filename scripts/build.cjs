const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const image = fs.readFileSync(path.join(root, 'unit23_available_area_clean_no_text.png')).toString('base64');
const brand = fs.readFileSync(path.join(root, 'assets/brand-wordmark.png')).toString('base64');
const html = read('src/template.html')
  .replace('/* INLINE_STYLES */', () => read('src/styles.css') + '\n' + read('src/office-theme.css'))
  .replace('/* INLINE_APP */', () => `globalThis.BestarMessages = ${JSON.stringify({ 'zh-CN': JSON.parse(read('src/locales/zh-CN.json')), en: JSON.parse(read('src/locales/en.json')) }).replaceAll('<', '\\u003c')};\n` + read('src/i18n.js') + '\n' + read('src/app.js'))
  .replace('__FLOORPLAN__', () => `data:image/png;base64,${image}`)
  .replaceAll('__BRAND__', `data:image/png;base64,${brand}`);
fs.writeFileSync(path.join(root, 'index.html'), html);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'index.html'), html);
console.log(`Built index.html and dist/index.html (${Math.round(Buffer.byteLength(html) / 1024)} KB), all assets embedded, no seeded inventory.`);
