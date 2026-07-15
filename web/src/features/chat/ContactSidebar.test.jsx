import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChatShell from './ChatShell.jsx'
import ContactSidebar from './ContactSidebar.jsx'

afterEach(() => {
  cleanup()
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
    expect(screen.getByRole('button', { name: 'Chat with Convia AI' })).toBeInTheDocument()
    expect(screen.getByLabelText('Family, 5 unread messages')).toBeInTheDocument()
    expect(screen.getByLabelText('Ben, 3 unread messages')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button')
    expect(buttons.indexOf(screen.getByRole('button', { name: 'Chat with Convia AI' }))).toBeLessThan(
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

  it('renders the configured Convia AI avatar and the bundled AI fallback', () => {
    const configuredAi = { id: 'pisces-core', name: 'Convia AI', isAi: true, avatar: '/images/custom-ai.webp' }
    const { rerender } = render(<ContactSidebar locale="en" groups={groups} contacts={[configuredAi]} defaultGroupId="friends" />)
    const aiAvatar = screen.getByRole('img', { name: 'Convia AI' })
    expect(aiAvatar).toHaveAttribute('src', '/images/custom-ai.webp')
    fireEvent.error(aiAvatar)
    expect(screen.getByRole('img', { name: 'Convia AI' })).toHaveAttribute('src', '/images/fish.png')

    rerender(<ContactSidebar locale="en" groups={groups} contacts={[{ ...configuredAi, avatar: '/images/new-ai.webp' }]} defaultGroupId="friends" />)
    expect(screen.getByRole('img', { name: 'Convia AI' })).toHaveAttribute('src', '/images/new-ai.webp')

    rerender(<ContactSidebar locale="en" groups={groups} contacts={[]} defaultGroupId="friends" />)
    expect(screen.getByRole('img', { name: 'Convia AI' })).toHaveAttribute('src', '/images/fish.png')
  })

  it('uses initials, never the AI fish fallback, when a real contact has no Google avatar', () => {
    render(<ContactSidebar locale="en" groups={groups} contacts={[{ id: 'missing', name: 'Missing Person', group_id: 'family' }]} defaultGroupId="friends" />)
    expect(screen.getByLabelText('Missing Person avatar')).toHaveTextContent('MP')
    expect(screen.queryByRole('img', { name: 'Missing Person' })).not.toBeInTheDocument()
  })

  it('lets a contact move to exactly one different group', async () => {
    const user = userEvent.setup()
    const onMoveContact = vi.fn()
    render(<ContactSidebar locale="en" groups={groups} contacts={contacts.slice(0, 1)} defaultGroupId="friends" onMoveContact={onMoveContact} />)
    await user.click(screen.getByRole('button', { name: 'Move Amy Adams' }))
    await user.click(screen.getByRole('button', { name: 'Move Amy Adams to Friends' }))
    expect(onMoveContact).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 'friends')
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
