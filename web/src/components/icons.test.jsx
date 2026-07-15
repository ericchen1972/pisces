import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import * as Icons from './icons.jsx'

const iconSource = readFileSync(resolve('src/components/icons.jsx'), 'utf8')
const externalImports = [...iconSource.matchAll(
  /^\s*import\s+(?:.+?\s+from\s+)?['"]([^'"]+)['"]/gm,
)]
  .map((match) => match[1])
  .filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'))

const iconComponents = [
  Icons.MenuIcon,
  Icons.PlusIcon,
  Icons.ChevronIcon,
  Icons.MoreIcon,
  Icons.SettingsIcon,
  Icons.PhoneIcon,
  Icons.AiVoiceIcon,
  Icons.MicrophoneIcon,
  Icons.SendIcon,
  Icons.CloseIcon,
  Icons.EditIcon,
  Icons.TrashIcon,
  Icons.ArrowUpIcon,
  Icons.ArrowDownIcon,
  Icons.AttachmentIcon,
  Icons.PlayIcon,
  Icons.StopIcon,
  Icons.SpeakerIcon,
  Icons.LogoutIcon,
  Icons.BackIcon,
]

describe('icon system', () => {
  it('exports the complete inline SVG icon set without raster or emoji content', () => {
    const { container } = render(
      <div style={{ color: 'rgb(12, 34, 56)' }}>
        {iconComponents.map((Icon, index) => (
          <Icon key={index} />
        ))}
      </div>,
    )

    expect(iconComponents).toHaveLength(20)
    expect(container.querySelectorAll('svg')).toHaveLength(20)
    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(container.querySelector('svg image')).not.toBeInTheDocument()
    expect(container.textContent).toBe('')
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24')
      expect(svg).toHaveAttribute('aria-hidden', 'true')
      expect(svg).toHaveAttribute('stroke', 'currentColor')
      expect(getComputedStyle(svg).color).toBe('rgb(12, 34, 56)')

      const vectors = svg.querySelectorAll('path, circle, rect, line, polyline, polygon, ellipse')
      expect(vectors.length).toBeGreaterThan(0)
      for (const vector of vectors) {
        const effectiveStroke = vector.getAttribute('stroke') ?? svg.getAttribute('stroke')
        const effectiveFill = vector.getAttribute('fill') ?? svg.getAttribute('fill')
        expect(['currentColor', 'none']).toContain(effectiveStroke)
        expect(['currentColor', 'none']).toContain(effectiveFill)
      }
    }
  })

  it('uses React only and contains no external icon package or raster references', () => {
    expect(externalImports).toEqual(['react'])
    expect(iconSource).not.toMatch(
      /data:image\/|https?:\/\/(?!www\.w3\.org\/2000\/svg)|\.(?:avif|gif|jpe?g|png|webp)(?:[?'"\s]|$)/i,
    )
  })

  it('supports title, size, class name, and safe SVG props', () => {
    const { getByRole } = render(
      <Icons.MenuIcon
        title="Open menu"
        size="32"
        className="toolbar-icon"
        data-testid="menu-icon"
      />,
    )

    const icon = getByRole('img', { name: 'Open menu' })
    expect(icon).toHaveAttribute('width', '32')
    expect(icon).toHaveAttribute('height', '32')
    expect(icon).toHaveClass('toolbar-icon')
    expect(icon).toHaveAttribute('data-testid', 'menu-icon')
    expect(icon).not.toHaveAttribute('aria-hidden')
    expect(icon.querySelector('title')).toHaveTextContent('Open menu')
  })

  it('links titled icons to unique title IDs', () => {
    const { getAllByRole } = render(
      <>
        <Icons.MenuIcon title="Open menu" />
        <Icons.CloseIcon title="Close dialog" />
      </>,
    )

    const icons = getAllByRole('img')
    const titleIds = icons.map((icon) => icon.querySelector('title').id)
    expect(titleIds[0]).toBeTruthy()
    expect(titleIds[1]).toBeTruthy()
    expect(titleIds[0]).not.toBe(titleIds[1])
    expect(icons[0]).toHaveAttribute('aria-labelledby', titleIds[0])
    expect(icons[1]).toHaveAttribute('aria-labelledby', titleIds[1])
  })

  it('uses aria-label and aria-labelledby as accessible names', () => {
    const { getByRole } = render(
      <>
        <Icons.MenuIcon aria-label="Open navigation" />
        <span id="send-description">Send message</span>
        <Icons.SendIcon aria-labelledby="send-description" />
      </>,
    )

    expect(getByRole('img', { name: 'Open navigation' })).not.toHaveAttribute('aria-hidden')
    expect(getByRole('img', { name: 'Send message' })).not.toHaveAttribute('aria-hidden')
  })

  it('prevents callers from overriding controlled accessibility state', () => {
    const { container } = render(
      <>
        <Icons.MenuIcon title="Open menu" role="presentation" aria-hidden="true" />
        <Icons.CloseIcon role="img" aria-hidden="false" />
      </>,
    )

    const [namedIcon, decorativeIcon] = container.querySelectorAll('svg')
    expect(namedIcon).toHaveAttribute('role', 'img')
    expect(namedIcon).not.toHaveAttribute('aria-hidden')
    expect(decorativeIcon).toHaveAttribute('aria-hidden', 'true')
    expect(decorativeIcon).not.toHaveAttribute('role')
  })
})
