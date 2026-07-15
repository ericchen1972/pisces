import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons.jsx'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default function Dialog({
  open,
  title,
  children,
  onClose,
  closeOnBackdrop = true,
  showCloseButton = true,
  className = '',
  closeLabel = 'Close dialog',
}) {
  const titleId = useId()
  const dialogRef = useRef(null)
  const previousFocusRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const target = dialog?.querySelector('[data-autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button')
      ;(target || dialog)?.focus()
    })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.cancelAnimationFrame(frame)
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus?.()
    }
  }, [open])

  if (!open) return null

  const onKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose?.('escape')
      return
    }
    if (event.key !== 'Tab') return
    const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])]
    if (!focusable.length) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!focusable.includes(document.activeElement)) {
      event.preventDefault()
      first.focus()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div
      className="dialog-backdrop"
      data-testid="dialog-backdrop"
      onMouseDown={(event) => {
        if (closeOnBackdrop && event.target === event.currentTarget) onClose?.('backdrop')
      }}
    >
      <section
        ref={dialogRef}
        className={`dialog-surface ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="dialog-header">
          <h2 id={titleId}>{title}</h2>
          {showCloseButton ? (
            <button type="button" className="icon-button" aria-label={closeLabel} onClick={() => onClose?.('close-button')}>
              <CloseIcon size={20} />
            </button>
          ) : null}
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>,
    document.body,
  )
}
