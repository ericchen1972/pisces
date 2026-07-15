import { describe, expect, it, vi } from 'vitest'
import { requestFriendDeletion } from './contactActions.js'

describe('requestFriendDeletion', () => {
  it('uses the authenticated persistent friend-delete contract', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, friend_user_id: 'friend' }) })
    await requestFriendDeletion({ apiBaseUrl: 'https://api.example', contactId: 'friend', fetchImpl })
    expect(fetchImpl).toHaveBeenCalledWith('https://api.example/api/friend/delete', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ friend_user_id: 'friend' }) }))
  })

  it('rejects a failed server confirmation without treating deletion as complete', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ ok: false, error: 'friendship not found' }) })
    await expect(requestFriendDeletion({ apiBaseUrl: '', contactId: 'friend', fetchImpl })).rejects.toThrow('friendship not found')
  })
})
