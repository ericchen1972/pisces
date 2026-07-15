import { describe, expect, it } from 'vitest'
import { localeFromLanguage, translate } from './i18n.js'

describe('localeFromLanguage', () => {
  it.each([
    ['zh-TW', 'zh-TW'],
    ['ZH-TW', 'zh-TW'],
    ['zh-Hant', 'zh-TW'],
    ['zh-Hant-TW', 'zh-TW'],
    ['ZH-HANT-HK', 'zh-TW'],
  ])('maps %s to Traditional Chinese', (language, expected) => {
    expect(localeFromLanguage(language)).toBe(expected)
  })

  it.each(['zh-CN', 'zh-HK', 'zh-MO', 'zh', 'ja', 'en-US', ''])(
    'maps %s to English',
    (language) => {
      expect(localeFromLanguage(language)).toBe('en')
    },
  )
})

describe('translate', () => {
  it('returns Traditional Chinese only for the zh-TW locale', () => {
    expect(translate('zh-TW', 'Settings', '設定')).toBe('設定')
    expect(translate('zh-CN', 'Settings', '設定')).toBe('Settings')
    expect(translate('en', 'Settings', '設定')).toBe('Settings')
  })
})
