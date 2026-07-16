import { useEffect, useRef, useState } from 'react'
import { MicrophoneIcon, SendIcon, StopIcon } from '../../components/icons.jsx'

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
  onToggleRecording,
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
  const zh = locale === 'zh-TW'
  const disabled = isSending || isRecording

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = `${BASE_HEIGHT}px`
    input.style.height = `${Math.min(input.scrollHeight || BASE_HEIGHT, MAX_HEIGHT)}px`
  }, [value])

  const submit = () => {
    const clean = (value || '').trim()
    if (!clean || disabled) return
    onSend?.(clean)
  }

  return (
    <form className="composer" onSubmit={(event) => { event.preventDefault(); submit() }}>
      {isRecording ? (
        <div className="composer__recording" role="status">
          <span>{zh ? `錄音中 ${formatElapsed(recordingElapsedMs)}` : `Recording ${formatElapsed(recordingElapsedMs)}`}</span>
          <span className="composer__recording-track"><i style={{ width: `${Math.min((recordingElapsedMs / maxRecordMs) * 100, 100)}%` }} /></span>
        </div>
      ) : (
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
      )}
      <div className="composer__actions">
        {canRecord ? (
          <button type="button" className="icon-button" aria-label={isRecording ? (zh ? '停止錄音' : 'Stop recording') : (zh ? '開始錄音' : 'Start recording')} disabled={isSending} onClick={onToggleRecording}>
            {isRecording ? <StopIcon size={20} /> : <MicrophoneIcon size={20} />}
          </button>
        ) : null}
        <button type="submit" className="composer__send" aria-label={zh ? '傳送訊息' : 'Send message'} disabled={disabled || !(value || '').trim()}>
          <SendIcon size={19} />
        </button>
      </div>
    </form>
  )
}
