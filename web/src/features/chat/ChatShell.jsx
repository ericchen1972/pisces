import { useEffect, useRef, useState } from 'react'
import { CloseIcon, MenuIcon } from '../../components/icons.jsx'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function ChatShell({ sidebar, children, locale = 'en' }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [isMobile, setIsMobile] = useState(() => (
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 767px)').matches
      : true
  ))
  const menuButtonRef = useRef(null)
  const drawerRef = useRef(null)
  const labels = locale === 'zh-TW' ? { open: '開啟聯絡人', close: '關閉聯絡人' } : { open: 'Open contacts', close: 'Close contacts' }
  const modalDrawerOpen = drawerOpen && isMobile

  const closeDrawer = ({ restoreFocus = true } = {}) => {
    setDrawerOpen(false)
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  useEffect(() => {
    if (!modalDrawerOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeDrawer()
    }
    const frame = window.requestAnimationFrame(() => {
      drawerRef.current?.querySelector(FOCUSABLE)?.focus()
    })
    document.addEventListener('keydown', onKeyDown)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [modalDrawerOpen])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const media = window.matchMedia('(max-width: 767px)')
    const onChange = (event) => {
      setIsMobile(event.matches)
      if (!event.matches) setDrawerOpen(false)
    }
    setIsMobile(media.matches)
    if (media.addEventListener) media.addEventListener('change', onChange)
    else media.addListener?.(onChange)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', onChange)
      else media.removeListener?.(onChange)
    }
  }, [])

  const trapDrawerFocus = (event) => {
    if (event.key !== 'Tab') return
    const focusable = [...(drawerRef.current?.querySelectorAll(FOCUSABLE) || [])]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable.at(-1)
    if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div className="chat-shell">
      <aside className="chat-shell__desktop-sidebar" aria-hidden={modalDrawerOpen || undefined} inert={modalDrawerOpen ? '' : undefined}>{sidebar}</aside>
      <div className="chat-shell__main" data-testid="chat-main" aria-hidden={modalDrawerOpen || undefined} inert={modalDrawerOpen ? '' : undefined}>
        <button
          ref={menuButtonRef}
          type="button"
          className="chat-shell__menu-button icon-button"
          aria-label={labels.open}
          aria-expanded={modalDrawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <MenuIcon />
        </button>
        {children}
      </div>
      <div className="chat-shell__mobile-layer" data-open={modalDrawerOpen ? 'true' : 'false'} aria-hidden={!modalDrawerOpen}>
        <button type="button" className="chat-shell__scrim" aria-label={labels.close} tabIndex={modalDrawerOpen ? 0 : -1} onClick={() => closeDrawer()} />
        <aside
          ref={drawerRef}
          className="chat-shell__drawer"
          data-testid="mobile-drawer"
          data-open={modalDrawerOpen ? 'true' : 'false'}
          role="dialog"
          aria-modal={modalDrawerOpen ? 'true' : undefined}
          aria-label={locale === 'zh-TW' ? '聯絡人' : 'Contacts'}
          onKeyDown={trapDrawerFocus}
          onClickCapture={(event) => {
            if (event.target.closest('[data-close-drawer]')) closeDrawer()
          }}
        >
          <button type="button" className="chat-shell__drawer-close icon-button" aria-label={labels.close} onClick={() => closeDrawer()}>
            <CloseIcon />
          </button>
          {modalDrawerOpen ? sidebar : null}
        </aside>
      </div>
    </div>
  )
}
