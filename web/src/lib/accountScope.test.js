import { expect, it, vi } from 'vitest'
import { resetAccountScopedRefs, stopActiveRecordingResources } from './accountScope.js'

it('clears all account-bound cache refs on activation or logout', () => {
  const refs = {
    restoredSelectedContactIdRef: { current: 'contact-a' },
    phoneLiveContextRef: { current: 'private context' },
    liveAboutFriendInjectedRef: { current: new Set(['topic']) },
    liveAboutFriendPendingRef: { current: new Set(['pending']) },
  }

  resetAccountScopedRefs(refs)

  expect(refs.restoredSelectedContactIdRef.current).toBeNull()
  expect(refs.phoneLiveContextRef.current).toBe('')
  expect([...refs.liveAboutFriendInjectedRef.current]).toEqual([])
  expect([...refs.liveAboutFriendPendingRef.current]).toEqual([])
})

it('invalidates recorder callbacks before stopping active recording resources', async () => {
  const queuedStop = []
  const recorder = {
    state: 'recording',
    ondataavailable: () => {},
    onstop: () => queuedStop.push('request sent'),
    stop: vi.fn(function stop() {
      this.onstop?.()
    }),
  }
  const track = { stop: vi.fn() }
  const refs = {
    mediaRecorderRef: { current: recorder },
    mediaStreamRef: { current: { getTracks: () => [track] } },
    recordChunksRef: { current: [new Blob(['old account'])] },
  }
  const clearTimers = vi.fn()

  stopActiveRecordingResources({ ...refs, clearTimers })
  await Promise.resolve()

  expect(recorder.onstop).toBeNull()
  expect(recorder.ondataavailable).toBeNull()
  expect(recorder.stop).toHaveBeenCalledOnce()
  expect(track.stop).toHaveBeenCalledOnce()
  expect(clearTimers).toHaveBeenCalledOnce()
  expect(refs.mediaRecorderRef.current).toBeNull()
  expect(refs.mediaStreamRef.current).toBeNull()
  expect(refs.recordChunksRef.current).toEqual([])
  expect(queuedStop).toEqual([])
})
