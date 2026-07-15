export function createAuthRequestGuard() {
  let generation = 0
  let userId = ''

  const snapshot = () => ({ generation, userId })
  const isCurrent = (context) => Boolean(
    context
    && context.generation === generation
    && context.userId === userId,
  )

  return {
    snapshot,
    isCurrent,
    activate(nextUserId) {
      generation += 1
      userId = String(nextUserId || '')
      return snapshot()
    },
    invalidate() {
      generation += 1
      userId = ''
      return snapshot()
    },
    runIfCurrent(context, operation) {
      if (!isCurrent(context)) return undefined
      return operation()
    },
  }
}

export function createAuthTransitionCoordinator(guard) {
  let currentTransition = null

  return {
    begin() {
      currentTransition?.controller.abort()
      const controller = new AbortController()
      const transition = {
        controller,
        signal: controller.signal,
        context: guard.invalidate(),
      }
      currentTransition = transition
      return transition
    },
    complete(transition, userId) {
      if (
        transition !== currentTransition
        || transition.signal.aborted
        || !guard.isCurrent(transition.context)
      ) return null
      currentTransition = null
      return guard.activate(userId)
    },
    cancel() {
      currentTransition?.controller.abort()
      currentTransition = null
      return guard.invalidate()
    },
  }
}

export async function consumeGuardedRequest({
  guard,
  context,
  request,
  onSuccess,
  onError,
  onSettled,
}) {
  try {
    const value = await request()
    if (!guard.isCurrent(context)) return { stale: true }
    await onSuccess?.(value)
    return { stale: false, value }
  } catch (error) {
    if (!guard.isCurrent(context)) return { stale: true, error }
    await onError?.(error)
    return { stale: false, error }
  } finally {
    if (guard.isCurrent(context)) await onSettled?.()
  }
}
