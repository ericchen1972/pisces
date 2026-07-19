import { readFileSync } from 'node:fs'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LoginScreen from './LoginScreen.jsx'

afterEach(cleanup)

describe('LoginScreen', () => {
  it('shows Google sign-in and both English Build Week accounts', () => {
    const onOpenDemoAccount = vi.fn()
    const { container } = render(
      <LoginScreen
        locale="en"
        googleButtonRef={{ current: null }}
        onOpenTesterLogin={() => {}}
        onOpenDemoAccount={onOpenDemoAccount}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Convia' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sign in with Google')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tester login' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in as Judy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in as Haland' })).toBeInTheDocument()
    expect(container.querySelector('.login-wordmark')).toHaveAttribute('src', '/images/logo.webp')
    expect(container).not.toHaveTextContent(/Pisces|9:41|Bluetooth|battery/i)

    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Judy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Haland' }))
    expect(onOpenDemoAccount).toHaveBeenNthCalledWith(1, 'judy')
    expect(onOpenDemoAccount).toHaveBeenNthCalledWith(2, 'haland')
  })

  it('uses Traditional Chinese labels only when the normalized locale is zh-TW', () => {
    render(
      <LoginScreen
        locale="zh-TW"
        googleButtonRef={{ current: null }}
        onOpenTesterLogin={() => {}}
        onOpenDemoAccount={() => {}}
      />,
    )

    expect(screen.getByLabelText('使用 Google 登入')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用 Judy 登入' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '用 Haland 登入' })).toBeInTheDocument()
  })

  it('keeps arbitrary tester login conditional and reports popup failure', () => {
    const onOpenTesterLogin = vi.fn()
    render(
      <LoginScreen
        locale="en"
        googleButtonRef={{ current: null }}
        testerLoginEnabled
        demoLoginError="Please allow pop-ups to open the demo account."
        onOpenTesterLogin={onOpenTesterLogin}
        onOpenDemoAccount={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Tester login' }))
    expect(onOpenTesterLogin).toHaveBeenCalledOnce()
    expect(screen.getByRole('alert')).toHaveTextContent('Please allow pop-ups to open the demo account.')
  })

  it('leaves the Google logo to the official rendered button', () => {
    const { container } = render(
      <LoginScreen
        locale="en"
        googleButtonRef={{ current: null }}
        onOpenTesterLogin={() => {}}
        onOpenDemoAccount={() => {}}
      />,
    )

    expect(container.querySelector('.google-signin__target')).toBeInTheDocument()
    expect(container.querySelector('.google-signin > svg')).not.toBeInTheDocument()
  })

  it('keeps the transparent login logo free of a painted background', () => {
    const styles = readFileSync(`${process.cwd()}/src/styles/forms.css`, 'utf8')
    const rule = styles.match(/\.login-wordmark\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rule).not.toMatch(/background\s*:/)
  })
})
