import { describe, expect, it } from 'vitest'
import { applyAiContactSettings, buildAiSettingsPayload, isSupportedAvatarInput, mergeAiSettingsUser, openaiVoiceFromUser } from './aiSettingsContract.js'

describe('AI settings API contract', () => {
  it('posts openai_voice while reading the returned ai_settings.openai_voice', () => {
    const payload = buildAiSettingsPayload({
      form: { gender: 'female', voice: 'legacy', openaiVoice: 'coral', globalPrompt: 'Be kind.' },
      avatarUrl: 'https://example.com/avatar.webp',
      avatarImageBase64: 'YWJj',
      avatarMimeType: 'image/webp',
    })
    expect(payload).toEqual({ avatar_url: 'https://example.com/avatar.webp', avatar_image_base64: 'YWJj', avatar_mime_type: 'image/webp', gender: 'female', voice: 'legacy', openai_voice: 'coral', global_prompt: 'Be kind.' })
    expect(payload).not.toHaveProperty('ai_openai_voice')
    expect(openaiVoiceFromUser({ ai_settings: { openai_voice: 'sage' } })).toBe('sage')
    expect(openaiVoiceFromUser({})).toBe('marin')
  })

  it('keeps the selected OpenAI voice in account state after saving', () => {
    const user = mergeAiSettingsUser({ id: 'u', ai_settings: { gender: 'female' } }, { gender: 'female', voice: 'legacy', openaiVoice: 'verse', globalPrompt: 'Warm' }, 'https://example.com/new.webp')
    expect(user.ai_avatar_url).toBe('https://example.com/new.webp')
    expect(user.ai_settings).toEqual({ gender: 'female', voice: 'legacy', openai_voice: 'verse', global_prompt: 'Warm' })
  })

  it('keeps the saved OpenAI voice when the AI contact is reselected', () => {
    const contacts = applyAiContactSettings([{ id: 'pisces-core', isAi: true, openaiVoice: 'marin' }, { id: 'friend' }], 'pisces-core', { alias: 'Convia AI', openaiVoice: 'verse', gender: 'female', voice: 'legacy', globalPrompt: 'Warm' }, '/avatar.webp')
    expect(contacts[0]).toMatchObject({ openaiVoice: 'verse', avatar: '/avatar.webp', globalPrompt: 'Warm' })
    expect(contacts[1]).toEqual({ id: 'friend' })
  })

  it('accepts exactly the avatar MIME types supported by the backend', () => {
    expect(['image/jpeg', 'image/png', 'image/webp'].map(isSupportedAvatarInput)).toEqual([true, true, true])
    expect(isSupportedAvatarInput('image/gif')).toBe(false)
  })
})
