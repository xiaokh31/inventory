const { createTranslator, normalizeLocale, catalogs } = require('./i18n.js');
function localizeError(message, locale) {
  const t = createTranslator(normalizeLocale(locale)).t;
  if (catalogs.en[message]) return t(message);
  const row = /^第 (\d+) 条：(.*)$/.exec(message);
  if (row) return t('第 {0} 条：{1}', { 0: row[1], 1: localizeError(row[2], locale) });
  const field = /^(\w+) 格式或长度不正确。$/.exec(message);
  if (field) return t('{0} 格式或长度不正确。', { 0: field[1] });
  return normalizeLocale(locale) === 'zh-CN' ? message : t('请求失败，请重试。');
}
module.exports = { localizeError };
