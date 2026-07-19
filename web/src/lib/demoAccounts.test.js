import { describe, expect, it, vi } from 'vitest'
import {
  demoAccountFromUrl,
  demoLoginUrl,
  openDemoWindow,
  stripDemoLoginQuery,
} from './demoAccounts.js'

describe('Build Week demo accounts', () => {
  it('accepts only the two fixed account keys', () => {
    expect(demoAccountFromUrl('https://judy.example/?demo_account=judy')).toBe('judy')
    expect(demoAccountFromUrl('https://haland.example/?demo_account=haland')).toBe('haland')
    expect(demoAccountFromUrl('https://example.test/?demo_account=eric')).toBe('')
  })

  it('builds only configured demo destinations', () => {
    const destinations = { judy: 'https://judy.example', haland: 'https://haland.example' }
    expect(demoLoginUrl('judy', destinations)).toBe('https://judy.example/?demo_account=judy')
    expect(demoLoginUrl('haland', destinations)).toBe('https://haland.example/?demo_account=haland')
    expect(demoLoginUrl('eric', destinations)).toBe('')
  })

  it('opens a named separate window without retaining its opener', () => {
    const popup = { opener: window, location: { replace: vi.fn() } }
    const openWindow = vi.fn(() => popup)

    expect(
      openDemoWindow('judy', openWindow, {
        judy: 'https://judy.example',
        haland: 'https://haland.example',
      }),
    ).toBe(true)
    expect(openWindow).toHaveBeenCalledWith('', 'convia-demo-judy', 'popup')
    expect(popup.opener).toBeNull()
    expect(popup.location.replace).toHaveBeenCalledWith('https://judy.example/?demo_account=judy')
  })

  it('reports blocked popups and removes only its login query parameter', () => {
    expect(
      openDemoWindow('haland', () => null, {
        judy: 'https://judy.example',
        haland: 'https://haland.example',
      }),
    ).toBe(false)
    expect(
      stripDemoLoginQuery('https://haland.example/?demo_account=haland&ref=devpost'),
    ).toBe('https://haland.example/?ref=devpost')
  })
})
