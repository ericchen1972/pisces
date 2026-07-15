export function localeFromLanguage(language = '') {
  const normalized = String(language).toLowerCase()
  return normalized === 'zh-tw' || normalized.startsWith('zh-hant') ? 'zh-TW' : 'en'
}

export function translate(locale, english, traditionalChinese) {
  return locale === 'zh-TW' ? traditionalChinese : english
}

export function visibleErrorMessage(error, locale, englishFallback, traditionalChineseFallback) {
  if (locale === 'zh-TW') return traditionalChineseFallback
  return error?.message || englishFallback
}
