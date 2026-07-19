import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
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
  delete window.google
})

describe('Google Identity initialization', () => {
  it('initializes the Google Identity client only once under React StrictMode', async () => {
    let initializedOptions
    const initialize = vi.fn()
    initialize.mockImplementation((options) => {
      initializedOptions = options
    })
    window.google = {
      accounts: {
        id: {
          initialize,
          renderButton: vi.fn(),
        },
      },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).endsWith('/api/auth/google')) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ ok: false }),
        }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, authenticated: false }),
      }
    })
    const language = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US')

    const firstRender = render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1))

    firstRender.unmount()
    language.mockReturnValue('zh-TW')
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    )

    await act(async () => {
      await initializedOptions.callback({ credential: 'new-render-credential' })
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Google 登入失敗。')
    expect(initialize).toHaveBeenCalledTimes(1)
  })

  it('enters the signed-in shell after a successful Google credential callback', async () => {
    let initializedOptions
    window.google = {
      accounts: {
        id: {
          initialize: vi.fn((options) => {
            initializedOptions = options
          }),
          renderButton: vi.fn(),
        },
      },
    }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = String(url)
      if (path.endsWith('/api/session/me')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, authenticated: false }),
        }
      }
      if (path.endsWith('/api/auth/google')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
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
          json: async () => ({ ok: true, groups: [{ id: 'friends', name: 'Friends', sort_order: 0 }], default_contact_group_id: 'friends' }),
        }
      }
      if (path.endsWith('/api/friends/list')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, friends: [] }),
        }
      }
      if (path.endsWith('/api/chat/mark-read')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        }
      }
      if (path.endsWith('/api/chat/history')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, messages: [] }),
        }
      }
      return {
        ok: false,
        status: 503,
        json: async () => ({ ok: false }),
      }
    })

    render(<App />)
    await waitFor(() => expect(window.google.accounts.id.initialize).toHaveBeenCalledTimes(1))

    await act(async () => {
      await initializedOptions.callback({ credential: 'valid-google-credential' })
    })

    expect(await screen.findByRole('navigation', { name: 'Contacts' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Voice call' })).toBeInTheDocument()
    expect(screen.queryByText('Select a conversation to start messaging')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
