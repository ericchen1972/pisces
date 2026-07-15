import { describe, expect, it, vi } from 'vitest'
import { authorizeIncomingFriend } from './realtimeFriendGate.js'

describe('authorizeIncomingFriend', () => {
  it('accepts a known real contact without creating one from realtime payload data', async () => {
    const known = { id: 'friend', name: 'Authoritative friend', isAi: false }
    const refreshFriends = vi.fn()
    await expect(authorizeIncomingFriend({ senderId: 'friend', contacts: [known], refreshFriends })).resolves.toEqual({ contact: known, refreshed: false })
    expect(refreshFriends).not.toHaveBeenCalled()
  })

  it('refetches authoritative friends before accepting an unknown sender', async () => {
    const authoritative = { id: 'friend', name: 'Server friend', isAi: false }
    const refreshFriends = vi.fn().mockResolvedValue([authoritative])
    await expect(authorizeIncomingFriend({ senderId: 'friend', contacts: [], refreshFriends })).resolves.toEqual({ contact: authoritative, refreshed: true })
    expect(refreshFriends).toHaveBeenCalledOnce()
  })

  it('ignores an unknown nonfriend realtime message after authoritative refetch', async () => {
    const refreshFriends = vi.fn().mockResolvedValue([])
    await expect(authorizeIncomingFriend({ senderId: 'stranger', contacts: [], refreshFriends })).resolves.toEqual({ contact: null, refreshed: true })
  })

  it('serializes different unknown senders so an older friends snapshot cannot overwrite a newer one', async () => {
    const resolvers = []
    const friendA = { id: 'friend-a', name: 'Server friend A', isAi: false }
    const friendB = { id: 'friend-b', name: 'Server friend B', isAi: false }
    const refreshFriends = vi.fn(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const inFlightRefreshes = new Map()
    const first = authorizeIncomingFriend({ senderId: 'friend-a', contacts: [], refreshFriends, inFlightRefreshes })
    const second = authorizeIncomingFriend({ senderId: 'friend-b', contacts: [], refreshFriends, inFlightRefreshes })
    await Promise.resolve()
    await Promise.resolve()
    expect(refreshFriends).toHaveBeenCalledOnce()
    resolvers[0]([friendA])
    await expect(first).resolves.toEqual({ contact: friendA, refreshed: true })
    await Promise.resolve()
    expect(refreshFriends).toHaveBeenCalledTimes(2)
    resolvers[1]([friendA, friendB])
    await expect(second).resolves.toEqual({ contact: friendB, refreshed: true })
    expect(inFlightRefreshes.size).toBe(0)
  })

  it('clears a rejected shared refresh without creating an ignored rejection chain', async () => {
    const inFlightRefreshes = new Map()
    await expect(authorizeIncomingFriend({ senderId: 'friend', contacts: [], refreshFriends: () => Promise.reject(new Error('offline')), inFlightRefreshes })).rejects.toThrow('offline')
    expect(inFlightRefreshes.size).toBe(0)
  })

  it('holds a known-sender delta until an older authoritative refresh has committed', async () => {
    let resolveRefresh
    const known = { id: 'known', name: 'Known friend', isAi: false }
    const unknown = { id: 'unknown', name: 'New friend', isAi: false }
    const inFlightRefreshes = new Map()
    const unknownAuthorization = authorizeIncomingFriend({
      senderId: 'unknown',
      contacts: [known],
      refreshFriends: () => new Promise((resolve) => { resolveRefresh = resolve }),
      inFlightRefreshes,
    })
    await Promise.resolve()
    await Promise.resolve()
    let knownCompleted = false
    const knownAuthorization = authorizeIncomingFriend({ senderId: 'known', contacts: [known], refreshFriends: vi.fn(), inFlightRefreshes })
      .then((result) => { knownCompleted = true; return result })
    await Promise.resolve()
    expect(knownCompleted).toBe(false)
    resolveRefresh([known, unknown])
    await expect(unknownAuthorization).resolves.toEqual({ contact: unknown, refreshed: true })
    await expect(knownAuthorization).resolves.toEqual({ contact: known, refreshed: false })
  })
})
