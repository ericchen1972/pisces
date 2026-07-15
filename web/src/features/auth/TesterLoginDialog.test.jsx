import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TesterLoginDialog from './TesterLoginDialog.jsx'

describe('TesterLoginDialog', () => {
  it('preserves tester email and avatar URL fields', () => {
    render(<TesterLoginDialog open locale="en" email="tester@example.com" avatarUrl="https://example.com/a.jpg" onEmailChange={() => {}} onAvatarUrlChange={() => {}} onSubmit={(event) => event.preventDefault()} onClose={() => {}} />)
    expect(screen.getByLabelText('Email')).toHaveValue('tester@example.com')
    expect(screen.getByLabelText('Avatar URL')).toHaveValue('https://example.com/a.jpg')
  })
})
