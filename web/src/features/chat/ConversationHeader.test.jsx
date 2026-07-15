import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ConversationHeader from './ConversationHeader.jsx'

afterEach(cleanup)

describe('ConversationHeader', () => {
  it('falls back to initials when the contact avatar fails', () => {
    render(<ConversationHeader contact={{ id: 'friend', name: 'Amy Adams', avatar: 'https://google/avatar' }} />)
    fireEvent.error(screen.getByRole('img', { name: 'Amy Adams' }))
    expect(screen.getByLabelText('Amy Adams avatar')).toHaveTextContent('AA')
  })

  it.each([
    ['en', 'Person-to-person calls are coming later'],
    ['zh-TW', '真人通話將於稍後開放'],
  ])('explains the disabled person call in %s', (locale, description) => {
    render(<ConversationHeader locale={locale} contact={{ id: 'friend', name: 'Amy' }} callDisabled />)
    const button = screen.getByRole('button', { name: locale === 'zh-TW' ? '語音通話' : 'Voice call' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(description)
    expect(button).toHaveAttribute('title', description)
  })

  it('keeps the AI call enabled', () => {
    const onCall = vi.fn()
    render(<ConversationHeader contact={{ id: 'pisces-core', name: 'Convia AI', isAi: true }} onCall={onCall} />)
    fireEvent.click(screen.getByRole('button', { name: 'Voice call' }))
    expect(onCall).toHaveBeenCalledOnce()
  })
})
