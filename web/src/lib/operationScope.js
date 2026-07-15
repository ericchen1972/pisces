export function createAccountOperationScope(authGuard) {
  let generation = 0
  const activeControllers = new Set()

  const isCurrent = (operation) => Boolean(
    operation
    && operation.generation === generation
    && operation.authContext?.userId
    && authGuard.isCurrent(operation.authContext),
  )

  const createOperation = (generationValue, authContext) => {
    const controller = new AbortController()
    activeControllers.add(controller)
    return {
      generation: generationValue,
      authContext,
      controller,
      signal: controller.signal,
    }
  }

  return {
    begin() {
      return createOperation(generation, authGuard.snapshot())
    },
    beginExclusive(ownerRef) {
      if (!ownerRef || ownerRef.current) return null
      const operation = createOperation(generation, authGuard.snapshot())
      ownerRef.current = operation
      return operation
    },
    fork(parent) {
      if (!isCurrent(parent)) {
        const stale = createOperation(parent?.generation ?? generation, parent?.authContext ?? authGuard.snapshot())
        stale.controller.abort()
        activeControllers.delete(stale.controller)
        return stale
      }
      return createOperation(parent.generation, parent.authContext)
    },
    isCurrent,
    isOwner(operation, ownerRef) {
      return ownerRef?.current === operation && isCurrent(operation)
    },
    publishOwned(operation, ownerRef, resource, dispose = (staleResource) => {
      staleResource?.getTracks?.().forEach((track) => track.stop())
    }) {
      if (ownerRef?.current === operation && isCurrent(operation)) return true
      dispose(resource)
      return false
    },
    releaseOwner(operation, ownerRef) {
      if (ownerRef?.current === operation) ownerRef.current = null
      activeControllers.delete(operation?.controller)
    },
    runIfCurrent(operation, callback) {
      if (!isCurrent(operation)) return undefined
      return callback()
    },
    finish(operation) {
      activeControllers.delete(operation?.controller)
    },
    invalidate() {
      generation += 1
      activeControllers.forEach((controller) => controller.abort())
      activeControllers.clear()
    },
  }
}
