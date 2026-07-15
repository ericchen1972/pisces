import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Conversation from './Conversation.jsx'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Conversation', () => {
  it('resets the bottom anchor when switching contacts', () => {
    const { rerender } = render(<Conversation contact={{ id: 'a', name: 'A' }} messages={[{ id: '1', role: 'peer', text: 'one' }]} />)
    const scroller = screen.getByTestId('conversation-messages')
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, value: 800 },
      clientHeight: { configurable: true, value: 200 },
    })
    scroller.scrollTop = 50
    fireEvent.scroll(scroller)
    rerender(<Conversation contact={{ id: 'b', name: 'B' }} messages={[{ id: '2', role: 'peer', text: 'two' }]} />)
    expect(scroller.scrollTop).toBe(800)
  })

  it('anchors async media growth only while the reader is near the bottom', () => {
    let resizeCallback
    class ResizeObserverMock {
      constructor(callback) { resizeCallback = callback }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock)
    render(<Conversation contact={{ id: 'a', name: 'A' }} messages={[{ id: '1', role: 'ai', imageUrl: '/image' }]} />)
    const scroller = screen.getByTestId('conversation-messages')
    let height = 800
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 200 },
    })
    scroller.scrollTop = 580
    fireEvent.scroll(scroller)
    height = 920
    resizeCallback()
    expect(scroller.scrollTop).toBe(920)

    scroller.scrollTop = 100
    fireEvent.scroll(scroller)
    height = 1040
    resizeCallback()
    expect(scroller.scrollTop).toBe(100)
  })

  it('uses media load events as a fallback when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined)
    render(<Conversation contact={{ id: 'a', name: 'A' }} messages={[{ id: '1', role: 'ai', imageUrl: '/image' }]} />)
    const scroller = screen.getByTestId('conversation-messages')
    let height = 800
    Object.defineProperties(scroller, {
      scrollHeight: { configurable: true, get: () => height },
      clientHeight: { configurable: true, value: 200 },
    })
    scroller.scrollTop = 580
    fireEvent.scroll(scroller)
    height = 920
    fireEvent.load(screen.getByAltText('Generated image'))
    expect(scroller.scrollTop).toBe(920)
  })
})
