import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShell from './ChatShell.jsx'
import ContactSidebar from './ContactSidebar.jsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const groups = [
  { id: 'family', name: 'Family', sort_order: 0 },
  { id: 'friends', name: 'Friends', sort_order: 1 },
]

const contacts = [
  { id: 'a', name: 'Amy Adams', avatar_url: 'https://lh3.googleusercontent.com/a', group_id: 'family', last_message_at: '2026-07-15T01:00:00Z' },
  { id: 'b', name: 'Ben', avatar_url: 'https://lh3.googleusercontent.com/b', group_id: 'family', last_message_at: '2026-07-15T02:00:00Z' },
]

describe('ContactSidebar', () => {
  it('renders the required order, group totals, contact totals, and latest-first contacts', () => {
    render(
      <ContactSidebar
        locale="en"
        groups={groups}
        contacts={contacts}
        unreadByContact={{ a: 2, b: 3 }}
        defaultGroupId="friends"
        currentUser={{ display_name: 'Eric', avatar_url: 'https://lh3.googleusercontent.com/me' }}
      />,
    )

    const navigation = screen.getByRole('navigation', { name: 'Contacts' })
    expect(navigation).toHaveTextContent('Convia')
    expect(screen.getByRole('button', { name: 'Chat with Convia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Family, 5 unread messages')).toBeInTheDocument()
    expect(screen.getByLabelText('Ben, 3 unread messages')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.indexOf(screen.getByRole('button', { name: 'Chat with Convia' }))).toBeLessThan(
      buttons.indexOf(screen.getByRole('button', { name: 'Ben, 3 unread messages' })),
    )
    expect(screen.getByText('Ben').compareDocumentPosition(screen.getByText('Amy Adams')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('falls back from a broken Google avatar to initials', () => {
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" />)
    fireEvent.error(screen.getByRole('img', { name: 'Amy Adams' }))
    expect(screen.getByLabelText('Amy Adams avatar')).toHaveTextContent('AA')
  })

  it('resets a real contact avatar failure when the Google avatar URL changes', () => {
    const { rerender } = render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" />)
    fireEvent.error(screen.getByRole('img', { name: 'Amy Adams' }))
    expect(screen.getByLabelText('Amy Adams avatar')).toHaveTextContent('AA')

    rerender(<ContactSidebar locale="en" groups={groups} contacts={[{ ...contacts[0], avatar_url: 'https://lh3.googleusercontent.com/new' }]} defaultGroupId="friends" />)
    expect(screen.getByRole('img', { name: 'Amy Adams' })).toHaveAttribute('src', 'https://lh3.googleusercontent.com/new')
  })

  it('renders the configured Convia avatar and the bundled AI fallback', () => {
    const configuredAi = { id: 'pisces-core', name: 'Convia', isAi: true, avatar: '/images/custom-ai.webp' }
    const { rerender } = render(<ContactSidebar locale="en" groups={groups} contacts={[configuredAi]} defaultGroupId="friends" />)
    const aiAvatar = screen.getByRole('img', { name: 'Convia' })
    expect(aiAvatar).toHaveAttribute('src', '/images/custom-ai.webp')
    fireEvent.error(aiAvatar)
    expect(screen.getByRole('img', { name: 'Convia' })).toHaveAttribute('src', '/images/fish.png')

    rerender(<ContactSidebar locale="en" groups={groups} contacts={[{ ...configuredAi, avatar: '/images/new-ai.webp' }]} defaultGroupId="friends" />)
    expect(screen.getByRole('img', { name: 'Convia' })).toHaveAttribute('src', '/images/new-ai.webp')

    rerender(<ContactSidebar locale="en" groups={groups} contacts={[]} defaultGroupId="friends" />)
    expect(screen.getByRole('img', { name: 'Convia' })).toHaveAttribute('src', '/images/fish.png')
  })

  it('uses initials, never the AI fish fallback, when a real contact has no Google avatar', () => {
    render(<ContactSidebar locale="en" groups={groups} contacts={[{ id: 'missing', name: 'Missing Person', group_id: 'family' }]} defaultGroupId="friends" />)
    expect(screen.getByLabelText('Missing Person avatar')).toHaveTextContent('MP')
    expect(screen.queryByRole('img', { name: 'Missing Person' })).not.toBeInTheDocument()
  })

  it('lets a contact move to exactly one different group', async () => {
    const user = userEvent.setup()
    let rerenderSidebar
    const onMoveContact = vi.fn(async () => {
      rerenderSidebar(<ContactSidebar locale="en" groups={groups} contacts={[{ ...contacts[0], group_id: 'friends' }]} defaultGroupId="friends" onMoveContact={onMoveContact} />)
    })
    const view = render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onMoveContact={onMoveContact} />)
    rerenderSidebar = view.rerender
    const trigger = screen.getByRole('button', { name: 'Contact options for Amy Adams' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Move Amy Adams to Friends' }))
    expect(onMoveContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'friends')
    const relocatedTrigger = await screen.findByRole('button', { name: 'Contact options for Amy Adams' })
    expect(relocatedTrigger).not.toBe(trigger)
    await waitFor(() => expect(relocatedTrigger).toHaveFocus())
  })

  it('offers edit, move, and confirmed delete in each real-contact overflow only', async () => {
    const user = userEvent.setup()
    const onEditContact = vi.fn()
    const onDeleteContact = vi.fn().mockResolvedValue(true)
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onEditContact={onEditContact} onMoveContact={() => {}} onDeleteContact={onDeleteContact} />)

    expect(screen.queryByRole('button', { name: 'Contact options for Convia' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Contact options for Amy Adams' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit Amy Adams' }))
    expect(onEditContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))

    await user.click(screen.getByRole('button', { name: 'Contact options for Amy Adams' }))
    await user.click(screen.getByRole('menuitem', { name: 'Delete Amy Adams' }))
    expect(screen.getByRole('dialog', { name: 'Delete Amy Adams?' })).toBeInTheDocument()
    expect(onDeleteContact).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm delete Amy Adams' }))
    expect(onDeleteContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('gives edit and delete dialogs a stable trigger focus owner before opening', async () => {
    const user = userEvent.setup()
    const onEditContact = vi.fn(() => expect(screen.getByRole('button', { name: 'Contact options for Amy Adams' })).toHaveFocus())
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onEditContact={onEditContact} onDeleteContact={async () => true} />)
    const trigger = screen.getByRole('button', { name: 'Contact options for Amy Adams' })
    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Edit Amy Adams' }))
    expect(onEditContact).toHaveBeenCalledOnce()

    await user.click(trigger)
    await user.click(screen.getByRole('menuitem', { name: 'Delete Amy Adams' }))
    expect(trigger).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(trigger).toHaveFocus()
  })

  it('portals the contact menu, focuses it, closes on Escape/outside, and restores its trigger', async () => {
    const user = userEvent.setup()
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onEditContact={() => {}} onMoveContact={() => {}} onDeleteContact={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Contact options for Amy Adams' })

    await user.click(trigger)
    const menu = screen.getByRole('menu', { name: 'Contact options for Amy Adams' })
    expect(menu.parentElement).toBe(document.body)
    expect(within(menu).getByRole('menuitem', { name: 'Edit Amy Adams' })).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())

    await user.click(trigger)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('flips and clamps a portaled menu inside the viewport instead of sidebar scrolling', async () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.tagName === 'BUTTON' && this.getAttribute?.('aria-label') === 'Contact options for Amy Adams') return { top: 730, bottom: 766, left: 990, right: 1026, width: 36, height: 36, x: 990, y: 730, toJSON() {} }
      if (this.getAttribute?.('role') === 'menu') return { top: 0, bottom: 160, left: 0, right: 180, width: 180, height: 160, x: 0, y: 0, toJSON() {} }
      return originalRect.call(this)
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
    const user = userEvent.setup()
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onEditContact={() => {}} onMoveContact={() => {}} onDeleteContact={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Contact options for Amy Adams' }))
    const menu = screen.getByRole('menu')
    expect(menu).toHaveAttribute('data-placement', 'top')
    expect(Number.parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8)
    expect(Number.parseFloat(menu.style.left) + 180).toBeLessThanOrEqual(1016)
  })

  it('localizes AI unread and avatar fallback accessibility copy in zh-TW', () => {
    render(<ContactSidebar locale="zh-TW" groups={groups} contacts={[{ ...contacts[0], avatar_url: '' }, { id: 'pisces-core', name: 'Convia', isAi: true }]} unreadByContact={{ a: 1, 'pisces-core': 2 }} defaultGroupId="friends" />)
    expect(screen.getByLabelText('Convia 有 2 則未讀訊息')).toBeInTheDocument()
    expect(screen.getByLabelText('Amy Adams 頭像')).toHaveTextContent('AA')
    expect(screen.getByLabelText('Family，1 則未讀訊息')).toBeInTheDocument()
    expect(screen.getByLabelText('Amy Adams，1 則未讀訊息')).toBeInTheDocument()
  })
})

describe('ChatShell', () => {
  it('opens its mobile drawer, closes after selection, and restores focus to the menu button', async () => {
    const user = userEvent.setup()
    render(
      <ChatShell sidebar={<button type="button" data-close-drawer onClick={() => {}}>Amy</button>}>
        <p>Conversation</p>
      </ChatShell>,
    )
    const menu = screen.getByRole('button', { name: 'Open contacts' })
    await user.click(menu)
    const drawer = screen.getByTestId('mobile-drawer')
    expect(drawer).toHaveAttribute('data-open', 'true')
    expect(drawer).toHaveAttribute('role', 'dialog')
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByTestId('chat-main')).toHaveAttribute('inert')
    await waitFor(() => expect(within(drawer).getByRole('button', { name: 'Close contacts' })).toHaveFocus())
    await user.click(within(drawer).getByRole('button', { name: 'Amy' }))
    expect(screen.getByTestId('mobile-drawer')).toHaveAttribute('data-open', 'false')
    await waitFor(() => expect(menu).toHaveFocus())
  })

  it('closes its mobile drawer with Escape', async () => {
    const user = userEvent.setup()
    render(<ChatShell sidebar={<p>Sidebar</p>}><p>Conversation</p></ChatShell>)
    await user.click(screen.getByRole('button', { name: 'Open contacts' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('mobile-drawer')).toHaveAttribute('data-open', 'false')
  })

  it('lets a portaled contact menu consume Escape before the mobile drawer', async () => {
    const user = userEvent.setup()
    render(<ChatShell sidebar={<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onEditContact={() => {}} />}><p>Conversation</p></ChatShell>)
    await user.click(screen.getByRole('button', { name: 'Open contacts' }))
    const drawer = screen.getByTestId('mobile-drawer')
    await user.click(within(drawer).getByRole('button', { name: 'Contact options for Amy Adams' }))
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(drawer).toHaveAttribute('data-open', 'true')
  })

  it('leaves post-move focus restoration to the mobile drawer owner', async () => {
    const user = userEvent.setup()
    render(<ChatShell sidebar={<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onMoveContact={async () => {}} />}><p>Conversation</p></ChatShell>)
    const openContacts = screen.getByRole('button', { name: 'Open contacts' })
    await user.click(openContacts)
    const drawer = screen.getByTestId('mobile-drawer')
    await user.click(within(drawer).getByRole('button', { name: 'Contact options for Amy Adams' }))
    await user.click(screen.getByRole('menuitem', { name: 'Move Amy Adams to Friends' }))
    await waitFor(() => expect(openContacts).toHaveFocus())
  })

  it('traps forward and reverse Tab focus inside the open drawer', async () => {
    const user = userEvent.setup()
    render(<ChatShell sidebar={<button type="button" data-close-drawer>Amy</button>}><button type="button">Conversation action</button></ChatShell>)
    await user.click(screen.getByRole('button', { name: 'Open contacts' }))
    const drawer = screen.getByTestId('mobile-drawer')
    const close = within(drawer).getByRole('button', { name: 'Close contacts' })
    const last = within(drawer).getByRole('button', { name: 'Amy' })
    await waitFor(() => expect(close).toHaveFocus())
    fireEvent.keyDown(drawer, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()
    fireEvent.keyDown(drawer, { key: 'Tab' })
    expect(close).toHaveFocus()
  })

  it('removes drawer modalization when the viewport changes to desktop', async () => {
    const listeners = new Set()
    const media = {
      matches: true,
      addEventListener: (_event, listener) => listeners.add(listener),
      removeEventListener: (_event, listener) => listeners.delete(listener),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const user = userEvent.setup()
    render(<ChatShell sidebar={<button type="button">Amy</button>}><button type="button">Conversation action</button></ChatShell>)
    await user.click(screen.getByRole('button', { name: 'Open contacts' }))
    expect(screen.getByTestId('chat-main')).toHaveAttribute('inert')

    media.matches = false
    act(() => listeners.forEach((listener) => listener({ matches: false })))

    await waitFor(() => expect(screen.getByTestId('chat-main')).not.toHaveAttribute('inert'))
    expect(screen.getByTestId('mobile-drawer')).toHaveAttribute('data-open', 'false')
  })
})
