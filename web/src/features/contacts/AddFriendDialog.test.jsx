import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import AddFriendDialog from './AddFriendDialog.jsx'

describe('AddFriendDialog', () => {
  const groups = [{ id: 'friends', name: 'Friends' }, { id: 'family', name: 'Family' }]

  it('keeps Google account, alias, group, and verification code fields', () => {
    render(<AddFriendDialog open locale="en" email="" alias="" groupId="" groups={groups} verificationCode="" onEmailChange={() => {}} onAliasChange={() => {}} onGroupChange={() => {}} onVerificationCodeChange={() => {}} onSubmit={(event) => event.preventDefault()} onClose={() => {}} />)
    expect(screen.getByLabelText('Google account')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Name')).toHaveAttribute('minLength', '2')
    expect(screen.getByLabelText('Group')).toHaveDisplayValue('Select group')
    expect(screen.getByLabelText('Contact verification code')).toBeInTheDocument()
  })

  it('requires a selected group before submitting', () => {
    const onSubmit = vi.fn((event) => event.preventDefault())
    render(<AddFriendDialog open locale="zh-TW" email="friend@gmail.com" alias="朋友" groupId="" groups={groups} verificationCode="" onEmailChange={() => {}} onAliasChange={() => {}} onGroupChange={() => {}} onVerificationCodeChange={() => {}} onSubmit={onSubmit} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '加入' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('請選擇群組')
  })
})
