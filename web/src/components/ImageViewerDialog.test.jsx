import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ImageViewerDialog from './ImageViewerDialog.jsx'

describe('ImageViewerDialog', () => {
  it('uses the shared accessible dark dialog surface', () => {
    render(<ImageViewerDialog open src="https://example.com/image.jpg" locale="en" onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Message image preview' })).toHaveAttribute('src', 'https://example.com/image.jpg')
    expect(screen.getByRole('button', { name: 'Close image preview' })).toBeInTheDocument()
  })
})
