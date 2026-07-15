import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import ConversationEmptyState from './ConversationEmptyState.jsx'

afterEach(cleanup)

it.each([
  ['en', 'Select a conversation to start messaging'],
  ['zh-TW', '選擇一個對話即可開始傳訊'],
])('renders a neutral localized empty state for %s', (locale, text) => {
  render(<ConversationEmptyState locale={locale} />)
  expect(screen.getByText(text)).toBeInTheDocument()
})
