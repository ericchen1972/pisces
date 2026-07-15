export function localeFromLanguage(language = '') {
  const normalized = String(language).toLowerCase()
  return normalized === 'zh-tw' || normalized.startsWith('zh-hant') ? 'zh-TW' : 'en'
}

export function translate(locale, english, traditionalChinese) {
  return locale === 'zh-TW' ? traditionalChinese : english
}
