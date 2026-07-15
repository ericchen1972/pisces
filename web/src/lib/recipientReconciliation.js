const DEFAULT_INTERVAL_MS = 30_000

export function createRecipientReconciler({
  run,
  isVisible,
  windowTarget,
  documentTarget,
  intervalMs = DEFAULT_INTERVAL_MS,
}) {
  let intervalId = null
  let stopped = true
  let running = null
  let queued = false

  const trigger = () => {
    if (stopped || !isVisible()) return Promise.resolve(false)
    if (running) {
      queued = true
      return running
    }
    running = (async () => {
      await run()
      if (queued && !stopped && isVisible()) {
        queued = false
        await run()
      }
      return true
    })().finally(() => {
      running = null
      queued = false
    })
    return running
  }

  const onFocus = () => { void trigger() }
  const onVisibility = () => { if (isVisible()) void trigger() }

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
      intervalId = null
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
