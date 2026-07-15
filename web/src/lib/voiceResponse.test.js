import { describe, expect, it } from 'vitest'
import { requireSuccessfulVoiceResponse } from './voiceResponse.js'

describe('requireSuccessfulVoiceResponse', () => {
  it('routes non-2xx AI voice responses into terminal failure cleanup', () => {
    expect(() => requireSuccessfulVoiceResponse({ ok: false, status: 403 }, { error: 'accepted friendship required' })).toThrow('accepted friendship required')
    expect(requireSuccessfulVoiceResponse({ ok: true, status: 200 }, { reply: 'Hello' })).toEqual({ reply: 'Hello' })
  })
})
