import { StrictMode } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

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
})
