import { useCallback, useEffect, useRef, useState } from 'react'

const OPENAI_REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
const MAX_REALTIME_EVENT_BYTES = 65_536
const MAX_REALTIME_TRANSCRIPT_CHARS = 4_000
const MAX_REALTIME_EVENT_ID_CHARS = 256
const MAX_REALTIME_RESPONSE_TOKEN_CHARS = 128
const ABOUT_FRIEND_LOOKUP_TIMEOUT_MS = 5_000
const RESPONSE_COMPLETION_TIMEOUT_MS = 120_000
const TRANSCRIPTION_COMPLETED = 'conversation.item.input_audio_transcription.completed'
const RESPONSE_DONE = 'response.done'
const TERMINAL_RESPONSE_STATUSES = new Set(['completed', 'cancelled', 'failed', 'incomplete'])
let responseTokenCounter = 0

function createResponseQueueToken() {
  try {
    const randomId = globalThis.crypto?.randomUUID?.()
    if (randomId) return `convia-${randomId}`
    if (globalThis.crypto?.getRandomValues) {
      const values = new Uint32Array(4)
      globalThis.crypto.getRandomValues(values)
      return `convia-${Array.from(values, (value) => value.toString(16).padStart(8, '0')).join('')}`
    }
  } catch {
    // A non-secure browser context can expose crypto without allowing random generation.
  }
  responseTokenCounter += 1
  return `convia-${Date.now().toString(36)}-${responseTokenCounter.toString(36)}`
}

function stopStreamTracks(stream, stoppedTracks = new Set()) {
  stream?.getTracks?.().forEach((track) => {
    if (stoppedTracks.has(track)) return
    stoppedTracks.add(track)
    track.stop()
  })
}

function closeResource(resource) {
  try {
    resource?.close?.()
  } catch {
    // A partially opened browser resource may already be closed.
  }
}

function errorFromFailure(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
    return { code: 'microphone_denied', message: 'Microphone access is required.' }
  }
  if (error?.name === 'NotFoundError') {
    return { code: 'microphone_unavailable', message: 'No microphone is available.' }
  }
  return { code: 'connection_failed', message: error?.message || 'Unable to start the call.' }
}

function createLocalOperationScope() {
  let generation = 0
  return {
    begin() {
      const controller = new AbortController()
      return { generation, controller, signal: controller.signal }
    },
    fork(parent) {
      const controller = new AbortController()
      return { generation: parent.generation, controller, signal: controller.signal }
    },
    isCurrent(operation) {
      return operation?.generation === generation
    },
    finish() {},
    invalidate() { generation += 1 },
  }
}

export function parseRealtimeEvent(value) {
  if (typeof value !== 'string') return null
  if (value.length > MAX_REALTIME_EVENT_BYTES) return null
  const byteLength = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(value).byteLength
    : value.length
  if (byteLength > MAX_REALTIME_EVENT_BYTES) return null
  let event
  try {
    event = JSON.parse(value)
  } catch {
    return null
  }
  if (!event || Array.isArray(event) || Object.getPrototypeOf(event) !== Object.prototype) return null
  if (typeof event.type !== 'string') return null
  if (event.type === 'error') return { type: 'error' }
  if (event.type === RESPONSE_DONE) {
    const response = event.response
    if (!response || Array.isArray(response) || Object.getPrototypeOf(response) !== Object.prototype) return null
    if (typeof response.id !== 'string') return null
    const responseId = response.id.trim()
    if (!responseId || responseId.length > MAX_REALTIME_EVENT_ID_CHARS) return null
    if (!TERMINAL_RESPONSE_STATUSES.has(response.status)) return null
    const metadata = response.metadata
    if (!metadata || Array.isArray(metadata) || Object.getPrototypeOf(metadata) !== Object.prototype) return null
    if (typeof metadata.convia_queue_token !== 'string') return null
    const queueToken = metadata.convia_queue_token.trim()
    if (!queueToken || queueToken.length > MAX_REALTIME_RESPONSE_TOKEN_CHARS) return null
    return { type: RESPONSE_DONE, responseId, status: response.status, queueToken }
  }
  if (event.type !== TRANSCRIPTION_COMPLETED) return null
  if (typeof event.item_id !== 'string') return null
  const id = event.item_id.trim()
  if (!id || id.length > MAX_REALTIME_EVENT_ID_CHARS) return null
  if (typeof event.transcript !== 'string') return null
  const transcript = event.transcript.trim()
  if (!transcript || transcript.length > MAX_REALTIME_TRANSCRIPT_CHARS) return null
  return { type: TRANSCRIPTION_COMPLETED, id, transcript }
}

export function useOpenAIRealtime({
  active = false,
  apiBaseUrl = '',
  mode = 'ai',
  contactId = 'pisces-core',
  operationScope,
} = {}) {
  const localScopeRef = useRef(null)
  if (!localScopeRef.current) localScopeRef.current = createLocalOperationScope()
  const scope = operationScope || localScopeRef.current
  const resourcesRef = useRef(null)
  const teardownRef = useRef(null)
  const mountedRef = useRef(true)
  const desiredMutedRef = useRef(false)
  const desiredSpeakerEnabledRef = useRef(true)
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState(active ? 'connecting' : 'closed')
  const [error, setError] = useState(null)
  const [muted, setMuted] = useState(false)
  const [speakerEnabled, setSpeakerEnabled] = useState(true)

  const hangUp = useCallback(() => {
    if (teardownRef.current) {
      teardownRef.current({ status: 'closed' })
    } else if (mountedRef.current) {
      setError(null)
      setStatus('closed')
    }
  }, [])

  const retry = useCallback(() => {
    teardownRef.current?.({ status: 'connecting' })
    if (mountedRef.current) {
      setError(null)
      setStatus('connecting')
      setAttempt((value) => value + 1)
    }
  }, [])

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current
      desiredMutedRef.current = next
      resourcesRef.current?.stream?.getAudioTracks?.().forEach((track) => { track.enabled = !next })
      return next
    })
  }, [])

  const toggleSpeaker = useCallback(() => {
    setSpeakerEnabled((current) => {
      const next = !current
      desiredSpeakerEnabledRef.current = next
      if (resourcesRef.current?.audio) resourcesRef.current.audio.muted = !next
      return next
    })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!active) {
      teardownRef.current?.({ status: 'closed' })
      desiredMutedRef.current = false
      desiredSpeakerEnabledRef.current = true
      setError(null)
      setStatus('closed')
      setMuted(false)
      setSpeakerEnabled(true)
      return undefined
    }

    const operation = scope.begin()
    const resources = {
      operation,
      peer: null,
      channel: null,
      stream: null,
      audio: null,
      remoteStreams: new Set(),
      contextOperations: new Set(),
      injected: new Set(),
      pending: new Set(),
      processedTranscriptions: new Set(),
      responseQueue: [],
      activeResponse: null,
      disposed: false,
    }
    resourcesRef.current = resources
    let tornDown = false

    const teardown = ({ status: nextStatus = 'closed', error: nextError = null, publish = true } = {}) => {
      if (tornDown) return
      tornDown = true
      resources.disposed = true
      if (teardownRef.current === teardown) teardownRef.current = null
      if (resourcesRef.current === resources) resourcesRef.current = null

      resources.operation?.controller?.abort?.()
      resources.contextOperations.forEach((contextOperation) => contextOperation?.controller?.abort?.())

      const channel = resources.channel
      const peer = resources.peer
      if (channel) {
        channel.onopen = null
        channel.onclose = null
        channel.onerror = null
        channel.onmessage = null
      }
      if (peer) {
        peer.ontrack = null
        peer.onconnectionstatechange = null
      }

      const stoppedTracks = new Set()
      stopStreamTracks(resources.stream, stoppedTracks)
      resources.remoteStreams.forEach((remoteStream) => stopStreamTracks(remoteStream, stoppedTracks))
      const audioStream = resources.audio?.srcObject
      stopStreamTracks(audioStream, stoppedTracks)

      if (resources.audio) {
        try {
          resources.audio.pause?.()
        } catch {
          // The media element may never have entered playback.
        }
        resources.audio.srcObject = null
        resources.audio.remove?.()
      }

      closeResource(channel)
      closeResource(peer)
      resources.remoteStreams.clear()
      resources.contextOperations.clear()
      resources.injected.clear()
      resources.pending.clear()
      resources.processedTranscriptions.clear()
      resources.responseQueue.length = 0
      if (resources.activeResponse?.timeoutId) window.clearTimeout(resources.activeResponse.timeoutId)
      resources.activeResponse = null
      resources.stream = null
      resources.audio = null
      resources.channel = null
      resources.peer = null
      scope.finish?.(operation)

      if (!operationScope) localScopeRef.current.invalidate()
      if (publish && mountedRef.current) {
        setError(nextError)
        setStatus(nextStatus)
      }
    }
    teardownRef.current = teardown
    setStatus('connecting')
    setError(null)

    const isCurrent = () => (
      !tornDown
      && resourcesRef.current === resources
      && scope.isCurrent(operation)
    )

    const removeResponseQueueEntry = (entry) => {
      const index = resources.responseQueue.indexOf(entry)
      if (index !== -1) resources.responseQueue.splice(index, 1)
    }

    const flushResponseQueue = () => {
      if (!isCurrent() || resources.activeResponse || resources.channel?.readyState !== 'open') return
      const entry = resources.responseQueue[0]
      if (!entry?.ready) return
      resources.responseQueue.shift()
      const activeResponse = {
        entry,
        queueToken: createResponseQueueToken(),
        timeoutId: null,
      }
      resources.activeResponse = activeResponse
      try {
        if (entry.context) {
          resources.channel.send(JSON.stringify({
            type: 'conversation.item.create',
            item: {
              type: 'message',
              role: 'user',
              content: [{
                type: 'input_text',
                text: entry.context,
              }],
            },
          }))
          resources.injected.add(entry.id)
        }
        if (!isCurrent()) return
        if (resources.channel?.readyState !== 'open') {
          teardown({
            status: 'error',
            error: { code: 'connection_failed', message: 'The call data connection failed.' },
          })
          return
        }
        resources.channel.send(JSON.stringify({
          type: 'response.create',
          response: {
            metadata: { convia_queue_token: activeResponse.queueToken },
          },
        }))
      } catch {
        teardown({
          status: 'error',
          error: { code: 'connection_failed', message: 'Unable to request an AI response.' },
        })
        return
      }
      if (!isCurrent() || resources.activeResponse !== activeResponse) return
      activeResponse.timeoutId = window.setTimeout(() => {
        if (!isCurrent() || resources.activeResponse !== activeResponse) return
        teardown({
          status: 'error',
          error: { code: 'response_timeout', message: 'The AI response timed out.' },
        })
      }, RESPONSE_COMPLETION_TIMEOUT_MS)
    }

    const handleResponseDone = (realtimeEvent) => {
      const activeResponse = resources.activeResponse
      if (!activeResponse || activeResponse.queueToken !== realtimeEvent.queueToken) return
      if (activeResponse.timeoutId) window.clearTimeout(activeResponse.timeoutId)
      resources.activeResponse = null
      flushResponseQueue()
    }

    const respondToAiTranscription = async (transcriptionEvent) => {
      if (mode !== 'ai' || !isCurrent()) return
      if (resources.processedTranscriptions.has(transcriptionEvent.id)) return
      resources.processedTranscriptions.add(transcriptionEvent.id)
      const normalized = transcriptionEvent.transcript
      const key = transcriptionEvent.id
      const queueEntry = { id: key, context: '', ready: false }
      resources.responseQueue.push(queueEntry)
      const contextOperation = scope.fork?.(operation) || operation
      if (!scope.isCurrent(contextOperation)) {
        removeResponseQueueEntry(queueEntry)
        return
      }
      resources.contextOperations.add(contextOperation)
      resources.pending.add(key)
      const lookupTimeout = contextOperation.controller
        ? window.setTimeout(() => contextOperation.controller.abort(), ABOUT_FRIEND_LOOKUP_TIMEOUT_MS)
        : null
      try {
        const response = await fetch(`${apiBaseUrl}/api/openai/realtime/about-friend-context`, {
          method: 'POST',
          credentials: 'include',
          signal: contextOperation.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: normalized, contact_id: contactId }),
        })
        const data = await response.json().catch(() => ({}))
        if (isCurrent() && scope.isCurrent(contextOperation)
          && response.ok && data?.ok && data?.matched && data?.context) {
          queueEntry.context = `Additional about_friend_context for understanding only; do not repeat it verbatim:\n${String(data.context)}`
        }
      } catch {
        // Context enrichment is optional; a current AI turn still receives a response.
      } finally {
        if (lookupTimeout) window.clearTimeout(lookupTimeout)
        resources.pending.delete(key)
        resources.contextOperations.delete(contextOperation)
        scope.finish?.(contextOperation)
      }
      if (!isCurrent() || !scope.isCurrent(contextOperation)) {
        removeResponseQueueEntry(queueEntry)
        return
      }
      queueEntry.ready = true
      flushResponseQueue()
    }

    const connect = async () => {
      try {
        const secretResponse = await fetch(`${apiBaseUrl}/api/openai/realtime/client-secret`, {
          method: 'POST',
          credentials: 'include',
          signal: operation.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode, contact_id: contactId }),
        })
        const secretData = await secretResponse.json().catch(() => ({}))
        if (!isCurrent()) return
        if (!secretResponse.ok || !secretData?.ok || !secretData?.client_secret) {
          throw new Error(secretData?.error || `Unable to create Realtime session (${secretResponse.status})`)
        }

        const peer = new RTCPeerConnection()
        resources.peer = peer
        const audio = document.createElement('audio')
        audio.autoplay = true
        audio.playsInline = true
        audio.muted = !desiredSpeakerEnabledRef.current
        resources.audio = audio
        peer.ontrack = (event) => {
          if (!isCurrent()) return
          const eventStreams = [...(event.streams || [])]
          let playbackStream = eventStreams[0]
          eventStreams.forEach((remoteStream) => resources.remoteStreams.add(remoteStream))
          if (!playbackStream && typeof MediaStream === 'function') {
            playbackStream = new MediaStream([event.track])
            resources.remoteStreams.add(playbackStream)
          }
          audio.srcObject = playbackStream || null
          audio.play?.().catch?.(() => {})
        }
        peer.onconnectionstatechange = () => {
          if (!isCurrent()) return
          if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
            teardown({
              status: 'error',
              error: { code: 'connection_failed', message: 'The call connection was lost.' },
            })
          } else if (peer.connectionState === 'closed') {
            teardown({ status: 'closed' })
          }
        }

        const channel = peer.createDataChannel('oai-events')
        resources.channel = channel
        channel.onopen = () => {
          if (isCurrent()) setStatus('connected')
        }
        channel.onclose = () => {
          if (isCurrent()) teardown({ status: 'closed' })
        }
        channel.onerror = () => {
          if (!isCurrent()) return
          teardown({
            status: 'error',
            error: { code: 'connection_failed', message: 'The call data connection failed.' },
          })
        }
        channel.onmessage = (event) => {
          if (!isCurrent()) return
          const realtimeEvent = parseRealtimeEvent(event.data)
          if (realtimeEvent?.type === 'error') {
            teardown({
              status: 'error',
              error: { code: 'realtime_error', message: 'The AI voice session ended unexpectedly.' },
            })
            return
          }
          if (realtimeEvent?.type === TRANSCRIPTION_COMPLETED) {
            void respondToAiTranscription(realtimeEvent)
          } else if (realtimeEvent?.type === RESPONSE_DONE) {
            handleResponseDone(realtimeEvent)
          }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        if (!isCurrent()) {
          stopStreamTracks(stream)
          return
        }
        resources.stream = stream
        stream.getTracks().forEach((track) => {
          track.enabled = !desiredMutedRef.current
          peer.addTrack(track, stream)
        })

        const offer = await peer.createOffer()
        if (!isCurrent()) return
        await peer.setLocalDescription(offer)
        if (!isCurrent()) return
        const answerResponse = await fetch(OPENAI_REALTIME_CALLS_URL, {
          method: 'POST',
          signal: operation.signal,
          headers: {
            Authorization: `Bearer ${secretData.client_secret}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
        })
        const answerSdp = await answerResponse.text()
        if (!isCurrent()) return
        if (!answerResponse.ok || !answerSdp) throw new Error(`OpenAI Realtime connection failed (${answerResponse.status})`)
        await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })
      } catch (connectionError) {
        if (tornDown) return
        if (connectionError?.name === 'AbortError' || !scope.isCurrent(operation)) {
          teardown({ status: 'closed', publish: false })
          return
        }
        teardown({ status: 'error', error: errorFromFailure(connectionError) })
      }
    }

    void connect()
    return () => teardown({ status: 'closed', publish: false })
  }, [active, apiBaseUrl, attempt, contactId, mode, operationScope, scope])

  useEffect(() => () => {
    mountedRef.current = false
    teardownRef.current?.({ status: 'closed', publish: false })
  }, [])

  return {
    status,
    connecting: status === 'connecting',
    connected: status === 'connected',
    closed: status === 'closed',
    error,
    muted,
    speakerEnabled,
    retry,
    hangUp,
    toggleMute,
    toggleSpeaker,
  }
}
