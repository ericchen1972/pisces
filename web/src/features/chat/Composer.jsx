import { useEffect, useRef, useState } from 'react'
import { AiVoiceIcon, AttachmentIcon, CloseIcon, MicrophoneIcon, SendIcon, StopIcon } from '../../components/icons.jsx'
import { validateTrustedMediaUrl } from '../../lib/chatSend.js'

const BASE_HEIGHT = 24
const MAX_HEIGHT = 132

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export default function Composer({
  value,
  onChange,
  onSend,
  onAttachment,
  attachment,
  onRemoveAttachment,
  onToggleAssist,
  onToggleRecording,
  showAssist = false,
  assistActive = false,
  canRecord = false,
  isRecording = false,
  recordingElapsedMs = 0,
  maxRecordMs = 30000,
  isSending = false,
  locale = 'en',
}) {
  const inputRef = useRef(null)
  const compositionEndAt = useRef(0)
  const [isComposing, setIsComposing] = useState(false)
  const [attachmentOpen, setAttachmentOpen] = useState(false)
  const [attachmentKind, setAttachmentKind] = useState('image')
  const [attachmentUrl, setAttachmentUrl] = useState('')
  const [attachmentError, setAttachmentError] = useState('')
  const zh = locale === 'zh-TW'
  const disabled = isSending || isRecording

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = `${BASE_HEIGHT}px`
    input.style.height = `${Math.min(input.scrollHeight || BASE_HEIGHT, MAX_HEIGHT)}px`
  }, [value])

  useEffect(() => {
    if (onAttachment) return
    setAttachmentOpen(false)
    setAttachmentKind('image')
    setAttachmentUrl('')
    setAttachmentError('')
  }, [onAttachment])

  const submit = () => {
    const clean = (value || '').trim()
    if ((!clean && !attachment) || disabled) return
    onSend?.(clean)
  }

  return (
    <form className={`composer${assistActive ? ' composer--assist' : ''}`} onSubmit={(event) => { event.preventDefault(); submit() }}>
      {isRecording ? (
        <div className="composer__recording" role="status">
          <span>{zh ? `錄音中 ${formatElapsed(recordingElapsedMs)}` : `Recording ${formatElapsed(recordingElapsedMs)}`}</span>
          <span className="composer__recording-track"><i style={{ width: `${Math.min((recordingElapsedMs / maxRecordMs) * 100, 100)}%` }} /></span>
        </div>
      ) : (
        <>
        {attachment ? (
          <div className="composer__attachment-chip">
            <span>{attachment.kind === 'music' ? (zh ? '音樂' : 'Music') : (zh ? '圖片' : 'Image')}: {attachment.url}</span>
            <button type="button" onClick={onRemoveAttachment} aria-label={zh ? '移除附件' : 'Remove attachment'}><CloseIcon size={15} /></button>
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(event) => onChange?.(event.target.value)}
          onCompositionStart={() => setIsComposing(true)}
          onCompositionEnd={() => { setIsComposing(false); compositionEndAt.current = Date.now() }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            const native = event.nativeEvent || {}
            const keyCode = Number(event.keyCode || native.keyCode || native.which || 0)
            if (isComposing || event.isComposing || native.isComposing || keyCode === 229 || Date.now() - compositionEndAt.current < 40) return
            event.preventDefault()
            submit()
          }}
          disabled={isSending}
          placeholder={zh ? '輸入訊息' : 'Message Convia'}
          aria-label={zh ? '輸入訊息' : 'Message'}
        />
        </>
      )}
      <div className="composer__actions">
        <button type="button" className="icon-button" aria-label={zh ? '新增附件' : 'Add attachment'} aria-expanded={attachmentOpen} disabled={disabled || !onAttachment} onClick={() => setAttachmentOpen((open) => !open)}>
          <AttachmentIcon size={20} />
        </button>
        {showAssist ? (
          <button type="button" className="icon-button" aria-label="AI Assist" aria-pressed={assistActive} disabled={disabled} onClick={onToggleAssist}>
            <AiVoiceIcon size={20} />
          </button>
        ) : null}
        {canRecord ? (
          <button type="button" className="icon-button" aria-label={isRecording ? (zh ? '停止錄音' : 'Stop recording') : (zh ? '開始錄音' : 'Start recording')} disabled={isSending} onClick={onToggleRecording}>
            {isRecording ? <StopIcon size={20} /> : <MicrophoneIcon size={20} />}
          </button>
        ) : null}
        <button type="submit" className="composer__send" aria-label={zh ? '傳送訊息' : 'Send message'} disabled={disabled || (!(value || '').trim() && !attachment)}>
          <SendIcon size={19} />
        </button>
      </div>
      {attachmentOpen ? (
        <div className="composer__attachment-panel">
          <div className="composer__attachment-types" role="group" aria-label={zh ? '附件類型' : 'Attachment type'}>
            <button type="button" aria-pressed={attachmentKind === 'image'} onClick={() => setAttachmentKind('image')}>{zh ? '圖片' : 'Image'}</button>
            <button type="button" aria-pressed={attachmentKind === 'music'} onClick={() => setAttachmentKind('music')}>{zh ? '音樂' : 'Music'}</button>
          </div>
          <input
            type="url"
            value={attachmentUrl}
            aria-label={zh ? '附件網址' : 'Attachment URL'}
            placeholder="https://"
            onChange={(event) => { setAttachmentUrl(event.target.value); setAttachmentError('') }}
          />
          {attachmentError ? <span className="composer__attachment-error">{attachmentError}</span> : null}
          <button
            type="button"
            onClick={() => {
              let clean
              try {
                clean = validateTrustedMediaUrl(attachmentUrl)
              } catch {
                setAttachmentError(zh ? '請輸入可信任的 Vercel Blob HTTPS 網址' : 'Enter a trusted Vercel Blob HTTPS URL')
                return
              }
              if (!onAttachment) return
              onAttachment({ kind: attachmentKind, url: clean })
              setAttachmentOpen(false)
              setAttachmentUrl('')
            }}
          >
            {attachmentKind === 'music' ? (zh ? '附加音樂' : 'Attach music') : (zh ? '附加圖片' : 'Attach image')}
          </button>
        </div>
      ) : null}
    </form>
  )
}
