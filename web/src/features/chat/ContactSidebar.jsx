import { useEffect, useState } from 'react'
import { PlusIcon, SettingsIcon } from '../../components/icons.jsx'
import { groupContacts } from '../../lib/chatState.js'
import ContactGroup, { ContactAvatar, UnreadBadge } from './ContactGroup.jsx'

const COPY = {
  en: { contacts: 'Contacts', add: 'Add friend', ai: 'Chat with Convia AI', settings: 'Settings' },
  'zh-TW': { contacts: '聯絡人', add: '新增好友', ai: '與 Convia AI 聊天', settings: '設定' },
}

function AiAvatar({ contact }) {
  const [configuredFailed, setConfiguredFailed] = useState(false)
  const configured = contact.avatar_url || contact.avatar || ''
  useEffect(() => setConfiguredFailed(false), [configured])
  const source = configured && !configuredFailed ? configured : '/images/fish.png'
  return <img className="contact-avatar contact-avatar--ai" src={source} alt="Convia AI" onError={() => { if (configured) setConfiguredFailed(true) }} />
}

export default function ContactSidebar({
  locale = 'en',
  groups = [],
  contacts = [],
  unreadByContact = {},
  defaultGroupId = '',
  selectedContactId = '',
  currentUser,
  onAddFriend,
  onSelectContact,
  onOpenSettings,
  onManageGroups,
  onMoveContact,
}) {
  const copy = COPY[locale] || COPY.en
  const orderedGroups = [...groups].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0))
  const grouped = groupContacts(orderedGroups, contacts, defaultGroupId)
  const aiUnread = unreadByContact['pisces-core'] || 0
  const aiContact = contacts.find((contact) => contact.isAi || contact.id === 'pisces-core') || { id: 'pisces-core', name: 'Convia AI', isAi: true }

  return (
    <nav className="contact-sidebar" aria-label={copy.contacts}>
      <header className="contact-sidebar__header">
        <span className="contact-sidebar__wordmark">Convia</span>
        <button type="button" className="icon-button" aria-label={copy.add} title={copy.add} data-close-drawer onClick={onAddFriend}>
          <PlusIcon size={20} />
        </button>
      </header>

      <button
        type="button"
        className={`contact-row contact-row--ai ${selectedContactId === aiContact.id ? 'contact-row--selected' : ''}`}
        aria-label={copy.ai}
        aria-current={selectedContactId === aiContact.id ? 'page' : undefined}
        data-close-drawer
        onClick={() => onSelectContact?.(aiContact)}
      >
        <AiAvatar contact={aiContact} />
        <span className="contact-row__copy"><strong>Convia AI</strong></span>
        <UnreadBadge count={aiUnread} label={`${aiUnread} unread messages from Convia AI`} />
      </button>

      <div className="contact-sidebar__groups">
        {orderedGroups.map((group) => (
          <ContactGroup
            key={group.id}
            group={group}
            groups={orderedGroups}
            locale={locale}
            contacts={grouped[group.id] || []}
            unreadByContact={unreadByContact}
            selectedContactId={selectedContactId}
            onSelectContact={onSelectContact}
            onMoveContact={onMoveContact}
          />
        ))}
      </div>

      <footer className="contact-sidebar__footer">
        <button type="button" className="contact-sidebar__account" data-close-drawer onClick={onOpenSettings}>
          <ContactAvatar contact={{ name: currentUser?.display_name || currentUser?.email || 'Account', avatar_url: currentUser?.avatar_url }} size="small" />
          <span>{currentUser?.display_name || currentUser?.email || copy.settings}</span>
          <SettingsIcon size={18} />
        </button>
        <button type="button" className="text-button" data-close-drawer onClick={onManageGroups}>{locale === 'zh-TW' ? '管理群組' : 'Manage groups'}</button>
      </footer>
    </nav>
  )
}
