const DEFAULT_INTERVAL_MS = 30_000

export function createReconnectGate() {
  let hasConnected = false
  return {
    shouldReconcile() {
      if (!hasConnected) {
        hasConnected = true
        return false
      }
      return true
    },
  }
}

export function createRecipientReconciler({
  run,
  isVisible,
  windowTarget,
  documentTarget,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  let intervalId = null
  let activationTimeoutId = null
  let stopped = true
  let running = null
  let queued = false

  const runSafely = async () => {
    try {
      await run()
      return true
    } catch {
      return false
    }
  }

  const trigger = () => {
    if (stopped || !isVisible()) return Promise.resolve(false)
    if (running) {
      queued = true
      return running
    }
    running = (async () => {
      let succeeded = await runSafely()
      if (queued && !stopped && isVisible()) {
        queued = false
        succeeded = (await runSafely()) && succeeded
      }
      return succeeded
    })().finally(() => {
      running = null
      queued = false
    })
    return running
  }

  const scheduleActivation = () => {
    if (stopped || activationTimeoutId !== null) return
    activationTimeoutId = windowTarget.setTimeout(() => {
      activationTimeoutId = null
      void trigger()
    }, 0)
  }
  const onFocus = scheduleActivation
  const onVisibility = () => { if (isVisible()) scheduleActivation() }

  return {
    trigger,
    start() {
      if (!stopped) return
      stopped = false
      windowTarget.addEventListener('focus', onFocus)
      documentTarget.addEventListener('visibilitychange', onVisibility)
      intervalId = windowTarget.setInterval(() => { void trigger() }, intervalMs)
    },
    stop() {
      if (stopped) return
      stopped = true
      queued = false
      windowTarget.removeEventListener('focus', onFocus)
      documentTarget.removeEventListener('visibilitychange', onVisibility)
      if (intervalId !== null) windowTarget.clearInterval(intervalId)
      if (activationTimeoutId !== null) windowTarget.clearTimeout(activationTimeoutId)
      intervalId = null
      activationTimeoutId = null
    },
  }
}

export async function reconcileRecipientSnapshot({
  snapshot,
  isCurrent,
  refreshSidebar,
  refreshHistory,
}) {
  await refreshSidebar(snapshot)
  if (!isCurrent(snapshot) || !snapshot.human || !snapshot.contactId) return false
  await refreshHistory(snapshot.contactId, snapshot)
  return isCurrent(snapshot)
}

export function mergeCanonicalHistoryTail(currentMessages = [], recentMessages = []) {
  const recentById = new Map()
  const recentOrder = []
  recentMessages.forEach((message) => {
    if (!message?.id) return
    if (!recentById.has(message.id)) recentOrder.push(message.id)
    recentById.set(message.id, message)
  })
  if (!recentOrder.length) return currentMessages

  const currentById = new Map(
    currentMessages.filter((message) => message?.id).map((message) => [message.id, message]),
  )
  const overlapIndex = currentMessages.findIndex((message) => recentById.has(message?.id))
  const pendingIndex = overlapIndex < 0
    ? currentMessages.findIndex((message) => (
        (message?.status && message.status !== 'complete')
        || String(message?.audioUrl || '').startsWith('blob:')
      ))
    : -1
  const prefix = overlapIndex >= 0
    ? currentMessages.slice(0, overlapIndex)
    : pendingIndex >= 0 ? currentMessages.slice(0, pendingIndex) : currentMessages
  const pendingTail = overlapIndex >= 0
    ? currentMessages.slice(overlapIndex).filter((message) => !recentById.has(message?.id))
    : pendingIndex >= 0 ? currentMessages.slice(pendingIndex) : []
  const canonicalTail = recentOrder.map((id) => ({ ...currentById.get(id), ...recentById.get(id) }))
  return [...prefix, ...canonicalTail, ...pendingTail]
}
