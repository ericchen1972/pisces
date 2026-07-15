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

function canonicalIdentityKind(message) {
  if (message?.role === 'assist_group') return 'assist_group'
  if (['user', 'peer', 'ai_proxy'].includes(message?.role)) return 'shared_message'
  return message?.role || ''
}

function hasSameCanonicalIdentity(first, second) {
  if (first?.id && second?.id && first.id === second.id) return true
  return Boolean(
    first?.requestId
    && second?.requestId
    && first.requestId === second.requestId
    && canonicalIdentityKind(first) === canonicalIdentityKind(second),
  )
}

export function reconcileCanonicalMessage(messages = [], placeholderId, canonicalMessage) {
  if (!canonicalMessage?.id) return messages
  const next = []
  let insertionIndex = -1
  messages.forEach((message) => {
    const matches = message?.id === placeholderId
      || hasSameCanonicalIdentity(message, canonicalMessage)
    if (matches) {
      if (insertionIndex < 0) insertionIndex = next.length
      return
    }
    next.push(message)
  })
  if (insertionIndex < 0) insertionIndex = next.length
  next.splice(insertionIndex, 0, canonicalMessage)
  return next
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

  const canonicalRecent = recentOrder.map((id) => recentById.get(id))
  const matchesRecent = (message) => canonicalRecent.some((recent) => hasSameCanonicalIdentity(message, recent))
  const overlapIndex = currentMessages.findIndex(matchesRecent)
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
    ? currentMessages.slice(overlapIndex).filter((message) => !matchesRecent(message))
    : pendingIndex >= 0 ? currentMessages.slice(pendingIndex) : []
  const canonicalTail = canonicalRecent.map((recent) => {
    const current = currentMessages.find((message) => hasSameCanonicalIdentity(message, recent))
    return current?.id === recent.id ? { ...current, ...recent } : recent
  })
  return [...prefix, ...canonicalTail, ...pendingTail]
}
