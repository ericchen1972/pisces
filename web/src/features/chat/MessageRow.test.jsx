import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import MessageRow from './MessageRow.jsx'

afterEach(cleanup)

describe('MessageRow', () => {
  it.each([
    ['user', true],
    ['peer', true],
    ['ai', false],
    ['ai_proxy', false],
    ['assist_ai', false],
  ])('renders %s bubble=%s', (role, expectedBubble) => {
    const { container } = render(<MessageRow message={{ id: '1', role, text: 'Hello' }} />)
    expect(Boolean(container.querySelector('[data-bubble]'))).toBe(expectedBubble)
  })

  it('renders rich audio image and music content', () => {
    render(<MessageRow message={{ id: '1', role: 'ai', audioUrl: '/speech', imageUrl: '/image', musicUrl: '/music' }} />)
    expect(screen.getByLabelText('Play voice message')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Generated image' })).toHaveAttribute('src', '/image')
    expect(screen.getByLabelText('Play music')).toBeInTheDocument()
  })

  it('localizes rich-media accessibility labels in zh-TW', () => {
    render(<MessageRow locale="zh-TW" message={{ id: '1', role: 'ai', audioUrl: '/speech', imageUrl: '/image', musicUrl: '/music' }} />)
    expect(screen.getByLabelText('播放語音訊息')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '生成的圖片' })).toBeInTheDocument()
    expect(screen.getByLabelText('播放音樂')).toBeInTheDocument()
  })

  it.each([
    ['en', 'Convia AI · Only visible to you'],
    ['zh-TW', 'Convia AI · 只有你看得到'],
  ])('localizes the private Assist label for %s', (locale, label) => {
    render(<MessageRow locale={locale} message={{ id: '1', role: 'assist_ai', text: 'Private' }} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows a typing indicator for a private Assist response in progress', () => {
    render(<MessageRow message={{ id: '1', role: 'assist_ai', text: '', status: 'streaming' }} />)
    expect(screen.getByLabelText('Responding')).toBeInTheDocument()
  })

  it.each(['ai', 'ai_proxy', 'ai-typing'])('labels %s as Convia without adding a bubble', (role) => {
    const { container } = render(<MessageRow message={{ id: role, role, text: role === 'ai-typing' ? '' : 'AI text', status: role === 'ai-typing' ? 'streaming' : undefined }} />)
    expect(screen.getByText('Convia')).toBeInTheDocument()
    expect(container.querySelector('[data-bubble]')).toBeNull()
  })

  it.each([
    ['en', 'Only visible to you'],
    ['zh-TW', '只有你看得到'],
  ])('keeps assist_user private and human-bubbled for %s', (locale, label) => {
    const { container } = render(<MessageRow locale={locale} message={{ id: 'private-user', role: 'assist_user', text: 'draft' }} />)
    expect(container.querySelector('[data-bubble]')).toBeInTheDocument()
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.querySelector('article')).toHaveClass('message-row--outgoing')
  })
})
