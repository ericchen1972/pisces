import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginScreen from './LoginScreen.jsx'

afterEach(cleanup)

describe('LoginScreen', () => {
  it('shows the Convia dark sign-in surface without legacy phone chrome or branding', () => {
    const { container } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} onOpenTesterLogin={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Convia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sign in with Google')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tester login' })).toBeInTheDocument()
    expect(container).not.toHaveTextContent(/Pisces|9:41|Bluetooth|battery/i)
    expect(container.querySelector('nav')).not.toBeInTheDocument()
    expect(container.querySelector('img[src*="background"], img[src*="logo.webp"]')).not.toBeInTheDocument()
  })

  it('leaves the Google logo to the official rendered button', () => {
    const { container } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} onOpenTesterLogin={() => {}} />)

    expect(container.querySelector('.google-signin__target')).toBeInTheDocument()
    expect(container.querySelector('.google-signin > svg')).not.toBeInTheDocument()
  })

  it('keeps tester login reachable and localizes only zh-TW/Hant', () => {
    const onOpenTesterLogin = vi.fn()
    const { rerender } = render(<LoginScreen locale="en" googleButtonRef={{ current: null }} onOpenTesterLogin={onOpenTesterLogin} />)
    fireEvent.click(screen.getByRole('button', { name: 'Tester login' }))
    expect(onOpenTesterLogin).toHaveBeenCalledOnce()

    rerender(<LoginScreen locale="zh-TW" googleButtonRef={{ current: null }} onOpenTesterLogin={() => {}} />)
    expect(screen.getByRole('button', { name: '測試帳號登入' })).toBeInTheDocument()
  })
})
