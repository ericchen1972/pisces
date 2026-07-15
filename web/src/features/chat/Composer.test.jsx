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

  it('shows recording state, attachment action, Assist toggle, and disabled send state', () => {
    const onAttachment = vi.fn()
    const onToggleAssist = vi.fn()
    const { rerender } = render(
      <Composer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        onAttachment={onAttachment}
        onToggleAssist={onToggleAssist}
        showAssist
        isRecording
        recordingElapsedMs={15000}
        maxRecordMs={30000}
        locale="en"
      />,
    )
    expect(screen.getByText('Recording 0:15')).toBeInTheDocument()
    rerender(
      <Composer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        onAttachment={onAttachment}
        onToggleAssist={onToggleAssist}
        showAssist
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    expect(screen.getByRole('textbox', { name: 'Attachment URL' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'AI Assist' }))
    expect(onToggleAssist).toHaveBeenCalled()
    rerender(<Composer value="hello" onChange={() => {}} onSend={() => {}} isSending />)
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
  })

  it('disables attachment when the current conversation has no attachment action', () => {
    render(<Composer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.getByRole('button', { name: 'Add attachment' })).toBeDisabled()
  })

  it('localizes the AI Assist control in zh-TW', () => {
    render(<Composer value="" onChange={() => {}} onSend={() => {}} onToggleAssist={() => {}} showAssist locale="zh-TW" />)
    expect(screen.getByRole('button', { name: 'AI 協助' })).toBeInTheDocument()
  })

  it('attaches a supported HTTPS image URL and allows attachment-only sending', () => {
    const onAttachment = vi.fn()
    const onSend = vi.fn()
    const { rerender } = render(<Composer value="" onChange={() => {}} onSend={onSend} onAttachment={onAttachment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Attachment URL' }), { target: { value: 'https://store.public.blob.vercel-storage.com/image.png' } })
    fireEvent.click(screen.getByRole('button', { name: 'Attach image' }))
    expect(onAttachment).toHaveBeenCalledWith({ kind: 'image', url: 'https://store.public.blob.vercel-storage.com/image.png' })
    rerender(
      <Composer
        value=""
        onChange={() => {}}
        onSend={onSend}
        onAttachment={onAttachment}
        attachment={{ kind: 'image', url: 'https://store.public.blob.vercel-storage.com/image.png' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('')
  })

  it('closes and resets attachment state when the callback becomes unavailable', () => {
    const onAttachment = vi.fn()
    const { rerender } = render(<Composer value="" onChange={() => {}} onSend={() => {}} onAttachment={onAttachment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    fireEvent.click(screen.getByRole('button', { name: 'Music' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Attachment URL' }), { target: { value: 'https://store.public.blob.vercel-storage.com/music.wav' } })
    rerender(<Composer value="" onChange={() => {}} onSend={() => {}} />)
    expect(screen.queryByRole('textbox', { name: 'Attachment URL' })).not.toBeInTheDocument()

    rerender(<Composer value="" onChange={() => {}} onSend={() => {}} onAttachment={onAttachment} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add attachment' }))
    expect(screen.getByRole('textbox', { name: 'Attachment URL' })).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Image' })).toHaveAttribute('aria-pressed', 'true')
  })
})
