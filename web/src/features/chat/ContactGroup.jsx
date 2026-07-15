import { useEffect, useState } from 'react'
import Dialog from '../../components/Dialog.jsx'
import { ChevronIcon, MoreIcon } from '../../components/icons.jsx'
import { unreadTotal } from '../../lib/chatState.js'
import ContactOptionsMenu from './ContactOptionsMenu.jsx'

function initialsFor(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts.at(-1)[0]}`).toLocaleUpperCase()
}

export function ContactAvatar({ contact, size = 'normal', locale = 'en' }) {
  const [failed, setFailed] = useState(false)
  const source = contact.avatar_url || contact.avatar || ''
  useEffect(() => setFailed(false), [source])
  if (!source || failed) {
    return <span className={`contact-avatar contact-avatar--${size}`} role="img" aria-label={locale === 'zh-TW' ? `${contact.name} 頭像` : `${contact.name} avatar`}>{initialsFor(contact.name)}</span>
  }
  return <img className={`contact-avatar contact-avatar--${size}`} src={source} alt={contact.name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

export function UnreadBadge({ count, label }) {
  const safe = Number.isInteger(count) && count > 0 ? count : 0
  if (!safe) return null
  return <span className="unread-badge" aria-label={label}>{safe > 99 ? '99+' : safe}</span>
}

export default function ContactGroup({ group, groups = [], contacts, unreadByContact, selectedContactId, onSelectContact, onMoveContact, onEditContact, onDeleteContact, locale = 'en' }) {
  const [expanded, setExpanded] = useState(true)
  const [optionsContactId, setOptionsContactId] = useState('')
  const [optionsAnchor, setOptionsAnchor] = useState(null)
  const [deleteContact, setDeleteContact] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const total = unreadTotal(contacts, unreadByContact)
  const unreadText = (count) => locale === 'zh-TW' ? `${count} 則未讀訊息` : `${count} unread messages`
  const groupLabel = total ? (locale === 'zh-TW' ? `${group.name}，${unreadText(total)}` : `${group.name}, ${unreadText(total)}`) : group.name

  return (
    <>
    <section className="contact-group">
      <button type="button" className="contact-group__heading" aria-label={groupLabel} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <ChevronIcon size={16} className={expanded ? 'contact-group__chevron contact-group__chevron--open' : 'contact-group__chevron'} />
        <span>{group.name}</span>
        <UnreadBadge count={total} label={locale === 'zh-TW' ? `${group.name} 有 ${unreadText(total)}` : `${total} unread messages in ${group.name}`} />
      </button>
      {expanded ? (
        <div className="contact-group__contacts">
          {contacts.map((contact) => {
            const unread = unreadByContact[contact.id] || 0
            const label = unread ? (locale === 'zh-TW' ? `${contact.name}，${unreadText(unread)}` : `${contact.name}, ${unreadText(unread)}`) : contact.name
            return (
              <div className={`contact-row contact-row--container ${selectedContactId === contact.id ? 'contact-row--selected' : ''}`} key={contact.id}>
                <button
                  type="button"
                  className="contact-row__select"
                  aria-label={label}
                  aria-current={selectedContactId === contact.id ? 'page' : undefined}
                  data-close-drawer
                  onClick={() => onSelectContact?.(contact)}
                >
                  <ContactAvatar contact={contact} locale={locale} />
                  <span className="contact-row__copy">
                    <strong>{contact.name}</strong>
                    {contact.last_message_preview ? <span>{contact.last_message_preview}</span> : null}
                  </span>
                  <UnreadBadge count={unread} label={locale === 'zh-TW' ? `${contact.name} 有 ${unreadText(unread)}` : `${unread} unread messages from ${contact.name}`} />
                </button>
                {onEditContact || onDeleteContact || (onMoveContact && groups.length > 1) ? (
                  <span className="contact-row__move">
                    <button type="button" className="icon-button" data-contact-options-id={contact.id} aria-label={locale === 'zh-TW' ? `${contact.name} 的聯絡人選項` : `Contact options for ${contact.name}`} aria-haspopup="menu" aria-expanded={optionsContactId === contact.id} onClick={(event) => {
                      const opening = optionsContactId !== contact.id
                      setOptionsContactId(opening ? contact.id : '')
                      setOptionsAnchor(opening ? event.currentTarget : null)
                    }}><MoreIcon size={18} /></button>
                    {optionsContactId === contact.id && optionsAnchor ? <ContactOptionsMenu anchor={optionsAnchor} contact={contact} group={group} groups={groups} locale={locale} onEdit={onEditContact} onMove={onMoveContact} onDelete={(target) => { setDeleteError(''); setDeleteContact(target) }} onClose={(restoreFocus) => {
                      setOptionsContactId('')
                      setOptionsAnchor(null)
                      if (restoreFocus) requestAnimationFrame(() => optionsAnchor.focus())
                    }} /> : null}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
    <Dialog open={Boolean(deleteContact)} title={deleteContact ? (locale === 'zh-TW' ? `刪除 ${deleteContact.name}？` : `Delete ${deleteContact.name}?`) : ''} closeLabel={locale === 'zh-TW' ? '關閉刪除聯絡人對話框' : 'Close delete contact dialog'} onClose={deleteBusy ? undefined : () => setDeleteContact(null)} closeOnBackdrop={!deleteBusy} showCloseButton={!deleteBusy}>
      <p className="form-help">{locale === 'zh-TW' ? '這會移除聯絡關係；此動作無法復原。' : 'This removes the contact relationship and cannot be undone.'}</p>
      {deleteError ? <p className="form-error" role="alert">{deleteError}</p> : null}
      <div className="dialog-actions">
        <button type="button" disabled={deleteBusy} onClick={() => setDeleteContact(null)}>{locale === 'zh-TW' ? '取消' : 'Cancel'}</button>
        <button type="button" className="danger-button" disabled={deleteBusy} aria-label={deleteContact ? (locale === 'zh-TW' ? `確認刪除 ${deleteContact.name}` : `Confirm delete ${deleteContact.name}`) : undefined} onClick={async () => {
          if (!deleteContact || deleteBusy) return
          setDeleteBusy(true)
          setDeleteError('')
          try {
            const deleted = await onDeleteContact(deleteContact)
            if (deleted !== false) setDeleteContact(null)
            else setDeleteError(locale === 'zh-TW' ? '刪除失敗。請稍後再試。' : 'Delete failed. Please try again.')
          } catch (error) {
            setDeleteError(locale === 'zh-TW' ? '刪除失敗。' : (error?.message || 'Delete failed.'))
          } finally {
            setDeleteBusy(false)
          }
        }}>{deleteBusy ? (locale === 'zh-TW' ? '刪除中…' : 'Deleting…') : (locale === 'zh-TW' ? '刪除' : 'Delete')}</button>
      </div>
    </Dialog>
    </>
  )
}
