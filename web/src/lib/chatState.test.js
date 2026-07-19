import { describe, expect, it } from 'vitest'
import {
  applyContactGroupAssignment,
  applyDeletedContactGroup,
  applyLocalThenRefresh,
  contactGroupStateFromResponse,
  groupContacts,
  normalizeGroupName,
  shouldAutoMarkIncomingRead,
  unreadStateFromFriendsResponse,
  unreadTotal,
} from './chatState.js'

describe('groupContacts', () => {
  it('returns every group and sorts contacts by latest message then name', () => {
    const groups = [
      { id: 'family', sort_order: 0 },
      { id: 'work', sort_order: 1 },
    ]
    const contacts = [
      { id: 'old', name: 'Zed', group_id: 'family', last_message_at: '2026-07-14T00:00:00Z' },
      { id: 'new-b', name: 'Beta', group_id: 'family', last_message_at: '2026-07-15T00:00:00Z' },
      { id: 'new-a', name: 'Alpha', group_id: 'family', last_message_at: '2026-07-15T00:00:00Z' },
    ]

    const result = groupContacts(groups, contacts, 'work')

    expect(result.family.map((contact) => contact.id)).toEqual(['new-a', 'new-b', 'old'])
    expect(result.work).toEqual([])
  })

  it('uses the default group for missing or invalid assignments and excludes AI', () => {
    const groups = [{ id: 'others' }, { id: 'friends' }]
    const contacts = [
      { id: 'unassigned', name: 'A' },
      { id: 'stale', name: 'B', group_id: 'deleted' },
      { id: 'pisces-core', name: 'Convia AI', isAi: true },
    ]

    const result = groupContacts(groups, contacts, 'others')

    expect(result.others.map((contact) => contact.id)).toEqual(['unassigned', 'stale'])
    expect(Object.values(result).flat()).not.toEqual(expect.arrayContaining([expect.objectContaining({ isAi: true })]))
  })

  it('does not invent a first-group assignment when the authoritative default is empty', () => {
    const groups = [{ id: 'first' }, { id: 'second' }]
    const result = groupContacts(groups, [{ id: 'unassigned', name: 'Unassigned' }], '')

    expect(result).toEqual({ first: [], second: [] })
  })

  it('does not invent a first-group assignment when the authoritative default is stale', () => {
    const groups = [{ id: 'first' }, { id: 'second' }]
    const result = groupContacts(groups, [{ id: 'unassigned', name: 'Unassigned' }], 'deleted')

    expect(result).toEqual({ first: [], second: [] })
  })
})

describe('unreadTotal', () => {
  it('sums only non-negative integer unread values for the supplied contacts', () => {
    const contacts = [{ id: 'old' }, { id: 'new' }, { id: 'invalid' }, { id: 'negative' }]
    expect(unreadTotal(contacts, { old: 2, new: 3, invalid: 1.5, negative: -4, unrelated: 9 })).toBe(5)
  })
})

describe('shouldAutoMarkIncomingRead', () => {
  it('only marks the selected conversation as read when the window is focused', () => {
    expect(shouldAutoMarkIncomingRead({
      selectedContactId: 'pisces-core',
      conversationId: 'pisces-core',
      windowFocused: true,
    })).toBe(true)

    expect(shouldAutoMarkIncomingRead({
      selectedContactId: 'pisces-core',
      conversationId: 'pisces-core',
      windowFocused: false,
    })).toBe(false)

    expect(shouldAutoMarkIncomingRead({
      selectedContactId: 'judy',
      conversationId: 'pisces-core',
      windowFocused: true,
    })).toBe(false)
  })
})

describe('unreadStateFromFriendsResponse', () => {
  it('hydrates durable Convia unread state together with friend unread counts', () => {
    const contacts = [
      { id: 'judy', unreadCount: 2 },
      { id: 'eric', unreadCount: 0 },
    ]

    expect(unreadStateFromFriendsResponse(contacts, { convia: { unread_count: 3 } })).toEqual({
      'pisces-core': 3,
      judy: 2,
      eric: 0,
    })
  })
})

it('normalizes group names for duplicate detection', () => {
  expect(normalizeGroupName('  ＦＡＭＩＬＹ   Team  ')).toBe('family team')
})

it('uses the server default even when custom reordered groups do not place it last', () => {
  expect(contactGroupStateFromResponse({
    groups: [
      { id: 'business', sort_order: 0 },
      { id: 'home', sort_order: 1 },
      { id: 'friends', sort_order: 2 },
    ],
    default_contact_group_id: 'home',
  })).toEqual({
    groups: [
      { id: 'business', sort_order: 0 },
      { id: 'home', sort_order: 1 },
      { id: 'friends', sort_order: 2 },
    ],
    defaultContactGroupId: 'home',
  })
})

it('does not guess a default when the response omits authoritative state', () => {
  expect(contactGroupStateFromResponse({ groups: [{ id: 'first' }, { id: 'last' }] }).defaultContactGroupId).toBe('')
})

it('keeps an authoritative contact assignment when the friend refresh fails', async () => {
  let contacts = [{ id: 'amy', group_id: 'family' }]
  const refreshed = await applyLocalThenRefresh(
    () => { contacts = applyContactGroupAssignment(contacts, 'amy', 'friends') },
    () => Promise.reject(new Error('offline')),
  )

  expect(refreshed).toBe(false)
  expect(contacts).toEqual([{ id: 'amy', group_id: 'friends' }])
})

it('keeps non-default group deletion moves when the friend refresh fails', async () => {
  let contacts = [
    { id: 'amy', group_id: 'work' },
    { id: 'ben', group_id: 'family' },
  ]
  const refreshed = await applyLocalThenRefresh(
    () => { contacts = applyDeletedContactGroup(contacts, 'work', 'friends') },
    () => Promise.reject(new Error('offline')),
  )

  expect(refreshed).toBe(false)
  expect(contacts).toEqual([
    { id: 'amy', group_id: 'friends' },
    { id: 'ben', group_id: 'family' },
  ])
})
