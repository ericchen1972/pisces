import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { EditIcon, TrashIcon } from '../../components/icons.jsx'

const VIEWPORT_MARGIN = 8
const MENU_GAP = 4

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export default function ContactOptionsMenu({ anchor, contact, group, groups, locale = 'en', onEdit, onMove, onDelete, onClose }) {
  const menuRef = useRef(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const zh = locale === 'zh-TW'
  const label = zh ? `${contact.name} 的聯絡人選項` : `Contact options for ${contact.name}`

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!anchor || !menu) return undefined

    const position = () => {
      const triggerRect = anchor.getBoundingClientRect()
      const menuRect = menu.getBoundingClientRect()
      const fitsBelow = triggerRect.bottom + MENU_GAP + menuRect.height <= window.innerHeight - VIEWPORT_MARGIN
      const fitsAbove = triggerRect.top - MENU_GAP - menuRect.height >= VIEWPORT_MARGIN
      const placement = !fitsBelow && fitsAbove ? 'top' : 'bottom'
      const idealTop = placement === 'top'
        ? triggerRect.top - MENU_GAP - menuRect.height
        : triggerRect.bottom + MENU_GAP
      menu.style.top = `${clamp(idealTop, VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN - menuRect.height)}px`
      menu.style.left = `${clamp(triggerRect.right - menuRect.width, VIEWPORT_MARGIN, window.innerWidth - VIEWPORT_MARGIN - menuRect.width)}px`
      menu.dataset.placement = placement
    }
    const closeAndRestore = () => onCloseRef.current?.(true)
    const onPointerDown = (event) => {
      if (!menu.contains(event.target) && !anchor.contains(event.target)) closeAndRestore()
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeAndRestore()
      }
    }

    position()
    menu.querySelector('[role="menuitem"]')?.focus()
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [anchor])

  const onMenuKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current?.(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll('[role="menuitem"]:not(:disabled)')]
    if (!items.length) return
    const current = items.indexOf(document.activeElement)
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length
    items[next].focus()
  }

  const moveAndRestoreFocus = async (groupId) => {
    const drawerOwnsFocus = Boolean(anchor.closest('.chat-shell__drawer'))
    onClose?.(false)
    await onMove(contact, groupId)
    if (drawerOwnsFocus) return
    requestAnimationFrame(() => {
      const triggers = [...document.querySelectorAll(`[data-contact-options-id="${CSS.escape(contact.id)}"]`)]
      const visibleTrigger = triggers.find((trigger) => !trigger.closest('[inert], [aria-hidden="true"]')) || triggers[0]
      visibleTrigger?.focus()
    })
  }

  const openDialogAction = (action) => {
    anchor?.focus()
    onClose?.(false)
    action(contact)
  }

  return createPortal(
    <div ref={menuRef} className="contact-options-menu" role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
      {onEdit ? <button type="button" role="menuitem" aria-label={zh ? `編輯 ${contact.name}` : `Edit ${contact.name}`} onClick={() => openDialogAction(onEdit)}><EditIcon size={16} />{zh ? '編輯' : 'Edit'}</button> : null}
      {onMove ? groups.filter((candidate) => candidate.id !== group.id).map((candidate) => (
        <button key={candidate.id} type="button" role="menuitem" data-close-drawer aria-label={zh ? `將 ${contact.name} 移至 ${candidate.name}` : `Move ${contact.name} to ${candidate.name}`} onClick={() => moveAndRestoreFocus(candidate.id)}>
          {zh ? `移至${candidate.name}` : `Move to ${candidate.name}`}
        </button>
      )) : null}
      {onDelete ? <button type="button" role="menuitem" className="contact-row__delete" aria-label={zh ? `刪除 ${contact.name}` : `Delete ${contact.name}`} onClick={() => openDialogAction(onDelete)}><TrashIcon size={16} />{zh ? '刪除' : 'Delete'}</button> : null}
    </div>,
    document.body,
  )
}
