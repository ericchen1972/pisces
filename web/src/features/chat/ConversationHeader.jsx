import { useId } from 'react'
import { PhoneIcon } from '../../components/icons.jsx'
import { ContactAvatar } from './ContactGroup.jsx'

export default function ConversationHeader({ contact, locale = 'en', onBack, onCall, callDisabled = false }) {
  if (!contact) return null
  const zh = locale === 'zh-TW'
  const callDescriptionId = useId()
  const personCallDescription = zh ? '真人通話將於稍後開放' : 'Person-to-person calls are coming later'
  return (
    <header className="conversation-header">
      <button type="button" className="conversation-header__back" onClick={onBack} aria-label={zh ? '返回' : 'Back'}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <ContactAvatar contact={contact} />
      <div><strong>{contact.name}</strong>{contact.isAi ? <span>Convia AI</span> : null}</div>
      <button type="button" className="icon-button conversation-header__call" onClick={onCall} disabled={callDisabled} aria-label={zh ? '語音通話' : 'Voice call'} aria-describedby={callDisabled ? callDescriptionId : undefined} title={callDisabled ? personCallDescription : undefined}>
        <PhoneIcon size={20} />
      </button>
      {callDisabled ? <span id={callDescriptionId} className="sr-only">{personCallDescription}</span> : null}
    </header>
  )
}
