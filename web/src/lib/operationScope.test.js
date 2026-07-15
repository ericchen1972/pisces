import { expect, it, vi } from 'vitest'
import { createAuthRequestGuard } from './authRequestGuard.js'
import { stopActiveRecordingResources } from './accountScope.js'
import { createAccountOperationScope } from './operationScope.js'

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

it('suppresses overlapping pisces-core completions from the prior account', async () => {
  const auth = createAuthRequestGuard()
  auth.activate('account-a')
  const scope = createAccountOperationScope(auth)
  const first = scope.begin()
  const second = scope.begin()
  const firstReply = deferred()
  const secondReply = deferred()
  const writes = []
  const completions = [first, second].map((operation, index) => (
    [firstReply, secondReply][index].promise.then((reply) => {
      scope.runIfCurrent(operation, () => writes.push(reply))
    })
  ))

  scope.invalidate()
  auth.activate('account-b')
  const current = scope.begin()
  scope.runIfCurrent(current, () => writes.push('account-b optimistic'))
  firstReply.resolve('account-a reply 1')
  secondReply.resolve('account-a reply 2')
  await Promise.all(completions)

  expect(first.signal.aborted).toBe(true)
  expect(second.signal.aborted).toBe(true)
  expect(writes).toEqual(['account-b optimistic'])
})

it('forks live context work that becomes stale when its live generation resets', async () => {
  const auth = createAuthRequestGuard()
  auth.activate('account-a')
  const liveScope = createAccountOperationScope(auth)
  const connect = liveScope.begin()
  const contextRequest = liveScope.fork(connect)
  const response = deferred()
  const accountASession = { sendConversationItem: vi.fn() }
  const completion = response.promise.then((context) => {
    liveScope.runIfCurrent(contextRequest, () => accountASession.sendConversationItem(context))
  })

  liveScope.invalidate()
  auth.activate('account-b')
  response.resolve('account-a private context')
  await completion

  expect(contextRequest.signal.aborted).toBe(true)
  expect(accountASession.sendConversationItem).not.toHaveBeenCalled()
})

it('prevents a queued recorder onstop callback from sending after re-authentication', async () => {
  const auth = createAuthRequestGuard()
  auth.activate('account-a')
  const scope = createAccountOperationScope(auth)
  const recording = scope.begin()
  const beforeRequest = deferred()
  const sends = []
  const recorder = {
    state: 'recording',
    ondataavailable: () => {},
    onstop: async () => {
      await beforeRequest.promise
      scope.runIfCurrent(recording, () => sends.push('account-a voice request'))
    },
    stop() {},
  }
  const queuedOnStop = recorder.onstop

  scope.invalidate()
  auth.activate('account-b')
  stopActiveRecordingResources({
    mediaRecorderRef: { current: recorder },
    mediaStreamRef: { current: { getTracks: () => [{ stop() {} }] } },
    recordChunksRef: { current: [new Blob(['account-a audio'])] },
  })
  const completion = queuedOnStop()
  beforeRequest.resolve()
  await completion

  expect(recording.signal.aborted).toBe(true)
  expect(sends).toEqual([])
})

it('closes a late connected session instead of publishing it after reset', async () => {
  const auth = createAuthRequestGuard()
  auth.activate('account-a')
  const liveScope = createAccountOperationScope(auth)
  const connect = liveScope.begin()
  const lateSession = { close: vi.fn() }
  const connected = deferred()
  let publishedSession = null
  const completion = connected.promise.then(async (session) => {
    if (!liveScope.isCurrent(connect)) {
      await session.close()
      return
    }
    publishedSession = session
  })

  liveScope.invalidate()
  auth.activate('account-b')
  connected.resolve(lateSession)
  await completion

  expect(lateSession.close).toHaveBeenCalledOnce()
  expect(publishedSession).toBeNull()
})

it('serializes recording startup and disposes an out-of-order stale stream', async () => {
  const auth = createAuthRequestGuard()
  auth.activate('account-a')
  const scope = createAccountOperationScope(auth)
  const ownerRef = { current: null }
  const first = scope.beginExclusive(ownerRef)
  const ignoredDoubleClick = scope.beginExclusive(ownerRef)
  const firstAcquisition = deferred()
  const currentAcquisition = deferred()
  const firstTrack = { stop: vi.fn() }
  const currentTrack = { stop: vi.fn() }
  const firstStream = { getTracks: () => [firstTrack] }
  const currentStream = { getTracks: () => [currentTrack] }
  const published = []
  const recorders = []
  const firstCompletion = firstAcquisition.promise.then((stream) => {
    if (scope.publishOwned(first, ownerRef, stream)) {
      published.push(stream)
      recorders.push({ stream })
    }
  })

  expect(ignoredDoubleClick).toBeNull()

  scope.invalidate()
  ownerRef.current = null
  auth.activate('account-b')
  const current = scope.beginExclusive(ownerRef)
  const currentCompletion = currentAcquisition.promise.then((stream) => {
    if (scope.publishOwned(current, ownerRef, stream)) {
      published.push(stream)
      recorders.push({ stream })
    }
  })

  currentAcquisition.resolve(currentStream)
  await currentCompletion
  firstAcquisition.resolve(firstStream)
  await firstCompletion

  expect(ownerRef.current).toBe(current)
  expect(published).toEqual([currentStream])
  expect(recorders).toEqual([{ stream: currentStream }])
  expect(currentTrack.stop).not.toHaveBeenCalled()
  expect(firstTrack.stop).toHaveBeenCalledOnce()
})
