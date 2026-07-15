import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Dialog from './Dialog.jsx'

afterEach(cleanup)

describe('Dialog', () => {
  it('is labelled, captures focus, closes on Escape, and restores prior focus', async () => {
    const onClose = vi.fn()
    const { rerender } = render(<button type="button">Before</button>)
    const before = screen.getByRole('button', { name: 'Before' })
    before.focus()
    rerender(
      <>
        <button type="button">Before</button>
        <Dialog open title="Manage groups" onClose={onClose}>
          <button type="button">Inside</button>
        </Dialog>
      </>,
    )
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Manage groups')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Inside' })).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<button type="button">Before</button>)
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus()
  })

  it('closes from the backdrop only when backdrop closing is allowed', () => {
    const onClose = vi.fn()
    const { rerender } = render(<Dialog open title="One" onClose={onClose}>Body</Dialog>)
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'))
    expect(onClose).toHaveBeenCalledWith('backdrop')

    onClose.mockClear()
    rerender(<Dialog open title="Two" onClose={onClose} closeOnBackdrop={false}>Body</Dialog>)
    fireEvent.mouseDown(screen.getByTestId('dialog-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })
})
