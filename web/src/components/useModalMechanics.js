import { useEffect, useRef } from 'react'

export const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function isolateBackground(modalRoot) {
  const records = [...document.body.children]
    .filter((element) => element !== modalRoot)
    .map((element) => ({
      element,
      ariaHidden: element.getAttribute('aria-hidden'),
      hadInert: element.hasAttribute('inert'),
      inertValue: element.inert,
    }))

  records.forEach(({ element }) => {
    element.setAttribute('aria-hidden', 'true')
    element.setAttribute('inert', '')
    if ('inert' in element) element.inert = true
  })

  return () => records.forEach(({ element, ariaHidden, hadInert, inertValue }) => {
    if (ariaHidden == null) element.removeAttribute('aria-hidden')
    else element.setAttribute('aria-hidden', ariaHidden)
    if (hadInert) element.setAttribute('inert', '')
    else element.removeAttribute('inert')
    if ('inert' in element) element.inert = inertValue
  })
}

export function useModalMechanics({ open, dialogRef, modalRootRef, onClose, initialFocusSelector = '[data-autofocus]' }) {
  const previousFocusRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    previousFocusRef.current = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const restoreBackground = isolateBackground(modalRootRef.current)
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current
      const target = dialog?.querySelector(initialFocusSelector) || dialog?.querySelector(FOCUSABLE)
      ;(target || dialog)?.focus()
    })

    return () => {
      window.cancelAnimationFrame(frame)
      restoreBackground()
      document.body.style.overflow = previousOverflow
      previousFocusRef.current?.focus?.()
    }
  }, [dialogRef, initialFocusSelector, modalRootRef, open])

  return (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCloseRef.current?.('escape')
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
}
