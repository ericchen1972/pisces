export function openaiVoiceFromUser(user) {
  return user?.ai_settings?.openai_voice || 'marin'
}

export function buildAiSettingsPayload({ form, avatarUrl = '', avatarImageBase64 = '', avatarMimeType = 'image/webp' }) {
  return {
    ...(avatarUrl?.startsWith('https://') ? { avatar_url: avatarUrl } : {}),
    ...(avatarImageBase64 ? { avatar_image_base64: avatarImageBase64, avatar_mime_type: avatarMimeType } : {}),
    gender: form.gender,
    voice: form.voice,
    openai_voice: form.openaiVoice,
    global_prompt: form.globalPrompt,
  }
}

export function mergeAiSettingsUser(user, form, avatarUrl) {
  if (!user) return user
  return {
    ...user,
    ai_avatar_url: avatarUrl,
    ai_settings: {
      gender: form.gender,
      voice: form.voice,
      openai_voice: form.openaiVoice,
      global_prompt: form.globalPrompt,
    },
  }
}

export function applyAiContactSettings(contacts, contactId, form, avatarUrl) {
  return contacts.map((contact) => contact.id === contactId ? {
    ...contact,
    name: 'Convia',
    avatar: avatarUrl,
    gender: form.gender,
    voice: form.voice,
    openaiVoice: form.openaiVoice,
    globalPrompt: form.globalPrompt,
  } : contact)
}

export function isSupportedAvatarInput(mimeType) {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
}
