import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AddFriendDialog from './AddFriendDialog.jsx'

describe('AddFriendDialog', () => {
  it('keeps Google account, alias, and verification code fields', () => {
    render(<AddFriendDialog open locale="en" email="" alias="" verificationCode="" onEmailChange={() => {}} onAliasChange={() => {}} onVerificationCodeChange={() => {}} onSubmit={(event) => event.preventDefault()} onClose={() => {}} />)
    expect(screen.getByLabelText('Google account')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Name')).toHaveAttribute('minLength', '2')
    expect(screen.getByLabelText('Friend verification code')).toBeInTheDocument()
  })
})
