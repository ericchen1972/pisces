import { describe, expect, it, vi } from 'vitest'
import { createAuthRequestGuard } from './authRequestGuard.js'
import { createAccountOperationScope } from './operationScope.js'
import {
  canonicalOutboundMessage,
  canonicalIncomingMessage,
  effectiveMessageRole,
  restoreAssistDraft,
  stablePersonSendIdentity,
  sendAssistRequest,
  sendPersonRequest,
  sendPersonVoiceRequest,
  startExclusiveSend,
  validateTrustedMediaUrl,
} from './chatSend.js'

function jsonResponse(data, ok = true, status = 200) {
  return { ok, status, json: async () => data }
}

describe('sendAssistRequest', () => {
  it.each([
    ['user', 'user'],
    ['ai_proxy', 'ai_proxy'],
  ])('sends stable request identity and consumes canonical %s outbound fields', async (senderMode, role) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      assist_group: { id: 'assist-canonical', user_text: 'draft', ai_text: 'sent' },
      outbound_message: {
        message_id: 'outbound-canonical',
        client_request_id: 'stable-assist-id',
        sender_mode: senderMode,
        text: 'hello',
        audio_url: '/voice',
        image_url: '/image',
        music_url: '/music',
        avatar_url: '/avatar',
      },
    }))

    const first = await sendAssistRequest({
      fetchImpl,
      url: '/api/assist/message',
      contactId: 'friend-1',
      message: 'draft',
      requestId: 'stable-assist-id',
    })
    await sendAssistRequest({
      fetchImpl,
      url: '/api/assist/message',
      contactId: 'friend-1',
      message: 'draft',
      requestId: 'stable-assist-id',
    })

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      contact_id: 'friend-1',
      message: 'draft',
      request_id: 'stable-assist-id',
    })
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).request_id).toBe('stable-assist-id')
    expect(first.outboundMessage).toEqual({
      id: 'outbound-canonical',
      requestId: 'stable-assist-id',
      role,
      senderMode,
      text: 'hello',
      audioUrl: '/voice',
      imageUrl: '/image',
      musicUrl: '/music',
      avatarUrl: '/avatar',
    })
  })
})

describe('sendPersonRequest', () => {
  it('sends a supported image attachment and consumes the canonical server message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      message: {
        message_id: 'server-message',
        client_request_id: 'person-stable-1',
        sender_mode: 'user',
        text: '',
        image_url: 'https://store.public.blob.vercel-storage.com/image.png',
        music_url: '',
        sender_avatar_url: 'https://google/avatar',
      },
    }))
    const result = await sendPersonRequest({
      fetchImpl,
      url: '/api/messages/send',
      contactId: 'friend-1',
      text: '',
      attachment: { kind: 'image', url: 'https://store.public.blob.vercel-storage.com/image.png' },
      requestId: 'person-stable-1',
    })
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      recipient_user_id: 'friend-1',
      text: '',
      image_url: 'https://store.public.blob.vercel-storage.com/image.png',
      request_id: 'person-stable-1',
    })
    expect(result.message).toMatchObject({ id: 'server-message', requestId: 'person-stable-1', role: 'user', imageUrl: 'https://store.public.blob.vercel-storage.com/image.png', avatarUrl: 'https://google/avatar' })
    expect(result.conviaMessage).toBeNull()
    expect(result.conviaError).toBe('')
  })

  it('returns shared Convia reply and caller-only Convia errors from the send response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      message: {
        message_id: 'human-message',
        client_request_id: 'person-stable-2',
        sender_mode: 'user',
        text: 'Convia, help',
      },
      convia_message: {
        message_id: 'convia-message',
        client_request_id: 'person-stable-2:ai',
        sender_mode: 'ai_proxy',
        text: 'Shared reply',
      },
      convia_error: 'convia_unavailable',
    }))
    const result = await sendPersonRequest({
      fetchImpl,
      url: '/api/messages/send',
      contactId: 'friend-1',
      text: 'Convia, help',
      requestId: 'person-stable-2',
    })
    expect(result.message).toMatchObject({ id: 'human-message', role: 'user', text: 'Convia, help' })
    expect(result.conviaMessage).toMatchObject({ id: 'convia-message', role: 'ai_proxy', senderMode: 'ai_proxy', text: 'Shared reply' })
    expect(result.conviaError).toBe('convia_unavailable')
  })

  it('reuses one request id for a failed draft retry and allocates after content or success changes', () => {
    const createId = vi.fn()
      .mockReturnValueOnce('person-1')
      .mockReturnValueOnce('person-2')
      .mockReturnValueOnce('person-3')
    const first = stablePersonSendIdentity(null, { contactId: 'friend-1', text: 'hello', attachment: null }, createId)
    const retry = stablePersonSendIdentity(first, { contactId: 'friend-1', text: 'hello', attachment: null }, createId)
    const edited = stablePersonSendIdentity(retry, { contactId: 'friend-1', text: 'hello!', attachment: null }, createId)
    const afterSuccess = stablePersonSendIdentity(null, { contactId: 'friend-1', text: 'hello!', attachment: null }, createId)
    expect([first.requestId, retry.requestId, edited.requestId, afterSuccess.requestId]).toEqual(['person-1', 'person-1', 'person-2', 'person-3'])
  })

  it('sends the same voice request id on retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, message: { message_id: 'voice-1', audio_url: '/voice' } }))
    const input = { fetchImpl, url: '/api/messages/send-voice', contactId: 'friend-1', audioBase64: 'YQ==', mimeType: 'audio/webm', durationSeconds: 1, requestId: 'voice-stable-1' }
    await sendPersonVoiceRequest(input)
    await sendPersonVoiceRequest(input)
    expect(fetchImpl.mock.calls.map((call) => JSON.parse(call[1].body).request_id)).toEqual(['voice-stable-1', 'voice-stable-1'])
  })
})

describe('exclusive send coordination', () => {
  it('suppresses a synchronous duplicate and ignores completion after an account switch', async () => {
    const auth = createAuthRequestGuard()
    auth.activate('account-a')
    const scope = createAccountOperationScope(auth)
    const ownerRef = { current: null }
    let resolveRequest
    const request = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve }))
    const onSuccess = vi.fn()
    const first = startExclusiveSend({ scope, ownerRef, request, onSuccess })
    const duplicate = startExclusiveSend({ scope, ownerRef, request, onSuccess })
    expect(first.started).toBe(true)
    expect(duplicate.started).toBe(false)
    expect(request).toHaveBeenCalledOnce()

    scope.invalidate()
    ownerRef.current = null
    auth.activate('account-b')
    resolveRequest('stale result')
    await first.completion
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('does not start a request without a current authenticated account', () => {
    const auth = createAuthRequestGuard()
    const scope = createAccountOperationScope(auth)
    const request = vi.fn()
    const result = startExclusiveSend({ scope, ownerRef: { current: null }, request })
    expect(result.started).toBe(false)
    expect(request).not.toHaveBeenCalled()
  })

  it('restores a failed Assist draft only when the user has not typed a newer edit', () => {
    expect(restoreAssistDraft('', 'failed draft')).toBe('failed draft')
    expect(restoreAssistDraft('newer user edit', 'failed draft')).toBe('newer user edit')
    expect(restoreAssistDraft('', 'failed draft', 2, 1)).toBe('')
    expect(restoreAssistDraft('', 'failed draft', 1, 1, 'friend-b', 'friend-a')).toBe('')
  })

  it('does not restore a deferred failed Assist draft after switching contacts', async () => {
    let rejectRequest
    let currentContactId = 'friend-a'
    let draft = ''
    const pendingRequest = new Promise((_, reject) => { rejectRequest = reject })
    const auth = createAuthRequestGuard()
    auth.activate('account-a')
    const scope = createAccountOperationScope(auth)
    const send = startExclusiveSend({
      scope,
      ownerRef: { current: null },
      request: () => pendingRequest,
      onError: () => {
        draft = restoreAssistDraft(draft, 'failed draft', 1, 1, currentContactId, 'friend-a')
      },
    })

    currentContactId = 'friend-b'
    rejectRequest(new Error('late failure'))
    await send.completion

    expect(draft).toBe('')
  })

  it('releases ownership even when onSettled throws', async () => {
    const auth = createAuthRequestGuard()
    auth.activate('account-a')
    const scope = createAccountOperationScope(auth)
    const ownerRef = { current: null }
    const first = startExclusiveSend({
      scope,
      ownerRef,
      request: async () => 'ok',
      onSettled: () => { throw new Error('settled failed') },
    })
    await expect(first.completion).rejects.toThrow('settled failed')
    expect(ownerRef.current).toBeNull()
    expect(startExclusiveSend({ scope, ownerRef, request: async () => 'next' }).started).toBe(true)
  })
})

describe('canonicalOutboundMessage', () => {
  it('returns null when no outbound delivery happened', () => {
    expect(canonicalOutboundMessage(null)).toBeNull()
  })
})

describe('effective AI proxy roles', () => {
  it('uses sender_mode for stored history messages', () => {
    expect(effectiveMessageRole({ role: 'peer', sender_mode: 'ai_proxy' })).toBe('ai_proxy')
  })

  it('uses sender_mode for Ably messages', () => {
    expect(canonicalIncomingMessage({
      message_id: 'ably-1',
      client_request_id: 'remote-request-1',
      sender_mode: 'ai_proxy',
      text: 'AI delivery',
    })).toMatchObject({ id: 'ably-1', requestId: 'remote-request-1', role: 'ai_proxy', senderMode: 'ai_proxy' })
  })
})

describe('trusted attachment URLs', () => {
  it.each([
    'https://store.public.blob.vercel-storage.com/images/a.png',
    'https://audio.public.blob.vercel-storage.com/audios/a.wav?download=1',
  ])('accepts existing Vercel Blob media %s', (url) => {
    expect(validateTrustedMediaUrl(url)).toBe(url)
  })

  it.each([
    'http://store.public.blob.vercel-storage.com/a.png',
    'https://user:pass@store.public.blob.vercel-storage.com/a.png',
    'https://localhost/a.png',
    'https://127.0.0.1/a.png',
    'https://store.public.blob.vercel-storage.com.evil.example/a.png',
    `https://store.public.blob.vercel-storage.com/${'a'.repeat(2050)}`,
  ])('rejects untrusted media %s', (url) => {
    expect(() => validateTrustedMediaUrl(url)).toThrow('trusted Vercel Blob HTTPS URL')
  })
})
