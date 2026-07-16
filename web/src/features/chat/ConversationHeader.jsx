import { useId } from 'react'
import { BackIcon, EditIcon, PhoneIcon } from '../../components/icons.jsx'
import { ContactAvatar } from './ContactGroup.jsx'

export default function ConversationHeader({ contact, locale = 'en', onBack, onCall, onEdit }) {
  const callDescriptionId = useId()
  if (!contact) return null
  const zh = locale === 'zh-TW'
  const personCallDescription = zh ? '真人通話稍後開放' : 'Person-to-person calls coming later'
  const personCallLongDescription = zh ? '真人通話將於稍後開放' : 'Person-to-person calls are coming later'
  const personCallDisabled = !contact.isAi
  return (
    <header className="conversation-header">
      <button type="button" className="conversation-header__back" onClick={onBack} aria-label={zh ? '返回' : 'Back'}>
        <BackIcon size={22} />
      </button>
      <ContactAvatar contact={contact} />
      <div><strong>{contact.name}</strong>{contact.isAi ? <span>Convia</span> : null}</div>
      <button type="button" className="icon-button conversation-header__edit" onClick={() => onEdit?.(contact)} aria-label={zh ? `編輯 ${contact.name}` : `Edit ${contact.name}`}>
        <EditIcon size={19} />
      </button>
      <button type="button" className="icon-button conversation-header__call" onClick={onCall} disabled={personCallDisabled} aria-label={personCallDisabled ? personCallDescription : (zh ? '語音通話' : 'Voice call')} aria-describedby={personCallDisabled ? callDescriptionId : undefined} title={personCallDisabled ? personCallLongDescription : undefined}>
        <PhoneIcon size={20} />
      </button>
      {personCallDisabled ? <span id={callDescriptionId} className="sr-only">{personCallLongDescription}</span> : null}
    </header>
  )
}
