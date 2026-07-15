import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiSettingsDialog, { OPENAI_VOICE_OPTIONS, VOICE_PREVIEW_TEXT } from './AiSettingsDialog.jsx'

afterEach(cleanup)

describe('AiSettingsDialog', () => {
  const form = { alias: 'Convia AI', avatar: '/avatar.png', openaiVoice: 'marin', globalPrompt: 'Be kind.' }

  it('offers only approved OpenAI voices and discloses AI-generated speech', () => {
    render(<AiSettingsDialog open locale="en" form={form} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByText('AI-generated voice')).toBeInTheDocument()
    const options = [...screen.getByLabelText('Voice').querySelectorAll('option')].map((option) => option.value)
    expect(options).toEqual(OPENAI_VOICE_OPTIONS)
    expect(options).not.toContain('Achernar')
  })

  it('previews a fixed safe phrase through the TTS endpoint', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, audio_base64: 'UklGRg==', audio_mime_type: 'audio/wav' }) })
    const play = vi.fn().mockResolvedValue(undefined)
    const audioFactory = vi.fn(() => ({ play }))
    render(<AiSettingsDialog open locale="en" form={form} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} apiBaseUrl="https://api.example" fetchImpl={fetchImpl} audioFactory={audioFactory} />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ text: VOICE_PREVIEW_TEXT.en, voice: 'marin', instructions: 'Warm, natural, conversational delivery.' })
    expect(audioFactory).toHaveBeenCalledWith(expect.stringMatching(/^data:audio\/wav;base64,/))
    expect(play).toHaveBeenCalledOnce()
  })

  it('advertises and forwards WebP avatar input for preview processing', () => {
    const onAvatarPick = vi.fn()
    const { container } = render(<AiSettingsDialog open locale="en" form={form} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} onAvatarPick={onAvatarPick} />)
    const input = container.ownerDocument.body.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    const file = new File(['webp'], 'avatar.webp', { type: 'image/webp' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onAvatarPick).toHaveBeenCalled()
  })

  it('keeps preview busy until playback ends and releases the audio element', async () => {
    const audio = new EventTarget()
    audio.play = vi.fn().mockResolvedValue(undefined)
    audio.pause = vi.fn()
    audio.removeAttribute = vi.fn()
    audio.load = vi.fn()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, audio_base64: 'UklGRg==', audio_mime_type: 'audio/wav' }) })
    render(<AiSettingsDialog open locale="en" form={form} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} fetchImpl={fetchImpl} audioFactory={() => audio} />)

    fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Previewing…' })).toBeDisabled())
    expect(audio.play).toHaveBeenCalledOnce()

    audio.dispatchEvent(new Event('ended'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Preview voice' })).toBeEnabled())
    expect(audio.pause).toHaveBeenCalledOnce()
    expect(audio.removeAttribute).toHaveBeenCalledWith('src')
    expect(audio.load).toHaveBeenCalledOnce()
  })

  it('aborts and ignores a stale preview when the dialog closes or account changes', async () => {
    let resolveFetch
    const fetchImpl = vi.fn((_url, options) => new Promise((resolve) => {
      resolveFetch = resolve
      expect(options.signal).toBeInstanceOf(AbortSignal)
    }))
    const audioFactory = vi.fn()
    const props = { locale: 'en', form, onFormChange: () => {}, onSave: () => {}, onClose: () => {}, fetchImpl, audioFactory }
    const { rerender } = render(<AiSettingsDialog {...props} open ownerKey="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }))
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())
    const signal = fetchImpl.mock.calls[0][1].signal

    rerender(<AiSettingsDialog {...props} open ownerKey="account-b" />)
    expect(signal.aborted).toBe(true)
    resolveFetch({ ok: true, json: async () => ({ ok: true, audio_base64: 'stale', audio_mime_type: 'audio/wav' }) })
    await Promise.resolve()
    await Promise.resolve()
    expect(audioFactory).not.toHaveBeenCalled()
  })

  it('clears preview errors when reopened', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('preview exploded'))
    const props = { locale: 'en', form, onFormChange: () => {}, onSave: () => {}, onClose: () => {}, fetchImpl }
    const { rerender } = render(<AiSettingsDialog {...props} open ownerKey="account-a" />)
    fireEvent.click(screen.getByRole('button', { name: 'Preview voice' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('preview exploded')
    rerender(<AiSettingsDialog {...props} open={false} ownerKey="account-a" />)
    rerender(<AiSettingsDialog {...props} open ownerKey="account-a" />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not expose raw English preview failures in Traditional Chinese', async () => {
    render(<AiSettingsDialog open locale="zh-TW" form={form} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} fetchImpl={vi.fn().mockRejectedValue(new Error('backend secret failure'))} />)
    fireEvent.click(screen.getByRole('button', { name: '預覽語音' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('無法預覽語音。')
    expect(screen.getByRole('alert')).not.toHaveTextContent('backend secret failure')
  })

  it('allows cancelling an in-flight avatar preparation while save stays disabled', () => {
    const onClose = vi.fn()
    render(<AiSettingsDialog open preparingAvatar locale="en" form={form} onFormChange={() => {}} onSave={() => {}} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Preparing avatar…' })).toBeDisabled()
    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.getByLabelText('Voice')).toBeDisabled()
    expect(screen.getByLabelText('Global prompt')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
