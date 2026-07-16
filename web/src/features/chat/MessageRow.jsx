import { PlayIcon } from '../../components/icons.jsx'

const HUMAN_ROLES = new Set(['user', 'peer', 'assist_user'])
const AI_ROLES = new Set(['ai', 'ai_proxy', 'ai-typing'])

function DefaultAudio({ url, label }) {
  return (
    <div className="message-media__audio">
      <PlayIcon size={18} />
      <audio src={url} controls aria-label={label} />
    </div>
  )
}

function RichContent({ message, locale, onImageClick, renderAudio }) {
  const audio = (url, label, kind) => renderAudio
    ? renderAudio({ url, label, kind, message })
    : <DefaultAudio url={url} label={label} />
  return (
    <div className="message-media">
      {message.audioUrl ? audio(message.audioUrl, locale === 'zh-TW' ? '播放語音訊息' : 'Play voice message', 'voice') : null}
      {message.imageUrl ? (
        <button type="button" className="message-media__image-button" onClick={() => onImageClick?.(message.imageUrl)}>
          <img src={message.imageUrl} alt={locale === 'zh-TW' ? '生成的圖片' : 'Generated image'} />
        </button>
      ) : null}
      {message.musicUrl ? audio(message.musicUrl, locale === 'zh-TW' ? '播放音樂' : 'Play music', 'music') : null}
      {(message.text || '').trim() ? <div className="message-row__text">{message.text}</div> : null}
    </div>
  )
}

export default function MessageRow({ message, locale = 'en', onImageClick, onRetry, renderAudio }) {
  if (!message) return null
  const isHuman = HUMAN_ROLES.has(message.role)
  const isUser = message.role === 'user' || message.role === 'assist_user'
  const isAssist = message.role === 'assist_ai'
  const isAssistUser = message.role === 'assist_user'
  const showAiLabel = AI_ROLES.has(message.role)
  const retry = onRetry || message.retry

  return (
    <article className={`message-row message-row--${isUser ? 'outgoing' : 'incoming'} message-row--${message.role}`} data-status={message.status || undefined}>
      {isAssist ? (
        <div className="message-row__private-label">
          {locale === 'zh-TW' ? 'Convia · 只有你看得到' : 'Convia · Only visible to you'}
        </div>
      ) : isAssistUser ? (
        <div className="message-row__private-label">{locale === 'zh-TW' ? '只有你看得到' : 'Only visible to you'}</div>
      ) : showAiLabel ? <div className="message-row__ai-label">Convia</div> : null}
      <div className={isHuman ? 'message-row__bubble' : 'message-row__plain'} {...(isHuman ? { 'data-bubble': true } : {})}>
        {(message.role === 'ai-typing' || message.status === 'streaming') && !(message.text || '').trim() ? (
          <span className="message-row__typing" aria-label={locale === 'zh-TW' ? '正在回覆' : 'Responding'}><i /><i /><i /></span>
        ) : (
          <RichContent message={message} locale={locale} onImageClick={onImageClick} renderAudio={renderAudio} />
        )}
      </div>
      {message.status === 'incomplete' ? (
        <div className="message-row__incomplete">
          <span>{locale === 'zh-TW' ? '回覆中斷' : 'Response interrupted'}</span>
          {retry ? <button type="button" onClick={retry}>{locale === 'zh-TW' ? '重試' : 'Retry'}</button> : null}
        </div>
      ) : null}
    </article>
  )
}
