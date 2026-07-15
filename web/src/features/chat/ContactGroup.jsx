import { useEffect, useState } from 'react'
import { ChevronIcon, MoreIcon } from '../../components/icons.jsx'
import { unreadTotal } from '../../lib/chatState.js'

function initialsFor(name) {
  const parts = String(name || '?').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts.at(-1)[0]}`).toLocaleUpperCase()
}

export function ContactAvatar({ contact, size = 'normal' }) {
  const [failed, setFailed] = useState(false)
  const source = contact.avatar_url || contact.avatar || ''
  useEffect(() => setFailed(false), [source])
  if (!source || failed) {
    return <span className={`contact-avatar contact-avatar--${size}`} role="img" aria-label={`${contact.name} avatar`}>{initialsFor(contact.name)}</span>
  }
  return <img className={`contact-avatar contact-avatar--${size}`} src={source} alt={contact.name} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
}

export function UnreadBadge({ count, label }) {
  const safe = Number.isInteger(count) && count > 0 ? count : 0
  if (!safe) return null
  return <span className="unread-badge" aria-label={label}>{safe > 99 ? '99+' : safe}</span>
}

export default function ContactGroup({ group, groups = [], contacts, unreadByContact, selectedContactId, onSelectContact, onMoveContact, locale = 'en' }) {
  const [expanded, setExpanded] = useState(true)
  const [moveContactId, setMoveContactId] = useState('')
  const total = unreadTotal(contacts, unreadByContact)
  const unreadText = (count) => locale === 'zh-TW' ? `${count} 則未讀訊息` : `${count} unread messages`
  const groupLabel = total ? `${group.name}, ${unreadText(total)}` : group.name

  return (
    <section className="contact-group">
      <button type="button" className="contact-group__heading" aria-label={groupLabel} aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
        <ChevronIcon size={16} className={expanded ? 'contact-group__chevron contact-group__chevron--open' : 'contact-group__chevron'} />
        <span>{group.name}</span>
        <UnreadBadge count={total} label={locale === 'zh-TW' ? `${group.name}有${unreadText(total)}` : `${total} unread messages in ${group.name}`} />
      </button>
      {expanded ? (
        <div className="contact-group__contacts">
          {contacts.map((contact) => {
            const unread = unreadByContact[contact.id] || 0
            const label = unread ? `${contact.name}, ${unreadText(unread)}` : contact.name
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
                  <ContactAvatar contact={contact} />
                  <span className="contact-row__copy">
                    <strong>{contact.name}</strong>
                    {contact.last_message_preview ? <span>{contact.last_message_preview}</span> : null}
                  </span>
                  <UnreadBadge count={unread} label={locale === 'zh-TW' ? `${contact.name}有${unreadText(unread)}` : `${unread} unread messages from ${contact.name}`} />
                </button>
                {onMoveContact && groups.length > 1 ? (
                  <span className="contact-row__move">
                    <button type="button" className="icon-button" aria-label={locale === 'zh-TW' ? `移動 ${contact.name}` : `Move ${contact.name}`} aria-expanded={moveContactId === contact.id} onClick={() => setMoveContactId((current) => current === contact.id ? '' : contact.id)}><MoreIcon size={18} /></button>
                    {moveContactId === contact.id ? (
                      <span className="contact-row__move-menu">
                        {groups.filter((candidate) => candidate.id !== group.id).map((candidate) => (
                          <button key={candidate.id} type="button" data-close-drawer aria-label={locale === 'zh-TW' ? `將 ${contact.name} 移至 ${candidate.name}` : `Move ${contact.name} to ${candidate.name}`} onClick={() => { setMoveContactId(''); onMoveContact(contact, candidate.id) }}>
                            {locale === 'zh-TW' ? `移至${candidate.name}` : `Move to ${candidate.name}`}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
