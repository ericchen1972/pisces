export function createClientRequestId(prefix = 'request') {
  const suffix = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${suffix}`
}

const TRUSTED_MEDIA_HOST_SUFFIX = '.blob.vercel-storage.com'
const MAX_MEDIA_URL_LENGTH = 2048

export function validateTrustedMediaUrl(value) {
  const raw = String(value || '').trim()
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error('Attachment must be a trusted Vercel Blob HTTPS URL')
  }
  const trusted = raw.length <= MAX_MEDIA_URL_LENGTH
    && parsed.protocol === 'https:'
    && !parsed.username
    && !parsed.password
    && !parsed.port
    && parsed.hostname.toLowerCase().endsWith(TRUSTED_MEDIA_HOST_SUFFIX)
    && parsed.pathname !== '/'
  if (!trusted) throw new Error('Attachment must be a trusted Vercel Blob HTTPS URL')
  return raw
}

export function effectiveMessageRole(message, fallbackRole = 'ai') {
  const senderMode = message?.sender_mode || message?.senderMode || ''
  if (senderMode === 'ai_proxy') return 'ai_proxy'
  const role = message?.role || ''
  return ['user', 'peer', 'ai', 'ai_proxy', 'ai-typing', 'assist_user', 'assist_ai', 'system'].includes(role)
    ? role
    : fallbackRole
}

export function canonicalIncomingMessage(payload) {
  if (!payload?.message_id) return null
  return {
    id: payload.message_id,
    role: effectiveMessageRole({ role: 'peer', sender_mode: payload.sender_mode }, 'peer'),
    senderMode: payload.sender_mode || 'user',
    text: payload.text || '',
    audioUrl: payload.audio_url || '',
    audioDuration: Number(payload.audio_duration_seconds || 0),
    imageUrl: payload.image_url || '',
    musicUrl: payload.music_url || '',
    avatarUrl: payload.sender_avatar_url || '',
  }
}

export function canonicalOutboundMessage(payload) {
  if (!payload?.message_id) return null
  const senderMode = payload.sender_mode === 'ai_proxy' ? 'ai_proxy' : 'user'
  return {
    id: payload.message_id,
    role: effectiveMessageRole({ role: 'user', sender_mode: senderMode }, 'user'),
    senderMode,
    text: payload.text || '',
    audioUrl: payload.audio_url || '',
    imageUrl: payload.image_url || '',
    musicUrl: payload.music_url || '',
    avatarUrl: payload.avatar_url || payload.sender_avatar_url || '',
  }
}

async function jsonRequest(fetchImpl, url, options) {
  const response = await fetchImpl(url, options)
  const data = await response.json()
  if (!response.ok || !data?.ok) throw new Error(data?.error || `Request failed (${response.status})`)
  return data
}

export async function sendAssistRequest({ fetchImpl = fetch, url, contactId, message, requestId, signal }) {
  const data = await jsonRequest(fetchImpl, url, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_id: contactId, message, request_id: requestId }),
  })
  return {
    assistGroup: data.assist_group || {},
    outboundMessage: canonicalOutboundMessage(data.outbound_message),
  }
}

export function stablePersonSendIdentity(previous, payload, createId = () => createClientRequestId('person')) {
  const attachment = payload.attachment
  const fingerprint = JSON.stringify({
    contactId: payload.contactId,
    text: payload.text,
    attachment: attachment ? { kind: attachment.kind, url: attachment.url } : null,
  })
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, requestId: createId() }
}

export async function sendPersonRequest({ fetchImpl = fetch, url, contactId, text, attachment, requestId, signal }) {
  const attachmentUrl = attachment ? validateTrustedMediaUrl(attachment.url) : ''
  const attachmentFields = attachment?.kind === 'image'
    ? { image_url: attachmentUrl }
    : attachment?.kind === 'music'
      ? { music_url: attachmentUrl }
      : {}
  const data = await jsonRequest(fetchImpl, url, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient_user_id: contactId, text, ...attachmentFields, request_id: requestId }),
  })
  const message = canonicalOutboundMessage(data.message)
  if (!message) throw new Error('Message response did not include a canonical identity')
  return message
}

export async function sendPersonVoiceRequest({ fetchImpl = fetch, url, contactId, audioBase64, mimeType, durationSeconds, requestId, signal }) {
  return jsonRequest(fetchImpl, url, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient_user_id: contactId,
      audio_base64: audioBase64,
      mime_type: mimeType,
      duration_seconds: durationSeconds,
      request_id: requestId,
    }),
  })
}

export function restoreAssistDraft(
  currentDraft,
  failedDraft,
  currentVersion = 0,
  submittedVersion = 0,
  currentContactId = '',
  submittedContactId = '',
) {
  if (currentVersion !== submittedVersion || currentContactId !== submittedContactId) return currentDraft
  return currentDraft || failedDraft
}

export function startExclusiveSend({ scope, ownerRef, request, onSuccess, onError, onSettled }) {
  const operation = scope.beginExclusive(ownerRef)
  if (!operation) return { started: false, completion: Promise.resolve(false) }
  if (!scope.isOwner(operation, ownerRef)) {
    scope.releaseOwner(operation, ownerRef)
    return { started: false, completion: Promise.resolve(false) }
  }
  const completion = (async () => {
    try {
      const result = await request(operation)
      scope.runIfCurrent(operation, () => onSuccess?.(result, operation))
      return true
    } catch (error) {
      if (error?.name !== 'AbortError') {
        scope.runIfCurrent(operation, () => onError?.(error, operation))
      }
      return false
    } finally {
      try {
        scope.runIfCurrent(operation, () => onSettled?.(operation))
      } finally {
        scope.releaseOwner(operation, ownerRef)
      }
    }
  })()
  return { started: true, operation, completion }
}
