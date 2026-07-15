export function createOwnedObjectUrlRegistry(revoke = (url) => URL.revokeObjectURL(url)) {
  const owned = new Map()

  const release = (url) => {
    if (!url || !owned.has(url)) return false
    owned.delete(url)
    revoke(url)
    return true
  }

  return {
    own(url, metadata) {
      if (url) owned.set(url, { ...metadata })
      return url
    },
    release,
    replace(localUrl, replacementUrl) {
      if (localUrl !== replacementUrl) release(localUrl)
      return replacementUrl
    },
    reconcileContact(contactId, messages = []) {
      const retained = new Set(messages.map((message) => message?.audioUrl).filter(Boolean))
      for (const [url, metadata] of [...owned]) {
        if (metadata.contactId === contactId && !retained.has(url)) release(url)
      }
    },
    releaseContact(contactId) {
      for (const [url, metadata] of [...owned]) {
        if (metadata.contactId === contactId) release(url)
      }
    },
    releaseAll() {
      for (const url of [...owned.keys()]) release(url)
    },
  }
}

export function discardRecordedMessage(messages = [], messageId) {
  return messages.filter((message) => message?.id !== messageId)
}
