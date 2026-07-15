import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MicrophoneIcon, PhoneIcon, SpeakerIcon } from '../../components/icons.jsx'
import { useModalMechanics } from '../../components/useModalMechanics.js'

function formatDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0)
  return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`
}

export default function AiCallOverlay({
  locale = 'en',
  name = 'Convia AI',
  avatar = '',
  status = 'connecting',
  error,
  muted = false,
  speakerEnabled = true,
  elapsedSeconds,
  onToggleMute,
  onToggleSpeaker,
  onHangUp,
  onRetry,
}) {
  const zh = locale === 'zh-TW'
  const modalRootRef = useRef(null)
  const dialogRef = useRef(null)
  const [internalElapsed, setInternalElapsed] = useState(0)
  const shownElapsed = elapsedSeconds == null ? internalElapsed : elapsedSeconds
  const onKeyDown = useModalMechanics({ open: true, dialogRef, modalRootRef, onClose: onHangUp })

  useEffect(() => {
    if (status === 'connecting') setInternalElapsed(0)
  }, [status])

  useEffect(() => {
    if (status !== 'connected' || elapsedSeconds != null) return undefined
    const timer = window.setInterval(() => setInternalElapsed((value) => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [elapsedSeconds, status])

  const stateText = status === 'connected'
    ? (zh ? '已連線' : 'Connected')
    : status === 'error'
      ? (zh ? '通話無法連線' : 'Unable to connect')
      : status === 'closed'
        ? (zh ? '通話已結束' : 'Call ended')
        : (zh ? '連線中…' : 'Connecting…')
  const microphoneMessage = error?.code === 'microphone_denied'
    ? (zh ? '需要允許麥克風存取。' : 'Microphone access is required.')
    : (error?.message || '')

  return createPortal(
    <div ref={modalRootRef} className="ai-call-overlay">
      <section ref={dialogRef} className="ai-call-card" role="dialog" aria-modal="true" aria-label={zh ? 'Convia AI 語音通話' : 'Convia AI voice call'} tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="ai-call-card__identity">
          {avatar ? <img src={avatar} alt="" className="ai-call-card__avatar" /> : <div className="ai-call-card__avatar ai-call-card__avatar--fallback" aria-hidden="true">C</div>}
          <h2>{name}</h2>
          <p aria-live="polite">{stateText}</p>
          {status === 'connected' ? <time>{formatDuration(shownElapsed)}</time> : null}
        </div>

        <div className="ai-call-waveform" aria-hidden="true">
          {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
        </div>

        {microphoneMessage ? <p className="ai-call-card__error" role="alert">{microphoneMessage}</p> : null}
        {status === 'error' && onRetry ? <button type="button" className="ai-call-card__retry" onClick={onRetry}>{zh ? '再試一次' : 'Try again'}</button> : null}

        <p className="ai-call-card__disclosure">{zh ? 'AI 生成語音' : 'AI-generated voice'}</p>
        <div className="ai-call-controls">
          <button type="button" aria-label={muted ? (zh ? '取消靜音' : 'Unmute') : (zh ? '靜音' : 'Mute')} aria-pressed={muted} onClick={onToggleMute}>
            <MicrophoneIcon size={24} />
          </button>
          <button type="button" aria-label={speakerEnabled ? (zh ? '關閉擴音' : 'Turn speaker off') : (zh ? '開啟擴音' : 'Turn speaker on')} aria-pressed={speakerEnabled} onClick={onToggleSpeaker}>
            <SpeakerIcon size={24} />
          </button>
          <button type="button" data-autofocus className="ai-call-controls__hangup" aria-label={zh ? '掛斷' : 'Hang up'} onClick={onHangUp}>
            <PhoneIcon size={25} />
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
