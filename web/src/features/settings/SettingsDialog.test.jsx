import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog.jsx'

describe('SettingsDialog', () => {
  it('preserves verification code and bounded history settings', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(<SettingsDialog open locale="en" identifyCode="secret" historyRange="30" onIdentifyCodeChange={() => {}} onHistoryRangeChange={() => {}} onSubmit={onSubmit} onClose={() => {}} />)
    expect(screen.getByLabelText('Friend verification code')).toHaveValue('secret')
    expect(screen.getByLabelText('History range')).toHaveAttribute('min', '10')
    expect(screen.getByLabelText('History range')).toHaveAttribute('max', '60')
    fireEvent.submit(screen.getByRole('button', { name: 'Save' }).closest('form'))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('keeps account logout available from settings', () => {
    const onLogout = vi.fn()
    render(<SettingsDialog open locale="en" identifyCode="" historyRange="30" onIdentifyCodeChange={() => {}} onHistoryRangeChange={() => {}} onSubmit={(event) => event.preventDefault()} onClose={() => {}} onLogout={onLogout} />)
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(onLogout).toHaveBeenCalledOnce()
  })
})
