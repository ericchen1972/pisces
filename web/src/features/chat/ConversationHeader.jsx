import { useId } from 'react'
import { AiVoiceIcon, PhoneIcon } from '../../components/icons.jsx'
import { ContactAvatar } from './ContactGroup.jsx'

export default function ConversationHeader({ contact, locale = 'en', onBack, onCall, aiAssistMode = false, onAssistCall }) {
  const callDescriptionId = useId()
  if (!contact) return null
  const zh = locale === 'zh-TW'
  const personCallDescription = zh ? '真人通話稍後開放' : 'Person-to-person calls coming later'
  const personCallLongDescription = zh ? '真人通話將於稍後開放' : 'Person-to-person calls are coming later'
  const personCallDisabled = !contact.isAi
  return (
    <header className="conversation-header">
      <button type="button" className="conversation-header__back" onClick={onBack} aria-label={zh ? '返回' : 'Back'}>
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <ContactAvatar contact={contact} />
      <div><strong>{contact.name}</strong>{contact.isAi ? <span>Convia AI</span> : null}</div>
      {aiAssistMode && !contact.isAi ? (
        <button type="button" className="icon-button conversation-header__assist-call" onClick={onAssistCall} aria-label={zh ? '開始私人 AI 語音協助' : 'Start private AI voice assist'}>
          <AiVoiceIcon size={20} />
        </button>
      ) : null}
      <button type="button" className="icon-button conversation-header__call" onClick={onCall} disabled={personCallDisabled} aria-label={personCallDisabled ? personCallDescription : (zh ? '語音通話' : 'Voice call')} aria-describedby={personCallDisabled ? callDescriptionId : undefined} title={personCallDisabled ? personCallLongDescription : undefined}>
        <PhoneIcon size={20} />
      </button>
      {personCallDisabled ? <span id={callDescriptionId} className="sr-only">{personCallLongDescription}</span> : null}
    </header>
  )
}
