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
    const button = screen.getByRole('button', { name: locale === 'zh-TW' ? '真人通話稍後開放' : 'Person-to-person calls coming later' })
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

  it.each([
    [{ id: 'pisces-core', name: 'Convia AI', isAi: true }, 'Edit Convia AI'],
    [{ id: 'friend', name: 'Amy', isAi: false }, 'Edit Amy'],
  ])('opens settings for every contact type', (contact, label) => {
    const onEdit = vi.fn()
    render(<ConversationHeader contact={contact} onEdit={onEdit} />)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onEdit).toHaveBeenCalledWith(contact)
  })

  it('keeps person phone disabled without exposing private AI Assist voice', () => {
    render(<ConversationHeader contact={{ id: 'friend', name: 'Amy', isAi: false }} />)

    expect(screen.getByRole('button', { name: 'Person-to-person calls coming later' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Start private AI voice assist' })).not.toBeInTheDocument()
  })
})
