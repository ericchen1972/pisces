import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginScreen from './LoginScreen.jsx'

afterEach(cleanup)

describe('LoginScreen', () => {
  it('shows the Convia dark sign-in surface without legacy phone chrome or branding', () => {
    const { container } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} testerLoginEnabled judyLoginEnabled onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Convia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sign in with Google')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tester login' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in as Judy' })).toBeInTheDocument()
    expect(container.querySelector('.login-wordmark')).toHaveAttribute('src', '/images/logo.webp')
    expect(container).not.toHaveTextContent(/Pisces|9:41|Bluetooth|battery/i)
    expect(container.querySelector('nav')).not.toBeInTheDocument()
    expect(container.querySelector('img[src*="background"]')).not.toBeInTheDocument()
  })

  it('leaves the Google logo to the official rendered button', () => {
    const { container } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} testerLoginEnabled judyLoginEnabled onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)

    expect(container.querySelector('.google-signin__target')).toBeInTheDocument()
    expect(container.querySelector('.google-signin > svg')).not.toBeInTheDocument()
  })

  it('keeps tester login reachable and localizes only zh-TW/Hant', () => {
    const onOpenTesterLogin = vi.fn()
    const onJudyLogin = vi.fn()
    const { rerender } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} testerLoginEnabled judyLoginEnabled onOpenTesterLogin={onOpenTesterLogin} onJudyLogin={onJudyLogin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester login' }))
    expect(onOpenTesterLogin).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Judy' }))
    expect(onJudyLogin).toHaveBeenCalledOnce()

    rerender(<LoginScreen locale="zh-TW" googleButtonRef={{ current: null }} testerLoginEnabled judyLoginEnabled onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)
    expect(screen.getByRole('button', { name: '測試帳號登入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Judy 登入' })).toBeInTheDocument()
  })

  it('keeps tester login hidden until the server capability is explicitly enabled', () => {
    const { rerender } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Tester login' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign in as Judy' })).not.toBeInTheDocument()

    rerender(<LoginScreen locale="en" googleButtonRef={{ current: null }} testerLoginEnabled={false} judyLoginEnabled onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Tester login' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in as Judy' })).toBeInTheDocument()

    rerender(<LoginScreen locale="en" googleButtonRef={{ current: null }} testerLoginEnabled onOpenTesterLogin={() => {}} onJudyLogin={() => {}} />)
    expect(screen.getByRole('button', { name: 'Tester login' })).toBeInTheDocument()
  })
})
