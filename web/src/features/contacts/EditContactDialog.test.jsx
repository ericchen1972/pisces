import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import EditContactDialog from './EditContactDialog.jsx'

describe('EditContactDialog', () => {
  it('preserves alias, special prompt, relationship, and Google avatar', () => {
    render(<EditContactDialog open locale="en" form={{ alias: 'Amy', avatar: 'https://lh3.googleusercontent.com/a/photo', specialPrompt: 'Be brief', relationship: 'Friend' }} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('img', { name: 'Amy Google profile avatar' })).toHaveAttribute('src', expect.stringContaining('googleusercontent.com'))
    expect(screen.getByLabelText('Name')).toHaveValue('Amy')
    expect(screen.getByLabelText('Special prompt')).toHaveValue('Be brief')
    expect(screen.getByLabelText('Relationship')).toHaveValue('Friend')
  })

  it('locks save and close controls while a real-contact save is busy', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(<EditContactDialog open busy locale="en" form={{ alias: 'Amy', avatar: 'https://lh3.googleusercontent.com/a/photo' }} onFormChange={() => {}} onSave={onSave} onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' }))
    expect(onSave).not.toHaveBeenCalled()
  })

  it('localizes the Google avatar alternative text in zh-TW', () => {
    render(<EditContactDialog open locale="zh-TW" form={{ alias: 'Amy', avatar: 'https://lh3.googleusercontent.com/a/photo' }} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} />)
    expect(screen.getByRole('img', { name: 'Amy 的 Google 個人資料頭像' })).toBeInTheDocument()
  })

  it('confirms before removing a contact relationship', () => {
    const onRemove = vi.fn()
    render(<EditContactDialog open locale="zh-TW" form={{ alias: 'Amy', avatar: 'https://lh3.googleusercontent.com/a/photo' }} onFormChange={() => {}} onSave={() => {}} onClose={() => {}} onRemove={onRemove} />)
    fireEvent.click(screen.getByRole('button', { name: /移除/ }))
    expect(onRemove).not.toHaveBeenCalled()
    expect(screen.getByText('確定要移除 Amy？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '確認移除 Amy' }))
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
