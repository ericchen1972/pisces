import { describe, expect, it, vi } from 'vitest'
import { createOwnedObjectUrlRegistry, discardRecordedMessage } from './ownedObjectUrls.js'

describe('owned recorded object URLs', () => {
  it('releases a local recording when a confirmed message replaces it', () => {
    const revoke = vi.fn()
    const registry = createOwnedObjectUrlRegistry(revoke)
    registry.own('blob:voice', { contactId: 'friend', messageId: 'temp' })
    registry.replace('blob:voice', 'https://store.example/voice.webm')
    expect(revoke).toHaveBeenCalledWith('blob:voice')
  })

  it('keeps an explicitly retry-owned recording until history replaces it', () => {
    const revoke = vi.fn()
    const registry = createOwnedObjectUrlRegistry(revoke)
    registry.own('blob:retry', { contactId: 'friend', messageId: 'temp' })
    registry.reconcileContact('friend', [{ id: 'temp', audioUrl: 'blob:retry' }])
    expect(revoke).not.toHaveBeenCalled()
    registry.reconcileContact('friend', [{ id: 'server', audioUrl: 'https://store.example/voice.webm' }])
    expect(revoke).toHaveBeenCalledWith('blob:retry')
  })

  it('revokes and removes terminally failed audio when no audio retry owns it', () => {
    const revoke = vi.fn()
    const registry = createOwnedObjectUrlRegistry(revoke)
    const messages = [{ id: 'voice-1', audioUrl: 'blob:voice' }, { id: 'other', text: 'keep' }]
    registry.own('blob:voice', { contactId: 'friend', messageId: 'voice-1' })
    registry.release('blob:voice')
    expect(discardRecordedMessage(messages, 'voice-1')).toEqual([{ id: 'other', text: 'keep' }])
    expect(revoke).toHaveBeenCalledWith('blob:voice')
  })

  it('releases contact and account-owned recordings exactly once', () => {
    const revoke = vi.fn()
    const registry = createOwnedObjectUrlRegistry(revoke)
    registry.own('blob:a', { contactId: 'a', messageId: 'one' })
    registry.own('blob:b', { contactId: 'b', messageId: 'two' })
    registry.releaseContact('a')
    registry.releaseAll()
    registry.releaseAll()
    expect(revoke.mock.calls).toEqual([['blob:a'], ['blob:b']])
  })
})
