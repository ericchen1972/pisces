import { useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons.jsx'
import { useModalMechanics } from './useModalMechanics.js'

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
  const modalRootRef = useRef(null)
  const onKeyDown = useModalMechanics({
    open,
    dialogRef,
    modalRootRef,
    onClose,
    initialFocusSelector: '[data-autofocus], .dialog-body input, .dialog-body select, .dialog-body textarea, .dialog-body button',
  })

  if (!open) return null

  return createPortal(
    <div
      ref={modalRootRef}
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
