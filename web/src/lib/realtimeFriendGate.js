export async function authorizeIncomingFriend({ senderId, contacts = [], refreshFriends, inFlightRefreshes = new Map() }) {
  const queueKey = 'authoritative-friends'
  const known = contacts.find((contact) => !contact.isAi && contact.id === senderId)
  if (known) {
    const pendingRefresh = inFlightRefreshes.get(queueKey)
    if (pendingRefresh) await pendingRefresh.catch(() => undefined)
    return { contact: known, refreshed: false }
  }
  const previous = inFlightRefreshes.get(queueKey) || Promise.resolve()
  const refresh = previous.catch(() => undefined).then(refreshFriends)
  inFlightRefreshes.set(queueKey, refresh)
  const clear = () => {
    if (inFlightRefreshes.get(queueKey) === refresh) inFlightRefreshes.delete(queueKey)
  }
  void refresh.then(clear, clear)
  const authoritative = await refresh
  return {
    contact: authoritative.find((contact) => !contact.isAi && contact.id === senderId) || null,
    refreshed: true,
  }
}
