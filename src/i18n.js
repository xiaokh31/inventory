/* Explicit UI catalogs; interpolated inventory values never enter translation lookup. */
(function (root) {
  'use strict';
  const catalogs = typeof module !== 'undefined' && module.exports
    ? { 'zh-CN': require('./locales/zh-CN.json'), en: require('./locales/en.json') }
    : root.BestarMessages;
  const normalizeLocale = value => /^zh(?:-|$)/i.test(value || '') ? 'zh-CN' : 'en';
  const format = (text, values) => text.replace(/\{(\w+)\}/g, (token, key) => values[key] === undefined ? token : String(values[key]));
  function messageKeys(template) {
    const keys = [];
    template.split(/(<[^>]*>)/g).forEach(part => {
      if (part.startsWith('<')) {
        for (const match of part.matchAll(/(?:aria-label|title|placeholder)="([^"]*)"/g)) if (/[\u4e00-\u9fff]/.test(match[1])) keys.push(match[1].trim());
      } else if (/[\u4e00-\u9fff]/.test(part)) keys.push(part.trim());
    });
    return keys;
  }
  function createTranslator(initialLocale = 'zh-CN') {
    let locale = normalizeLocale(initialLocale);
    const remembered = new Map();
    function t(key, params = {}) {
      const translated = catalogs[locale][key];
      if (translated === undefined) throw new Error(`Missing ${locale} translation: ${key}`);
      return format(translated, params);
    }
    function translatePart(value) {
      if (!/[\u4e00-\u9fff]/.test(value)) return value;
      return value.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, before, key, after) => before + t(key) + after);
    }
    function render(template, values) {
      const translated = template.split(/(<[^>]*>)/g).map(part => part.startsWith('<')
        ? part.replace(/((?:aria-label|title|placeholder)=")([^"]*)(")/g, (_, before, value, after) => before + translatePart(value) + after)
        : translatePart(part)).join('');
      // Substitute once, after translation: customer text and identifiers stay verbatim.
      return format(translated, values);
    }
    function ui(strings, ...values) {
      const template = typeof strings === 'string' ? strings : strings.reduce((out, part, index) => out + (index ? `{${index - 1}}` : '') + part, '');
      const result = render(template, values);
      if (remembered.size > 512) remembered.delete(remembered.keys().next().value);
      remembered.set(result, { template, values });
      return result;
    }
    return { t, ui, get locale() { return locale; }, setLocale(value) { locale = normalizeLocale(value); }, retranslate(value) { const entry = remembered.get(value); return entry ? render(entry.template, entry.values) : value; } };
  }
  function readBrowserLocale(storage, cookie, browserLanguage) {
    const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('bestar_locale='))?.slice(14);
    if (value) { try { return normalizeLocale(decodeURIComponent(value)); } catch {} }
    try { const saved = storage.getItem('bestar.locale'); if (saved) return normalizeLocale(saved); } catch {}
    return normalizeLocale(browserLanguage);
  }
  function persistBrowserLocale(locale) {
    try { localStorage.setItem('bestar.locale', locale); } catch {}
    document.cookie = `bestar_locale=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  }
  function bindStatic(rootNode, translator) {
    const entries = [], walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName) && /[\u4e00-\u9fff]/.test(node.nodeValue)) entries.push({ node, source: node.nodeValue });
    }
    for (const node of rootNode.querySelectorAll('[aria-label],[title],[placeholder]')) for (const attribute of ['aria-label', 'title', 'placeholder']) {
      const source = node.getAttribute(attribute);
      if (source && /[\u4e00-\u9fff]/.test(source)) entries.push({ node, attribute, source });
    }
    return () => entries.forEach(({ node, attribute, source }) => {
      if (!node.isConnected) return;
      if (attribute) node.setAttribute(attribute, translator.ui(source)); else node.nodeValue = translator.ui(source);
    });
  }
  const api = { createTranslator, normalizeLocale, readBrowserLocale, persistBrowserLocale, bindStatic, messageKeys, catalogs };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BestarI18n = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
