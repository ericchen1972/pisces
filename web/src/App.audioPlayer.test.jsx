import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioMessagePlayer } from './App.jsx'

afterEach(() => vi.restoreAllMocks())

describe('AudioMessagePlayer localization', () => {
  it('uses Traditional Chinese play and pause accessibility labels', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    render(<AudioMessagePlayer audioUrl="/voice.webm" kind="voice" locale="zh-TW" />)
    const button = screen.getByRole('button', { name: '播放語音訊息' })
    fireEvent.click(button)
    expect(play).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: '暫停語音訊息' })).toBeInTheDocument()
  })
})
