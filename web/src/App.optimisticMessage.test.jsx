import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

vi.mock('ably', () => ({
  Realtime: class {
    connection = { on: vi.fn() }
    channels = {
      get: vi.fn(() => ({
        subscribe: vi.fn(),
        unsubscribe: vi.fn(),
      })),
    }
    close = vi.fn()
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('optimistic message rendering', () => {
  it('shows a sent human-contact text before the API confirms it and reconciles the canonical message', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })))
    const user = userEvent.setup()
    let resolveSend
    let sentRequestId = ''
    const sendResponse = new Promise((resolve) => {
      resolveSend = resolve
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, options = {}) => {
      const path = String(url)
      if (path.endsWith('/api/session/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            authenticated: true,
            user: {
              id: 'user-a',
              display_name: 'Eric Chen',
              email: 'eric@example.com',
              history_range: 30,
              ai_settings: {},
            },
          }),
        }
      }
      if (path.endsWith('/api/contact-groups/bootstrap')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            groups: [{ id: 'friends', name: 'Friends', sort_order: 0 }],
            default_contact_group_id: 'friends',
          }),
        }
      }
      if (path.endsWith('/api/friends/list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            friends: [{ id: 'friend-a', name: 'Judy', group_id: 'friends' }],
          }),
        }
      }
      if (path.endsWith('/api/chat/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messages: [] }),
        }
      }
      if (path.endsWith('/api/messages/send')) {
        sentRequestId = JSON.parse(options?.body || '{}').request_id || ''
        return sendResponse
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({ ok: false }),
      }
    })

    render(<App />)

    await user.click(await screen.findByRole('button', { name: 'Open contacts' }))
    let drawer = screen.getByTestId('mobile-drawer')
    await user.click(within(drawer).getByRole('button', { name: 'Chat with Convia' }))
    expect(await screen.findByRole('button', { name: 'Edit Convia' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Open contacts' }))
    drawer = screen.getByTestId('mobile-drawer')
    await user.click(within(drawer).getByRole('button', { name: 'Judy' }))
    expect(await screen.findByRole('button', { name: 'Edit Judy' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled())
    await user.type(screen.getByRole('textbox', { name: 'Message' }), 'Convia, 可是我聽說週末會下大雨耶')
    await user.click(screen.getByRole('button', { name: 'Send message' }))

    const messages = screen.getByTestId('conversation-messages')
    expect(await within(messages).findByText('Convia, 可是我聽說週末會下大雨耶')).toBeInTheDocument()

    resolveSend({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        message: {
          message_id: 'server-message-1',
          client_request_id: sentRequestId,
          role: 'user',
          text: 'Convia, 可是我聽說週末會下大雨耶',
        },
        convia_message: {
          message_id: 'server-convia-1',
          client_request_id: 'convia-1',
          sender_mode: 'ai_proxy',
          text: '可以先準備雨天備案。',
        },
      }),
    })

    expect(await within(messages).findByText('可以先準備雨天備案。')).toBeInTheDocument()
    expect(within(messages).getAllByText('Convia, 可是我聽說週末會下大雨耶')).toHaveLength(1)
  })
})
