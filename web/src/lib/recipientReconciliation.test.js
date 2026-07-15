import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRecipientReconciler, reconcileRecipientSnapshot } from './recipientReconciliation.js'

afterEach(() => vi.useRealTimers())

describe('recipient reconciliation scheduling', () => {
  it('polls every 30s only while visible and reacts to focus/visible events', async () => {
    vi.useFakeTimers()
    let visible = true
    const run = vi.fn().mockResolvedValue(undefined)
    const controller = createRecipientReconciler({ run, isVisible: () => visible, windowTarget: window, documentTarget: document })
    controller.start()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(run).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('focus'))
    await vi.runAllTicks()
    expect(run).toHaveBeenCalledTimes(2)
    visible = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
    visible = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.runAllTicks()
    expect(run).toHaveBeenCalledTimes(3)
    controller.stop()
  })

  it('accepts Ably-connected triggers, cleans up, and coalesces overlap to one bounded rerun', async () => {
    vi.useFakeTimers()
    let resolve
    const run = vi.fn(() => new Promise((done) => { resolve = done }))
    const controller = createRecipientReconciler({ run, isVisible: () => true, windowTarget: window, documentTarget: document })
    controller.start()
    controller.trigger()
    controller.trigger()
    controller.trigger()
    expect(run).toHaveBeenCalledTimes(1)
    resolve()
    await vi.runAllTicks()
    expect(run).toHaveBeenCalledTimes(2)
    controller.stop()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
  })
})

describe('recipient reconciliation snapshot safety', () => {
  it('recovers sidebar and selected human history after a missed publish', async () => {
    const refreshSidebar = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const snapshot = { accountId: 'a', contactId: 'friend', human: true }
    await reconcileRecipientSnapshot({ snapshot, isCurrent: () => true, refreshSidebar, refreshHistory })
    expect(refreshSidebar).toHaveBeenCalledWith(snapshot)
    expect(refreshHistory).toHaveBeenCalledWith('friend', snapshot)
  })

  it('does not load AI history and drops stale account/contact work after sidebar refresh', async () => {
    const refreshHistory = vi.fn()
    const ai = { accountId: 'a', contactId: 'pisces-core', human: false }
    await reconcileRecipientSnapshot({ snapshot: ai, isCurrent: () => true, refreshSidebar: vi.fn(), refreshHistory })
    expect(refreshHistory).not.toHaveBeenCalled()
    const stale = { accountId: 'a', contactId: 'friend-a', human: true }
    await reconcileRecipientSnapshot({ snapshot: stale, isCurrent: () => false, refreshSidebar: vi.fn(), refreshHistory })
    expect(refreshHistory).not.toHaveBeenCalled()
  })
})
