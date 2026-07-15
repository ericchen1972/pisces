import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleGenAI, Modality } from '@google/genai'
import * as Ably from 'ably'
import { localeFromLanguage } from './lib/i18n.js'
import {
  applyContactGroupAssignment,
  applyDeletedContactGroup,
  applyLocalThenRefresh,
  contactGroupStateFromResponse,
} from './lib/chatState.js'
import {
  consumeGuardedRequest,
  createAuthRequestGuard,
  createAuthTransitionCoordinator,
} from './lib/authRequestGuard.js'
import { resetAccountScopedRefs, stopActiveRecordingResources } from './lib/accountScope.js'
import { createAccountOperationScope } from './lib/operationScope.js'
import { mergeStreamMessage, streamAiTurn } from './lib/stream.js'
import {
  canonicalIncomingMessage,
  createClientRequestId,
  effectiveMessageRole,
  restoreAssistDraft,
  sendAssistRequest,
  sendPersonRequest,
  startExclusiveSend,
} from './lib/chatSend.js'
import ChatShell from './features/chat/ChatShell.jsx'
import ContactSidebar from './features/chat/ContactSidebar.jsx'
import Composer from './features/chat/Composer.jsx'
import Conversation from './features/chat/Conversation.jsx'
import ConversationEmptyState from './features/chat/ConversationEmptyState.jsx'
import GroupManagerDialog from './features/groups/GroupManagerDialog.jsx'
import './styles/app-shell.css'
import './styles/chat.css'
import './styles/dialogs.css'

const FALLBACK_API_BASE_URL = 'https://pisces-315346868518.asia-east1.run.app'
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8080'
const GOOGLE_CLIENT_ID = '315346868518-os2tf8uc5282bggj40jbpkaltae1phi9.apps.googleusercontent.com'
const MAX_RECORD_MS = 30000
const GEMINI_LIVE_GREETING = '請你先開場打招呼，用自然簡短的電話語氣先問候我。'
const LIVE_CONNECT_TIMEOUT_MS = 20000
const AI_DEFAULT_GLOBAL_PROMPT = 'You are a polite, warm, and thoughtful AI communication partner.'
const UI_STORAGE_KEY = 'pisces_ui_v1'
const AVATAR_SIZE = 256
const FEMALE_VOICE_OPTIONS = [
  'Achernar',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Despina',
  'Erinome',
  'Gacrux',
  'Kore',
  'Laomedeia',
  'Leda',
  'Pulcherrima',
  'Sulafat',
  'Vindemiatrix',
  'Zephyr',
]
const MALE_VOICE_OPTIONS = [
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Charon',
  'Enceladus',
  'Fenrir',
  'Iapetus',
  'Orus',
  'Puck',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Umbriel',
  'Zubenelgenubi',
]

function detectIsZhLocale() {
  if (typeof navigator === 'undefined') return false
  return localeFromLanguage(navigator.language) === 'zh-TW'
}

function tr(isZh, enText, zhText) {
  return isZh ? zhText : enText
}

function getApiBaseUrl() {
  const envBase = (import.meta.env.VITE_API_BASE_URL || '').trim()
  if (envBase) return envBase.replace(/\/$/, '')
  const host = window.location.hostname
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  return (isLocalHost ? LOCAL_API_BASE_URL : FALLBACK_API_BASE_URL).replace(/\/$/, '')
}

function navigateTo(pathname) {
  if (window.location.pathname === pathname) return
  window.history.pushState({}, '', pathname)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname)
  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  return pathname
}

function useIsPadUp() {
  const getValue = () => window.matchMedia('(min-width: 768px)').matches
  const [isPadUp, setIsPadUp] = useState(getValue)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const onChange = () => setIsPadUp(media.matches)
    if (media.addEventListener) {
      media.addEventListener('change', onChange)
    } else {
      media.addListener(onChange)
    }
    return () => {
      if (media.removeEventListener) {
        media.removeEventListener('change', onChange)
      } else {
        media.removeListener(onChange)
      }
    }
  }, [])

  return isPadUp
}

function useBackgroundImage(url) {
  useEffect(() => {
    const prev = {
      htmlHeight: document.documentElement.style.height,
      htmlOverflow: document.documentElement.style.overflow,
      margin: document.body.style.margin,
      height: document.body.style.height,
      minHeight: document.body.style.minHeight,
      overflow: document.body.style.overflow,
      backgroundImage: document.body.style.backgroundImage,
      backgroundSize: document.body.style.backgroundSize,
      backgroundPosition: document.body.style.backgroundPosition,
      backgroundRepeat: document.body.style.backgroundRepeat,
      backgroundAttachment: document.body.style.backgroundAttachment,
    }

    document.documentElement.style.height = '100%'
    document.documentElement.style.overflow = 'hidden'
    document.body.style.margin = '0'
    document.body.style.height = '100%'
    document.body.style.minHeight = '100dvh'
    document.body.style.overflow = 'hidden'
    document.body.style.backgroundImage = `url(${url})`
    document.body.style.backgroundSize = 'cover'
    document.body.style.backgroundPosition = 'center'
    document.body.style.backgroundRepeat = 'no-repeat'
    document.body.style.backgroundAttachment = 'fixed'

    return () => {
      document.documentElement.style.height = prev.htmlHeight
      document.documentElement.style.overflow = prev.htmlOverflow
      document.body.style.margin = prev.margin
      document.body.style.height = prev.height
      document.body.style.minHeight = prev.minHeight
      document.body.style.overflow = prev.overflow
      document.body.style.backgroundImage = prev.backgroundImage
      document.body.style.backgroundSize = prev.backgroundSize
      document.body.style.backgroundPosition = prev.backgroundPosition
      document.body.style.backgroundRepeat = prev.backgroundRepeat
      document.body.style.backgroundAttachment = prev.backgroundAttachment
    }
  }, [url])
}

function IconPower() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2v10" />
      <path d="M7 5.8A8 8 0 1 0 17 5.8" />
    </svg>
  )
}

function IconBluetooth() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 7l10 10-4 3V4l4 3L6 17" />
    </svg>
  )
}

function IconBattery() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="7" width="18" height="10" rx="2" />
      <path d="M22 10v4" />
      <path d="M5 12h9" />
    </svg>
  )
}

function IconUser() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c2-4 14-4 16 0" />
    </svg>
  )
}

function IconUserPlus() {
  return (
    <span style={{ position: 'relative', display: 'inline-block', width: 24, height: 24 }}>
      <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
        <IconUser />
      </span>
      <span
        style={{
          position: 'absolute',
          right: -2,
          bottom: -2,
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#fff',
          color: '#8f2bbf',
          fontSize: 10,
          fontWeight: 800,
          lineHeight: '12px',
          textAlign: 'center',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        }}
      >
        +
      </span>
    </span>
  )
}

function IconMessage() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 13a7 7 0 0 1-7 7H7l-4 3v-7a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7z" />
    </svg>
  )
}

function IconList() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconAiSpark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" />
      <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z" />
    </svg>
  )
}

function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .8 2.9a2 2 0 0 1-.4 2.1L8.2 10a16 16 0 0 0 5.8 5.8l1.3-1.3a2 2 0 0 1 2.1-.4c.9.4 1.9.7 2.9.8A2 2 0 0 1 22 16.9z" />
    </svg>
  )
}

function IconMoreVertical() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

function IconSave() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  )
}

function IconSettings() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 0 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h0a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6h0a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v0a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1z" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 2L11 13" />
      <path d="M22 2L15 22L11 13L2 9L22 2Z" />
    </svg>
  )
}

function IconEmoji() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 15a5 5 0 0 0 8 0" />
      <path d="M9 10h.01" />
      <path d="M15 10h.01" />
    </svg>
  )
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <path d="M12 17v5" />
      <path d="M8 22h8" />
    </svg>
  )
}

function IconStop() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const sec = Math.max(0, Math.floor(seconds))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function logPhoneLive(...args) {
  // Keep a single namespace so debugging call flow is easy in DevTools.
  console.log('[Pisces Live]', ...args)
}

function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const objectUrl = URL.createObjectURL(file)
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Unable to read image file.'))
    }
    image.src = objectUrl
  })
}

async function buildAvatarWebpBlob(file) {
  const image = await loadImageFile(file)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  const squareSide = Math.min(sourceWidth, sourceHeight)
  const sourceX = Math.floor((sourceWidth - squareSide) / 2)
  const sourceY = Math.floor((sourceHeight - squareSide) / 2)

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas context is not available.')
  }

  ctx.drawImage(
    image,
    sourceX,
    sourceY,
    squareSide,
    squareSide,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Failed to create avatar image.'))
          return
        }
        resolve(blob)
      },
      'image/webp',
      0.9,
    )
  })
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const base64 = result.includes(',') ? result.split(',')[1] : result
      if (!base64) {
        reject(new Error('Failed to encode image.'))
        return
      }
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read image blob.'))
    reader.readAsDataURL(blob)
  })
}

function float32ToInt16(float32Array) {
  const out = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    out[i] = s < 0 ? s * 32768 : s * 32767
  }
  return out
}

function downsampleBuffer(float32Array, inputRate, outputRate) {
  if (outputRate >= inputRate) return float32Array
  const sampleRateRatio = inputRate / outputRate
  const newLength = Math.round(float32Array.length / sampleRateRatio)
  const result = new Float32Array(newLength)
  let offsetResult = 0
  let offsetBuffer = 0
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * sampleRateRatio)
    let accum = 0
    let count = 0
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i += 1) {
      accum += float32Array[i]
      count += 1
    }
    result[offsetResult] = count > 0 ? accum / count : 0
    offsetResult += 1
    offsetBuffer = nextOffsetBuffer
  }
  return result
}

function AudioMessagePlayer({ audioUrl, variant = 'user', durationHint = 0 }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(
    Number.isFinite(durationHint) && durationHint > 0 ? durationHint : 0,
  )
  const isAi = variant === 'ai'
  const buttonGradient = isAi
    ? 'linear-gradient(135deg, rgb(124 188 255) 0%, rgb(81 140 245) 55%, rgb(66 217 232) 100%)'
    : 'linear-gradient(135deg, rgb(255, 124, 183) 0%, rgb(236, 75, 167) 55%, rgb(237 195 255) 100%)'
  const waveColor = isAi ? '#9ed8ff' : '#ff84c2'
  const buttonShadow = isAi ? '0 4px 10px rgba(37, 84, 161, 0.35)' : '0 4px 10px rgba(96, 24, 121, 0.35)'

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => {
      const d = Number(audio.duration)
      if (Number.isFinite(d) && d > 0) {
        setDuration(d)
      } else if (Number.isFinite(durationHint) && durationHint > 0) {
        setDuration(durationHint)
      } else {
        setDuration(0)
      }
    }
    const onDurationChange = () => {
      const d = Number(audio.duration)
      if (Number.isFinite(d) && d > 0) {
        setDuration(d)
      }
    }
    const onEnded = () => setIsPlaying(false)

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended', onEnded)
    }
  }, [durationHint])

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      try {
        await audio.play()
        setIsPlaying(true)
      } catch {
        setIsPlaying(false)
      }
    }
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />
      <div style={{ display: 'grid', gridTemplateColumns: '48px 1fr', alignItems: 'center', columnGap: 10 }}>
        <button
          type="button"
          onClick={togglePlay}
          style={{
            width: 46,
            height: 46,
            borderRadius: '50%',
            border: '1px solid rgba(255,255,255,0.7)',
            background: buttonGradient,
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: buttonShadow,
          }}
          aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
        >
          {isPlaying ? <IconStop /> : <IconPlay />}
        </button>

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'end', gap: 4, height: 26 }}>
            {Array.from({ length: 24 }).map((_, i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 8 + ((i * 7) % 14),
                  borderRadius: 999,
                  background: waveColor,
                  opacity: 0.9,
                  transformOrigin: 'bottom',
                  animation: isPlaying ? `wavePulse 920ms ease-in-out ${i * 40}ms infinite` : 'none',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
            <span>{formatTime(duration || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageRichContent({ msg, variant = 'user', onImageClick }) {
  const hasAudio = !!msg.audioUrl
  const hasImage = !!msg.imageUrl
  const hasMusic = !!msg.musicUrl
  const hasText = !!(msg.text || '').trim()
  if (!hasAudio && !hasImage && !hasMusic) {
    return hasText ? msg.text : null
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {hasAudio ? (
        <AudioMessagePlayer
          audioUrl={msg.audioUrl}
          variant={variant === 'ai' ? 'ai' : 'user'}
          durationHint={Number(msg.audioDuration || 0)}
        />
      ) : null}
      {hasImage ? (
        <img
          src={msg.imageUrl}
          alt="Generated"
          onClick={() => onImageClick?.(msg.imageUrl)}
          style={{
            width: 'min(280px, 72vw)',
            maxWidth: '100%',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.35)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.24)',
            objectFit: 'cover',
            cursor: 'zoom-in',
          }}
        />
      ) : null}
      {hasMusic ? (
        <AudioMessagePlayer
          audioUrl={msg.musicUrl}
          variant={variant === 'ai' ? 'ai' : 'user'}
          durationHint={0}
        />
      ) : null}
      {hasText ? <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{msg.text}</div> : null}
    </div>
  )
}

function LoginHome() {
  useBackgroundImage('/images/background.webp')
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const isZh = useMemo(() => detectIsZhLocale(), [])
  const t = (enText, zhText) => tr(isZh, enText, zhText)
  const isPadUp = useIsPadUp()
  const googleButtonRef = useRef(null)
  const [googleError, setGoogleError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [hoveredContactId, setHoveredContactId] = useState(null)
  const [openContactMenuId, setOpenContactMenuId] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [pendingAttachment, setPendingAttachment] = useState(null)
  const [messagesByContact, setMessagesByContact] = useState({})
  const [unreadByContact, setUnreadByContact] = useState({})
  const [contactGroups, setContactGroups] = useState([])
  const [defaultContactGroupId, setDefaultContactGroupId] = useState('')
  const [groupManagerOpen, setGroupManagerOpen] = useState(false)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [micAllowed, setMicAllowed] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isAwaitingReply, setIsAwaitingReply] = useState(false)
  const [isAiAssistMode, setIsAiAssistMode] = useState(false)
  const [showPhoneOverlay, setShowPhoneOverlay] = useState(false)
  const [phone2RotationDeg, setPhone2RotationDeg] = useState(0)
  const [showPhonePeerAvatar, setShowPhonePeerAvatar] = useState(false)
  const [phoneLiveStatus, setPhoneLiveStatus] = useState('idle')
  const [contacts, setContacts] = useState([
    {
      id: 'pisces-core',
      name: '💜✨Pisces✨💜',
      avatar: '/images/fish.png',
      snippet: '',
      isAi: true,
      gender: 'female',
      voice: 'Achernar',
      globalPrompt: AI_DEFAULT_GLOBAL_PROMPT,
    },
  ])
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [isAliasEditing, setIsAliasEditing] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [avatarUploadError, setAvatarUploadError] = useState('')
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [identifyCodeInput, setIdentifyCodeInput] = useState('')
  const [historyRangeInput, setHistoryRangeInput] = useState('30')
  const [settingsError, setSettingsError] = useState('')
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [testerModalOpen, setTesterModalOpen] = useState(false)
  const [testerEmail, setTesterEmail] = useState('')
  const [testerAvatarUrl, setTesterAvatarUrl] = useState('')
  const [testerError, setTesterError] = useState('')
  const [testerSubmitting, setTesterSubmitting] = useState(false)
  const [addFriendModalOpen, setAddFriendModalOpen] = useState(false)
  const [friendEmailInput, setFriendEmailInput] = useState('')
  const [friendAliasInput, setFriendAliasInput] = useState('')
  const [friendCodeInput, setFriendCodeInput] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [addFriendSuccess, setAddFriendSuccess] = useState('')
  const [addFriendSubmitting, setAddFriendSubmitting] = useState(false)
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState(null)
  const [pendingAvatarPreviewUrl, setPendingAvatarPreviewUrl] = useState('')
  const [recordElapsedMs, setRecordElapsedMs] = useState(0)
  const [imageViewerUrl, setImageViewerUrl] = useState('')
  const restoredSelectedContactIdRef = useRef(null)
  const selectedContactIdRef = useRef('')
  const chatDraftVersionRef = useRef(0)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordIntervalRef = useRef(null)
  const recordTimeoutRef = useRef(null)
  const phoneRingAudioRef = useRef(null)
  const phonePickupAudioRef = useRef(null)
  const phoneAudioSeqRef = useRef(0)
  const phoneAvatarTimerRef = useRef(null)
  const phoneHangupTimersRef = useRef([])
  const phoneLiveSessionRef = useRef(null)
  const phoneLiveConnectPromiseRef = useRef(null)
  const phoneAudioContextRef = useRef(null)
  const phonePlaybackTimeRef = useRef(0)
  const phoneMicStreamRef = useRef(null)
  const phoneMicAudioContextRef = useRef(null)
  const phoneMicSourceRef = useRef(null)
  const phoneMicProcessorRef = useRef(null)
  const phoneLiveContextRef = useRef('')
  const phoneLiveOperationContextRef = useRef(null)
  const liveAboutFriendInjectedRef = useRef(new Set())
  const liveAboutFriendPendingRef = useRef(new Set())
  const recordingOperationRef = useRef(null)
  const aiStreamOperationRef = useRef(null)
  const assistSendOperationRef = useRef(null)
  const personSendOperationRef = useRef(null)
  const avatarFileInputRef = useRef(null)
  const ablyRealtimeRef = useRef(null)
  const ablyChannelRef = useRef(null)
  const authRequestGuardRef = useRef(null)
  if (!authRequestGuardRef.current) authRequestGuardRef.current = createAuthRequestGuard()
  const authRequestGuard = authRequestGuardRef.current
  const authTransitionCoordinatorRef = useRef(null)
  if (!authTransitionCoordinatorRef.current) {
    authTransitionCoordinatorRef.current = createAuthTransitionCoordinator(authRequestGuard)
  }
  const authTransitionCoordinator = authTransitionCoordinatorRef.current
  const accountOperationScopeRef = useRef(null)
  if (!accountOperationScopeRef.current) {
    accountOperationScopeRef.current = createAccountOperationScope(authRequestGuard)
  }
  const accountOperationScope = accountOperationScopeRef.current
  const liveOperationScopeRef = useRef(null)
  if (!liveOperationScopeRef.current) {
    liveOperationScopeRef.current = createAccountOperationScope(authRequestGuard)
  }
  const liveOperationScope = liveOperationScopeRef.current
  const aiContactAvatar = contacts.find((c) => c.isAi)?.avatar || '/images/fish.png'
  const aiAvatarForCall = currentUser?.ai_avatar_url || aiContactAvatar || '/images/fish.png'
  const callPeerAvatarUrl = selectedContact
    ? (selectedContact.isAi || isAiAssistMode ? aiAvatarForCall : selectedContact.avatar)
    : aiAvatarForCall

  const buildViewMessages = (rawMessages = []) => {
    const view = []
    const groupIndexById = {}
    rawMessages.forEach((message) => {
      const role = effectiveMessageRole(message)
      if (role === 'assist_user' || role === 'assist_ai') {
        const gid = message.assist_group_id || `assist-${message.id}`
        let idx = groupIndexById[gid]
        if (idx == null) {
          idx = view.length
          groupIndexById[gid] = idx
          view.push({
            id: gid,
            role: 'assist_group',
            groupId: gid,
            collapsed: true,
            userText: '',
            aiText: '',
            aiAudioUrl: '',
          })
        }
        if (role === 'assist_user') view[idx].userText = message.text || ''
        if (role === 'assist_ai') {
          view[idx].aiText = message.text || ''
          view[idx].aiAudioUrl = message.audio_url || ''
        }
        return
      }
      view.push({
        id: message.id || `${message.role}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        text: message.text || '',
        audioUrl: message.audio_url || '',
        audioDuration: Number(message.audio_duration_seconds || 0),
        imageUrl: message.image_url || '',
        musicUrl: message.music_url || '',
        senderMode: message.sender_mode || '',
        avatarUrl: message.avatar_url || '',
      })
    })
    return view
  }

  const resetAccountScopedData = () => {
    accountOperationScope.invalidate()
    liveOperationScope.invalidate()
    recordingOperationRef.current = null
    aiStreamOperationRef.current = null
    assistSendOperationRef.current = null
    personSendOperationRef.current = null
    stopActiveRecordingResources({
      mediaRecorderRef,
      mediaStreamRef,
      recordChunksRef,
      clearTimers: clearRecordingTimers,
    })
    stopPhoneSounds()
    void closePhoneLiveSession()
    if (ablyChannelRef.current) {
      try {
        ablyChannelRef.current.unsubscribe()
      } catch {
        // ignore stale realtime channel cleanup errors
      }
      ablyChannelRef.current = null
    }
    if (ablyRealtimeRef.current) {
      try {
        ablyRealtimeRef.current.close()
      } catch {
        // ignore stale realtime connection cleanup errors
      }
      ablyRealtimeRef.current = null
    }
    setContacts([])
    selectedContactIdRef.current = ''
    setSelectedContact(null)
    setMessagesByContact({})
    setPendingAttachment(null)
    setUnreadByContact({})
    setContactGroups([])
    setDefaultContactGroupId('')
    setChatInput('')
    chatDraftVersionRef.current = 0
    setIsAiAssistMode(false)
    setIsHistoryLoading(false)
    setIsAwaitingReply(false)
    setIsRecording(false)
    setRecordElapsedMs(0)
    setSettingsSaving(false)
    setAddFriendSubmitting(false)
    setIsUploadingAvatar(false)
    setGroupManagerOpen(false)
    setOpenContactMenuId(null)
    setEditModalOpen(false)
    setSettingsModalOpen(false)
    setAddFriendModalOpen(false)
    setIsAliasEditing(false)
    setEditForm(null)
    setAvatarUploadError('')
    setSettingsError('')
    setIdentifyCodeInput('')
    setAddFriendError('')
    setAddFriendSuccess('')
    setPendingAvatarBlob(null)
    setImageViewerUrl('')
    setShowPhoneOverlay(false)
    resetAccountScopedRefs({
      restoredSelectedContactIdRef,
      phoneLiveContextRef,
      liveAboutFriendInjectedRef,
      liveAboutFriendPendingRef,
    })
    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl)
      setPendingAvatarPreviewUrl('')
    }
  }

  const clearSessionAndLogout = async () => {
    authTransitionCoordinator.cancel()
    resetAccountScopedData()
    setIsSignedIn(false)
    setCurrentUser(null)
    try {
      await fetch(`${apiBaseUrl}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      })
    } catch {
      // ignore logout network errors
    }
    try {
      localStorage.removeItem(UI_STORAGE_KEY)
    } catch {
      // ignore storage errors
    }
    setTesterModalOpen(false)
    setTesterError('')
  }

  const upsertFriendContact = (friend) => {
    if (!friend?.id) return
    const nextContact = {
      id: friend.id,
      name: friend.name || friend.display_name || friend.email || 'Friend',
      avatar: friend.avatar_url || friend.avatar || '',
      avatar_url: friend.avatar_url || friend.avatar || '',
      snippet: friend.last_message_preview || friend.snippet || '',
      last_message_preview: friend.last_message_preview || friend.snippet || '',
      last_message_at: friend.last_message_at || null,
      group_id: friend.group_id || '',
      isAi: false,
    }
    setContacts((prev) => {
      const existingIndex = prev.findIndex((contact) => contact.id === nextContact.id)
      if (existingIndex >= 0) {
        const cloned = [...prev]
        const existing = cloned[existingIndex]
        cloned[existingIndex] = {
          ...existing,
          ...nextContact,
          avatar: nextContact.avatar || existing.avatar || '',
          avatar_url: nextContact.avatar_url || existing.avatar_url || '',
          snippet: nextContact.snippet || existing.snippet || '',
          last_message_preview: nextContact.last_message_preview || existing.last_message_preview || '',
          last_message_at: nextContact.last_message_at || existing.last_message_at || null,
          group_id: nextContact.group_id || existing.group_id || defaultContactGroupId || '',
        }
        return cloned
      }
      const next = [...prev]
      nextContact.group_id ||= defaultContactGroupId || ''
      next.splice(1, 0, nextContact)
      return next
    })
  }

  const applySignedInUser = (user, transition = null) => {
    if (!user?.id) return null
    const authContext = transition
      ? authTransitionCoordinator.complete(transition, user.id)
      : authRequestGuard.activate(user.id)
    if (!authContext) return null
    resetAccountScopedData()
    setCurrentUser(user || null)
    setIsSignedIn(true)

    const fetchedAiSettings = user?.ai_settings || {}
    const nextGender = fetchedAiSettings.gender || 'female'
    const nextVoice = fetchedAiSettings.voice || 'Achernar'
    const nextGlobalPrompt = fetchedAiSettings.global_prompt || AI_DEFAULT_GLOBAL_PROMPT
    const nextAvatar = user?.ai_avatar_url || '/images/fish.png'
    setContacts([
      {
        id: 'pisces-core',
        name: 'Convia AI',
        avatar: nextAvatar,
        snippet: '',
        isAi: true,
        gender: nextGender,
        voice: nextVoice,
        globalPrompt: nextGlobalPrompt,
      },
    ])
    return authContext
  }

  const requestContactGroups = async (endpoint, body = {}, authContext = authRequestGuard.snapshot()) => {
    if (!authContext.userId || !authRequestGuard.isCurrent(authContext)) {
      return { ok: false, stale: true, groups: [] }
    }
    const res = await fetch(`${apiBaseUrl}/api/contact-groups/${endpoint}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || `Contact group request failed (HTTP ${res.status})`)
    if (!authRequestGuard.isCurrent(authContext)) return { ...data, stale: true }
    if (Array.isArray(data.groups)) {
      const state = contactGroupStateFromResponse(data)
      authRequestGuard.runIfCurrent(authContext, () => setContactGroups(state.groups))
      authRequestGuard.runIfCurrent(authContext, () => setDefaultContactGroupId(state.defaultContactGroupId))
    } else if (typeof data.default_contact_group_id === 'string') {
      authRequestGuard.runIfCurrent(authContext, () => setDefaultContactGroupId(data.default_contact_group_id.trim()))
    }
    return data
  }

  const loadContactGroups = async (signedInUser, { bootstrap = false, authContext = authRequestGuard.snapshot() } = {}) => {
    if (!signedInUser?.id) return []
    if (authContext.userId !== signedInUser.id || !authRequestGuard.isCurrent(authContext)) return []
    const data = await requestContactGroups(bootstrap ? 'bootstrap' : 'list', bootstrap ? { locale: isZh ? 'zh-TW' : 'en' } : {}, authContext)
    return data.groups || []
  }

  const loadFriendsList = async (signedInUser, authContext = authRequestGuard.snapshot()) => {
    if (!signedInUser?.id) return
    if (authContext.userId !== signedInUser.id || !authRequestGuard.isCurrent(authContext)) return false
    try {
      const res = await fetch(`${apiBaseUrl}/api/friends/list`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: isZh ? 'zh-TW' : 'en' }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t(`Failed to load friends (HTTP ${res.status})`, `載入好友失敗（HTTP ${res.status}）`))
      }
      if (!authRequestGuard.isCurrent(authContext)) return false
      const friendContacts = (data.friends || []).map((friend) => ({
        id: friend.id,
        name: friend.name || friend.display_name || 'Friend',
        avatar: friend.avatar_url || '',
        avatar_url: friend.avatar_url || '',
        specialPrompt: friend.special_prompt || '',
        relationship: friend.relationship || '',
        unreadCount: Number(friend.unread_count || 0),
        snippet: friend.last_message_preview || '',
        last_message_preview: friend.last_message_preview || '',
        last_message_at: friend.last_message_at || null,
        group_id: friend.group_id || '',
        isAi: false,
      }))
      authRequestGuard.runIfCurrent(authContext, () => setContacts((prev) => [prev[0], ...friendContacts]))
      const unreadMap = {}
      friendContacts.forEach((c) => {
        unreadMap[c.id] = Number.isFinite(c.unreadCount) ? Math.max(0, c.unreadCount) : 0
      })
      authRequestGuard.runIfCurrent(authContext, () => setUnreadByContact(unreadMap))
      return true
    } catch (error) {
      throw error
    }
  }

  const initializeContactData = async (signedInUser, { bootstrap = true, authContext = authRequestGuard.snapshot() } = {}) => {
    if (!signedInUser?.id) return
    if (authContext.userId !== signedInUser.id || !authRequestGuard.isCurrent(authContext)) return
    try {
      await loadContactGroups(signedInUser, { bootstrap, authContext })
      await loadFriendsList(signedInUser, authContext)
    } catch {
      // Keep the signed-in shell usable when a refresh request is temporarily unavailable.
    }
  }

  const mutateGroups = async (endpoint, body) => {
    const authContext = authRequestGuard.snapshot()
    const data = await requestContactGroups(endpoint, body, authContext)
    return data.stale ? null : data.groups || []
  }

  const deleteGroup = async (groupId, moveToGroupId) => {
    const authContext = authRequestGuard.snapshot()
    const data = await requestContactGroups('delete', { group_id: groupId, move_to_group_id: moveToGroupId }, authContext)
    if (data.stale) return null
    const deletion = data.deletion || { deleted_group_id: groupId, move_to_group_id: moveToGroupId }
    await applyLocalThenRefresh(
      () => authRequestGuard.runIfCurrent(authContext, () => setContacts((previous) => applyDeletedContactGroup(previous, deletion.deleted_group_id, deletion.move_to_group_id))),
      async () => {
        const refreshed = await loadFriendsList(currentUser, authContext)
        if (!refreshed) throw new Error('Friend refresh was superseded')
      },
    )
    return data.groups || []
  }

  const markContactAsRead = async (contactId) => {
    if (!isSignedIn || !contactId || contactId === 'pisces-core') return
    setUnreadByContact((prev) => ({ ...prev, [contactId]: 0 }))
    try {
      await fetch(`${apiBaseUrl}/api/chat/mark-read`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId }),
      })
    } catch {
      // ignore mark-read errors in UI
    }
  }

  const submitTesterLogin = async (e) => {
    e.preventDefault()
    const email = testerEmail.trim().toLowerCase()
    const avatarUrl = testerAvatarUrl.trim()
    if (!email) {
      setTesterError('Email is required.')
      return
    }
    const authTransition = authTransitionCoordinator.begin()
    try {
      setTesterSubmitting(true)
      setTesterError('')
      const res = await fetch(`${apiBaseUrl}/api/auth/tester`, {
        method: 'POST',
        credentials: 'include',
        signal: authTransition.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, avatar_url: avatarUrl }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t(`Tester login failed (HTTP ${res.status})`, `測試帳號登入失敗（HTTP ${res.status}）`))
      }
      const authContext = applySignedInUser(data.user || null, authTransition)
      if (!authContext) return
      initializeContactData(data.user || null, { authContext })
      setTesterModalOpen(false)
      setTesterEmail('')
      setTesterAvatarUrl('')
    } catch (err) {
      if (err?.name === 'AbortError') return
      setTesterError(err?.message || t('Tester login failed.', '測試帳號登入失敗。'))
    } finally {
      if (!authTransition.signal.aborted) setTesterSubmitting(false)
    }
  }

  const openSettingsModal = () => {
    if (!isSignedIn || !currentUser?.id) return
    setSettingsError('')
    setIdentifyCodeInput((currentUser?.identify_code || '').trim())
    setHistoryRangeInput(String(currentUser?.history_range || 30))
    setSettingsModalOpen(true)
  }

  const saveUserSettings = async (e) => {
    e.preventDefault()
    if (!isSignedIn || !currentUser?.id) return
    const authContext = authRequestGuard.snapshot()
    if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== String(currentUser.id)) return

    let historyRange = Number.parseInt(historyRangeInput, 10)
    if (!Number.isFinite(historyRange)) historyRange = 30
    if (historyRange < 10) historyRange = 10
    if (historyRange > 60) historyRange = 60

    authRequestGuard.runIfCurrent(authContext, () => {
      setSettingsSaving(true)
      setSettingsError('')
    })
    await consumeGuardedRequest({
      guard: authRequestGuard,
      context: authContext,
      request: async () => {
        const res = await fetch(`${apiBaseUrl}/api/user/settings`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identify_code: identifyCodeInput,
            history_range: historyRange,
          }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `Save failed (HTTP ${res.status})`)
        }
        return data
      },
      onSuccess: (data) => {
        setCurrentUser((prev) =>
          prev
            ? {
                ...prev,
                identify_code: data?.user?.identify_code || '',
                history_range: Number(data?.user?.history_range || historyRange),
              }
            : prev,
        )
        setSettingsModalOpen(false)
      },
      onError: (err) => setSettingsError(err?.message || 'Failed to save settings.'),
      onSettled: () => setSettingsSaving(false),
    })
  }

  const openAddFriendModal = () => {
    if (!isSignedIn || !currentUser?.id) return
    setAddFriendError('')
    setAddFriendSuccess('')
    setFriendEmailInput('')
    setFriendAliasInput('')
    setFriendCodeInput('')
    setAddFriendModalOpen(true)
  }

  const submitAddFriendValidation = async (e) => {
    e.preventDefault()
    if (!isSignedIn || !currentUser?.id) return

    const email = friendEmailInput.trim().toLowerCase()
    const alias = friendAliasInput.trim()
    const code = friendCodeInput.trim()
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(email)) {
      setAddFriendError(t('Please enter a valid Google account email.', '請輸入有效的 Google 帳號 Email。'))
      return
    }
    if (alias.length < 2) {
      setAddFriendError(t('Name must be at least 2 characters.', '名稱至少要 2 個字元。'))
      return
    }
    const aliasTaken = contacts.some((contact) => !contact.isAi && contact.name.trim().toLowerCase() === alias.toLowerCase())
    if (aliasTaken) {
      setAddFriendError(t('This name is already used by another contact.', '這個名稱已被其他聯絡人使用。'))
      return
    }

    const authContext = authRequestGuard.snapshot()
    try {
      setAddFriendSubmitting(true)
      setAddFriendError('')
      setAddFriendSuccess('')
      const res = await fetch(`${apiBaseUrl}/api/friend/add`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friend_email: email,
          friend_alias: alias,
          identify_code: code,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t(`Add friend failed (HTTP ${res.status})`, `新增好友失敗（HTTP ${res.status}）`))
      }
      if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== currentUser.id) return
      const newFriend = data?.friend || {}
      const newContact = {
        id: newFriend.id,
        name: alias || newFriend.display_name || newFriend.email || 'Friend',
        avatar: newFriend.avatar_url || '',
        snippet: '',
        isAi: false,
      }
      upsertFriendContact(newContact)
      await initializeContactData(currentUser, { bootstrap: false, authContext })
      if (!authRequestGuard.isCurrent(authContext)) return
      setAddFriendSuccess('')
      setAddFriendError('')
      setFriendEmailInput('')
      setFriendAliasInput('')
      setFriendCodeInput('')
      setAddFriendModalOpen(false)
      selectedContactIdRef.current = ''
      setSelectedContact(null)
    } catch (err) {
      setAddFriendError(err?.message || t('Add friend failed.', '新增好友失敗。'))
    } finally {
      setAddFriendSubmitting(false)
    }
  }

  const onEditContact = (contact) => {
    setOpenContactMenuId(null)
    setIsAliasEditing(false)
    setAvatarUploadError('')
    setPendingAvatarBlob(null)
    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl)
      setPendingAvatarPreviewUrl('')
    }
    setEditForm({
      id: contact.id,
      isAi: Boolean(contact.isAi),
      avatar: contact.avatar,
      alias: contact.name,
      aliasOriginal: contact.name,
      specialPrompt: contact.specialPrompt || '',
      relationship: contact.relationship || '',
      gender: contact.gender || 'female',
      voice: contact.voice || 'Achernar',
      globalPrompt: contact.globalPrompt || AI_DEFAULT_GLOBAL_PROMPT,
    })
    setEditModalOpen(true)
  }

  const onDeleteContact = (contact) => {
    setOpenContactMenuId(null)
    if (contact.isAi) return
    setContacts((prev) => prev.filter((item) => item.id !== contact.id))
    if (selectedContact?.id === contact.id) {
      selectedContactIdRef.current = ''
      setSelectedContact(null)
    }
  }

  const loadContactHistory = async (contactId) => {
    if (!isSignedIn || !currentUser?.id || !contactId) return
    const authContext = authRequestGuard.snapshot()
    if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== String(currentUser.id)) return
    authRequestGuard.runIfCurrent(authContext, () => setIsHistoryLoading(true))
    await consumeGuardedRequest({
      guard: authRequestGuard,
      context: authContext,
      request: async () => {
        const res = await fetch(`${apiBaseUrl}/api/chat/history`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contact_id: contactId }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data.error || t(`History load failed (HTTP ${res.status})`, `載入歷史訊息失敗（HTTP ${res.status}）`))
        }
        return buildViewMessages(data.messages || [])
      },
      onSuccess: (nextMessages) => {
        setMessagesByContact((prev) => ({ ...prev, [contactId]: nextMessages }))
      },
      onError: (err) => {
        setMessagesByContact((prev) => {
          const current = prev[contactId] || []
          return {
            ...prev,
            [contactId]: [
              ...current,
              {
                id: `history-err-${Date.now()}`,
                role: 'ai',
                text: err?.message || t('Failed to load history.', '載入歷史訊息失敗。'),
              },
            ],
          }
        })
      },
      onSettled: () => setIsHistoryLoading(false),
    })
  }

  const onAliasBlur = () => {
    if (!editForm) return
    const trimmed = (editForm.alias || '').trim()
    if (trimmed.length < 2) {
      setEditForm((prev) => (prev ? { ...prev, alias: prev.aliasOriginal } : prev))
    } else {
      setEditForm((prev) => (prev ? { ...prev, alias: trimmed } : prev))
    }
    setIsAliasEditing(false)
  }

  const onSaveContactEdit = async () => {
    if (!editForm) return
    const authContext = authRequestGuard.snapshot()
    const aliasTrimmed = (editForm.alias || '').trim()
    const nextAlias = aliasTrimmed.length >= 2 ? aliasTrimmed : editForm.aliasOriginal
    const aliasCollision = contacts.some(
      (contact) => contact.id !== editForm.id && contact.name.trim().toLowerCase() === nextAlias.toLowerCase(),
    )
    if (aliasCollision) {
      setAvatarUploadError(t('This name is already used by another contact.', '這個名稱已被其他聯絡人使用。'))
      return
    }
    let nextAvatarUrl = editForm.avatar

    if (editForm.isAi) {
      if (!currentUser?.id) {
        setAvatarUploadError(t('Please sign in again before saving AI settings.', '請重新登入後再儲存 AI 設定。'))
        return
      }

      try {
        setIsUploadingAvatar(true)
        setAvatarUploadError('')
        let avatarImageBase64 = ''
        let avatarMimeType = 'image/webp'

        if (pendingAvatarBlob) {
          avatarImageBase64 = await blobToBase64(pendingAvatarBlob)
          avatarMimeType = pendingAvatarBlob.type || 'image/webp'
        }
        if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== currentUser.id) return

        const saveRes = await fetch(`${apiBaseUrl}/api/user/ai-settings`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...(nextAvatarUrl && nextAvatarUrl.startsWith('https://')
              ? { avatar_url: nextAvatarUrl }
              : {}),
            ...(avatarImageBase64
              ? {
                  avatar_image_base64: avatarImageBase64,
                  avatar_mime_type: avatarMimeType,
                }
              : {}),
            gender: editForm.gender,
            voice: editForm.voice,
            global_prompt: editForm.globalPrompt,
          }),
        })
        const saveData = await saveRes.json()
        if (!saveRes.ok || !saveData.ok) {
          throw new Error(saveData.error || `Save failed (HTTP ${saveRes.status})`)
        }
        if (!authRequestGuard.isCurrent(authContext)) return
        nextAvatarUrl = saveData?.user?.ai_avatar_url || nextAvatarUrl
      } catch (err) {
        setAvatarUploadError(err?.message || t('Save failed.', '儲存失敗。'))
        setIsUploadingAvatar(false)
        return
      } finally {
        setIsUploadingAvatar(false)
      }
    } else {
      if (!currentUser?.id) {
        setAvatarUploadError(t('Please sign in again before saving contact settings.', '請重新登入後再儲存聯絡人設定。'))
        return
      }

      try {
        setAvatarUploadError('')
        if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== currentUser.id) return
        const saveRes = await fetch(`${apiBaseUrl}/api/friend/settings`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            friend_user_id: editForm.id,
            alias: nextAlias,
            special_prompt: (editForm.specialPrompt || '').trim(),
            relationship: (editForm.relationship || '').trim(),
          }),
        })
        const saveData = await saveRes.json()
        if (!saveRes.ok || !saveData.ok) {
          throw new Error(saveData.error || `Save failed (HTTP ${saveRes.status})`)
        }
        if (!authRequestGuard.isCurrent(authContext)) return
      } catch (err) {
        setAvatarUploadError(err?.message || t('Save failed.', '儲存失敗。'))
        return
      }
    }

    if (!authRequestGuard.isCurrent(authContext)) return
    setContacts((prev) =>
      prev.map((contact) => {
        if (contact.id !== editForm.id) return contact
        const nextContact = {
          ...contact,
          name: nextAlias,
          avatar: nextAvatarUrl,
          specialPrompt: (editForm.specialPrompt || '').trim(),
          relationship: (editForm.relationship || '').trim(),
        }
        if (contact.isAi) {
          nextContact.gender = editForm.gender
          nextContact.voice = editForm.voice
          nextContact.globalPrompt = editForm.globalPrompt
        }
        return nextContact
      }),
    )

    if (selectedContact?.id === editForm.id) {
      setSelectedContact((prev) =>
        prev
          ? {
              ...prev,
              name: nextAlias,
              avatar: nextAvatarUrl,
              specialPrompt: (editForm.specialPrompt || '').trim(),
              relationship: (editForm.relationship || '').trim(),
              gender: editForm.gender,
              voice: editForm.voice,
              globalPrompt: editForm.globalPrompt,
            }
          : prev,
      )
    }

    if (editForm.isAi) {
      setCurrentUser((prev) =>
        prev
          ? {
              ...prev,
              ai_avatar_url: nextAvatarUrl,
              ai_settings: {
                gender: editForm.gender,
                voice: editForm.voice,
                global_prompt: editForm.globalPrompt,
              },
            }
          : prev,
      )
    }
    if (pendingAvatarPreviewUrl) {
      URL.revokeObjectURL(pendingAvatarPreviewUrl)
    }
    setPendingAvatarPreviewUrl('')
    setPendingAvatarBlob(null)
    setEditModalOpen(false)
    setEditForm(null)
    setIsAliasEditing(false)
  }

  const onPickAvatarFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editForm?.isAi) return

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setAvatarUploadError('Only jpg/png files are supported.')
      return
    }

    try {
      setAvatarUploadError('')
      const avatarBlob = await buildAvatarWebpBlob(file)
      const previewUrl = URL.createObjectURL(avatarBlob)
      if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl)
      }
      setPendingAvatarBlob(avatarBlob)
      setPendingAvatarPreviewUrl(previewUrl)
      setEditForm((prev) => (prev ? { ...prev, avatar: previewUrl } : prev))
    } catch (err) {
      setAvatarUploadError(err?.message || 'Avatar upload failed.')
    }
  }

  useEffect(() => {
    const restore = async () => {
      const authTransition = authTransitionCoordinator.begin()
      let activeRestoreContext = authTransition.context
      try {
        const res = await fetch(`${apiBaseUrl}/api/session/me`, {
          method: 'GET',
          credentials: 'include',
          signal: authTransition.signal,
        })
        const data = await res.json()
        if (res.ok && data?.ok && data?.authenticated && data?.user?.id) {
          const authContext = applySignedInUser(data.user, authTransition)
          if (authContext) {
            activeRestoreContext = authContext
            initializeContactData(data.user, { authContext })
          }
        }
      } catch (err) {
        if (err?.name === 'AbortError') return
        // ignore restore errors and continue with defaults
      }
      try {
        const rawUi = localStorage.getItem(UI_STORAGE_KEY)
        if (rawUi) {
          const uiState = JSON.parse(rawUi)
          if (uiState?.selectedContactId) {
            authRequestGuard.runIfCurrent(activeRestoreContext, () => {
              restoredSelectedContactIdRef.current = uiState.selectedContactId
            })
          }
        }
      } catch {
        // ignore restore errors and continue with defaults
      }
    }
    restore()
  }, [apiBaseUrl])

  useEffect(() => {
    if (isSignedIn) return
    let cancelled = false
    let attempts = 0

    const initGoogleButton = () => {
      if (cancelled) return

      const google = window.google
      if (google?.accounts?.id && googleButtonRef.current) {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            const authTransition = authTransitionCoordinator.begin()
            try {
              setIsLoggingIn(true)
              setGoogleError('')

              const res = await fetch(`${apiBaseUrl}/api/auth/google`, {
                method: 'POST',
                credentials: 'include',
                signal: authTransition.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential }),
              })
              const data = await res.json()
              if (!res.ok || !data.ok) {
                throw new Error(data.error || `Google login failed (HTTP ${res.status})`)
              }
              const authContext = applySignedInUser(data.user || null, authTransition)
              if (!authContext) return
              initializeContactData(data.user || null, { authContext })
            } catch (err) {
              if (err?.name === 'AbortError') return
              setGoogleError(err?.message || 'Google login failed.')
            } finally {
              if (!authTransition.signal.aborted) setIsLoggingIn(false)
            }
          },
        })

        googleButtonRef.current.innerHTML = ''
        google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: 320,
          logo_alignment: 'left',
        })
        setGoogleError('')
        return
      }

      attempts += 1
      if (attempts < 30) {
        window.setTimeout(initGoogleButton, 200)
      } else {
        setGoogleError('Google Sign-In failed to load.')
      }
    }

    initGoogleButton()
    return () => {
      cancelled = true
    }
  }, [isSignedIn, apiBaseUrl])

  useEffect(() => {
    if (!isSignedIn) return
    try {
      localStorage.setItem(
        UI_STORAGE_KEY,
        JSON.stringify({
          selectedContactId: selectedContact?.id || '',
        }),
      )
    } catch {
      // ignore storage errors
    }
  }, [isSignedIn, selectedContact])

  useEffect(() => {
    if (!isSignedIn || selectedContact || !restoredSelectedContactIdRef.current) return
    const target = contacts.find((contact) => contact.id === restoredSelectedContactIdRef.current)
    if (target) {
      selectedContactIdRef.current = target.id
      setSelectedContact(target)
      markContactAsRead(target.id)
      loadContactHistory(target.id)
    }
    restoredSelectedContactIdRef.current = null
  }, [isSignedIn, selectedContact, contacts])

  useEffect(() => {
    if (!isSignedIn || !currentUser?.id) return

    let isCancelled = false

    const setupAbly = async () => {
      try {
        if (ablyChannelRef.current) {
          try {
            ablyChannelRef.current.unsubscribe()
          } catch {
            // ignore
          }
          ablyChannelRef.current = null
        }
        if (ablyRealtimeRef.current) {
          try {
            ablyRealtimeRef.current.close()
          } catch {
            // ignore
          }
          ablyRealtimeRef.current = null
        }

        const realtime = new Ably.Realtime({
          authCallback: async (_tokenParams, callback) => {
            try {
              const res = await fetch(`${apiBaseUrl}/api/ably/token`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
              })
              const data = await res.json()
              if (!res.ok || !data.ok || !data.token_request) {
                throw new Error(data.error || `Ably auth failed (${res.status})`)
              }
              callback(null, data.token_request)
            } catch (err) {
              callback(err, null)
            }
          },
        })

        realtime.connection.on('connected', () => {
          const authContext = authRequestGuard.snapshot()
          if (!isCancelled && authContext.userId === currentUser.id) {
            initializeContactData(currentUser, { bootstrap: false, authContext })
          }
        })

        const subscriptionContext = authRequestGuard.snapshot()
        const channel = realtime.channels.get(`user_${currentUser.id}`)
        channel.subscribe('message.new', (message) => {
          if (isCancelled || !authRequestGuard.isCurrent(subscriptionContext) || subscriptionContext.userId !== currentUser.id) return
          const payload = message?.data || {}
          const senderId = payload.sender_user_id || ''
          const incomingMessage = canonicalIncomingMessage(payload)
          const text = payload.text || ''
          const audioUrl = payload.audio_url || ''
          const imageUrl = payload.image_url || ''
          const musicUrl = payload.music_url || ''
          if (!senderId || (!text && !audioUrl && !imageUrl && !musicUrl)) return
          if (!incomingMessage) return

          upsertFriendContact({
            id: senderId,
            name: payload.sender_display_name || 'Friend',
            avatar_url: payload.sender_avatar_url || '',
            last_message_at: payload.created_at || new Date().toISOString(),
            last_message_preview: text,
          })

          setMessagesByContact((prev) => {
            const current = prev[senderId] || []
            return {
              ...prev,
              [senderId]: [
                ...current,
                incomingMessage,
              ],
            }
          })

          if (selectedContact?.id === senderId) {
            markContactAsRead(senderId)
          } else {
            setUnreadByContact((prev) => ({ ...prev, [senderId]: (prev[senderId] || 0) + 1 }))
          }
        })

        ablyRealtimeRef.current = realtime
        ablyChannelRef.current = channel
      } catch {
        // ignore ably setup errors in UI
      }
    }

    setupAbly()
    return () => {
      isCancelled = true
      if (ablyChannelRef.current) {
        try {
          ablyChannelRef.current.unsubscribe()
        } catch {
          // ignore
        }
        ablyChannelRef.current = null
      }
      if (ablyRealtimeRef.current) {
        try {
          ablyRealtimeRef.current.close()
        } catch {
          // ignore
        }
        ablyRealtimeRef.current = null
      }
    }
  }, [isSignedIn, currentUser?.id, currentUser?.provider, apiBaseUrl, selectedContact?.id])

  useEffect(() => {
    return () => {
      if (pendingAvatarPreviewUrl) {
        URL.revokeObjectURL(pendingAvatarPreviewUrl)
      }
    }
  }, [pendingAvatarPreviewUrl])

  useEffect(() => {
    if (!selectedContact || selectedContact.isAi) {
      setIsAiAssistMode(false)
    }
  }, [selectedContact?.id, selectedContact?.isAi])

  useEffect(() => {
    let cancelled = false
    const askMic = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMicAllowed(false)
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((t) => t.stop())
        if (!cancelled) setMicAllowed(true)
      } catch {
        if (!cancelled) setMicAllowed(false)
      }
    }
    askMic()
    return () => {
      cancelled = true
    }
  }, [])

  const clearRecordingTimers = () => {
    if (recordIntervalRef.current) {
      clearInterval(recordIntervalRef.current)
      recordIntervalRef.current = null
    }
    if (recordTimeoutRef.current) {
      clearTimeout(recordTimeoutRef.current)
      recordTimeoutRef.current = null
    }
  }

  const playAudioOnce = async (audioEl) => {
    if (!audioEl) return
    audioEl.currentTime = 0
    await audioEl.play()
    await new Promise((resolve) => {
      const done = () => {
        audioEl.removeEventListener('ended', done)
        audioEl.removeEventListener('error', done)
        resolve()
      }
      audioEl.addEventListener('ended', done)
      audioEl.addEventListener('error', done)
    })
  }

  const getOrCreatePhoneAudioContext = () => {
    let ctx = phoneAudioContextRef.current
    if (!ctx || ctx.state === 'closed') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext
      if (!AudioCtx) return null
      ctx = new AudioCtx()
      phoneAudioContextRef.current = ctx
      phonePlaybackTimeRef.current = ctx.currentTime
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    return ctx
  }

  const stopPhoneMicStreaming = () => {
    if (phoneMicProcessorRef.current) {
      phoneMicProcessorRef.current.disconnect()
      phoneMicProcessorRef.current.onaudioprocess = null
      phoneMicProcessorRef.current = null
    }
    if (phoneMicSourceRef.current) {
      phoneMicSourceRef.current.disconnect()
      phoneMicSourceRef.current = null
    }
    if (phoneMicAudioContextRef.current) {
      const ctx = phoneMicAudioContextRef.current
      phoneMicAudioContextRef.current = null
      if (ctx.state !== 'closed') {
        ctx.close().catch(() => {})
      }
    }
    if (phoneMicStreamRef.current) {
      phoneMicStreamRef.current.getTracks().forEach((t) => t.stop())
      phoneMicStreamRef.current = null
    }
  }

  const startPhoneMicStreaming = async () => {
    stopPhoneMicStreaming()
    const session = phoneLiveSessionRef.current
    const liveContext = phoneLiveOperationContextRef.current
    if (!session || !liveOperationScope.isCurrent(liveContext)) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (!liveOperationScope.isCurrent(liveContext) || phoneLiveSessionRef.current !== session) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    phoneMicStreamRef.current = stream

    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (!AudioCtx) {
      throw new Error('AudioContext is not supported in this browser')
    }

    const ctx = new AudioCtx()
    phoneMicAudioContextRef.current = ctx
    const source = ctx.createMediaStreamSource(stream)
    phoneMicSourceRef.current = source

    const processor = ctx.createScriptProcessor(2048, 1, 1)
    phoneMicProcessorRef.current = processor

    processor.onaudioprocess = (event) => {
      const activeSession = phoneLiveSessionRef.current
      if (
        !activeSession
        || activeSession !== session
        || !liveOperationScope.isCurrent(liveContext)
      ) return
      const input = event.inputBuffer.getChannelData(0)
      const downsampled = downsampleBuffer(input, ctx.sampleRate, 16000)
      const pcm16 = float32ToInt16(downsampled)
      const bytes = new Uint8Array(pcm16.buffer)
      let binary = ''
      for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i])
      }
      const b64 = btoa(binary)
      try {
        activeSession.sendRealtimeInput({
          audio: {
            data: b64,
            mimeType: 'audio/pcm;rate=16000',
          },
        })
      } catch (err) {
        logPhoneLive('sendRealtimeInput(audio) failed', err)
      }
    }

    source.connect(processor)
    processor.connect(ctx.destination)
    await ctx.resume().catch(() => {})
    logPhoneLive('mic streaming started', { sampleRate: ctx.sampleRate })
  }

  const playPcm16Chunk = (base64Data, mimeType = '') => {
    const ctx = getOrCreatePhoneAudioContext()
    if (!ctx || !base64Data) return

    const rateMatch = /rate=(\d+)/i.exec(mimeType || '')
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000

    const binary = atob(base64Data)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }

    const sampleCount = Math.floor(bytes.length / 2)
    if (sampleCount <= 0) return
    const samples = new Float32Array(sampleCount)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < sampleCount; i += 1) {
      const s = view.getInt16(i * 2, true)
      samples[i] = Math.max(-1, Math.min(1, s / 32768))
    }

    const buffer = ctx.createBuffer(1, sampleCount, sampleRate)
    buffer.getChannelData(0).set(samples)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)

    const when = Math.max(ctx.currentTime + 0.01, phonePlaybackTimeRef.current)
    source.start(when)
    phonePlaybackTimeRef.current = when + buffer.duration
  }

  const closePhoneLiveSession = async () => {
    const existingSession = phoneLiveSessionRef.current
    liveOperationScope.invalidate()
    phoneLiveOperationContextRef.current = null
    phoneLiveSessionRef.current = null
    phoneLiveConnectPromiseRef.current = null
    if (existingSession) {
      try {
        existingSession.sendRealtimeInput({ audioStreamEnd: true })
      } catch {
        // ignore
      }
    }
    stopPhoneMicStreaming()
    liveAboutFriendInjectedRef.current.clear()
    liveAboutFriendPendingRef.current.clear()
    setPhoneLiveStatus('idle')

    const ctx = phoneAudioContextRef.current
    phoneAudioContextRef.current = null
    phonePlaybackTimeRef.current = 0
    if (ctx && ctx.state !== 'closed') {
      ctx.close().catch(() => {})
    }

    try {
      if (existingSession?.close) {
        await existingSession.close()
      }
    } catch {
      // ignore close errors
    }
  }

  const maybeInjectAboutFriendLiveContext = async (
    transcriptText,
    liveContext = phoneLiveOperationContextRef.current,
  ) => {
    const normalized = String(transcriptText || '').trim()
    if (!normalized || !liveOperationScope.isCurrent(liveContext)) return
    const contactId = selectedContact?.id || 'pisces-core'
    if (contactId !== 'pisces-core') return
    const key = normalized.toLowerCase()
    if (liveAboutFriendInjectedRef.current.has(key) || liveAboutFriendPendingRef.current.has(key)) return
    const contextOperation = liveOperationScope.fork(liveContext)
    if (!liveOperationScope.isCurrent(contextOperation)) return
    liveAboutFriendPendingRef.current.add(key)
    try {
      const res = await fetch(`${apiBaseUrl}/api/live/about-friend-context`, {
        method: 'POST',
        credentials: 'include',
        signal: contextOperation.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: normalized,
          contact_id: contactId,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!liveOperationScope.isCurrent(contextOperation)) return
      if (!res.ok || !data?.ok || !data?.matched || !data?.context) return
      const contextText = String(data.context || '').trim()
      if (!contextText) return
      const activeSession = phoneLiveSessionRef.current
      if (
        !activeSession
        || phoneLiveOperationContextRef.current !== liveContext
        || !liveOperationScope.isCurrent(liveContext)
      ) return
      activeSession.sendClientContent({
        turns: [
          {
            role: 'user',
            parts: [
              {
                text:
                  'Additional background context only. Do not repeat this verbatim. ' +
                  'Use it to better understand the mentioned contact.\n\n' +
                  contextText,
              },
            ],
          },
        ],
        turnComplete: false,
      })
      liveAboutFriendInjectedRef.current.add(key)
      logPhoneLive('about_friend context injected', {
        name: data?.name || '',
        friendName: data?.friend_name || '',
        contextLength: contextText.length,
      })
    } catch (err) {
      if (!liveOperationScope.isCurrent(contextOperation) || err?.name === 'AbortError') return
      logPhoneLive('about_friend context request failed', err)
    } finally {
      liveOperationScope.runIfCurrent(contextOperation, () => {
        liveAboutFriendPendingRef.current.delete(key)
      })
      liveOperationScope.finish(contextOperation)
    }
  }

  const connectPhoneLive = async () => {
    if (
      phoneLiveSessionRef.current
      && liveOperationScope.isCurrent(phoneLiveOperationContextRef.current)
    ) return true
    if (phoneLiveSessionRef.current) await closePhoneLiveSession()
    if (phoneLiveConnectPromiseRef.current) return phoneLiveConnectPromiseRef.current
    const liveContext = liveOperationScope.begin()
    phoneLiveOperationContextRef.current = liveContext

    const connectPromise = (async () => {
      liveOperationScope.runIfCurrent(liveContext, () => setPhoneLiveStatus('connecting'))
      logPhoneLive('requesting /api/live/token')
      const tokenRes = await fetch(`${apiBaseUrl}/api/live/token`, {
        method: 'POST',
        credentials: 'include',
        signal: liveContext.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: selectedContact?.id || 'pisces-core',
        }),
      })
      const tokenData = await tokenRes.json()
      if (!liveOperationScope.isCurrent(liveContext)) return false
      logPhoneLive('live token response', { status: tokenRes.status, data: tokenData })
      if (!tokenRes.ok || !tokenData.ok || !tokenData.token) {
        throw new Error(tokenData.error || `Live token failed (${tokenRes.status})`)
      }

      const ai = new GoogleGenAI({
        apiKey: tokenData.token,
        httpOptions: { apiVersion: 'v1alpha' },
      })
      logPhoneLive('connecting live session', { model: tokenData.model, voice: tokenData.voice_name })
      const session = await ai.live.connect({
        model: tokenData.model || 'gemini-live-2.5-flash-preview',
        config: {
          responseModalities: [Modality.AUDIO],
          ...(tokenData.system_prompt
            ? {
                systemInstruction: {
                  parts: [{ text: tokenData.system_prompt }],
                },
              }
            : {}),
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: tokenData.voice_name || 'Leda',
              },
            },
          },
        },
        callbacks: {
          onopen: () => {
            if (!liveOperationScope.isCurrent(liveContext)) return
            setPhoneLiveStatus('connected')
            logPhoneLive('live session opened')
          },
          onmessage: (message) => {
            if (!liveOperationScope.isCurrent(liveContext)) return
            logPhoneLive('live message', message)
            const possibleInputText =
              message?.serverContent?.inputTranscription?.text ||
              message?.serverContent?.inputTranscript?.text ||
              message?.inputTranscription?.text ||
              message?.inputTranscript?.text ||
              ''
            if (possibleInputText) {
              maybeInjectAboutFriendLiveContext(possibleInputText, liveContext)
            }
            const serverContent = message?.serverContent
            const parts = serverContent?.modelTurn?.parts || []
            parts.forEach((part) => {
              const inlineData = part?.inlineData
              if (!inlineData?.data) return
              if ((inlineData.mimeType || '').toLowerCase().includes('audio/pcm')) {
                playPcm16Chunk(inlineData.data, inlineData.mimeType || '')
              }
            })
          },
          onerror: (evt) => {
            if (!liveOperationScope.isCurrent(liveContext)) return
            setPhoneLiveStatus('error')
            logPhoneLive('live session error', evt)
          },
          onclose: (evt) => {
            if (
              !liveOperationScope.isCurrent(liveContext)
              || phoneLiveOperationContextRef.current !== liveContext
            ) return
            phoneLiveSessionRef.current = null
            phoneLiveConnectPromiseRef.current = null
            phoneLiveContextRef.current = ''
            liveAboutFriendInjectedRef.current.clear()
            liveAboutFriendPendingRef.current.clear()
            setPhoneLiveStatus('closed')
            stopPhoneMicStreaming()
            liveOperationScope.invalidate()
            phoneLiveOperationContextRef.current = null
            logPhoneLive('live session closed', {
              code: evt?.code,
              reason: evt?.reason,
              wasClean: evt?.wasClean,
              event: evt,
            })
          },
        },
      })

      if (!liveOperationScope.isCurrent(liveContext)) {
        try {
          await session?.close?.()
        } catch {
          // ignore stale late-session close errors
        }
        return false
      }

      phoneLiveContextRef.current = String(tokenData.live_context || '')
      liveAboutFriendInjectedRef.current.clear()
      liveAboutFriendPendingRef.current.clear()

      phoneLiveSessionRef.current = session
      phoneLiveOperationContextRef.current = liveContext
      setPhoneLiveStatus('connected')
      return true
    })()

    phoneLiveConnectPromiseRef.current = connectPromise
    try {
      const ok = await connectPromise
      return ok
    } catch (err) {
      liveOperationScope.runIfCurrent(liveContext, () => {
        phoneLiveSessionRef.current = null
        phoneLiveOperationContextRef.current = null
        setPhoneLiveStatus('error')
      })
      if (!liveOperationScope.isCurrent(liveContext) || err?.name === 'AbortError') return false
      throw err
    } finally {
      if (phoneLiveConnectPromiseRef.current === connectPromise) {
        phoneLiveConnectPromiseRef.current = null
      }
      liveOperationScope.finish(liveContext)
    }
  }

  const startGeminiLiveGreeting = () => {
    const session = phoneLiveSessionRef.current
    const liveContext = phoneLiveOperationContextRef.current
    if (!session || !liveOperationScope.isCurrent(liveContext)) return
    const contextText = (phoneLiveContextRef.current || '').trim()
    const greetingText = contextText
      ? (
          'Background context only. Do not repeat this verbatim. ' +
          'Use it to understand speakers, tone, and relationship.\n\n' +
          contextText +
          '\n\n' +
          GEMINI_LIVE_GREETING
        )
      : GEMINI_LIVE_GREETING
    try {
      session.sendClientContent({
        turns: [{ role: 'user', parts: [{ text: greetingText }] }],
        turnComplete: true,
      })
      logPhoneLive('live greeting sent', { withContext: Boolean(contextText), contextLength: contextText.length })
    } catch (err) {
      logPhoneLive('failed to send live greeting', err)
    }
  }

  const clearPhoneUiTimers = () => {
    if (phoneAvatarTimerRef.current) {
      clearTimeout(phoneAvatarTimerRef.current)
      phoneAvatarTimerRef.current = null
    }
    if (phoneHangupTimersRef.current.length > 0) {
      phoneHangupTimersRef.current.forEach((timerId) => clearTimeout(timerId))
      phoneHangupTimersRef.current = []
    }
  }

  const stopPhoneSounds = () => {
    phoneAudioSeqRef.current += 1
    clearPhoneUiTimers()
    const ring = phoneRingAudioRef.current
    const pickup = phonePickupAudioRef.current
    if (ring) {
      ring.pause()
      ring.currentTime = 0
    }
    if (pickup) {
      pickup.pause()
      pickup.currentTime = 0
    }
  }

  const openPhoneOverlay = async () => {
    await closePhoneLiveSession()
    setShowPhoneOverlay(true)
    setPhone2RotationDeg(0)
    setShowPhonePeerAvatar(false)
    stopPhoneSounds()

    const seq = phoneAudioSeqRef.current
    let liveConnected = false
    const connectPromise = connectPhoneLive()
      .then(() => {
        liveConnected = true
        return true
      })
      .catch((err) => {
        logPhoneLive('connectPhoneLive failed', err)
        return false
      })

    try {
      await playAudioOnce(phoneRingAudioRef.current)
      if (seq !== phoneAudioSeqRef.current) return

      let connected = liveConnected
      if (!connected) {
        logPhoneLive('ring finished before connected, entering ring loop')
        const ring = phoneRingAudioRef.current
        if (ring) {
          ring.loop = true
          ring.currentTime = 0
          ring.play().catch(() => {})
        }
        connected = await Promise.race([
          connectPromise,
          new Promise((resolve) =>
            window.setTimeout(() => {
              logPhoneLive('live connect timeout', { timeoutMs: LIVE_CONNECT_TIMEOUT_MS })
              resolve(false)
            }, LIVE_CONNECT_TIMEOUT_MS),
          ),
        ])
        if (ring) {
          ring.pause()
          ring.loop = false
          ring.currentTime = 0
        }
      }

      if (seq !== phoneAudioSeqRef.current) {
        await closePhoneLiveSession()
        return
      }
      if (!connected) {
        setPhoneLiveStatus('error')
        logPhoneLive('live not connected, aborting call flow')
        return
      }

      logPhoneLive('connected, starting pickup flow')
      setPhone2RotationDeg(-90)
      phoneAvatarTimerRef.current = window.setTimeout(() => {
        setShowPhonePeerAvatar(true)
        phoneAvatarTimerRef.current = null
      }, 1000)
      await playAudioOnce(phonePickupAudioRef.current)
      if (seq !== phoneAudioSeqRef.current) {
        await closePhoneLiveSession()
        return
      }
      try {
        await startPhoneMicStreaming()
      } catch (err) {
        logPhoneLive('failed to start mic streaming', err)
      }
      logPhoneLive('pickup completed, sending greeting prompt')
      startGeminiLiveGreeting()
    } catch {
      // Browser autoplay or audio decode failures are non-blocking for UI.
      logPhoneLive('openPhoneOverlay flow failed unexpectedly')
    }
  }

  const closePhoneOverlay = async () => {
    stopPhoneSounds()
    await closePhoneLiveSession()
    setShowPhoneOverlay(false)
    setPhone2RotationDeg(0)
    setShowPhonePeerAvatar(false)
  }

  const onPhoneImageClick = () => {
    const isOffhook = phone2RotationDeg === -90
    stopPhoneSounds()
    if (isOffhook) {
      closePhoneLiveSession().catch(() => {})
      const pickup = phonePickupAudioRef.current
      if (pickup) {
        pickup.currentTime = 0
        pickup.play().catch(() => {})
      }
      const t1 = window.setTimeout(() => {
        setShowPhonePeerAvatar(false)
      }, 220)
      const t2 = window.setTimeout(() => {
        setPhone2RotationDeg(0)
      }, 640)
      const t3 = window.setTimeout(() => {
        setShowPhoneOverlay(false)
        setShowPhonePeerAvatar(false)
      }, 1680)
      phoneHangupTimersRef.current.push(t1, t2, t3)
      return
    }
    closePhoneLiveSession().catch(() => {})
    setShowPhoneOverlay(false)
    setShowPhonePeerAvatar(false)
  }

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current
    if (!recorder) return
    clearRecordingTimers()
    if (recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      setIsRecording(false)
      setRecordElapsedMs(0)
    }
  }

  const startRecording = async () => {
    if (isRecording || isAwaitingReply || !selectedContact || !micAllowed) return
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return
    const recordingOperation = accountOperationScope.beginExclusive(recordingOperationRef)
    if (!recordingOperation) return
    const runIfRecordingCurrent = (callback) => {
      if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return undefined
      return callback()
    }
    let acquiredStream = null

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      acquiredStream = stream
      if (!accountOperationScope.publishOwned(recordingOperation, recordingOperationRef, stream)) {
        accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
        return
      }
      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
      ]
      const pickedMimeType = preferredMimeTypes.find((type) => window.MediaRecorder.isTypeSupported?.(type))
      const recorder = pickedMimeType ? new MediaRecorder(stream, { mimeType: pickedMimeType }) : new MediaRecorder(stream)
      const contactId = selectedContact.id
      const startedAt = Date.now()
      recordChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (
          accountOperationScope.isOwner(recordingOperation, recordingOperationRef)
          && event.data
          && event.data.size > 0
        ) {
          recordChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = async () => {
        const recordedDurationSeconds = Math.max(0, (Date.now() - startedAt) / 1000)
        const ownsRecording = recordingOperationRef.current === recordingOperation
        const chunks = ownsRecording ? recordChunksRef.current : []
        if (ownsRecording && mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        }
        if (ownsRecording) {
          mediaStreamRef.current = null
          mediaRecorderRef.current = null
          recordChunksRef.current = []
          clearRecordingTimers()
        }
        if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) {
          accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
          return
        }
        runIfRecordingCurrent(() => {
          setIsRecording(false)
          setRecordElapsedMs(0)
        })

        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          const audioUrl = URL.createObjectURL(blob)
          const audioMessageId = `ua-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const shouldUseAiVoiceFlow = contactId === 'pisces-core' || isAiAssistMode
          const isAssistVoiceFlow = isAiAssistMode && contactId !== 'pisces-core'
          const typingId = `vt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          const assistRequestId = createClientRequestId('assist-voice')
          const assistTempId = `assist-v-${assistRequestId}`
          let assistTranscript = ''
          runIfRecordingCurrent(() => {
            setMessagesByContact((prev) => {
              const current = prev[contactId] || []
              return {
                ...prev,
                [contactId]: [
                  ...current,
                  { id: audioMessageId, role: 'user', audioUrl, audioDuration: recordedDurationSeconds },
                  ...(isAssistVoiceFlow
                    ? [
                        {
                          id: assistTempId,
                          role: 'assist_group',
                          groupId: assistTempId,
                          requestId: assistRequestId,
                          userText: '',
                          aiText: '',
                          aiAudioUrl: '',
                          status: 'streaming',
                        },
                      ]
                    : shouldUseAiVoiceFlow
                      ? [{ id: typingId, role: 'ai-typing', text: '...' }]
                      : []),
                ],
              }
            })
            setIsAwaitingReply(true)
          })

          try {
            const arrayBuffer = await blob.arrayBuffer()
            if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
            const bytes = new Uint8Array(arrayBuffer)
            let binary = ''
            for (let i = 0; i < bytes.length; i += 1) {
              binary += String.fromCharCode(bytes[i])
            }
            const audioBase64 = btoa(binary)

            if (!shouldUseAiVoiceFlow && contactId !== 'pisces-core') {
              const res = await fetch(`${apiBaseUrl}/api/messages/send-voice`, {
                method: 'POST',
                credentials: 'include',
                signal: recordingOperation.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  recipient_user_id: contactId,
                  audio_base64: audioBase64,
                  mime_type: blob.type || recorder.mimeType || 'audio/webm',
                  duration_seconds: recordedDurationSeconds,
                }),
              })
              const data = await res.json()
              if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
              if (!res.ok || !data.ok) {
                throw new Error(data.error || `Send failed (${res.status})`)
              }
              runIfRecordingCurrent(() => setMessagesByContact((prev) => {
                const current = prev[contactId] || []
                return {
                  ...prev,
                  [contactId]: current.map((m) =>
                    m.id === audioMessageId
                      ? {
                          ...m,
                          id: data?.message?.message_id || audioMessageId,
                          audioUrl: data?.message?.audio_url || m.audioUrl,
                          audioDuration: Number(data?.message?.audio_duration_seconds || m.audioDuration || 0),
                        }
                      : m,
                  ),
                }
              }))
            } else if (isAssistVoiceFlow) {
              const sttRes = await fetch(`${apiBaseUrl}/api/speech/transcribe`, {
                method: 'POST',
                credentials: 'include',
                signal: recordingOperation.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audio_base64: audioBase64,
                  mime_type: blob.type || recorder.mimeType || 'audio/webm',
                }),
              })
              const sttData = await sttRes.json()
              if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
              if (!sttRes.ok || !sttData.ok || !sttData.transcript) {
                throw new Error(sttData.error || `Speech-to-text failed (${sttRes.status})`)
              }
              assistTranscript = sttData.transcript

              const { assistGroup: assist, outboundMessage } = await sendAssistRequest({
                url: `${apiBaseUrl}/api/assist/message`,
                contactId,
                message: assistTranscript,
                requestId: assistRequestId,
                signal: recordingOperation.signal,
              })
              if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
              const assistAudioUrl = assist.audio_url
                ? assist.audio_url
                : assist.audio_base64 && assist.audio_mime_type
                  ? `data:${assist.audio_mime_type};base64,${assist.audio_base64}`
                  : ''
              runIfRecordingCurrent(() => setMessagesByContact((prev) => {
                const current = prev[contactId] || []
                const assistMessage = {
                  id: assist.id || assistTempId,
                  role: 'assist_group',
                  groupId: assist.id || assistTempId,
                  requestId: assistRequestId,
                  userText: assist.user_text || assistTranscript,
                  aiText: assist.ai_text || '',
                  aiAudioUrl: assistAudioUrl,
                  status: 'complete',
                }
                const replaced = mergeStreamMessage(current, assistTempId, assistMessage)
                return {
                  ...prev,
                  [contactId]: outboundMessage && !replaced.some((message) => message.id === outboundMessage.id)
                    ? [...replaced, outboundMessage]
                    : replaced,
                }
              }))
            } else {
              const res = await fetch(`${apiBaseUrl}/api/voice-chat`, {
                method: 'POST',
                credentials: 'include',
                signal: recordingOperation.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  audio_base64: audioBase64,
                  mime_type: blob.type || recorder.mimeType || 'audio/webm',
                  contact_id: contactId,
                }),
              })
              const data = await res.json()
              if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
              const aiText = res.ok && data.reply ? data.reply : data.error || `Request failed (${res.status})`
              const aiAudioUrl =
                res.ok && data.audio_base64
                  ? `data:${data.audio_mime_type || 'audio/wav'};base64,${data.audio_base64}`
                  : ''
              const aiImageUrl = res.ok ? (data.image_url || '') : ''
              const aiMusicUrl = res.ok ? (data.music_url || '') : ''

              runIfRecordingCurrent(() => setMessagesByContact((prev) => {
                const current = prev[contactId] || []
                return {
                  ...prev,
                  [contactId]: current.map((m) =>
                    m.id === typingId
                      ? {
                          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                          role: 'ai',
                          text: aiText,
                          audioUrl: aiAudioUrl,
                          imageUrl: aiImageUrl,
                          musicUrl: aiMusicUrl,
                        }
                      : m,
                  ),
                }
              }))
            }
          } catch (err) {
            const errText = err?.message || 'Voice chat request failed.'
            runIfRecordingCurrent(() => setMessagesByContact((prev) => {
              const current = prev[contactId] || []
              if (isAssistVoiceFlow) {
                return {
                  ...prev,
                  [contactId]: current.map((m) =>
                    m.id === assistTempId
                      ? {
                          ...m,
                          userText: assistTranscript,
                          aiText: errText,
                          status: 'incomplete',
                          retry: assistTranscript
                            ? () => sendAssistText(assistTranscript, {
                                requestId: assistRequestId,
                                temporaryId: assistTempId,
                                clearDraft: false,
                              })
                            : undefined,
                        }
                      : m,
                  ),
                }
              }
              if (shouldUseAiVoiceFlow) {
                return {
                  ...prev,
                  [contactId]: current.map((m) =>
                    m.id === typingId
                      ? { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'ai', text: errText }
                      : m,
                  ),
                }
              }
              return {
                ...prev,
                [contactId]: [
                  ...current,
                  { id: `e-${Date.now()}`, role: 'peer', text: errText },
                ],
              }
            }))
          } finally {
            runIfRecordingCurrent(() => setIsAwaitingReply(false))
            accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
          }
        } else {
          accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
        }
      }

      if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) {
        recorder.ondataavailable = null
        recorder.onstop = null
        stream.getTracks().forEach((track) => track.stop())
        accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
        return
      }
      recorder.start()
      runIfRecordingCurrent(() => {
        setChatInput('')
        setIsRecording(true)
        setRecordElapsedMs(0)
      })

      recordIntervalRef.current = setInterval(() => {
        runIfRecordingCurrent(() => {
          setRecordElapsedMs(Math.min(Date.now() - startedAt, MAX_RECORD_MS))
        })
      }, 100)
      recordTimeoutRef.current = setTimeout(() => {
        if (accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) stopRecording()
      }, MAX_RECORD_MS)
    } catch {
      const ownsRecording = accountOperationScope.isOwner(recordingOperation, recordingOperationRef)
      if (ownsRecording) {
        stopActiveRecordingResources({
          mediaRecorderRef,
          mediaStreamRef,
          recordChunksRef,
          clearTimers: clearRecordingTimers,
        })
      }
      if (acquiredStream && mediaStreamRef.current !== acquiredStream) {
        acquiredStream.getTracks().forEach((track) => track.stop())
      }
      if (ownsRecording) {
        setMicAllowed(false)
        setIsRecording(false)
        setRecordElapsedMs(0)
      }
      accountOperationScope.releaseOwner(recordingOperation, recordingOperationRef)
    }
  }

  useEffect(() => {
    return () => {
      accountOperationScope.invalidate()
      recordingOperationRef.current = null
      stopActiveRecordingResources({
        mediaRecorderRef,
        mediaStreamRef,
        recordChunksRef,
        clearTimers: clearRecordingTimers,
      })
      stopPhoneSounds()
      closePhoneLiveSession().catch(() => {})
    }
  }, [])

  const selectContactFromSidebar = (contact) => {
    if (!contact?.id) return
    setPendingAttachment(null)
    selectedContactIdRef.current = contact.id
    setSelectedContact(contact)
    markContactAsRead(contact.id)
    loadContactHistory(contact.id)
  }

  const replaceConversationMessage = (contactId, messageId, nextMessage) => {
    setMessagesByContact((previous) => {
      const current = previous[contactId] || []
      return {
        ...previous,
        [contactId]: mergeStreamMessage(current, messageId, nextMessage),
      }
    })
  }

  const sendAiStream = async (input, { appendUser = true, requestId, temporaryId } = {}) => {
    const contactId = selectedContact?.id
    if (!contactId || !selectedContact?.isAi) return
    const operation = accountOperationScope.beginExclusive(aiStreamOperationRef)
    if (!operation) return
    const userMessageId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const streamMessageId = temporaryId || `stream-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

    accountOperationScope.runIfCurrent(operation, () => {
      setMessagesByContact((previous) => {
        const current = previous[contactId] || []
        const withoutPreviousAttempt = current.filter((message) => (
          message.id !== streamMessageId && (!requestId || message.requestId !== requestId)
        ))
        return {
          ...previous,
          [contactId]: [
            ...withoutPreviousAttempt,
            ...(appendUser ? [{ id: userMessageId, role: 'user', text: input }] : []),
            { id: streamMessageId, role: 'ai', text: '', status: 'streaming', originalInput: input, requestId },
          ],
        }
      })
      if (appendUser) {
        setChatInput('')
      }
      setIsAwaitingReply(true)
    })

    try {
      await streamAiTurn({
        url: `${apiBaseUrl}/api/chat/stream`,
        input,
        contactId,
        requestId,
        signal: operation.signal,
        onMessage: (message) => accountOperationScope.runIfCurrent(operation, () => {
          const retry = message.status === 'incomplete'
            ? () => sendAiStream(input, {
                appendUser: false,
                requestId: message.requestId,
                temporaryId: streamMessageId,
              })
            : undefined
          replaceConversationMessage(contactId, streamMessageId, { ...message, retry })
        }),
      })
    } catch (error) {
      if (error?.name !== 'AbortError') {
        accountOperationScope.runIfCurrent(operation, () => {
          replaceConversationMessage(contactId, streamMessageId, {
            id: streamMessageId,
            role: 'ai',
            text: '',
            status: 'incomplete',
            error: error?.message || t('Unable to reach API.', '無法連線到 API。'),
            retry: () => sendAiStream(input, { appendUser: false, requestId, temporaryId: streamMessageId }),
          })
        })
      }
    } finally {
      accountOperationScope.runIfCurrent(operation, () => setIsAwaitingReply(false))
      accountOperationScope.releaseOwner(operation, aiStreamOperationRef)
    }
  }

  const sendAssistText = (input, {
    requestId = createClientRequestId('assist'),
    temporaryId = `assist-${requestId}`,
    clearDraft = true,
  } = {}) => {
    const contactId = selectedContact?.id
    if (!contactId || selectedContact?.isAi) return false
    const submittedDraftVersion = chatDraftVersionRef.current

    const send = startExclusiveSend({
      scope: accountOperationScope,
      ownerRef: assistSendOperationRef,
      request: (operation) => sendAssistRequest({
        url: `${apiBaseUrl}/api/assist/message`,
        contactId,
        message: input,
        requestId,
        signal: operation.signal,
      }),
      onSuccess: ({ assistGroup, outboundMessage }) => {
        const audioUrl = assistGroup.audio_url || (
          assistGroup.audio_base64 && assistGroup.audio_mime_type
            ? `data:${assistGroup.audio_mime_type};base64,${assistGroup.audio_base64}`
            : ''
        )
        setMessagesByContact((previous) => {
          const current = previous[contactId] || []
          const assistMessage = {
            id: assistGroup.id || temporaryId,
            role: 'assist_group',
            groupId: assistGroup.id || temporaryId,
            requestId,
            userText: assistGroup.user_text || input,
            aiText: assistGroup.ai_text || '',
            aiAudioUrl: audioUrl,
            status: 'complete',
          }
          const replaced = mergeStreamMessage(current, temporaryId, assistMessage)
          const withCanonicalOutbound = outboundMessage && !replaced.some((message) => message.id === outboundMessage.id)
            ? [...replaced, outboundMessage]
            : replaced
          return { ...previous, [contactId]: withCanonicalOutbound }
        })
        if (chatDraftVersionRef.current === submittedDraftVersion) {
          setChatInput((current) => current === input ? '' : current)
        }
      },
      onError: (error) => {
        const retry = () => sendAssistText(input, { requestId, temporaryId, clearDraft: false })
        replaceConversationMessage(contactId, temporaryId, {
          id: temporaryId,
          role: 'assist_group',
          groupId: temporaryId,
          requestId,
          userText: input,
          aiText: error?.message || t('AI Assist failed.', 'AI 協助失敗。'),
          aiAudioUrl: '',
          status: 'incomplete',
          retry,
        })
        setChatInput((current) => restoreAssistDraft(
          current,
          input,
          chatDraftVersionRef.current,
          submittedDraftVersion,
          selectedContactIdRef.current,
          contactId,
        ))
      },
      onSettled: () => setIsAwaitingReply(false),
    })
    if (!send.started) return false

    setMessagesByContact((previous) => {
      const current = previous[contactId] || []
      const optimistic = {
        id: temporaryId,
        role: 'assist_group',
        groupId: temporaryId,
        requestId,
        userText: input,
        aiText: '',
        aiAudioUrl: '',
        status: 'streaming',
      }
      return { ...previous, [contactId]: mergeStreamMessage(current, temporaryId, optimistic) }
    })
    if (clearDraft) setChatInput('')
    setIsAwaitingReply(true)
    return true
  }

  const sendPersonText = (input, attachment = pendingAttachment) => {
    const contactId = selectedContact?.id
    if (!contactId || selectedContact?.isAi || (!input && !attachment)) return false

    const send = startExclusiveSend({
      scope: accountOperationScope,
      ownerRef: personSendOperationRef,
      request: (operation) => sendPersonRequest({
        url: `${apiBaseUrl}/api/messages/send`,
        contactId,
        text: input,
        attachment,
        signal: operation.signal,
      }),
      onSuccess: (message) => {
        setMessagesByContact((previous) => {
          const current = previous[contactId] || []
          return current.some((item) => item.id === message.id)
            ? previous
            : { ...previous, [contactId]: [...current, message] }
        })
        setChatInput((current) => current.trim() === input ? '' : current)
        setPendingAttachment((current) => current === attachment ? null : current)
      },
      onError: (error) => {
        setMessagesByContact((previous) => ({
          ...previous,
          [contactId]: [
            ...(previous[contactId] || []),
            {
              id: `error-${Date.now()}`,
              role: 'system',
              text: error?.message || t('Unable to send message.', '無法傳送訊息。'),
              status: 'incomplete',
            },
          ],
        }))
      },
      onSettled: () => setIsAwaitingReply(false),
    })
    if (!send.started) return false
    setIsAwaitingReply(true)
    return true
  }

  const sendComposerText = (input) => {
    if (!selectedContact || isRecording || isAwaitingReply) return
    if (selectedContact.isAi) return sendAiStream(input)
    if (isAiAssistMode) return sendAssistText(input)
    return sendPersonText(input, pendingAttachment)
  }

  const conversationMessages = selectedContact
    ? (messagesByContact[selectedContact.id] || []).flatMap((message) => {
        if (message.role !== 'assist_group') return [message]
        return [
          { id: `${message.id}-user`, role: 'assist_user', text: message.userText || '' },
          {
            id: `${message.id}-ai`,
            role: 'assist_ai',
            text: message.aiText || '',
            audioUrl: message.aiAudioUrl || '',
            status: message.status === 'streaming' ? 'streaming' : message.status,
            retry: message.retry,
          },
        ]
      })
    : []

  const conversationPanel = selectedContact ? (
    <Conversation
      contact={selectedContact}
      messages={conversationMessages}
      locale={isZh ? 'zh-TW' : 'en'}
      loading={isHistoryLoading}
      onBack={() => {
        selectedContactIdRef.current = ''
        setSelectedContact(null)
      }}
      onCall={openPhoneOverlay}
      callDisabled={!selectedContact.isAi}
      onImageClick={setImageViewerUrl}
      renderAudio={({ url, kind, message }) => (
        <AudioMessagePlayer
          audioUrl={url}
          variant={message.role === 'user' ? 'user' : 'ai'}
          durationHint={kind === 'voice' ? Number(message.audioDuration || 0) : 0}
        />
      )}
      composer={(
        <Composer
          value={chatInput}
          onChange={(value) => {
            chatDraftVersionRef.current += 1
            setChatInput(value)
          }}
          onSend={sendComposerText}
          attachment={pendingAttachment}
          onAttachment={!selectedContact.isAi && !isAiAssistMode ? setPendingAttachment : undefined}
          onRemoveAttachment={() => setPendingAttachment(null)}
          showAssist={!selectedContact.isAi}
          assistActive={isAiAssistMode && !selectedContact.isAi}
          onToggleAssist={() => {
            setPendingAttachment(null)
            setIsAiAssistMode((value) => !value)
          }}
          canRecord={micAllowed}
          isRecording={isRecording}
          recordingElapsedMs={recordElapsedMs}
          maxRecordMs={MAX_RECORD_MS}
          onToggleRecording={() => (isRecording ? stopRecording() : startRecording())}
          isSending={isAwaitingReply}
          locale={isZh ? 'zh-TW' : 'en'}
        />
      )}
    />
  ) : null

  const contactSidebar = (
    <ContactSidebar
      locale={isZh ? 'zh-TW' : 'en'}
      groups={contactGroups}
      contacts={contacts}
      unreadByContact={unreadByContact}
      defaultGroupId={defaultContactGroupId}
      selectedContactId={selectedContact?.id || ''}
      currentUser={currentUser}
      onAddFriend={openAddFriendModal}
      onSelectContact={selectContactFromSidebar}
      onOpenSettings={openSettingsModal}
      onManageGroups={() => setGroupManagerOpen(true)}
      onMoveContact={async (contact, groupId) => {
        const authContext = authRequestGuard.snapshot()
        try {
          const data = await requestContactGroups('assign', { contact_id: contact.id, group_id: groupId }, authContext)
          if (data.stale) return
          const assignment = data.assignment || { contact_id: contact.id, group_id: groupId }
          await applyLocalThenRefresh(
            () => authRequestGuard.runIfCurrent(authContext, () => setContacts((previous) => applyContactGroupAssignment(previous, assignment.contact_id, assignment.group_id))),
            async () => {
              const refreshed = await loadFriendsList(currentUser, authContext)
              if (!refreshed) throw new Error('Friend refresh was superseded')
            },
          )
        } catch {
          // The assignment endpoint failed before an authoritative local update.
        }
      }}
    />
  )

  return (
    <main
      style={{
        height: '100dvh',
        display: 'grid',
        placeItems: isSignedIn ? 'stretch' : 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        padding: isSignedIn ? 0 : 'max(8px, min(2vh, 18px)) 12px',
        background: isSignedIn ? '#212121' : undefined,
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          width: isSignedIn ? '100%' : 'min(92vw, 720px)',
          height: isSignedIn ? '100dvh' : 'min(96dvh, 980px)',
          maxHeight: isSignedIn ? '100dvh' : '96dvh',
          borderRadius: isSignedIn ? 0 : 46,
          border: isSignedIn ? 0 : '2px solid rgba(255,255,255,0.55)',
          display: 'grid',
          gridTemplateRows: isSignedIn ? '1fr' : '56px 1fr auto 92px',
          background: isSignedIn ? '#212121' : 'linear-gradient(165deg, rgba(255,255,255,0.24), rgba(255,255,255,0.1))',
          backdropFilter: isSignedIn ? 'none' : 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: isSignedIn ? 'none' : 'blur(18px) saturate(140%)',
          boxShadow: isSignedIn ? 'none' : '0 22px 80px rgba(57, 6, 82, 0.4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: isSignedIn ? 'none' : 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px 0',
            color: 'rgba(255,255,255,0.92)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}>9:41</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button
              type="button"
              onClick={clearSessionAndLogout}
              disabled={!isSignedIn}
              style={{
                border: 0,
                background: 'transparent',
                color: 'inherit',
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                cursor: isSignedIn ? 'pointer' : 'default',
                opacity: isSignedIn ? 1 : 0.5,
              }}
              aria-label="Log out"
              title="Log out"
            >
              <IconPower />
            </button>
            <IconBluetooth />
            <button
              type="button"
              onClick={() => {
                setTesterError('')
                setTesterModalOpen(true)
              }}
              style={{
                border: 0,
                background: 'transparent',
                color: 'inherit',
                padding: 0,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
              aria-label="Open tester login"
              title="Tester login"
            >
              <IconBattery />
            </button>
          </div>
        </div>

        {isSignedIn ? (
          <ChatShell sidebar={contactSidebar} locale={isZh ? 'zh-TW' : 'en'}>
          <div style={{ padding: selectedContact ? 0 : (isPadUp ? '8px 18px 0' : '50px 10px 0'), minHeight: 0, height: '100%', boxSizing: 'border-box' }}>
            <style>{`
              .no-scrollbar::-webkit-scrollbar { display: none; }
              @keyframes typingDot {
                0%, 80%, 100% { opacity: 0.35; transform: translateY(0); }
                40% { opacity: 1; transform: translateY(-2px); }
              }
              @keyframes wavePulse {
                0%, 100% { transform: scaleY(0.45); opacity: 0.65; }
                50% { transform: scaleY(1); opacity: 1; }
              }
            `}</style>
            {selectedContact ? (
              conversationPanel
            ) : (
              <ConversationEmptyState locale={isZh ? 'zh-TW' : 'en'} />
            )}
          </div>
          </ChatShell>
        ) : (
          <>
            <div style={{ display: 'grid', placeItems: 'center', padding: '0 20px' }}>
              <div style={{ display: 'grid', justifyItems: 'center', alignContent: 'center', lineHeight: 1 }}>
                <img
                  src="/images/logo.webp"
                  alt="Convia"
                  style={{
                    width: 'clamp(180px, 42vw, 360px)',
                    maxWidth: '78%',
                    height: 'auto',
                    opacity: 0.9,
                    filter: 'drop-shadow(rgba(40, 7, 65, 0.4) 0px 4px 4px)',
                  }}
                />
                <div
                  style={{
                    color: '#ffffff',
                    fontFamily: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    fontWeight: 700,
                    fontStyle: 'normal',
                    fontSize: 'clamp(32px, 12.5vw, 64px)',
                    letterSpacing: '-0.035em',
                    lineHeight: 1.82,
                    marginTop: 'clamp(-22px, -3.5vw, -12px)',
                    textShadow: '0 4px 14px rgba(40, 7, 65, 0.35)',
                  }}
                >
                  Convia
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', placeItems: 'center', gap: 10, padding: '0 24px 26px' }}>
              <div
                style={{
                  width: 'min(64vw, 420px)',
                  maxWidth: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 999,
                  background: 'transparent',
                  padding: 0,
                  boxShadow: 'none',
                }}
              >
                <div ref={googleButtonRef} />
              </div>
              {isLoggingIn ? (
                <p style={{ margin: 0, color: '#fff', fontSize: 12, textShadow: '0 2px 8px rgba(40,7,65,0.3)' }}>
                  {t('Signing in...', '登入中...')}
                </p>
              ) : null}
              {googleError ? (
                <p style={{ margin: 0, color: '#fff', fontSize: 12, textShadow: '0 2px 8px rgba(40,7,65,0.3)' }}>
                  {googleError}
                </p>
              ) : null}
            </div>
          </>
        )}

        <nav
          style={{
            borderTop: '1px solid rgba(255,255,255,0.36)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.25), rgba(255,255,255,0.15))',
            display: isSignedIn ? 'none' : 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            placeItems: 'center',
          color: '#2f2454',
        }}
      >
          <button
            type="button"
            onClick={openAddFriendModal}
            disabled={!isSignedIn}
            style={{
              border: 0,
              background: 'transparent',
              color: 'inherit',
              cursor: isSignedIn ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              width: '100%',
              height: '100%',
              padding: 0,
              opacity: isSignedIn ? 1 : 0.45,
            }}
            aria-label="Add friend"
          >
            <IconUserPlus />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isSignedIn) return
              selectedContactIdRef.current = ''
              setSelectedContact(null)
            }}
            disabled={!isSignedIn}
            style={{
              border: 0,
              background: 'transparent',
              color: 'inherit',
              cursor: isSignedIn ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              width: '100%',
              height: '100%',
              padding: 0,
              opacity: isSignedIn ? 1 : 0.45,
            }}
            aria-label="Contact list"
          >
            <IconList />
          </button>
          <button
            type="button"
            onClick={() => {
              if (!isSignedIn || !selectedContact) return
              openPhoneOverlay()
            }}
            disabled={!isSignedIn || !selectedContact}
            style={{
              border: 0,
              background: 'transparent',
              color: 'inherit',
              cursor: isSignedIn && selectedContact ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              width: '100%',
              height: '100%',
              padding: 0,
              opacity: isSignedIn && selectedContact ? 1 : 0.45,
            }}
            aria-label="Open phone modal"
          >
            <IconPhone />
          </button>
          <button
            type="button"
            onClick={openSettingsModal}
            disabled={!isSignedIn}
            style={{
              border: 0,
              background: 'transparent',
              color: 'inherit',
              cursor: isSignedIn ? 'pointer' : 'default',
              display: 'grid',
              placeItems: 'center',
              width: '100%',
              height: '100%',
              padding: 0,
              opacity: isSignedIn ? 1 : 0.45,
            }}
            aria-label="Open settings"
          >
            <IconSettings />
          </button>
        </nav>
      </section>
      <GroupManagerDialog
        open={groupManagerOpen}
        locale={isZh ? 'zh-TW' : 'en'}
        groups={contactGroups}
        onClose={() => setGroupManagerOpen(false)}
        onCreate={(name) => mutateGroups('create', { name })}
        onRename={(groupId, name) => mutateGroups('update', { group_id: groupId, name })}
        onReorder={(orderedGroupIds) => mutateGroups('reorder', { ordered_group_ids: orderedGroupIds })}
        onDelete={deleteGroup}
        onRefresh={(groups) => {
          setContactGroups(groups)
          setDefaultContactGroupId((current) => (groups.some((group) => group.id === current) ? current : ''))
        }}
      />
      {settingsModalOpen ? (
        <div
          onClick={() => {
            if (settingsSaving) return
            setSettingsModalOpen(false)
            setSettingsError('')
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 6, 14, 0.52)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 54,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <form
            onSubmit={saveUserSettings}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92vw, 520px)',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(55, 30, 78, 0.9)',
              color: '#fff',
              boxShadow: '0 20px 46px rgba(0,0,0,0.35)',
              padding: 18,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('Friend Verification Code', '好友驗證碼')}</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <input
                type="text"
                value={identifyCodeInput}
                onChange={(e) => setIdentifyCodeInput(e.target.value)}
                placeholder={t('Enter code (optional)', '輸入驗證碼（可選）')}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,255,255,0.92)' }}>
              {t(
                'If you set a verification code here, anyone who adds you as a friend must enter this code. If left empty, anyone can add you as a friend using your Google account.',
                '如果你在這裡設定驗證碼，任何新增你為好友的人都必須輸入此驗證碼。若留白，任何人都可透過你的 Google 帳號新增你為好友。',
              )}
            </p>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('History Range', '歷史範圍')}</span>
              <input
                type="number"
                min={10}
                max={60}
                step={1}
                value={historyRangeInput}
                onChange={(e) => setHistoryRangeInput(e.target.value)}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,255,255,0.92)' }}>
              {t(
                'When AI needs to send messages for you or provide advice, this controls how many recent messages from your conversation with that contact AI is allowed to read.',
                '當你需要 AI 幫你傳遞訊息或提供意見時，這會控制 AI 可讀取你與對方最近訊息的數量。',
              )}
            </p>
            {settingsError ? <p style={{ margin: 0, color: '#ffd7e3', fontSize: 12 }}>{settingsError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  if (settingsSaving) return
                  setSettingsModalOpen(false)
                  setSettingsError('')
                }}
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: '#fff',
                  cursor: settingsSaving ? 'default' : 'pointer',
                  padding: '8px 14px',
                }}
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="submit"
                disabled={settingsSaving}
                style={{
                  border: '1px solid rgba(255,255,255,0.45)',
                  borderRadius: 999,
                  background: 'linear-gradient(135deg, rgb(255, 124, 183) 0%, rgb(236, 75, 167) 55%, rgb(237 195 255) 100%)',
                  color: '#fff',
                  cursor: settingsSaving ? 'default' : 'pointer',
                  padding: '8px 16px',
                  fontWeight: 700,
                  opacity: settingsSaving ? 0.7 : 1,
                }}
              >
                {settingsSaving ? t('Saving...', '儲存中...') : t('Save', '儲存')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {addFriendModalOpen ? (
        <div
          onClick={() => {
            if (addFriendSubmitting) return
            setAddFriendModalOpen(false)
            setAddFriendError('')
            setAddFriendSuccess('')
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 6, 14, 0.52)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 54,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <form
            onSubmit={submitAddFriendValidation}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92vw, 520px)',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(55, 30, 78, 0.9)',
              color: '#fff',
              boxShadow: '0 20px 46px rgba(0,0,0,0.35)',
              padding: 18,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('Add Friend', '新增好友')}</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('Google Account', 'Google 帳號')}</span>
              <input
                type="email"
                required
                value={friendEmailInput}
                onChange={(e) => setFriendEmailInput(e.target.value)}
                placeholder="friend@gmail.com"
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('Name', '名稱')}</span>
              <input
                type="text"
                required
                minLength={2}
                value={friendAliasInput}
                onChange={(e) => setFriendAliasInput(e.target.value)}
                placeholder={t('Contact name', '聯絡人名稱')}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('Friend Verification Code', '好友驗證碼')}</span>
              <input
                type="text"
                value={friendCodeInput}
                onChange={(e) => setFriendCodeInput(e.target.value)}
                placeholder={t('Optional', '可選')}
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'rgba(255,255,255,0.92)' }}>
              {t('If the other user has set a verification code, please enter it here.', '若對方有設定驗證碼，請在此輸入。')}
            </p>
            {addFriendError ? <p style={{ margin: 0, color: '#ffe56b', fontSize: 12 }}>{addFriendError}</p> : null}
            {addFriendSuccess ? <p style={{ margin: 0, color: '#ccffe0', fontSize: 12 }}>{addFriendSuccess}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  if (addFriendSubmitting) return
                  setAddFriendModalOpen(false)
                  setAddFriendError('')
                  setAddFriendSuccess('')
                }}
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: '#fff',
                  cursor: addFriendSubmitting ? 'default' : 'pointer',
                  padding: '8px 14px',
                }}
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="submit"
                disabled={addFriendSubmitting}
                style={{
                  border: '1px solid rgba(255,255,255,0.45)',
                  borderRadius: 999,
                  background: 'linear-gradient(135deg, rgb(255, 124, 183) 0%, rgb(236, 75, 167) 55%, rgb(237 195 255) 100%)',
                  color: '#fff',
                  cursor: addFriendSubmitting ? 'default' : 'pointer',
                  padding: '8px 16px',
                  fontWeight: 700,
                  opacity: addFriendSubmitting ? 0.7 : 1,
                }}
              >
                {addFriendSubmitting ? t('Checking...', '檢查中...') : t('Submit', '送出')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {testerModalOpen ? (
        <div
          onClick={() => {
            if (testerSubmitting) return
            setTesterModalOpen(false)
            setTesterError('')
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 6, 14, 0.52)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 54,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <form
            onSubmit={submitTesterLogin}
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92vw, 480px)',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(55, 30, 78, 0.9)',
              color: '#fff',
              boxShadow: '0 20px 46px rgba(0,0,0,0.35)',
              padding: 18,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t('Tester Login', '測試帳號登入')}</div>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('Email', 'Email')}</span>
              <input
                type="email"
                required
                value={testerEmail}
                onChange={(e) => setTesterEmail(e.target.value)}
                placeholder="tester@example.com"
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 13, opacity: 0.9 }}>{t('Avatar URL', '頭像 URL')}</span>
              <input
                type="url"
                value={testerAvatarUrl}
                onChange={(e) => setTesterAvatarUrl(e.target.value)}
                placeholder="https://..."
                style={{
                  height: 38,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.35)',
                  background: 'rgba(255,255,255,0.12)',
                  color: '#fff',
                  padding: '0 10px',
                  outline: 'none',
                }}
              />
            </label>
            {testerError ? <p style={{ margin: 0, color: '#ffd7e3', fontSize: 12 }}>{testerError}</p> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  if (testerSubmitting) return
                  setTesterModalOpen(false)
                  setTesterError('')
                }}
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: '#fff',
                  cursor: testerSubmitting ? 'default' : 'pointer',
                  padding: '8px 14px',
                }}
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="submit"
                disabled={testerSubmitting}
                style={{
                  border: '1px solid rgba(255,255,255,0.45)',
                  borderRadius: 999,
                  background: 'linear-gradient(135deg, rgb(255, 124, 183) 0%, rgb(236, 75, 167) 55%, rgb(237 195 255) 100%)',
                  color: '#fff',
                  cursor: testerSubmitting ? 'default' : 'pointer',
                  padding: '8px 16px',
                  fontWeight: 700,
                  opacity: testerSubmitting ? 0.7 : 1,
                }}
              >
                {testerSubmitting ? t('Signing in...', '登入中...') : t('Sign in', '登入')}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {editModalOpen && editForm ? (
        <div
          onClick={() => {
            if (pendingAvatarPreviewUrl) {
              URL.revokeObjectURL(pendingAvatarPreviewUrl)
            }
            setEditModalOpen(false)
            setEditForm(null)
            setIsAliasEditing(false)
            setPendingAvatarBlob(null)
            setPendingAvatarPreviewUrl('')
            setAvatarUploadError('')
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(7, 6, 14, 0.52)',
            backdropFilter: 'blur(3px)',
            WebkitBackdropFilter: 'blur(3px)',
            zIndex: 55,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92vw, 560px)',
              maxHeight: 'min(88vh, 760px)',
              overflowY: 'auto',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(55, 30, 78, 0.88)',
              color: '#fff',
              boxShadow: '0 20px 46px rgba(0,0,0,0.35)',
              padding: 18,
              display: 'grid',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <button
                type="button"
                disabled={!editForm.isAi || isUploadingAvatar}
                onClick={() => {
                  if (!editForm.isAi || isUploadingAvatar) return
                  avatarFileInputRef.current?.click()
                }}
                style={{
                  border: '1px solid rgba(255,255,255,0.4)',
                  background: 'transparent',
                  padding: 0,
                  borderRadius: '50%',
                  width: 128,
                  height: 128,
                  cursor: editForm.isAi && !isUploadingAvatar ? 'pointer' : 'default',
                  position: 'relative',
                  overflow: 'hidden',
                  flex: '0 0 auto',
                }}
                title={editForm.isAi ? 'Click to replace avatar (jpg/png)' : 'Avatar edit for AI only'}
              >
                <img
                  src={editForm.avatar}
                  alt="Contact avatar"
                  style={{
                    width: 128,
                    height: 128,
                    borderRadius: '50%',
                    objectFit: 'cover',
                    filter: 'drop-shadow(rgba(0, 0, 0, 0.25) 0px 8px 16px)',
                    opacity: isUploadingAvatar ? 0.5 : 1,
                  }}
                />
                {isUploadingAvatar ? (
                  <span
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 700,
                      background: 'rgba(23,13,34,0.35)',
                    }}
                  >
                    Uploading...
                  </span>
                ) : null}
              </button>
              <div style={{ minHeight: 128, display: 'grid', alignContent: 'center', flex: 1 }}>
                {isAliasEditing ? (
                  <input
                    autoFocus
                    value={editForm.alias}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, alias: e.target.value } : prev))}
                    onBlur={onAliasBlur}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                      }
                    }}
                    style={{
                      width: '100%',
                      maxWidth: 320,
                      border: '1px solid rgba(255,255,255,0.45)',
                      borderRadius: 10,
                      background: 'rgba(255,255,255,0.12)',
                      color: '#fff',
                      fontSize: isPadUp ? '1.55rem' : '1.35rem',
                      padding: '8px 12px',
                      outline: 'none',
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsAliasEditing(true)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#fff',
                      cursor: 'pointer',
                      fontSize: isPadUp ? '1.55rem' : '1.35rem',
                      textAlign: 'left',
                      padding: 0,
                      textShadow: '0 2px 8px rgba(41,10,57,0.35)',
                    }}
                  >
                    {editForm.alias}
                  </button>
                )}
              </div>
            </div>
            <input
              ref={avatarFileInputRef}
              type="file"
              accept="image/jpeg,image/png"
              onChange={onPickAvatarFile}
              style={{ display: 'none' }}
            />
            {avatarUploadError ? (
              <p style={{ margin: 0, fontSize: 12, color: '#ffd7e3' }}>{avatarUploadError}</p>
            ) : null}

            {editForm.isAi ? (
              <>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 13, opacity: 0.88 }}>Gender</div>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="ai-gender"
                        checked={editForm.gender === 'female'}
                        onChange={() =>
                          setEditForm((prev) => (prev ? { ...prev, gender: 'female', voice: 'Achernar' } : prev))
                        }
                      />
                      <span>Female</span>
                    </label>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input
                        type="radio"
                        name="ai-gender"
                        checked={editForm.gender === 'male'}
                        onChange={() =>
                          setEditForm((prev) => (prev ? { ...prev, gender: 'male', voice: 'Achird' } : prev))
                        }
                      />
                      <span>Male</span>
                    </label>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ fontSize: 13, opacity: 0.88 }}>Voice</div>
                    <select
                      value={editForm.voice}
                      onChange={(e) => setEditForm((prev) => (prev ? { ...prev, voice: e.target.value } : prev))}
                      style={{
                        height: 38,
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.35)',
                        background: 'rgba(255,255,255,0.12)',
                        color: '#fff',
                        padding: '0 10px',
                      }}
                    >
                      {(editForm.gender === 'female' ? FEMALE_VOICE_OPTIONS : MALE_VOICE_OPTIONS).map((voice) => (
                        <option key={voice} style={{ color: '#111' }} value={voice}>{voice}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 13, opacity: 0.88 }}>Glogal Prompt</div>
                  <textarea
                    value={editForm.globalPrompt}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, globalPrompt: e.target.value } : prev))}
                    rows={4}
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.35)',
                      background: 'rgba(255,255,255,0.12)',
                      color: '#fff',
                      padding: 10,
                      fontSize: 14,
                      lineHeight: 1.4,
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 13, opacity: 0.88 }}>{t('Special Prompt', '特殊 Prompt')}</div>
                  <textarea
                    value={editForm.specialPrompt || ''}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, specialPrompt: e.target.value } : prev))}
                    rows={4}
                    placeholder={
                      t(
                        'You can set a special prompt for this contact.\nWhen AI sends messages for you to this person, it will use this setting and ignore the Global Prompt.',
                        '你可以為這位聯絡人設定特殊 Prompt。\n當 AI 為你傳訊給這位對象時，會優先使用這裡的設定並忽略 Global Prompt。',
                      )
                    }
                    style={{
                      width: '100%',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.35)',
                      background: 'rgba(255,255,255,0.12)',
                      color: '#fff',
                      padding: 10,
                      fontSize: 14,
                      lineHeight: 1.4,
                      resize: 'vertical',
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 13, opacity: 0.88 }}>{t('Relationship', '關係')}</div>
                  <input
                    type="text"
                    value={editForm.relationship || ''}
                    onChange={(e) => setEditForm((prev) => (prev ? { ...prev, relationship: e.target.value } : prev))}
                    placeholder="Label your relationship with this contact"
                    style={{
                      height: 38,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.35)',
                      background: 'rgba(255,255,255,0.12)',
                      color: '#fff',
                      padding: '0 10px',
                      outline: 'none',
                    }}
                  />
                  <p style={{ margin: 0, fontSize: 12, color: 'rgba(255,255,255,0.85)', lineHeight: 1.5 }}>
                    You can describe your relationship with this person, for example: friend, boss, or crush.
                    AI will use this label to adjust wording when sending messages, and the other person will not see this label.
                  </p>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => {
                  if (pendingAvatarPreviewUrl) {
                    URL.revokeObjectURL(pendingAvatarPreviewUrl)
                  }
                  setEditModalOpen(false)
                  setEditForm(null)
                  setIsAliasEditing(false)
                  setPendingAvatarBlob(null)
                  setPendingAvatarPreviewUrl('')
                  setAvatarUploadError('')
                }}
                style={{
                  border: '1px solid rgba(255,255,255,0.35)',
                  borderRadius: 999,
                  background: 'transparent',
                  color: '#fff',
                  cursor: 'pointer',
                  padding: '8px 14px',
                  fontWeight: 600,
                }}
              >
                {t('Cancel', '取消')}
              </button>
              <button
                type="button"
                onClick={onSaveContactEdit}
                style={{
                  border: '1px solid rgba(255,255,255,0.45)',
                  borderRadius: 999,
                  background: 'linear-gradient(135deg, rgb(255, 124, 183) 0%, rgb(236, 75, 167) 55%, rgb(237 195 255) 100%)',
                  color: '#fff',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 16px',
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                <IconSave />
                <span>{t('Save', '儲存')}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showPhoneOverlay ? (
        <div
          onClick={closePhoneOverlay}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(6, 5, 12, 0.58)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            zIndex: 50,
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'relative',
              width: 'min(64vw, 380px)',
              aspectRatio: '9 / 13',
              maxWidth: 'calc(100vw - 32px)',
              maxHeight: 'calc(100vh - 32px)',
            }}
          >
            <img
              src={callPeerAvatarUrl}
              alt="Caller avatar"
              style={{
                position: 'absolute',
                top: '14%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 150,
                height: 'auto',
                cursor: 'pointer',
                filter: 'drop-shadow(rgba(0, 0, 0, 0.36) 0px 10px 20px)',
                borderRadius: '50%',
                opacity: showPhonePeerAvatar ? 1 : 0,
                transition: 'opacity 420ms ease',
                zIndex: 4,
              }}
              onClick={onPhoneImageClick}
            />
            <img
              src="/images/phone1.webp"
              alt="Phone 1"
              onClick={onPhoneImageClick}
              style={{
                position: 'absolute',
                top: '40%',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '50%',
                height: 'auto',
                cursor: 'pointer',
                filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.36))',
                zIndex: 1,
              }}
            />
            <img
              src="/images/phone2.webp"
              alt="Phone 2"
              onClick={onPhoneImageClick}
              style={{
                position: 'absolute',
                top: '40%',
                left: '50%',
                transform: `translateX(-50%) rotate(${phone2RotationDeg}deg)`,
                transformOrigin: '0% 50%',
                transition: 'transform 1s ease',
                width: '50%',
                height: 'auto',
                cursor: 'pointer',
                filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.36))',
                zIndex: 3,
              }}
            />
          </div>
        </div>
      ) : null}
      <audio ref={phoneRingAudioRef} src="/images/phone_ring.wav" preload="auto" />
      <audio ref={phonePickupAudioRef} src="/images/phone_pickup.wav" preload="auto" />
      {imageViewerUrl ? (
        <div
          onClick={() => setImageViewerUrl('')}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 3, 18, 0.82)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 3000,
            cursor: 'zoom-out',
            padding: 20,
          }}
        >
          <img
            src={imageViewerUrl}
            alt="Preview"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(92vw, 1200px)',
              maxHeight: '88vh',
              borderRadius: 14,
              border: '1px solid rgba(255,255,255,0.35)',
              boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
              objectFit: 'contain',
              background: 'rgba(0,0,0,0.15)',
            }}
          />
        </div>
      ) : null}
    </main>
  )
}

function ChatTestLab() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const isZh = useMemo(() => detectIsZhLocale(), [])
  const t = (enText, zhText) => tr(isZh, enText, zhText)
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [debugLog, setDebugLog] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) {
      setError(t('Please enter a message.', '請輸入訊息。'))
      return
    }

    setError('')
    setReply('')
    setDebugLog('')
    setIsLoading(true)

    const requestUrl = `${apiBaseUrl}/api/chat`
    const startedAt = new Date().toISOString()

    try {
      const res = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const rawText = await res.text()
      let data = {}
      try {
        data = rawText ? JSON.parse(rawText) : {}
      } catch {
        data = { rawText }
      }

      if (!res.ok) {
        const msg = data.error || `Request failed (HTTP ${res.status})`
        setDebugLog(
          JSON.stringify(
            { startedAt, requestUrl, status: res.status, statusText: res.statusText, response: data },
            null,
            2,
          ),
        )
        throw new Error(msg)
      }

      setReply(data.reply || '')
      setDebugLog(
        JSON.stringify(
          {
            startedAt,
            requestUrl,
            status: res.status,
            statusText: res.statusText,
            responsePreview: (data.reply || '').slice(0, 250),
          },
          null,
          2,
        ),
      )
    } catch (err) {
      const errorMessage = err?.message || t('Unable to reach API.', '無法連線到 API。')
      setError(errorMessage)
      setDebugLog(
        JSON.stringify(
          {
            startedAt,
            requestUrl,
            error: errorMessage,
            hint:
              errorMessage === 'Failed to fetch'
                ? t('Usually CORS, HTTPS/mixed-content, DNS, or backend unavailable.', '通常是 CORS、HTTPS/混合內容、DNS 或後端服務不可用。')
                : '',
          },
          null,
          2,
        ),
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 760,
        margin: '36px auto',
        padding: 16,
        fontFamily: 'Avenir Next, Montserrat, Helvetica Neue, sans-serif',
      }}
    >
      <button
        type="button"
        onClick={() => navigateTo('/')}
        style={{ border: '1px solid #cad5e9', background: '#fff', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}
      >
        {t('← Back to Login', '← 回到登入頁')}
      </button>

      <h1>{t('Pisces AI Chat Test Lab', 'Pisces AI 測試頁')}</h1>
      <p>{t('Backend endpoint:', '後端端點：')} {apiBaseUrl}</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('Type a message for Gemini...', '輸入要給 Gemini 的訊息...')}
          style={{ padding: 12, fontSize: 16 }}
        />
        <button type="submit" disabled={isLoading} style={{ width: 170, padding: '10px 12px' }}>
          {isLoading ? t('Sending...', '送出中...') : t('Send to AI', '送給 AI')}
        </button>
      </form>

      <section style={{ marginTop: 24 }}>
        <h2>{t('AI Reply', 'AI 回覆')}</h2>
        <div style={{ minHeight: 120, border: '1px solid #ccc', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          {reply || t('No reply yet.', '尚無回覆。')}
        </div>
        {error ? <p style={{ color: '#b00020', marginTop: 12 }}>{error}</p> : null}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>{t('Debug Log', '偵錯日誌')}</h2>
        <pre
          style={{
            minHeight: 120,
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            whiteSpace: 'pre-wrap',
            overflowX: 'auto',
          }}
        >
          {debugLog || t('No logs yet.', '尚無日誌。')}
        </pre>
      </section>
    </main>
  )
}

function NotFound() {
  const isZh = detectIsZhLocale()
  const t = (enText, zhText) => tr(isZh, enText, zhText)
  return (
    <main style={{ padding: 24, fontFamily: 'Avenir Next, Montserrat, Helvetica Neue, sans-serif' }}>
      <h1>{t('Page Not Found', '找不到頁面')}</h1>
      <p>{t('This route does not exist.', '此路由不存在。')}</p>
      <button type="button" onClick={() => navigateTo('/')} style={{ padding: '8px 12px' }}>
        {t('Go Home', '回首頁')}
      </button>
    </main>
  )
}

export default function App() {
  const pathname = usePathname()
  if (pathname === '/') return <LoginHome />
  if (pathname === '/lab/chat-test') return <ChatTestLab />
  return <NotFound />
}
