import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiCallOverlay from './AiCallOverlay.jsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('AiCallOverlay', () => {
  it('renders the AI voice disclosure and call controls', () => {
    const onHangUp = vi.fn()
    render(<AiCallOverlay locale="en" name="Convia AI" avatar="/ai.png" status="connected" elapsedSeconds={62} onHangUp={onHangUp} />)
    expect(screen.getByText('1:02')).toBeInTheDocument()
    expect(screen.getByText('AI-generated voice')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hang up' }))
    expect(onHangUp).toHaveBeenCalledOnce()
  })

  it('offers an explicit retry after microphone permission denial', () => {
    const onRetry = vi.fn()
    render(<AiCallOverlay locale="en" name="Convia AI" status="error" error={{ code: 'microphone_denied' }} onRetry={onRetry} />)
    expect(screen.getByText('Microphone access is required.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('traps focus, closes on Escape, restores the page, and isolates the background', async () => {
    const onHangUp = vi.fn()
    const { container, rerender } = render(<button type="button">Before call</button>)
    const before = screen.getByRole('button', { name: 'Before call' })
    before.focus()

    rerender(
      <>
        <button type="button">Before call</button>
        <AiCallOverlay locale="en" name="Convia AI" status="connected" onHangUp={onHangUp} />
      </>,
    )

    const dialog = screen.getByRole('dialog')
    const hangUp = screen.getByRole('button', { name: 'Hang up' })
    const mute = screen.getByRole('button', { name: 'Mute' })
    await waitFor(() => expect(hangUp).toHaveFocus())
    expect(document.body.style.overflow).toBe('hidden')
    expect(container).toHaveAttribute('inert')
    expect(container).toHaveAttribute('aria-hidden', 'true')

    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(mute).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(hangUp).toHaveFocus()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onHangUp).toHaveBeenCalledOnce()

    rerender(<button type="button">Before call</button>)
    expect(screen.getByRole('button', { name: 'Before call' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
    expect(container).not.toHaveAttribute('inert')
    expect(container).not.toHaveAttribute('aria-hidden')
  })

  it('resets the call timer when a retry starts connecting', () => {
    vi.useFakeTimers()
    const { rerender } = render(<AiCallOverlay locale="en" name="Convia AI" status="connected" />)
    act(() => vi.advanceTimersByTime(2_000))
    expect(screen.getByText('0:02')).toBeInTheDocument()

    rerender(<AiCallOverlay locale="en" name="Convia AI" status="connecting" />)
    rerender(<AiCallOverlay locale="en" name="Convia AI" status="connected" />)

    expect(screen.getByText('0:00')).toBeInTheDocument()
    act(() => vi.advanceTimersByTime(1_000))
    expect(screen.getByText('0:01')).toBeInTheDocument()
  })
})
