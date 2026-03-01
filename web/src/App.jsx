import { useEffect, useMemo, useRef, useState } from 'react'

const FALLBACK_API_BASE_URL = 'https://pisces-315346868518.asia-east1.run.app'
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8080'
const GOOGLE_CLIENT_ID = '315346868518-os2tf8uc5282bggj40jbpkaltae1phi9.apps.googleusercontent.com'
const MAX_RECORD_MS = 30000

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

function IconMessage() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 13a7 7 0 0 1-7 7H7l-4 3v-7a7 7 0 0 1 7-7h4a7 7 0 0 1 7 7z" />
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
  const sec = Math.max(0, Math.floor(seconds))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function AudioMessagePlayer({ audioUrl }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onTimeUpdate = () => setCurrentTime(audio.currentTime || 0)
    const onLoaded = () => setDuration(audio.duration || 0)
    const onEnded = () => setIsPlaying(false)

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('ended', onEnded)
    }
  }, [])

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
            background: 'linear-gradient(135deg, #ff7cb7 0%, #ec4ba7 55%, #c442e8 100%)',
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 4px 10px rgba(96, 24, 121, 0.35)',
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
                  background: '#ff84c2',
                  opacity: 0.9,
                  transformOrigin: 'bottom',
                  animation: isPlaying ? `wavePulse 920ms ease-in-out ${i * 40}ms infinite` : 'none',
                }}
              />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.9)' }}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration || 0)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function LoginHome() {
  useBackgroundImage('/images/background.webp')
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const isPadUp = useIsPadUp()
  const googleButtonRef = useRef(null)
  const [googleError, setGoogleError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [hoveredContactId, setHoveredContactId] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [messagesByContact, setMessagesByContact] = useState({})
  const [micAllowed, setMicAllowed] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [recordElapsedMs, setRecordElapsedMs] = useState(0)
  const chatScrollRef = useRef(null)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordIntervalRef = useRef(null)
  const recordTimeoutRef = useRef(null)

  const contacts = useMemo(() => {
    return [
      {
        id: 'pisces-core',
        name: '💜✨Pisces✨💜',
        avatar: '/images/fish.png',
        snippet: '',
      },
    ]
  }, [])

  useEffect(() => {
    let cancelled = false
    let attempts = 0

    const initGoogleButton = () => {
      if (cancelled) return

      const google = window.google
      if (google?.accounts?.id && googleButtonRef.current) {
        google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            try {
              setIsLoggingIn(true)
              setGoogleError('')

              const res = await fetch(`${apiBaseUrl}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential }),
              })
              const data = await res.json()
              if (!res.ok || !data.ok) {
                throw new Error(data.error || `Google login failed (HTTP ${res.status})`)
              }
              setCurrentUser(data.user || null)
              setIsSignedIn(true)
              setSelectedContact(null)
            } catch (err) {
              setGoogleError(err?.message || 'Google login failed.')
            } finally {
              setIsLoggingIn(false)
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
  }, [])

  useEffect(() => {
    if (!selectedContact || !chatScrollRef.current) return
    chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [selectedContact, messagesByContact])

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
    if (isRecording || !selectedContact || !micAllowed) return
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) return

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      const contactId = selectedContact.id
      recordChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const chunks = recordChunksRef.current
        if (chunks.length > 0) {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
          const audioUrl = URL.createObjectURL(blob)
          const audioMessageId = `ua-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          setMessagesByContact((prev) => {
            const current = prev[contactId] || []
            return {
              ...prev,
              [contactId]: [...current, { id: audioMessageId, role: 'user', audioUrl }],
            }
          })
        }

        if (mediaStreamRef.current) {
          mediaStreamRef.current.getTracks().forEach((t) => t.stop())
        }
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        recordChunksRef.current = []
        clearRecordingTimers()
        setIsRecording(false)
        setRecordElapsedMs(0)
      }

      recorder.start()
      setIsRecording(true)
      setRecordElapsedMs(0)
      setShowEmojiPicker(false)

      const startedAt = Date.now()
      recordIntervalRef.current = setInterval(() => {
        setRecordElapsedMs(Math.min(Date.now() - startedAt, MAX_RECORD_MS))
      }, 100)
      recordTimeoutRef.current = setTimeout(() => {
        stopRecording()
      }, MAX_RECORD_MS)
    } catch {
      setMicAllowed(false)
      setIsRecording(false)
      setRecordElapsedMs(0)
    }
  }

  useEffect(() => {
    return () => {
      clearRecordingTimers()
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop()
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop())
      }
    }
  }, [])

  return (
    <main
      style={{
        height: '100dvh',
        display: 'grid',
        placeItems: 'center',
        boxSizing: 'border-box',
        overflow: 'hidden',
        padding: 'max(8px, min(2vh, 18px)) 12px',
        fontFamily: 'Avenir Next, Montserrat, Helvetica Neue, sans-serif',
      }}
    >
      <section
        style={{
          width: 'min(92vw, 720px)',
          height: 'min(96dvh, 980px)',
          maxHeight: '96dvh',
          borderRadius: 46,
          border: '2px solid rgba(255,255,255,0.55)',
          display: 'grid',
          gridTemplateRows: isSignedIn ? '56px 1fr 92px' : '56px 1fr auto 92px',
          background: 'linear-gradient(165deg, rgba(255,255,255,0.24), rgba(255,255,255,0.1))',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          boxShadow: '0 22px 80px rgba(57, 6, 82, 0.4)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px 0',
            color: 'rgba(255,255,255,0.92)',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}>9:41</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <IconPower />
            <IconBluetooth />
            <IconBattery />
          </div>
        </div>

        {isSignedIn ? (
          <div style={{ padding: '8px 10px 0', minHeight: 0 }}>
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
              <div style={{ height: '100%', display: 'grid', gridTemplateRows: '56px 1fr auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isPadUp ? '0 24px' : '0 8px' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedContact(null)}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#fff',
                      fontSize: 34,
                      lineHeight: 1,
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                      textShadow: '0 2px 8px rgba(41,10,57,0.35)',
                    }}
                  >
                    &lt;
                  </button>
                  <div style={{ color: '#fff', fontSize: isPadUp ? '1.5rem' : '1.3rem', textShadow: '0 2px 8px rgba(41,10,57,0.35)' }}>
                    {selectedContact.name}
                  </div>
                </div>

                <div
                  ref={chatScrollRef}
                  className="no-scrollbar"
                  style={{
                    minHeight: 0,
                    overflowY: 'auto',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    padding: isPadUp ? '8px 24px 4px' : '8px 8px 4px',
                    display: 'grid',
                    alignContent: 'start',
                    gap: 10,
                  }}
                >
                  {(messagesByContact[selectedContact.id] || []).map((msg) => {
                    if (msg.role === 'user') {
                      return (
                        <div key={msg.id} style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                          <div
                            style={{
                              width: msg.audioUrl ? 'fit-content' : undefined,
                              maxWidth: isPadUp ? '62%' : '78%',
                              background: msg.audioUrl ? 'transparent' : '#79cc63',
                              color: msg.audioUrl ? '#fff' : '#1b2817',
                              borderRadius: 18,
                              padding: msg.audioUrl ? '0' : '10px 12px',
                              fontSize: '0.98rem',
                              lineHeight: 1.35,
                              whiteSpace: 'pre-wrap',
                              wordBreak: 'break-word',
                              overflowWrap: 'anywhere',
                              boxShadow: msg.audioUrl ? 'none' : '0 3px 8px rgba(0,0,0,0.18)',
                            }}
                          >
                            {msg.audioUrl ? (
                              <AudioMessagePlayer audioUrl={msg.audioUrl} />
                            ) : (
                              msg.text
                            )}
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={msg.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: isPadUp ? '72px 1fr' : '56px 1fr',
                          alignItems: 'start',
                          columnGap: 8,
                          width: '100%',
                        }}
                      >
                        <img
                          src="/images/fish.png"
                          alt="Pisces"
                          style={{
                            width: isPadUp ? 64 : 48,
                            height: isPadUp ? 64 : 48,
                            borderRadius: '50%',
                            objectFit: 'cover',
                            marginTop: 0,
                          }}
                        />
                        <div
                          style={{
                            justifySelf: 'start',
                            width: 'fit-content',
                            maxWidth: isPadUp ? '66%' : '80%',
                            background: 'rgba(84, 84, 84, 0.88)',
                            color: '#fff',
                            borderRadius: 18,
                            padding: '10px 12px',
                            fontSize: '0.96rem',
                            lineHeight: 1.35,
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            overflowWrap: 'anywhere',
                            boxShadow: '0 3px 8px rgba(0,0,0,0.2)',
                          }}
                        >
                          {msg.role === 'ai-typing' ? (
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', opacity: 0.4, animation: 'typingDot 1s infinite' }} />
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', opacity: 0.4, animation: 'typingDot 1s infinite 0.2s' }} />
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', opacity: 0.4, animation: 'typingDot 1s infinite 0.4s' }} />
                            </span>
                          ) : (
                            msg.text
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <form
                  onSubmit={async (e) => {
                    e.preventDefault()
                    if (isRecording) return
                    const input = chatInput.trim()
                    if (!input || !selectedContact) return

                    const contactId = selectedContact.id
                    const userMessageId = `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
                    const typingId = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

                    setMessagesByContact((prev) => {
                      const current = prev[contactId] || []
                      return {
                        ...prev,
                        [contactId]: [
                          ...current,
                          { id: userMessageId, role: 'user', text: input },
                          { id: typingId, role: 'ai-typing', text: '...' },
                        ],
                      }
                    })
                    setChatInput('')
                    setShowEmojiPicker(false)

                    try {
                      const res = await fetch(`${apiBaseUrl}/api/chat`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: input }),
                      })
                      const data = await res.json()
                      const aiText = res.ok && data.reply ? data.reply : data.error || `Request failed (${res.status})`

                      setMessagesByContact((prev) => {
                        const current = prev[contactId] || []
                        return {
                          ...prev,
                          [contactId]: current.map((m) =>
                            m.id === typingId
                              ? { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'ai', text: aiText }
                              : m,
                          ),
                        }
                      })
                    } catch (err) {
                      const errText = err?.message || 'Unable to reach API.'
                      setMessagesByContact((prev) => {
                        const current = prev[contactId] || []
                        return {
                          ...prev,
                          [contactId]: current.map((m) =>
                            m.id === typingId
                              ? { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role: 'ai', text: errText }
                              : m,
                          ),
                        }
                      })
                    }
                  }}
                  style={{ padding: isPadUp ? '8px 24px 12px' : '8px 8px 12px' }}
                >
                  <div
                    style={{
                      position: 'relative',
                      display: 'grid',
                      gridTemplateColumns: micAllowed ? '1fr auto auto auto' : '1fr auto auto',
                      alignItems: 'center',
                      gap: 10,
                      borderRadius: 16,
                      border: '1px solid rgba(255,255,255,0.5)',
                      background: 'rgba(255,255,255,0.18)',
                      backdropFilter: 'blur(8px)',
                      WebkitBackdropFilter: 'blur(8px)',
                      padding: '8px 10px',
                    }}
                  >
                    <div style={{ position: 'relative', height: 24, display: 'flex', alignItems: 'center' }}>
                      {isRecording ? (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            height: 4,
                            borderRadius: 999,
                            background: 'rgba(255,255,255,0.25)',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${Math.min((recordElapsedMs / MAX_RECORD_MS) * 100, 100)}%`,
                              background: '#79cc63',
                              transition: 'width 100ms linear',
                            }}
                          />
                        </div>
                      ) : null}
                      <input
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onFocus={() => setShowEmojiPicker(false)}
                        placeholder={isRecording ? '' : 'Type a message...'}
                        disabled={isRecording}
                        style={{
                          height: 24,
                          width: '100%',
                          border: 0,
                          outline: 'none',
                          background: 'transparent',
                          color: '#fff',
                          fontSize: '1rem',
                          opacity: isRecording ? 0 : 1,
                        }}
                      />
                    </div>
                    {micAllowed ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (isRecording) {
                            stopRecording()
                          } else {
                            startRecording()
                          }
                        }}
                        style={{
                          border: 0,
                          background: 'transparent',
                          color: '#fff',
                          cursor: 'pointer',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        {isRecording ? <IconStop /> : <IconMic />}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={isRecording}
                      onClick={() => setShowEmojiPicker((v) => !v)}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: '#fff',
                        cursor: isRecording ? 'default' : 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        opacity: isRecording ? 0.5 : 1,
                      }}
                    >
                      <IconEmoji />
                    </button>
                    <button
                      type="submit"
                      disabled={isRecording}
                      style={{
                        border: 0,
                        background: 'transparent',
                        color: '#fff',
                        cursor: isRecording ? 'default' : 'pointer',
                        display: 'grid',
                        placeItems: 'center',
                        opacity: isRecording ? 0.5 : 1,
                      }}
                    >
                      <IconSend />
                    </button>
                    {showEmojiPicker ? (
                      <div
                        style={{
                          position: 'absolute',
                          right: 42,
                          bottom: 52,
                          background: 'rgba(56, 39, 78, 0.92)',
                          border: '1px solid rgba(255,255,255,0.3)',
                          borderRadius: 12,
                          padding: '8px 10px',
                          display: 'grid',
                          gridTemplateColumns: 'repeat(6, 1fr)',
                          gap: 6,
                          boxShadow: '0 8px 18px rgba(0,0,0,0.25)',
                          backdropFilter: 'blur(8px)',
                          WebkitBackdropFilter: 'blur(8px)',
                        }}
                      >
                        {['😀', '😂', '🥹', '😍', '🙏', '🔥', '✨', '💜', '👍', '🎉', '🤔', '😎'].map((emoji) => (
                          <button
                            key={emoji}
                            type="button"
                            onClick={() => {
                              setChatInput((v) => `${v}${emoji}`)
                              setShowEmojiPicker(false)
                            }}
                            style={{
                              border: 0,
                              background: 'transparent',
                              fontSize: 20,
                              lineHeight: 1,
                              cursor: 'pointer',
                            }}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </form>
              </div>
            ) : (
              <div
                className="no-scrollbar"
                style={{
                  height: '100%',
                  overflowY: 'auto',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  padding: isPadUp ? '0px 24px 0px' : '0px 4px 0px',
                }}
              >
                {contacts.map((contact, index) => (
                  <article
                    key={contact.id}
                    onMouseEnter={() => setHoveredContactId(contact.id)}
                    onMouseLeave={() => setHoveredContactId(null)}
                    onClick={() => setSelectedContact(contact)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isPadUp ? '72px 1fr' : '56px 1fr',
                      alignItems: 'center',
                      columnGap: isPadUp ? 12 : 0,
                      padding: '14px 10px 16px',
                      borderRadius: isPadUp ? 0 : 14,
                      borderBottom: hoveredContactId === contact.id ? 'none' : '1px solid #d8d8d8',
                      boxShadow: hoveredContactId === contact.id ? 'rgba(0, 0, 0, 0.45) 0px 17px 20px -20px' : 'none',
                      transition: 'box-shadow 160ms ease, border-color 160ms ease',
                      position: 'relative',
                      marginBottom: 10,
                      cursor: 'pointer',
                      pointerEvents: 'auto',
                    }}
                  >
                    <img
                      src={contact.avatar}
                      alt={contact.name}
                    style={{
                        width: isPadUp ? 64 : 48,
                        height: isPadUp ? 64 : 48,
                        borderRadius: '50%',
                        objectFit: 'cover',
                      }}
                    />

                    <div style={{ display: 'grid', alignContent: 'center', minHeight: 64 }}>
                      <div
                        style={{
                          color: '#fff',
                          fontSize: isPadUp ? '1.5rem' : '1.3rem',
                          lineHeight: 1.05,
                          textShadow: '0 2px 8px rgba(41, 10, 57, 0.35)',
                          cursor: 'pointer',
                        }}
                      >
                        {contact.name}
                      </div>
                      {contact.snippet ? (
                        <div
                          style={{
                            marginTop: 4,
                            color: 'rgba(255,255,255,0.98)',
                            fontSize: isPadUp ? '1.2rem' : '1rem',
                            lineHeight: 1.05,
                            textShadow: '0 2px 8px rgba(41, 10, 57, 0.35)',
                          }}
                        >
                          {contact.snippet}
                        </div>
                      ) : null}
                    </div>

                    {index === contacts.length - 1 ? null : (
                      <div
                        style={{
                          position: 'absolute',
                          left: 10,
                          right: 10,
                          bottom: 0,
                          height: 1,
                          boxShadow: '0 12px 14px 1px rgba(75, 22, 96, 0.55)',
                        }}
                      />
                    )}
                  </article>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', placeItems: 'center', padding: '0 20px' }}>
              <div style={{ display: 'grid', justifyItems: 'center', alignContent: 'center', lineHeight: 1 }}>
                <img
                  src="/images/logo.webp"
                  alt="Pisces"
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
                    fontFamily: '"Waterfall", cursive',
                    fontWeight: 400,
                    fontStyle: 'normal',
                    fontSize: 'clamp(32px, 12.5vw, 64px)',
                    lineHeight: 1.82,
                    marginTop: 'clamp(-22px, -3.5vw, -12px)',
                    textShadow: '0 4px 14px rgba(40, 7, 65, 0.35)',
                  }}
                >
                  Pisces
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
                  Signing in...
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
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            placeItems: 'center',
            color: '#2f2454',
          }}
        >
          <IconUser />
          <IconMessage />
          <IconPhone />
          <IconSettings />
        </nav>
      </section>
    </main>
  )
}

function ChatTestLab() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const [message, setMessage] = useState('')
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [debugLog, setDebugLog] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const onSubmit = async (event) => {
    event.preventDefault()
    const trimmed = message.trim()
    if (!trimmed) {
      setError('Please enter a message.')
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
      const errorMessage = err?.message || 'Unable to reach API.'
      setError(errorMessage)
      setDebugLog(
        JSON.stringify(
          {
            startedAt,
            requestUrl,
            error: errorMessage,
            hint:
              errorMessage === 'Failed to fetch'
                ? 'Usually CORS, HTTPS/mixed-content, DNS, or backend unavailable.'
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
        ← Back to Login
      </button>

      <h1>Pisces AI Chat Test Lab</h1>
      <p>Backend endpoint: {apiBaseUrl}</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message for Gemini..."
          style={{ padding: 12, fontSize: 16 }}
        />
        <button type="submit" disabled={isLoading} style={{ width: 170, padding: '10px 12px' }}>
          {isLoading ? 'Sending...' : 'Send to AI'}
        </button>
      </form>

      <section style={{ marginTop: 24 }}>
        <h2>AI Reply</h2>
        <div style={{ minHeight: 120, border: '1px solid #ccc', borderRadius: 8, padding: 12, whiteSpace: 'pre-wrap' }}>
          {reply || 'No reply yet.'}
        </div>
        {error ? <p style={{ color: '#b00020', marginTop: 12 }}>{error}</p> : null}
      </section>

      <section style={{ marginTop: 24 }}>
        <h2>Debug Log</h2>
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
          {debugLog || 'No logs yet.'}
        </pre>
      </section>
    </main>
  )
}

function NotFound() {
  return (
    <main style={{ padding: 24, fontFamily: 'Avenir Next, Montserrat, Helvetica Neue, sans-serif' }}>
      <h1>Page Not Found</h1>
      <p>This route does not exist.</p>
      <button type="button" onClick={() => navigateTo('/')} style={{ padding: '8px 12px' }}>
        Go Home
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
