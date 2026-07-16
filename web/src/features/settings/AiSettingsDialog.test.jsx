import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AiSettingsDialog from './AiSettingsDialog.jsx'

afterEach(cleanup)

describe('AiSettingsDialog', () => {
  const form = { alias: 'Convia AI', avatar: '/avatar.png', openaiVoice: 'marin', globalPrompt: 'Be kind.' }

  it('shows fixed Convia identity and hides name and voice controls', () => {
    const onFormChange = vi.fn()
    render(<AiSettingsDialog open locale="en" form={form} onFormChange={onFormChange} onSave={() => {}} onClose={() => {}} />)

    expect(screen.getByText('Convia')).toBeInTheDocument()
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Voice')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Preview voice' })).not.toBeInTheDocument()
    expect(onFormChange).toHaveBeenCalledWith({ ...form, alias: 'Convia' })
  })

  it('advertises and forwards WebP avatar input for preview processing', () => {
    const onAvatarPick = vi.fn()
    const { container } = render(<AiSettingsDialog open locale="en" form={{ ...form, alias: 'Convia' }} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} onAvatarPick={onAvatarPick} />)
    const input = container.ownerDocument.body.querySelector('input[type="file"]')
    expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    const file = new File(['webp'], 'avatar.webp', { type: 'image/webp' })
    fireEvent.change(input, { target: { files: [file] } })
    expect(onAvatarPick).toHaveBeenCalled()
  })

  it('allows editing the global prompt and saving settings', () => {
    const onFormChange = vi.fn()
    const onSave = vi.fn()
    render(<AiSettingsDialog open locale="en" form={{ ...form, alias: 'Convia' }} onFormChange={onFormChange} onSave={onSave} onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Global prompt'), { target: { value: 'New prompt' } })
    expect(onFormChange).toHaveBeenCalledWith({ ...form, alias: 'Convia', globalPrompt: 'New prompt' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledOnce()
  })

  it('allows cancelling in-flight avatar preparation while save stays disabled', () => {
    const onClose = vi.fn()
    render(<AiSettingsDialog open preparingAvatar locale="en" form={{ ...form, alias: 'Convia' }} onFormChange={() => {}} onSave={() => {}} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Preparing avatar…' })).toBeDisabled()
    expect(screen.getByLabelText('Global prompt')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
