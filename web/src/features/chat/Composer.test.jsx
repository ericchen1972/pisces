import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Composer from './Composer.jsx'

afterEach(cleanup)

describe('Composer', () => {
  it('does not send when Enter is pressed during Traditional Chinese composition', () => {
    const onSend = vi.fn()
    render(<Composer value="你好" onChange={() => {}} onSend={onSend} locale="zh-TW" />)
    const input = screen.getByRole('textbox')
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', isComposing: true, keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends trimmed text on Enter and preserves Shift+Enter', () => {
    const onSend = vi.fn()
    render(<Composer value="  hello  " onChange={() => {}} onSend={onSend} />)
    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello')
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', shiftKey: true })
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('shows recording state, keeps mic, hides attachment and Assist controls, and disables sending while busy', () => {
    const { rerender } = render(
      <Composer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        canRecord
        isRecording
        recordingElapsedMs={15000}
        maxRecordMs={30000}
        locale="en"
      />,
    )
    expect(screen.getByText('Recording 0:15')).toBeInTheDocument()
    rerender(
      <Composer
        value="hello"
        onChange={() => {}}
        onSend={() => {}}
        canRecord
      />,
    )
    expect(screen.getByRole('button', { name: 'Start recording' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add attachment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI Assist' })).not.toBeInTheDocument()
    rerender(<Composer value="hello" onChange={() => {}} onSend={() => {}} isSending />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('does not render attachment controls', () => {
    render(<Composer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Add attachment' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Attachment URL' })).not.toBeInTheDocument()
  })

  it('does not render the AI Assist control in zh-TW', () => {
    render(<Composer value="" onChange={() => {}} onSend={() => {}} locale="zh-TW" />)
    expect(screen.queryByRole('button', { name: 'AI 協助' })).not.toBeInTheDocument()
  })

  it('requires text before sending', () => {
    const onSend = vi.fn()
    render(<Composer value="" onChange={() => {}} onSend={onSend} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).not.toHaveBeenCalled()
  })
})
