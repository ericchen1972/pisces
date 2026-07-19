import { useEffect, useMemo, useRef, useState } from 'react'
import * as Ably from 'ably'
import { localeFromLanguage, visibleErrorMessage } from './lib/i18n.js'
import {
  DEMO_ACCOUNT_EMAILS,
  demoAccountFromUrl,
  openDemoWindow,
  stripDemoLoginQuery,
} from './lib/demoAccounts.js'
import {
  applyContactGroupAssignment,
  applyDeletedContactGroup,
  applyLocalThenRefresh,
  contactGroupStateFromResponse,
  shouldAutoMarkIncomingRead,
  unreadStateFromFriendsResponse,
} from './lib/chatState.js'
import {
  consumeGuardedRequest,
  createAuthRequestGuard,
  createAuthTransitionCoordinator,
} from './lib/authRequestGuard.js'
import { resetAccountScopedRefs, stopActiveRecordingResources } from './lib/accountScope.js'
import { createAccountOperationScope } from './lib/operationScope.js'
import { avatarProcessingErrorMessage, createAvatarPreviewOwner, prepareAvatarPreview } from './lib/avatarMedia.js'
import { createOwnedObjectUrlRegistry, discardRecordedMessage } from './lib/ownedObjectUrls.js'
import { authorizeIncomingFriend } from './lib/realtimeFriendGate.js'
import { createReconnectGate, createRecipientReconciler, mergeCanonicalHistoryTail, reconcileCanonicalMessage, reconcileRecipientSnapshot } from './lib/recipientReconciliation.js'
import { requireSuccessfulVoiceResponse } from './lib/voiceResponse.js'
import { mergeStreamMessage, streamAiTurn } from './lib/stream.js'
import {
  canonicalIncomingMessage,
  createClientRequestId,
  effectiveMessageRole,
  sendPersonRequest,
  sendPersonVoiceRequest,
  stablePersonSendIdentity,
  startExclusiveSend,
} from './lib/chatSend.js'
import ChatShell from './features/chat/ChatShell.jsx'
import ContactSidebar from './features/chat/ContactSidebar.jsx'
import Composer from './features/chat/Composer.jsx'
import Conversation from './features/chat/Conversation.jsx'
import ConversationEmptyState from './features/chat/ConversationEmptyState.jsx'
import AiCallOverlay from './features/calls/AiCallOverlay.jsx'
import LoginScreen from './features/auth/LoginScreen.jsx'
import TesterLoginDialog from './features/auth/TesterLoginDialog.jsx'
import SettingsDialog from './features/settings/SettingsDialog.jsx'
import AiSettingsDialog from './features/settings/AiSettingsDialog.jsx'
import { applyAiContactSettings, buildAiSettingsPayload, mergeAiSettingsUser, openaiVoiceFromUser } from './features/settings/aiSettingsContract.js'
import AddFriendDialog from './features/contacts/AddFriendDialog.jsx'
import EditContactDialog from './features/contacts/EditContactDialog.jsx'
import { requestFriendDeletion } from './features/contacts/contactActions.js'
import ImageViewerDialog from './components/ImageViewerDialog.jsx'
import { PlayIcon, StopIcon } from './components/icons.jsx'
import { useOpenAIRealtime } from './features/calls/useOpenAIRealtime.js'
import './styles/app-shell.css'
import './styles/chat.css'
import './styles/dialogs.css'
import './styles/forms.css'

const FALLBACK_API_BASE_URL = 'https://pisces-315346868518.asia-east1.run.app'
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8080'
const GOOGLE_CLIENT_ID = '315346868518-os2tf8uc5282bggj40jbpkaltae1phi9.apps.googleusercontent.com'
const MAX_RECORD_MS = 30000
const AI_DEFAULT_GLOBAL_PROMPT = 'You are a polite, warm, and thoughtful AI communication partner.'
const UI_STORAGE_KEY = 'pisces_ui_v1'
const AVATAR_SIZE = 256
const initializedGoogleIdentityClients = new WeakMap()

function initializeGoogleIdentityClient(identityClient, options) {
  const existing = initializedGoogleIdentityClients.get(identityClient)
  if (existing) {
    existing.callback = options.callback
    return
  }

  const state = { callback: options.callback }
  initializedGoogleIdentityClients.set(identityClient, state)
  identityClient.initialize({
    ...options,
    callback: (response) => state.callback(response),
  })
}

function detectIsZhLocale() {
  if (typeof navigator === 'undefined') return false
  return localeFromLanguage(navigator.language) === 'zh-TW'
}

function tr(isZh, enText, zhText) {
  return isZh ? zhText : enText
}

function isLocalHostName(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

function isLoopbackApiBase(value) {
  try {
    return isLocalHostName(new URL(value).hostname)
  } catch {
    return false
  }
}

function getApiBaseUrl() {
  const envBase = (import.meta.env.VITE_API_BASE_URL || '').trim()
  const host = window.location.hostname
  const isLocalHost = isLocalHostName(host)
  if (!isLocalHost) return ''
  if (envBase) {
    const normalizedEnvBase = envBase.replace(/\/$/, '')
    if (isLoopbackApiBase(normalizedEnvBase)) return normalizedEnvBase
  }
  return LOCAL_API_BASE_URL.replace(/\/$/, '')
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const sec = Math.max(0, Math.floor(seconds))
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
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

async function decodeAvatarFile(file) {
  const image = await loadImageFile(file)
  return {
    source: image,
    width: image.naturalWidth || image.width,
    height: image.naturalHeight || image.height,
  }
}

async function normalizeAvatarImage({ source: image, width: sourceWidth, height: sourceHeight }) {
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

function buildAvatarWebpBlob(file) {
  return prepareAvatarPreview({ file, decode: decodeAvatarFile, normalize: normalizeAvatarImage })
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

export function AudioMessagePlayer({ audioUrl, variant = 'user', durationHint = 0, kind = 'voice', locale = 'en' }) {
  const audioRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [duration, setDuration] = useState(
    Number.isFinite(durationHint) && durationHint > 0 ? durationHint : 0,
  )
  const isAi = variant === 'ai'
  const buttonBackground = isAi ? '#2f2f2f' : '#ececec'
  const waveColor = isAi ? '#b4b4b4' : '#424242'
  const buttonShadow = '0 2px 8px rgba(0, 0, 0, 0.28)'
  const zh = locale === 'zh-TW'
  const mediaName = kind === 'music' ? (zh ? '音樂' : 'music') : (zh ? '語音訊息' : 'voice message')

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
              background: buttonBackground,
            color: '#fff',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: buttonShadow,
          }}
          aria-label={`${isPlaying ? (zh ? '暫停' : 'Pause') : (zh ? '播放' : 'Play')}${zh ? '' : ' '}${mediaName}`}
        >
          {isPlaying ? <StopIcon size={20} /> : <PlayIcon size={20} />}
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

function LoginHome() {
  const apiBaseUrl = useMemo(() => getApiBaseUrl(), [])
  const isZh = useMemo(() => detectIsZhLocale(), [])
  const t = (enText, zhText) => tr(isZh, enText, zhText)
  const googleButtonRef = useRef(null)
  const demoBootstrapStartedRef = useRef(false)
  const [googleError, setGoogleError] = useState('')
  const [demoLoginError, setDemoLoginError] = useState('')
  const [isLoggingIn, setIsLoggingIn] = useState(false)
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [testerLoginEnabled, setTesterLoginEnabled] = useState(false)
  const [currentUser, setCurrentUser] = useState(null)
  const [selectedContact, setSelectedContact] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [messagesByContact, setMessagesByContact] = useState({})
  const [unreadByContact, setUnreadByContact] = useState({})
  const [contactGroups, setContactGroups] = useState([])
  const [defaultContactGroupId, setDefaultContactGroupId] = useState('')
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [micAllowed, setMicAllowed] = useState(() => Boolean(navigator.mediaDevices?.getUserMedia))
  const [isRecording, setIsRecording] = useState(false)
  const [isAwaitingReply, setIsAwaitingReply] = useState(false)
  const [activeCall, setActiveCall] = useState(null)
  const [contacts, setContacts] = useState([
    {
      id: 'pisces-core',
      name: 'Convia',
      avatar: '/images/fish.png',
      snippet: '',
      isAi: true,
      gender: 'female',
      voice: 'Achernar',
      openaiVoice: 'marin',
      globalPrompt: AI_DEFAULT_GLOBAL_PROMPT,
    },
  ])
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [editForm, setEditForm] = useState(null)
  const [editContactSaving, setEditContactSaving] = useState(false)
  const [editContactRemoving, setEditContactRemoving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const [isPreparingAvatar, setIsPreparingAvatar] = useState(false)
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
  const [friendGroupInput, setFriendGroupInput] = useState('')
  const [friendCodeInput, setFriendCodeInput] = useState('')
  const [addFriendError, setAddFriendError] = useState('')
  const [addFriendSuccess, setAddFriendSuccess] = useState('')
  const [addFriendSubmitting, setAddFriendSubmitting] = useState(false)
  const [pendingAvatarBlob, setPendingAvatarBlob] = useState(null)
  const [recordElapsedMs, setRecordElapsedMs] = useState(0)
  const [imageViewerUrl, setImageViewerUrl] = useState('')
  const restoredSelectedContactIdRef = useRef(null)
  const selectedContactIdRef = useRef('')
  const contactsRef = useRef(contacts)
  contactsRef.current = contacts
  const chatDraftVersionRef = useRef(0)
  const mediaRecorderRef = useRef(null)
  const mediaStreamRef = useRef(null)
  const recordChunksRef = useRef([])
  const recordIntervalRef = useRef(null)
  const recordTimeoutRef = useRef(null)
  const recordingOperationRef = useRef(null)
  const aiStreamOperationRef = useRef(null)
  const personSendOperationRef = useRef(null)
  const personSendIdentityRef = useRef(null)
  const deleteContactOperationRef = useRef(null)
  const contactEditSaveRef = useRef(null)
  const aiEditSaveRef = useRef(null)
  const realtimeFriendRefreshesRef = useRef(new Map())
  const recipientReconcilerRef = useRef(null)
  const avatarFileInputRef = useRef(null)
  const avatarPreviewOwnerRef = useRef(null)
  if (!avatarPreviewOwnerRef.current) avatarPreviewOwnerRef.current = createAvatarPreviewOwner()
  const recordedObjectUrlsRef = useRef(null)
  if (!recordedObjectUrlsRef.current) recordedObjectUrlsRef.current = createOwnedObjectUrlRegistry()
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
  const realtimeOperationScopeRef = useRef(null)
  if (!realtimeOperationScopeRef.current) {
    realtimeOperationScopeRef.current = createAccountOperationScope(authRequestGuard)
  }
  const realtimeOperationScope = realtimeOperationScopeRef.current
  const aiContactAvatar = contacts.find((c) => c.isAi)?.avatar || '/images/fish.png'
  const aiAvatarForCall = currentUser?.ai_avatar_url || aiContactAvatar || '/images/fish.png'
  const realtimeCall = useOpenAIRealtime({
    active: Boolean(activeCall),
    apiBaseUrl,
    mode: activeCall?.mode || 'ai',
    contactId: activeCall?.contactId || 'pisces-core',
    operationScope: realtimeOperationScope,
  })

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
            requestId: message.client_request_id || '',
            collapsed: true,
            userText: '',
            aiText: '',
            aiAudioUrl: '',
          })
        }
        view[idx].requestId ||= message.client_request_id || ''
        if (role === 'assist_user') view[idx].userText = message.text || ''
        if (role === 'assist_ai') {
          view[idx].aiText = message.text || ''
          view[idx].aiAudioUrl = message.audio_url || ''
        }
        return
      }
      view.push({
        id: message.id || `${message.role}-${Math.random().toString(36).slice(2, 8)}`,
        requestId: message.client_request_id || '',
        role,
        text: message.text || '',
        audioUrl: message.audio_url || '',
        audioDuration: Number(message.audio_duration_seconds || 0),
        imageUrl: message.image_url || '',
        musicUrl: message.music_url || '',
        senderMode: message.sender_mode || '',
        avatarUrl: message.avatar_url || '',
        forwardedByName: message.forwarded_by_name || '',
        forwardedByAvatarUrl: message.forwarded_by_avatar_url || '',
      })
    })
    return view
  }

  const resetAccountScopedData = () => {
    accountOperationScope.invalidate()
    realtimeOperationScope.invalidate()
    recordingOperationRef.current = null
    aiStreamOperationRef.current = null
    personSendOperationRef.current = null
    personSendIdentityRef.current = null
    deleteContactOperationRef.current = null
    contactEditSaveRef.current = null
    aiEditSaveRef.current = null
    realtimeFriendRefreshesRef.current.clear()
    avatarPreviewOwnerRef.current.invalidate()
    recordedObjectUrlsRef.current.releaseAll()
    stopActiveRecordingResources({
      mediaRecorderRef,
      mediaStreamRef,
      recordChunksRef,
      clearTimers: clearRecordingTimers,
    })
    realtimeCall.hangUp()
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
    setUnreadByContact({})
    setContactGroups([])
    setDefaultContactGroupId('')
    setChatInput('')
    chatDraftVersionRef.current = 0
    setIsHistoryLoading(false)
    setIsAwaitingReply(false)
    setIsRecording(false)
    setRecordElapsedMs(0)
    setSettingsSaving(false)
    setAddFriendSubmitting(false)
    setIsUploadingAvatar(false)
    setIsPreparingAvatar(false)
    setEditContactSaving(false)
    setEditModalOpen(false)
    setSettingsModalOpen(false)
    setAddFriendModalOpen(false)
    setEditForm(null)
    setAvatarUploadError('')
    setSettingsError('')
    setIdentifyCodeInput('')
    setAddFriendError('')
    setAddFriendSuccess('')
    setPendingAvatarBlob(null)
    setImageViewerUrl('')
    setActiveCall(null)
    resetAccountScopedRefs({ restoredSelectedContactIdRef })
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
    const nextOpenaiVoice = openaiVoiceFromUser(user)
    const nextGlobalPrompt = fetchedAiSettings.global_prompt || AI_DEFAULT_GLOBAL_PROMPT
    const nextAvatar = user?.ai_avatar_url || '/images/fish.png'
    setContacts([
      {
        id: 'pisces-core',
        name: 'Convia',
        avatar: nextAvatar,
        snippet: '',
        isAi: true,
        gender: nextGender,
        voice: nextVoice,
        openaiVoice: nextOpenaiVoice,
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
        name: friend.name || friend.display_name || (isZh ? '聯絡人' : 'Friend'),
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
      const unreadMap = unreadStateFromFriendsResponse(friendContacts, data)
      authRequestGuard.runIfCurrent(authContext, () => setUnreadByContact(unreadMap))
      return friendContacts
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
    if (!isSignedIn || !contactId) return
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

  const loginTesterAccount = async ({ email: rawEmail, avatarUrl: rawAvatarUrl = '', modal = true }) => {
    const email = rawEmail.trim().toLowerCase()
    const avatarUrl = rawAvatarUrl.trim()
    if (!email) {
      if (modal) setTesterError(t('Email is required.', '請輸入 Email。'))
      else setGoogleError(t('Email is required.', '請輸入 Email。'))
      return false
    }
    const authTransition = authTransitionCoordinator.begin()
    try {
      if (modal) {
        setTesterSubmitting(true)
        setTesterError('')
      } else {
        setIsLoggingIn(true)
        setGoogleError('')
      }
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
      if (!authContext) return false
      initializeContactData(data.user || null, { authContext })
      setTesterModalOpen(false)
      setTesterEmail('')
      setTesterAvatarUrl('')
      return true
    } catch (err) {
      if (err?.name === 'AbortError') return false
      const message = visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Tester login failed.', '測試帳號登入失敗。')
      if (modal) setTesterError(message)
      else setGoogleError(message)
      return false
    } finally {
      if (!authTransition.signal.aborted) {
        if (modal) setTesterSubmitting(false)
        else setIsLoggingIn(false)
      }
    }
  }

  const submitTesterLogin = async (e) => {
    e.preventDefault()
    await loginTesterAccount({ email: testerEmail, avatarUrl: testerAvatarUrl, modal: true })
  }

  const openDemoAccount = (key) => {
    setDemoLoginError('')
    if (openDemoWindow(key)) return
    setDemoLoginError(t(
      'Please allow pop-ups to open the demo account.',
      '請允許彈出式視窗以開啟測試帳號。',
    ))
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
      onError: (err) => setSettingsError(visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Failed to save settings.', '儲存設定失敗。')),
      onSettled: () => setSettingsSaving(false),
    })
  }

  const openAddFriendModal = () => {
    if (!isSignedIn || !currentUser?.id) return
    setAddFriendError('')
    setAddFriendSuccess('')
    setFriendEmailInput('')
    setFriendAliasInput('')
    setFriendGroupInput('')
    setFriendCodeInput('')
    setAddFriendModalOpen(true)
  }

  const submitAddFriendValidation = async (e) => {
    e.preventDefault()
    if (!isSignedIn || !currentUser?.id) return

    const email = friendEmailInput.trim().toLowerCase()
    const alias = friendAliasInput.trim()
    const groupId = friendGroupInput.trim()
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
    if (!groupId) {
      setAddFriendError(t('Please select a group.', '請選擇群組。'))
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
          group_id: groupId,
          identify_code: code,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        throw new Error(data.error || t(`Add contact failed (HTTP ${res.status})`, `新增聯絡人失敗（HTTP ${res.status}）`))
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
      setFriendGroupInput('')
      setFriendCodeInput('')
      setAddFriendModalOpen(false)
      selectedContactIdRef.current = ''
      setSelectedContact(null)
    } catch (err) {
      setAddFriendError(visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Add contact failed.', '新增聯絡人失敗。'))
    } finally {
      setAddFriendSubmitting(false)
    }
  }

  const onEditContact = (contact) => {
    avatarPreviewOwnerRef.current.invalidate()
    setEditContactSaving(false)
    setEditContactRemoving(false)
    setIsPreparingAvatar(false)
    setAvatarUploadError('')
    setPendingAvatarBlob(null)
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
      openaiVoice: contact.openaiVoice || currentUser?.ai_settings?.openai_voice || 'marin',
      globalPrompt: contact.globalPrompt || AI_DEFAULT_GLOBAL_PROMPT,
    })
    setEditModalOpen(true)
  }

  const onDeleteContact = async (contact) => {
    if (!contact?.id || contact.isAi || !currentUser?.id) return false
    const deletingContactId = contact.id
    const send = startExclusiveSend({
      scope: accountOperationScope,
      ownerRef: deleteContactOperationRef,
      request: (operation) => requestFriendDeletion({
        apiBaseUrl,
        contactId: deletingContactId,
        signal: operation.signal,
      }),
      onSuccess: (_result, operation) => {
        recordedObjectUrlsRef.current.releaseContact(deletingContactId)
        setContacts((previous) => previous.filter((candidate) => candidate.id !== deletingContactId))
        setUnreadByContact((previous) => {
          const next = { ...previous }
          delete next[deletingContactId]
          return next
        })
        setMessagesByContact((previous) => {
          const next = { ...previous }
          delete next[deletingContactId]
          return next
        })
        if (selectedContactIdRef.current === deletingContactId) {
          selectedContactIdRef.current = ''
          setSelectedContact(null)
        }
        void loadFriendsList(currentUser, operation.authContext).catch(() => {
          // The confirmed local deletion remains valid if the follow-up refresh fails.
        })
      },
    })
    return send.started ? send.completion : false
  }

  const onRemoveEditingContact = async () => {
    if (!editForm || editForm.isAi || editContactRemoving) return
    setEditContactRemoving(true)
    try {
      const removed = await onDeleteContact(editForm)
      if (removed !== false) {
        setEditModalOpen(false)
        setEditForm(null)
      }
    } finally {
      setEditContactRemoving(false)
    }
  }

  const loadContactHistory = async (contactId, { limit = null, merge = false, silent = false } = {}) => {
    if (!isSignedIn || !currentUser?.id || !contactId) return
    const authContext = authRequestGuard.snapshot()
    if (!authRequestGuard.isCurrent(authContext) || authContext.userId !== String(currentUser.id)) return
    authRequestGuard.runIfCurrent(authContext, () => setIsHistoryLoading(true))
    await consumeGuardedRequest({
      guard: authRequestGuard,
      context: authContext,
      request: async () => {
        const body = { contact_id: contactId }
        if (Number.isInteger(limit)) body.limit = limit
        const res = await fetch(`${apiBaseUrl}/api/chat/history`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) {
          throw new Error(data.error || t(`History load failed (HTTP ${res.status})`, `載入歷史訊息失敗（HTTP ${res.status}）`))
        }
        return buildViewMessages(data.messages || [])
      },
      onSuccess: (nextMessages) => {
        if (!merge) recordedObjectUrlsRef.current.reconcileContact(contactId, nextMessages)
        setMessagesByContact((prev) => {
          const current = prev[contactId] || []
          return {
            ...prev,
            [contactId]: merge ? mergeCanonicalHistoryTail(current, nextMessages) : nextMessages,
          }
        })
      },
      onError: (err) => {
        if (silent) return
        setMessagesByContact((prev) => {
          const current = prev[contactId] || []
          return {
            ...prev,
            [contactId]: [
              ...current,
              {
                id: `history-err-${Date.now()}`,
                role: 'ai',
                text: visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Failed to load history.', '載入歷史訊息失敗。'),
              },
            ],
          }
        })
      },
      onSettled: () => setIsHistoryLoading(false),
    })
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

      const saveOperation = accountOperationScope.beginExclusive(aiEditSaveRef)
      if (!saveOperation) return
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
          body: JSON.stringify(buildAiSettingsPayload({
            form: editForm,
            avatarUrl: nextAvatarUrl,
            avatarImageBase64,
            avatarMimeType,
          })),
          signal: saveOperation.signal,
        })
        const saveData = await saveRes.json()
        if (!saveRes.ok || !saveData.ok) {
          throw new Error(saveData.error || `Save failed (HTTP ${saveRes.status})`)
        }
        if (!accountOperationScope.isOwner(saveOperation, aiEditSaveRef)) return
        nextAvatarUrl = saveData?.user?.ai_avatar_url || nextAvatarUrl
      } catch (err) {
        if (accountOperationScope.isOwner(saveOperation, aiEditSaveRef) && err?.name !== 'AbortError') {
          setAvatarUploadError(visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Save failed.', '儲存失敗。'))
        }
        return
      } finally {
        if (accountOperationScope.isOwner(saveOperation, aiEditSaveRef)) setIsUploadingAvatar(false)
        accountOperationScope.releaseOwner(saveOperation, aiEditSaveRef)
      }
    } else {
      if (!currentUser?.id) {
        setAvatarUploadError(t('Please sign in again before saving contact settings.', '請重新登入後再儲存聯絡人設定。'))
        return
      }

      const saveOperation = accountOperationScope.beginExclusive(contactEditSaveRef)
      if (!saveOperation) return
      setEditContactSaving(true)
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
          signal: saveOperation.signal,
        })
        const saveData = await saveRes.json()
        if (!saveRes.ok || !saveData.ok) {
          throw new Error(saveData.error || `Save failed (HTTP ${saveRes.status})`)
        }
        if (!accountOperationScope.isOwner(saveOperation, contactEditSaveRef)) return
      } catch (err) {
        if (accountOperationScope.isOwner(saveOperation, contactEditSaveRef) && err?.name !== 'AbortError') {
          setAvatarUploadError(visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Save failed.', '儲存失敗。'))
        }
        return
      } finally {
        if (accountOperationScope.isOwner(saveOperation, contactEditSaveRef)) setEditContactSaving(false)
        accountOperationScope.releaseOwner(saveOperation, contactEditSaveRef)
      }
    }

    if (!authRequestGuard.isCurrent(authContext)) return
    setContacts((prev) => editForm.isAi
      ? applyAiContactSettings(prev, editForm.id, { ...editForm, alias: nextAlias }, nextAvatarUrl)
      : prev.map((contact) => {
        if (contact.id !== editForm.id) return contact
        const nextContact = {
          ...contact,
          name: nextAlias,
          avatar: nextAvatarUrl,
          specialPrompt: (editForm.specialPrompt || '').trim(),
          relationship: (editForm.relationship || '').trim(),
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
              openaiVoice: editForm.openaiVoice,
              globalPrompt: editForm.globalPrompt,
            }
          : prev,
      )
    }

    if (editForm.isAi) {
      setCurrentUser((prev) => mergeAiSettingsUser(prev, editForm, nextAvatarUrl))
    }
    avatarPreviewOwnerRef.current.invalidate()
    setPendingAvatarBlob(null)
    setEditModalOpen(false)
    setEditForm(null)
  }

  const onPickAvatarFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editForm?.isAi) return

    const generation = avatarPreviewOwnerRef.current.begin()
    try {
      setIsPreparingAvatar(true)
      setAvatarUploadError('')
      const avatarBlob = await buildAvatarWebpBlob(file)
      if (!avatarPreviewOwnerRef.current.isCurrent(generation)) return
      const previewUrl = URL.createObjectURL(avatarBlob)
      if (!avatarPreviewOwnerRef.current.publish(generation, previewUrl)) return
      setPendingAvatarBlob(avatarBlob)
      setEditForm((prev) => (prev ? { ...prev, avatar: previewUrl } : prev))
    } catch (err) {
      if (avatarPreviewOwnerRef.current.isCurrent(generation)) {
        setAvatarUploadError(avatarProcessingErrorMessage(err, isZh ? 'zh-TW' : 'en'))
      }
    } finally {
      if (avatarPreviewOwnerRef.current.isCurrent(generation)) setIsPreparingAvatar(false)
    }
  }

  useEffect(() => {
    const restore = async () => {
      const demoAccountKey = demoAccountFromUrl(window.location.href)
      if (demoAccountKey) {
        if (demoBootstrapStartedRef.current) return
        demoBootstrapStartedRef.current = true
        const authenticated = await loginTesterAccount({
          email: DEMO_ACCOUNT_EMAILS[demoAccountKey],
          modal: false,
        })
        if (authenticated) {
          window.history.replaceState({}, '', stripDemoLoginQuery(window.location.href))
        }
        return
      }
      const authTransition = authTransitionCoordinator.begin()
      let activeRestoreContext = authTransition.context
      try {
        const res = await fetch(`${apiBaseUrl}/api/session/me`, {
          method: 'GET',
          credentials: 'include',
          signal: authTransition.signal,
        })
        const data = await res.json()
        setTesterLoginEnabled(data?.tester_login_enabled === true)
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
        initializeGoogleIdentityClient(google.accounts.id, {
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
              setGoogleError(visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Google login failed.', 'Google 登入失敗。'))
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
        setGoogleError(t('Google Sign-In failed to load.', 'Google 登入無法載入。'))
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
    if (!isSignedIn || !currentUser?.id || selectedContact) return
    const target = contacts.find((contact) => contact.id === 'pisces-core' || contact.isAi)
    if (!target) return
    selectedContactIdRef.current = target.id
    setSelectedContact(target)
    markContactAsRead(target.id)
    loadContactHistory(target.id)
  }, [isSignedIn, currentUser?.id, selectedContact, contacts])

  useEffect(() => {
    if (!isSignedIn || !currentUser?.id) return
    const accountId = String(currentUser.id)
    const controller = createRecipientReconciler({
      windowTarget: window,
      documentTarget: document,
      isVisible: () => document.visibilityState === 'visible',
      run: async () => {
        const authContext = authRequestGuard.snapshot()
        const contactId = selectedContactIdRef.current
        const contact = contactsRef.current.find((candidate) => candidate.id === contactId)
        const snapshot = {
          accountId,
          contactId,
          human: Boolean(contactId && contactId !== 'pisces-core' && contact && !contact.isAi),
          authContext,
        }
        await reconcileRecipientSnapshot({
          snapshot,
          isCurrent: (candidate) => (
            authRequestGuard.isCurrent(candidate.authContext)
            && candidate.accountId === String(currentUser.id)
            && candidate.contactId === selectedContactIdRef.current
          ),
          refreshSidebar: () => initializeContactData(currentUser, { bootstrap: false, authContext }),
          // Polling merges a bounded tail using canonical server message ids.
          refreshHistory: (selectedId) => loadContactHistory(selectedId, { limit: 100, merge: true, silent: true }),
        })
      },
    })
    recipientReconcilerRef.current = controller
    controller.start()
    return () => {
      controller.stop()
      if (recipientReconcilerRef.current === controller) recipientReconcilerRef.current = null
    }
  }, [isSignedIn, currentUser?.id, currentUser?.provider, apiBaseUrl])

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

        const reconnectGate = createReconnectGate()
        realtime.connection.on('connected', () => {
          if (!reconnectGate.shouldReconcile()) return
          const authContext = authRequestGuard.snapshot()
          if (!isCancelled && authContext.userId === currentUser.id) {
            if (recipientReconcilerRef.current) {
              void recipientReconcilerRef.current.trigger()
            } else {
              initializeContactData(currentUser, { bootstrap: false, authContext })
            }
          }
        })

        const subscriptionContext = authRequestGuard.snapshot()
        const channel = realtime.channels.get(`user_${currentUser.id}`)
        channel.subscribe('message.new', async (message) => {
          if (isCancelled || !authRequestGuard.isCurrent(subscriptionContext) || subscriptionContext.userId !== currentUser.id) return
          const payload = message?.data || {}
          const senderId = payload.sender_user_id || ''
          const conversationId = payload.contact_id === 'pisces-core' ? 'pisces-core' : senderId
          const incomingMessage = canonicalIncomingMessage(payload)
          const text = payload.text || ''
          const audioUrl = payload.audio_url || ''
          const imageUrl = payload.image_url || ''
          const musicUrl = payload.music_url || ''
          if (!conversationId || (!text && !audioUrl && !imageUrl && !musicUrl)) return
          if (!incomingMessage) return

          let authorization = null
          if (conversationId === 'pisces-core') {
            authorization = {
              contact: contactsRef.current.find((contact) => contact.id === 'pisces-core') || { id: 'pisces-core', name: 'Convia', isAi: true },
              refreshed: false,
            }
          } else {
            try {
              authorization = await authorizeIncomingFriend({
                senderId,
                contacts: contactsRef.current,
                refreshFriends: () => loadFriendsList(currentUser, subscriptionContext),
                inFlightRefreshes: realtimeFriendRefreshesRef.current,
              })
            } catch {
              return
            }
          }
          if (!authorization?.contact || isCancelled || !authRequestGuard.isCurrent(subscriptionContext)) return

          setContacts((previous) => previous.map((contact) => contact.id === conversationId ? {
            ...contact,
            last_message_at: payload.created_at || new Date().toISOString(),
            last_message_preview: text,
          } : contact))

          setMessagesByContact((prev) => {
            const current = prev[conversationId] || []
            return {
              ...prev,
              [conversationId]: reconcileCanonicalMessage(current, '', incomingMessage),
            }
          })

          const windowFocused = typeof document.hasFocus === 'function'
            ? document.hasFocus()
            : document.visibilityState === 'visible'
          if (shouldAutoMarkIncomingRead({ selectedContactId: selectedContactIdRef.current, conversationId, windowFocused })) {
            markContactAsRead(conversationId)
          } else if (!authorization.refreshed) {
            setUnreadByContact((prev) => ({ ...prev, [conversationId]: (prev[conversationId] || 0) + 1 }))
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
  }, [isSignedIn, currentUser?.id, currentUser?.provider, apiBaseUrl])

  useEffect(() => () => {
    avatarPreviewOwnerRef.current.invalidate()
    recordedObjectUrlsRef.current.releaseAll()
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

  const openAiCall = () => {
    if (!selectedContact?.isAi) return
    setActiveCall({
      mode: 'ai',
      contactId: selectedContact.id || 'pisces-core',
      name: selectedContact.name || 'Convia',
      avatar: aiAvatarForCall,
    })
  }

  const closePhoneOverlay = () => {
    realtimeCall.hangUp()
    setActiveCall(null)
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
          recordedObjectUrlsRef.current.own(audioUrl, { contactId, messageId: audioMessageId })
          const shouldUseAiVoiceFlow = contactId === 'pisces-core'
          const personVoiceRequestId = shouldUseAiVoiceFlow ? '' : createClientRequestId('person-voice')
          const typingId = `vt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
          runIfRecordingCurrent(() => {
            setMessagesByContact((prev) => {
              const current = prev[contactId] || []
              return {
                ...prev,
                [contactId]: [
                  ...current,
                  { id: audioMessageId, role: 'user', requestId: personVoiceRequestId, audioUrl, audioDuration: recordedDurationSeconds },
                  ...(shouldUseAiVoiceFlow ? [{ id: typingId, role: 'ai-typing', text: '...' }] : []),
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
              const data = await sendPersonVoiceRequest({
                url: `${apiBaseUrl}/api/messages/send-voice`,
                contactId,
                audioBase64,
                mimeType: blob.type || recorder.mimeType || 'audio/webm',
                durationSeconds: recordedDurationSeconds,
                requestId: personVoiceRequestId,
                signal: recordingOperation.signal,
              })
              if (!accountOperationScope.isOwner(recordingOperation, recordingOperationRef)) return
              const confirmedAudioUrl = data?.message?.audio_url || audioUrl
              recordedObjectUrlsRef.current.replace(audioUrl, confirmedAudioUrl)
              runIfRecordingCurrent(() => setMessagesByContact((prev) => {
                const current = prev[contactId] || []
                const existingVoiceMessage = current.find((message) => (
                  message.id === audioMessageId
                  || (personVoiceRequestId && message.requestId === personVoiceRequestId)
                ))
                const canonicalVoiceMessage = {
                  ...existingVoiceMessage,
                  id: data?.message?.message_id || audioMessageId,
                  role: 'user',
                  requestId: data?.message?.client_request_id || personVoiceRequestId,
                  audioUrl: confirmedAudioUrl,
                  audioDuration: Number(data?.message?.audio_duration_seconds || existingVoiceMessage?.audioDuration || 0),
                }
                return {
                  ...prev,
                  [contactId]: reconcileCanonicalMessage(current, audioMessageId, canonicalVoiceMessage),
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
              requireSuccessfulVoiceResponse(res, data)
              recordedObjectUrlsRef.current.release(audioUrl)
              const aiText = data.reply || t('AI returned an empty reply.', 'AI 沒有回傳內容。')
              const aiAudioUrl = ''
              const aiImageUrl = data.image_url || ''
              const aiMusicUrl = data.music_url || ''

              runIfRecordingCurrent(() => setMessagesByContact((prev) => {
                const current = (prev[contactId] || []).map((message) => message.id === audioMessageId
                  ? { ...message, text: data.transcript || '', audioUrl: '' }
                  : message)
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
            const errText = visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Voice chat request failed.', '語音訊息處理失敗。')
            recordedObjectUrlsRef.current.release(audioUrl)
            runIfRecordingCurrent(() => setMessagesByContact((prev) => {
              const current = discardRecordedMessage(prev[contactId] || [], audioMessageId)
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
      realtimeCall.hangUp()
    }
  }, [])

  const selectContactFromSidebar = (contact) => {
    if (!contact?.id) return
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
            error: visibleErrorMessage(error, isZh ? 'zh-TW' : 'en', 'Unable to reach API.', '無法連線到 API。'),
            retry: () => sendAiStream(input, { appendUser: false, requestId, temporaryId: streamMessageId }),
          })
        })
      }
    } finally {
      accountOperationScope.runIfCurrent(operation, () => setIsAwaitingReply(false))
      accountOperationScope.releaseOwner(operation, aiStreamOperationRef)
    }
  }

  const sendPersonText = (input) => {
    const contactId = selectedContact?.id
    if (!contactId || selectedContact?.isAi || !input) return false

    const identity = stablePersonSendIdentity(
      personSendIdentityRef.current,
      { contactId, text: input },
    )
    personSendIdentityRef.current = identity
    const pendingMessageId = `pending-${identity.requestId}`
    const send = startExclusiveSend({
      scope: accountOperationScope,
      ownerRef: personSendOperationRef,
      request: (operation) => sendPersonRequest({
        url: `${apiBaseUrl}/api/messages/send`,
        contactId,
        text: input,
        requestId: identity.requestId,
        signal: operation.signal,
      }),
      onSuccess: ({ message, conviaMessage, conviaError }) => {
        if (personSendIdentityRef.current?.requestId === identity.requestId) personSendIdentityRef.current = null
        setMessagesByContact((previous) => {
          const current = previous[contactId] || []
          const withMessage = reconcileCanonicalMessage(current, pendingMessageId, message)
          return {
            ...previous,
            [contactId]: conviaMessage
              ? reconcileCanonicalMessage(withMessage, '', conviaMessage)
              : withMessage,
          }
        })
        if (conviaError) {
          const text = conviaError === 'convia_in_progress'
            ? t('Convia is still replying.', 'Convia 還在回覆中。')
            : t('Convia could not reply right now.', 'Convia 暫時無法回覆。')
          setMessagesByContact((previous) => ({
            ...previous,
            [contactId]: [
              ...(previous[contactId] || []),
              { id: `convia-error-${Date.now()}`, role: 'system', text, status: 'incomplete' },
            ],
          }))
        }
        setChatInput((current) => current.trim() === input ? '' : current)
      },
      onError: (error) => {
        setMessagesByContact((previous) => ({
          ...previous,
          [contactId]: [
            ...(previous[contactId] || []),
            {
              id: `error-${Date.now()}`,
              role: 'system',
              text: visibleErrorMessage(error, isZh ? 'zh-TW' : 'en', 'Unable to send message.', '無法傳送訊息。'),
              status: 'incomplete',
            },
          ],
        }))
      },
      onSettled: () => setIsAwaitingReply(false),
    })
    if (!send.started) return false
    setMessagesByContact((previous) => ({
      ...previous,
      [contactId]: [
        ...(previous[contactId] || []),
        { id: pendingMessageId, role: 'user', requestId: identity.requestId, text: input, status: 'sending' },
      ],
    }))
    setChatInput((current) => current.trim() === input ? '' : current)
    setIsAwaitingReply(true)
    return true
  }

  const sendComposerText = (input) => {
    if (!selectedContact || isRecording || isAwaitingReply) return
    if (selectedContact.isAi) return sendAiStream(input)
    return sendPersonText(input)
  }

  const conversationMessages = selectedContact
    ? (messagesByContact[selectedContact.id] || []).filter((message) => message.role !== 'assist_group')
    : []

  const conversationPanel = selectedContact ? (
    <Conversation
      contact={selectedContact}
      messages={conversationMessages}
      locale={isZh ? 'zh-TW' : 'en'}
      loading={isHistoryLoading}
      onCall={openAiCall}
      onEdit={onEditContact}
      onImageClick={setImageViewerUrl}
      renderAudio={({ url, kind, message }) => (
        <AudioMessagePlayer
          audioUrl={url}
          variant={message.role === 'user' ? 'user' : 'ai'}
          durationHint={kind === 'voice' ? Number(message.audioDuration || 0) : 0}
          kind={kind}
          locale={isZh ? 'zh-TW' : 'en'}
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
      onEditContact={onEditContact}
      onDeleteContact={onDeleteContact}
      onOpenSettings={openSettingsModal}
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

  const closeSettings = () => {
    if (settingsSaving) return
    setSettingsModalOpen(false)
    setSettingsError('')
  }
  const closeAddFriend = () => {
    if (addFriendSubmitting) return
    setAddFriendModalOpen(false)
    setAddFriendError('')
    setAddFriendSuccess('')
    setFriendGroupInput('')
  }
  const closeTesterLogin = () => {
    if (testerSubmitting) return
    setTesterModalOpen(false)
    setTesterError('')
  }
  const closeContactEditor = () => {
    if (editContactSaving) return
    if (editContactRemoving) return
    avatarPreviewOwnerRef.current.invalidate()
    setIsPreparingAvatar(false)
    setEditModalOpen(false)
    setEditForm(null)
    setPendingAvatarBlob(null)
    setAvatarUploadError('')
  }

  if (!isSignedIn) {
    return (
      <>
        <LoginScreen
          locale={isZh ? 'zh-TW' : 'en'}
          googleButtonRef={googleButtonRef}
          isLoggingIn={isLoggingIn}
          error={googleError}
          testerLoginEnabled={testerLoginEnabled}
          demoLoginError={demoLoginError}
          onOpenTesterLogin={() => {
            setTesterError('')
            setTesterModalOpen(true)
          }}
          onOpenDemoAccount={openDemoAccount}
        />
        <TesterLoginDialog
          open={testerModalOpen}
          locale={isZh ? 'zh-TW' : 'en'}
          email={testerEmail}
          avatarUrl={testerAvatarUrl}
          error={testerError}
          submitting={testerSubmitting}
          onEmailChange={setTesterEmail}
          onAvatarUrlChange={setTesterAvatarUrl}
          onSubmit={submitTesterLogin}
          onClose={closeTesterLogin}
        />
      </>
    )
  }

  return (
    <main className="authenticated-app">
      <ChatShell sidebar={contactSidebar} locale={isZh ? 'zh-TW' : 'en'}>
        <div className={`authenticated-app__conversation${selectedContact ? ' authenticated-app__conversation--selected' : ''}`}>
          {selectedContact ? conversationPanel : <ConversationEmptyState locale={isZh ? 'zh-TW' : 'en'} />}
        </div>
      </ChatShell>
      <SettingsDialog
        open={settingsModalOpen}
        locale={isZh ? 'zh-TW' : 'en'}
        identifyCode={identifyCodeInput}
        historyRange={historyRangeInput}
        error={settingsError}
        saving={settingsSaving}
        groups={contactGroups}
        onIdentifyCodeChange={setIdentifyCodeInput}
        onHistoryRangeChange={setHistoryRangeInput}
        onSubmit={saveUserSettings}
        onClose={closeSettings}
        onLogout={clearSessionAndLogout}
        onCreateGroup={(name) => mutateGroups('create', { name })}
        onRenameGroup={(groupId, name) => mutateGroups('update', { group_id: groupId, name })}
        onReorderGroups={(orderedGroupIds) => mutateGroups('reorder', { ordered_group_ids: orderedGroupIds })}
        onDeleteGroup={deleteGroup}
        onRefreshGroups={(groups) => {
          setContactGroups(groups)
          setDefaultContactGroupId((current) => (groups.some((group) => group.id === current) ? current : ''))
        }}
      />
      <AddFriendDialog
        open={addFriendModalOpen}
        locale={isZh ? 'zh-TW' : 'en'}
        email={friendEmailInput}
        alias={friendAliasInput}
        groupId={friendGroupInput}
        groups={contactGroups}
        verificationCode={friendCodeInput}
        error={addFriendError}
        success={addFriendSuccess}
        submitting={addFriendSubmitting}
        onEmailChange={setFriendEmailInput}
        onAliasChange={setFriendAliasInput}
        onGroupChange={setFriendGroupInput}
        onVerificationCodeChange={setFriendCodeInput}
        onSubmit={submitAddFriendValidation}
        onClose={closeAddFriend}
      />
      <AiSettingsDialog
        open={editModalOpen && Boolean(editForm?.isAi)}
        locale={isZh ? 'zh-TW' : 'en'}
        form={editForm}
        error={avatarUploadError}
        saving={false}
        uploading={isUploadingAvatar}
        preparingAvatar={isPreparingAvatar}
        avatarInputRef={avatarFileInputRef}
        onFormChange={setEditForm}
        onAvatarPick={onPickAvatarFile}
        onSave={onSaveContactEdit}
        onClose={closeContactEditor}
        apiBaseUrl={apiBaseUrl}
        ownerKey={currentUser?.id || ''}
      />
      <EditContactDialog
        open={editModalOpen && Boolean(editForm && !editForm.isAi)}
        locale={isZh ? 'zh-TW' : 'en'}
        form={editForm}
        error={avatarUploadError}
        busy={editContactSaving}
        removing={editContactRemoving}
        onFormChange={setEditForm}
        onSave={onSaveContactEdit}
        onRemove={onRemoveEditingContact}
        onClose={closeContactEditor}
      />
      <ImageViewerDialog open={Boolean(imageViewerUrl)} src={imageViewerUrl} locale={isZh ? 'zh-TW' : 'en'} onClose={() => setImageViewerUrl('')} />
      {activeCall ? (
        <AiCallOverlay
          locale={isZh ? 'zh-TW' : 'en'}
          name={activeCall.name}
          avatar={activeCall.avatar}
          status={realtimeCall.status}
          error={realtimeCall.error}
          muted={realtimeCall.muted}
          speakerEnabled={realtimeCall.speakerEnabled}
          onToggleMute={realtimeCall.toggleMute}
          onToggleSpeaker={realtimeCall.toggleSpeaker}
          onRetry={realtimeCall.retry}
          onHangUp={closePhoneOverlay}
        />
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
      const errorMessage = visibleErrorMessage(err, isZh ? 'zh-TW' : 'en', 'Unable to reach API.', '無法連線到 API。')
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
    <main className="utility-page">
      <section className="utility-card">
        <button type="button" onClick={() => navigateTo('/')}>{t('Back to Convia', '返回 Convia')}</button>
        <h1>{t('Convia test lab', 'Convia 測試頁')}</h1>
        <p className="form-help">{t('Backend endpoint:', '後端端點：')} {apiBaseUrl}</p>
        <form className="form-stack" onSubmit={onSubmit}>
          <label><span>{t('Message', '訊息')}</span><textarea rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t('Type a message for Convia…', '輸入要給 Convia 的訊息…')} /></label>
          <button type="submit" className="primary-button" disabled={isLoading}>{isLoading ? t('Sending…', '送出中…') : t('Send to AI', '送給 AI')}</button>
        </form>
        <section>
          <h2>{t('AI reply', 'AI 回覆')}</h2>
          <div className="utility-output">{reply || t('No reply yet.', '尚無回覆。')}</div>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </section>
        <details>
          <summary>{t('Debug log', '偵錯日誌')}</summary>
          <pre className="utility-output">{debugLog || t('No logs yet.', '尚無日誌。')}</pre>
        </details>
      </section>
    </main>
  )
}

function NotFound() {
  const isZh = detectIsZhLocale()
  const t = (enText, zhText) => tr(isZh, enText, zhText)
  return (
    <main className="utility-page">
      <section className="utility-card utility-card--compact">
        <div className="login-wordmark" aria-hidden="true">C</div>
        <h1>{t('Page not found', '找不到頁面')}</h1>
        <p>{t('This route does not exist.', '此路由不存在。')}</p>
        <button type="button" className="primary-button" onClick={() => navigateTo('/')}>{t('Go to Convia', '前往 Convia')}</button>
      </section>
    </main>
  )
}

export default function App() {
  const pathname = usePathname()
  if (pathname === '/') return <LoginHome />
  if (pathname === '/lab/chat-test') return <ChatTestLab />
  return <NotFound />
}
