import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog.jsx'

describe('SettingsDialog', () => {
  it('preserves verification code and bounded history settings', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(<SettingsDialog open locale="en" identifyCode="secret" historyRange="30" onIdentifyCodeChange={() => {}} onHistoryRangeChange={() => {}} onSubmit={onSubmit} onClose={() => {}} />)
    expect(screen.getByLabelText('Contact verification code')).toHaveValue('secret')
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

  it('places group management in a settings tab', async () => {
    const user = userEvent.setup()
    const onCreateGroup = vi.fn().mockResolvedValue([{ id: 'family', name: 'Family', sort_order: 0 }])
    render(
      <SettingsDialog
        open
        locale="en"
        identifyCode=""
        historyRange="30"
        groups={[{ id: 'family', name: 'Family', sort_order: 0 }]}
        onIdentifyCodeChange={() => {}}
        onHistoryRangeChange={() => {}}
        onSubmit={(event) => event.preventDefault()}
        onClose={() => {}}
        onCreateGroup={onCreateGroup}
        onRenameGroup={() => {}}
        onReorderGroups={() => {}}
        onDeleteGroup={() => {}}
      />,
    )

    expect(screen.getByRole('tab', { name: 'Basic settings' })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: 'Manage groups' }))
    expect(screen.getByRole('tab', { name: 'Manage groups' })).toHaveAttribute('aria-selected', 'true')
    await user.type(screen.getByLabelText('New group name'), 'Friends')
    await user.click(screen.getByRole('button', { name: 'Create group' }))
    expect(onCreateGroup).toHaveBeenCalledWith('Friends')
  })
})
