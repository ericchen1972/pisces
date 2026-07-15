import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GroupManagerDialog from './GroupManagerDialog.jsx'

afterEach(cleanup)

const groups = [
  { id: 'family', name: 'Family', sort_order: 0 },
  { id: 'friends', name: 'Friends', sort_order: 1 },
  { id: 'business', name: 'Business', sort_order: 2 },
]

function renderManager(overrides = {}) {
  const props = {
    open: true,
    locale: 'en',
    groups,
    onClose: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(groups),
    onRename: vi.fn().mockResolvedValue(groups),
    onReorder: vi.fn().mockResolvedValue(groups),
    onDelete: vi.fn().mockResolvedValue(groups),
    onRefresh: vi.fn(),
    ...overrides,
  }
  render(<GroupManagerDialog {...props} />)
  return props
}

describe('GroupManagerDialog', () => {
  it('creates groups and prevents normalized duplicate names', async () => {
    const user = userEvent.setup()
    const props = renderManager()
    const input = screen.getByLabelText('New group name')
    await user.type(input, ' ＦＡＭＩＬＹ ')
    expect(screen.getByText('A group with this name already exists.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create group' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'Neighbors')
    await user.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() => expect(props.onCreate).toHaveBeenCalledWith('Neighbors'))
    expect(props.onRefresh).toHaveBeenCalledWith(groups)
  })

  it('renames inline and moves groups only with up/down controls', async () => {
    const user = userEvent.setup()
    const props = renderManager()
    expect(screen.queryByText(/drag/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rename Family' }))
    const rename = screen.getByLabelText('Group name')
    await user.clear(rename)
    await user.type(rename, 'Home')
    await user.click(screen.getByRole('button', { name: 'Save group name' }))
    await waitFor(() => expect(props.onRename).toHaveBeenCalledWith('family', 'Home'))

    await user.click(screen.getByRole('button', { name: 'Move Friends up' }))
    expect(props.onReorder).toHaveBeenCalledWith(['friends', 'family', 'business'])
  })

  it('requires a destination when deleting a group', async () => {
    const user = userEvent.setup()
    const props = renderManager()
    await user.click(screen.getByRole('button', { name: 'Delete Family' }))
    expect(screen.getByRole('button', { name: 'Delete group' })).toBeDisabled()
    await user.selectOptions(screen.getByLabelText('Move contacts to'), 'friends')
    await user.click(screen.getByRole('button', { name: 'Delete group' }))
    await waitFor(() => expect(props.onDelete).toHaveBeenCalledWith('family', 'friends'))
    expect(props.onRefresh).toHaveBeenCalledWith(groups)
  })
})
