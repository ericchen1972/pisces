import { afterEach, describe, expect, it, vi } from 'vitest'
import { createReconnectGate, createRecipientReconciler, mergeCanonicalHistoryTail, reconcileCanonicalMessage, reconcileRecipientSnapshot } from './recipientReconciliation.js'

afterEach(() => vi.useRealTimers())

describe('recipient reconciliation scheduling', () => {
  it('skips the initial Ably connection and reconciles actual reconnects', () => {
    const gate = createReconnectGate()
    expect(gate.shouldReconcile()).toBe(false)
    expect(gate.shouldReconcile()).toBe(true)
    expect(gate.shouldReconcile()).toBe(true)
  })

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
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(2)
    visible = false
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(run).toHaveBeenCalledTimes(2)
    visible = true
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledTimes(3)
    controller.stop()
  })

  it('accepts Ably-connected triggers, cleans up, and coalesces overlap to one bounded rerun', async () => {
    vi.useFakeTimers()
    let resolve
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValueOnce(undefined)
    const controller = createRecipientReconciler({ run, isVisible: () => true, windowTarget: window, documentTarget: document })
    controller.start()
    const completion = controller.trigger()
    controller.trigger()
    controller.trigger()
    expect(run).toHaveBeenCalledTimes(1)
    resolve()
    await completion
    expect(run).toHaveBeenCalledTimes(2)
    controller.stop()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('catches a failed run and preserves one queued rerun without rejecting callers', async () => {
    let rejectFirst
    const run = vi.fn()
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject }))
      .mockResolvedValueOnce(undefined)
    const controller = createRecipientReconciler({ run, isVisible: () => true, windowTarget: window, documentTarget: document })
    controller.start()
    const completion = controller.trigger()
    controller.trigger()
    rejectFirst(new Error('offline'))
    await expect(completion).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    controller.stop()
  })

  it('coalesces focus and visible events from one foreground activation', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockResolvedValue(undefined)
    const controller = createRecipientReconciler({ run, isVisible: () => true, windowTarget: window, documentTarget: document })
    controller.start()
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(run).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).toHaveBeenCalledOnce()
    controller.stop()
  })

  it('cancels a queued foreground activation during cleanup', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockResolvedValue(undefined)
    const controller = createRecipientReconciler({ run, isVisible: () => true, windowTarget: window, documentTarget: document })
    controller.start()
    window.dispatchEvent(new Event('focus'))
    controller.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(run).not.toHaveBeenCalled()
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

  it('replaces the overlapping canonical tail while preserving older and pending messages', () => {
    const current = [
      { id: 'old', text: 'old' },
      { id: 'server-1', text: 'stale' },
      { id: 'pending', text: 'pending' },
    ]
    const recent = [
      { id: 'server-1', text: 'canonical' },
      { id: 'server-2', text: 'missed' },
      { id: 'server-2', text: 'missed canonical' },
    ]

    expect(mergeCanonicalHistoryTail(current, recent)).toEqual([
      { id: 'old', text: 'old' },
      { id: 'server-1', text: 'canonical' },
      { id: 'server-2', text: 'missed canonical' },
      { id: 'pending', text: 'pending' },
    ])
  })

  it('places a canonical recent window before a pending-only local tail', () => {
    expect(mergeCanonicalHistoryTail(
      [{ id: 'pending', text: 'pending', status: 'sending' }],
      [{ id: 'server-1', text: 'canonical' }],
    )).toEqual([
      { id: 'server-1', text: 'canonical' },
      { id: 'pending', text: 'pending', status: 'sending' },
    ])
  })

  it.each([
    ['assist', { id: 'assist-client-1', role: 'assist_group', requestId: 'request-1', status: 'streaming' }, { id: 'assist-server-1', role: 'assist_group', requestId: 'request-1', status: 'complete' }],
    ['voice', { id: 'voice-client-1', role: 'user', requestId: 'request-2', audioUrl: 'blob:voice' }, { id: 'voice-server-1', role: 'user', requestId: 'request-2', audioUrl: 'https://blob/voice.webm' }],
  ])('removes a pending %s message when polling sees its canonical request identity', (_kind, pending, canonical) => {
    expect(mergeCanonicalHistoryTail([pending], [canonical])).toEqual([canonical])
  })

  it.each([
    ['assist', { id: 'assist-client-1', role: 'assist_group', requestId: 'request-1', status: 'streaming' }, { id: 'assist-server-1', role: 'assist_group', requestId: 'request-1', status: 'complete' }],
    ['voice', { id: 'voice-client-1', role: 'user', requestId: 'request-2', audioUrl: 'blob:voice' }, { id: 'voice-server-1', role: 'user', requestId: 'request-2', audioUrl: 'https://blob/voice.webm' }],
  ])('keeps one canonical %s message when success lands after polling', (_kind, pending, canonical) => {
    const polled = mergeCanonicalHistoryTail([pending], [canonical])
    expect(reconcileCanonicalMessage(polled, pending.id, canonical)).toEqual([canonical])
    expect(reconcileCanonicalMessage([canonical, pending], pending.id, canonical)).toEqual([canonical])
  })

  it('does not copy transient pending state into a different canonical message id', () => {
    const retry = vi.fn()
    const pending = { id: 'assist-client', role: 'assist_group', requestId: 'request-3', status: 'streaming', retry }
    const canonical = { id: 'assist-server', role: 'assist_group', requestId: 'request-3', userText: 'saved' }
    expect(mergeCanonicalHistoryTail([pending], [canonical])).toEqual([canonical])
  })
})
