export function normalizeGroupName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US')
}

function timestampValue(value) {
  const timestamp = Date.parse(value || '')
  return Number.isFinite(timestamp) ? timestamp : 0
}

export function groupContacts(groups = [], contacts = [], defaultGroupId = '') {
  const result = Object.fromEntries(groups.map((group) => [group.id, []]))
  const available = new Set(Object.keys(result))
  const fallback = available.has(defaultGroupId) ? defaultGroupId : ''

  for (const contact of contacts) {
    if (!contact?.id || contact.isAi || contact.id === 'pisces-core') continue
    const groupId = available.has(contact.group_id) ? contact.group_id : fallback
    if (groupId) result[groupId].push(contact)
  }

  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  for (const group of groups) {
    result[group.id].sort((left, right) => {
      const byTime = timestampValue(right.last_message_at) - timestampValue(left.last_message_at)
      if (byTime) return byTime
      const byName = collator.compare(left.name || '', right.name || '')
      return byName || String(left.id).localeCompare(String(right.id))
    })
  }
  return result
}

export function unreadTotal(contacts = [], unreadByContact = {}) {
  return contacts.reduce((total, contact) => {
    const value = unreadByContact[contact?.id]
    return total + (Number.isInteger(value) && value >= 0 ? value : 0)
  }, 0)
}

export function shouldAutoMarkIncomingRead({ selectedContactId = '', conversationId = '', windowFocused = false } = {}) {
  return Boolean(conversationId && selectedContactId === conversationId && windowFocused)
}

export function unreadStateFromFriendsResponse(friendContacts = [], data = {}) {
  const unread = {
    'pisces-core': Math.max(0, Number(data?.convia?.unread_count) || 0),
  }
  for (const contact of friendContacts) {
    if (!contact?.id) continue
    unread[contact.id] = Number.isFinite(contact.unreadCount)
      ? Math.max(0, contact.unreadCount)
      : 0
  }
  return unread
}

export function contactGroupStateFromResponse(data = {}) {
  const groups = Array.isArray(data.groups) ? data.groups : []
  const candidate = typeof data.default_contact_group_id === 'string'
    ? data.default_contact_group_id.trim()
    : ''
  return {
    groups,
    defaultContactGroupId: groups.some((group) => group?.id === candidate) ? candidate : '',
  }
}

export function applyContactGroupAssignment(contacts = [], contactId, groupId) {
  return contacts.map((contact) => (
    contact?.id === contactId ? { ...contact, group_id: groupId } : contact
  ))
}

export function applyDeletedContactGroup(contacts = [], deletedGroupId, destinationGroupId) {
  return contacts.map((contact) => (
    contact?.group_id === deletedGroupId
      ? { ...contact, group_id: destinationGroupId }
      : contact
  ))
}

export async function applyLocalThenRefresh(applyLocal, refresh) {
  applyLocal()
  try {
    await refresh()
    return true
  } catch {
    return false
  }
}
