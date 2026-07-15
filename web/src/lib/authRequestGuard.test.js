import { expect, it } from 'vitest'
import {
  consumeGuardedRequest,
  createAuthRequestGuard,
  createAuthTransitionCoordinator,
} from './authRequestGuard.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

it('prevents a slow old-user request from writing after logout', async () => {
  const guard = createAuthRequestGuard()
  const oldUser = guard.activate('user-a')
  const request = deferred()
  const writes = []
  const completion = request.promise.then((value) => guard.runIfCurrent(oldUser, () => writes.push(value)))

  guard.invalidate()
  request.resolve('old groups')
  await completion

  expect(writes).toEqual([])
})

it('prevents a slow session or bootstrap request from overwriting a switched account', async () => {
  const guard = createAuthRequestGuard()
  const oldUser = guard.activate('user-a')
  const request = deferred()
  const writes = []
  const completion = request.promise.then((value) => guard.runIfCurrent(oldUser, () => writes.push(value)))

  const newUser = guard.activate('user-b')
  request.resolve('user-a friends')
  await completion

  expect(writes).toEqual([])
  expect(guard.isCurrent(newUser)).toBe(true)
})

it('suppresses deferred success, error, and settled consumers after an account switch', async () => {
  const guard = createAuthRequestGuard()
  const context = guard.activate('user-a')
  const successfulRequest = deferred()
  const failedRequest = deferred()
  const events = []
  const successCompletion = consumeGuardedRequest({
    guard,
    context,
    request: () => successfulRequest.promise,
    onSuccess: () => events.push('success'),
    onError: () => events.push('error'),
    onSettled: () => events.push('settled'),
  })
  const errorCompletion = consumeGuardedRequest({
    guard,
    context,
    request: () => failedRequest.promise,
    onSuccess: () => events.push('success'),
    onError: () => events.push('error'),
    onSettled: () => events.push('settled'),
  })

  guard.activate('user-b')
  successfulRequest.resolve('old history')
  failedRequest.reject(new Error('old settings error'))
  await Promise.all([successCompletion, errorCompletion])

  expect(events).toEqual([])
})

it('aborts restore when explicit login starts and lets the explicit login win', async () => {
  const guard = createAuthRequestGuard()
  const transitions = createAuthTransitionCoordinator(guard)
  const restoreResponse = deferred()
  const explicitResponse = deferred()
  let sessionCookie = ''

  const restore = transitions.begin()
  const restoreCompletion = restoreResponse.promise.then((userId) => {
    if (restore.signal.aborted) return null
    sessionCookie = userId
    return transitions.complete(restore, userId)
  })
  const explicitLogin = transitions.begin()
  const explicitCompletion = explicitResponse.promise.then((userId) => {
    if (explicitLogin.signal.aborted) return null
    sessionCookie = userId
    return transitions.complete(explicitLogin, userId)
  })

  restoreResponse.resolve('restored-user')
  expect(await restoreCompletion).toBeNull()

  expect(restore.signal.aborted).toBe(true)
  expect(sessionCookie).toBe('')

  explicitResponse.resolve('explicit-user')
  const active = await explicitCompletion

  expect(sessionCookie).toBe('explicit-user')
  expect(active.userId).toBe('explicit-user')
  expect(guard.isCurrent(active)).toBe(true)
})
