import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseRealtimeEvent, useOpenAIRealtime } from './useOpenAIRealtime.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function createTrack() {
  return { enabled: true, stop: vi.fn() }
}

function createPeer() {
  const senders = []
  const peer = {
    connectionState: 'new',
    addTrack: vi.fn((track) => senders.push({ track })),
    getSenders: vi.fn(() => senders),
    createDataChannel: vi.fn(() => ({
      readyState: 'connecting',
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onclose: null,
      onerror: null,
      onmessage: null,
    })),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    close: vi.fn(),
    ontrack: null,
    onconnectionstatechange: null,
  }
  return peer
}

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: vi.fn(async () => body), text: vi.fn(async () => String(body)) }
}

function transcriptionEvent(eventId, transcript, itemId = `item-${eventId}`) {
  return JSON.stringify({
    type: 'conversation.item.input_audio_transcription.completed',
    event_id: eventId,
    item_id: itemId,
    transcript,
  })
}

function sentEvents(channel, type) {
  return channel.send.mock.calls
    .map(([value]) => JSON.parse(value))
    .filter((event) => event.type === type)
}

function responseDoneFor(responseCreate, {
  responseId = 'resp-current',
  status = 'completed',
  token = responseCreate?.response?.metadata?.convia_queue_token,
} = {}) {
  return JSON.stringify({
    type: 'response.done',
    event_id: `event-done-${responseId}`,
    response: {
      id: responseId,
      status,
      metadata: token ? { convia_queue_token: token } : {},
    },
  })
}

function currentResponseCreate(channel) {
  return sentEvents(channel, 'response.create').at(-1)
}

describe('parseRealtimeEvent', () => {
  it('accepts a bounded recognized transcription with a stable id', () => {
    expect(parseRealtimeEvent(transcriptionEvent('event-1', 'What about Amy?'))).toEqual({
      type: 'conversation.item.input_audio_transcription.completed',
      id: 'item-event-1',
      transcript: 'What about Amy?',
    })
  })

  it.each([
    ['binary', new Uint8Array([1, 2, 3])],
    ['non-string', { type: 'error' }],
    ['oversize event', 'x'.repeat(65_537)],
    ['oversize multibyte event', '😀'.repeat(20_000)],
    ['invalid JSON', '{'],
    ['array JSON', '[]'],
    ['unknown type', JSON.stringify({ type: 'session.updated' })],
    ['non-string type', JSON.stringify({ type: 7 })],
    ['missing item id', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', event_id: 'event-only', transcript: 'Amy' })],
    ['non-string item id', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', event_id: 'event-number', item_id: 7, transcript: 'Amy' })],
    ['oversize item id', transcriptionEvent('event-long-id', 'Amy', 'x'.repeat(257))],
    ['empty transcript', transcriptionEvent('event-empty', '   ')],
    ['non-string transcript', JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', event_id: 'event-number', transcript: 7 })],
    ['oversize transcript', transcriptionEvent('event-long', 'x'.repeat(4_001))],
  ])('rejects %s', (_name, value) => {
    expect(parseRealtimeEvent(value)).toBeNull()
  })
})

describe('useOpenAIRealtime', () => {
  let peer
  let track
  let stream
  let fetchMock

  beforeEach(() => {
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue()
    peer = createPeer()
    track = createTrack()
    stream = { getTracks: () => [track], getAudioTracks: () => [track] }
    vi.stubGlobal('RTCPeerConnection', vi.fn(() => peer))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    })
    fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('exchanges an ephemeral secret and SDP, then connects on the data channel', async () => {
    const { result } = renderHook(() => useOpenAIRealtime({
      active: true,
      apiBaseUrl: 'https://backend.example',
      mode: 'ai',
      contactId: 'pisces-core',
    }))

    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' }))
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://backend.example/api/openai/realtime/client-secret', expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ mode: 'ai', contact_id: 'pisces-core' }),
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.openai.com/v1/realtime/calls', expect.objectContaining({
      method: 'POST',
      body: 'offer-sdp',
      headers: expect.objectContaining({ Authorization: 'Bearer ephemeral', 'Content-Type': 'application/sdp' }),
    }))
    expect(peer.addTrack).toHaveBeenCalledWith(track, stream)
    act(() => peer.createDataChannel.mock.results[0].value.onopen())
    expect(result.current.status).toBe('connected')
  })

  it('applies speaker preference when a deferred secret creates audio later', async () => {
    const secret = deferred()
    fetchMock.mockReset()
      .mockReturnValueOnce(secret.promise)
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
    const originalCreateElement = document.createElement.bind(document)
    let createdAudio
    vi.spyOn(document, 'createElement').mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options)
      if (tagName === 'audio') createdAudio = element
      return element
    })
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))

    act(() => result.current.toggleSpeaker())
    expect(result.current.speakerEnabled).toBe(false)
    secret.resolve(jsonResponse({ ok: true, client_secret: 'late-secret', model: 'gpt-realtime-2.1' }))

    await waitFor(() => expect(createdAudio).toBeTruthy())
    expect(createdAudio.muted).toBe(true)
  })

  it('applies mute preference when deferred microphone media arrives later', async () => {
    const media = deferred()
    navigator.mediaDevices.getUserMedia.mockReturnValueOnce(media.promise)
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce())

    act(() => result.current.toggleMute())
    expect(result.current.muted).toBe(true)
    media.resolve(stream)

    await waitFor(() => expect(peer.addTrack).toHaveBeenCalled())
    expect(track.enabled).toBe(false)
  })

  it('stops tracks and closes channel and peer on hangup and unmount', async () => {
    const { result, unmount } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())

    act(() => result.current.hangUp())
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(peer.createDataChannel.mock.results[0].value.close).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(result.current.status).toBe('closed')
    unmount()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it('tears down local and remote media on standalone unmount', async () => {
    const remoteTrack = createTrack()
    const remoteStream = { getTracks: () => [remoteTrack] }
    const { unmount } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    act(() => peer.ontrack({ streams: [remoteStream], track: remoteTrack }))

    unmount()

    expect(track.stop).toHaveBeenCalledOnce()
    expect(remoteTrack.stop).toHaveBeenCalledOnce()
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce()
    expect(peer.createDataChannel.mock.results[0].value.close).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['peer failure', 'error', ({ peer: currentPeer }) => {
      currentPeer.connectionState = 'failed'
      currentPeer.onconnectionstatechange()
    }],
    ['peer disconnect', 'error', ({ peer: currentPeer }) => {
      currentPeer.connectionState = 'disconnected'
      currentPeer.onconnectionstatechange()
    }],
    ['peer close', 'closed', ({ peer: currentPeer }) => {
      currentPeer.connectionState = 'closed'
      currentPeer.onconnectionstatechange()
    }],
    ['channel close', 'closed', ({ channel }) => channel.onclose()],
    ['channel error', 'error', ({ channel }) => channel.onerror()],
    ['Realtime server error', 'error', ({ channel }) => channel.onmessage({ data: JSON.stringify({ type: 'error', error: { message: 'provider detail' } }) })],
  ])('uses the idempotent teardown for %s', async (_name, expectedStatus, trigger) => {
    const remoteTrack = createTrack()
    const remoteStream = { getTracks: () => [remoteTrack] }
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    act(() => peer.ontrack({ streams: [remoteStream], track: remoteTrack }))
    channel.close.mockImplementation(() => channel.onclose?.())
    peer.close.mockImplementation(() => {
      peer.connectionState = 'closed'
      peer.onconnectionstatechange?.()
    })

    act(() => trigger({ peer, channel }))

    expect(result.current.status).toBe(expectedStatus)
    expect(track.stop).toHaveBeenCalledOnce()
    expect(remoteTrack.stop).toHaveBeenCalledOnce()
    expect(channel.close).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalledOnce()
    if (_name === 'Realtime server error') {
      expect(result.current.error?.message).not.toContain('provider detail')
    }
  })

  it('shows microphone denial and retries only after an explicit action', async () => {
    navigator.mediaDevices.getUserMedia
      .mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
      .mockResolvedValueOnce(stream)
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))

    await waitFor(() => expect(result.current.error?.code).toBe('microphone_denied'))
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce()
    expect(peer.createDataChannel.mock.results[0].value.close).toHaveBeenCalledOnce()
    expect(peer.close).toHaveBeenCalledOnce()
    fetchMock
      .mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'retry-secret', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'retry-answer-sdp') })
    await act(async () => result.current.retry())
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2))
  })

  it('closes late resources when the account operation becomes stale', async () => {
    const secret = deferred()
    fetchMock.mockReset().mockReturnValueOnce(secret.promise)
    let current = true
    const operationScope = {
      begin: () => ({ signal: new AbortController().signal }),
      isCurrent: () => current,
      finish: vi.fn(),
      fork: (operation) => operation,
      runIfCurrent: (_operation, callback) => current && callback(),
    }
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core', operationScope }))
    current = false
    await act(async () => {
      secret.resolve(jsonResponse({ ok: true, client_secret: 'late', model: 'gpt-realtime-2.1' }))
      await secret.promise
      await Promise.resolve()
    })
    expect(RTCPeerConnection).not.toHaveBeenCalled()
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
  })

  it('injects fresh about-friend context only for AI input transcriptions', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: true, context: '{"friend":"Amy"}' }))
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: 'https://backend.example', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => channel.onmessage({ data: transcriptionEvent('event-match', 'What did Amy say?') }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(channel.send).toHaveBeenCalledWith(expect.stringContaining('about_friend_context')))
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://backend.example/api/openai/realtime/about-friend-context', expect.objectContaining({ credentials: 'include' }))
  })

  it('does not dynamically look up about-friend context in Assist mode', async () => {
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'assist', contactId: 'friend' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => channel.onmessage({ data: transcriptionEvent('event-assist', 'Tell me about Amy') }))
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(channel.send).not.toHaveBeenCalled()
  })

  it('does not inject context that resolves after the account operation becomes stale', async () => {
    const contextResponse = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockReturnValueOnce(contextResponse.promise)
    let current = true
    const operationScope = {
      begin: () => ({ signal: new AbortController().signal }),
      isCurrent: () => current,
      finish: vi.fn(),
      fork: (operation) => operation,
      runIfCurrent: (_operation, callback) => current && callback(),
    }
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core', operationScope }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => channel.onmessage({ data: transcriptionEvent('event-stale', 'What about Amy?') }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))

    current = false
    await act(async () => {
      contextResponse.resolve(jsonResponse({ ok: true, matched: true, context: 'private context' }))
      await contextResponse.promise
      await Promise.resolve()
    })
    expect(channel.send).not.toHaveBeenCalled()
  })

  it.each([
    ['no match', jsonResponse({ ok: true, matched: false, context: '' })],
    ['lookup failure', new Error('lookup failed')],
  ])('creates exactly one AI response after %s', async (_name, contextResult) => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
    if (contextResult instanceof Error) fetchMock.mockRejectedValueOnce(contextResult)
    else fetchMock.mockResolvedValueOnce(contextResult)
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'

    act(() => channel.onmessage({ data: transcriptionEvent(`event-${_name}`, 'Tell me about Amy') }))

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    expect(sentEvents(channel, 'conversation.item.create')).toHaveLength(0)
  })

  it('deduplicates different delivery events for the same transcription item id', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'

    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-delivery-a', 'Tell me about Amy', 'item-shared') })
      channel.onmessage({ data: transcriptionEvent('event-delivery-b', 'Tell me about Amy', 'item-shared') })
    })

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('runs lookups in parallel but commits contexts and responses in transcription arrival order', async () => {
    const first = deferred()
    const second = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-second', 'Second') })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))

    second.resolve(jsonResponse({ ok: true, matched: true, context: 'second context' }))
    await act(async () => { await second.promise; await Promise.resolve() })
    expect(channel.send).not.toHaveBeenCalled()
    first.resolve(jsonResponse({ ok: true, matched: true, context: 'first context' }))

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    expect(channel.send.mock.calls.map(([value]) => {
      const event = JSON.parse(value)
      return event.type === 'conversation.item.create' ? event.item.content[0].text : event.type
    })).toEqual([
      expect.stringContaining('first context'),
      'response.create',
    ])

    act(() => channel.onmessage({ data: responseDoneFor(currentResponseCreate(channel)) }))

    expect(channel.send.mock.calls.map(([value]) => {
      const event = JSON.parse(value)
      return event.type === 'conversation.item.create' ? event.item.content[0].text : event.type
    })).toEqual([
      expect.stringContaining('first context'),
      'response.create',
      expect.stringContaining('second context'),
      'response.create',
    ])
  })

  it('ignores malformed, unrelated, and duplicate response.done events', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-done-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-done-second', 'Second') })
    })

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    const firstCreate = currentResponseCreate(channel)
    act(() => {
      channel.onmessage({ data: JSON.stringify({ type: 'response.done', response: null }) })
      channel.onmessage({ data: responseDoneFor(firstCreate, { token: 'unrelated-token' }) })
      channel.onmessage({ data: responseDoneFor(firstCreate, { status: 'in_progress' }) })
      channel.onmessage({ data: responseDoneFor(firstCreate, { responseId: 'x'.repeat(257) }) })
      channel.onmessage({ data: responseDoneFor(firstCreate, { token: 'x'.repeat(129) }) })
    })
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)

    act(() => channel.onmessage({ data: responseDoneFor(firstCreate) }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(2)

    act(() => channel.onmessage({ data: responseDoneFor(firstCreate) }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(2)
  })

  it.each(['cancelled', 'failed', 'incomplete'])('releases the next queued turn after a %s response', async (status) => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent(`event-${status}-first`, 'First') })
      channel.onmessage({ data: transcriptionEvent(`event-${status}-second`, 'Second') })
    })

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    act(() => channel.onmessage({ data: responseDoneFor(currentResponseCreate(channel), { status }) }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(2)
  })

  it('does not release queued turns after teardown or a late completion event', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-teardown-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-teardown-second', 'Second') })
    })

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    const lateHandler = channel.onmessage
    const done = responseDoneFor(currentResponseCreate(channel))
    act(() => result.current.hangUp())
    act(() => lateHandler({ data: done }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
  })

  it('tears down an active response and drops queued turns on a server error', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, matched: false, context: '' }))
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-error-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-error-second', 'Second') })
    })

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    const lateHandler = channel.onmessage
    const done = responseDoneFor(currentResponseCreate(channel))
    act(() => channel.onmessage({ data: JSON.stringify({ type: 'error' }) }))
    expect(result.current.error?.code).toBe('realtime_error')
    expect(channel.close).toHaveBeenCalledOnce()

    act(() => lateHandler({ data: done }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
  })

  it('bounds an active response wait by tearing down instead of overlapping the next turn', async () => {
    const first = deferred()
    const second = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    vi.useFakeTimers()
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-response-timeout-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-response-timeout-second', 'Second') })
    })
    first.resolve(jsonResponse({ ok: true, matched: false, context: '' }))
    second.resolve(jsonResponse({ ok: true, matched: false, context: '' }))
    await act(async () => {
      await first.promise
      await second.promise
      await Promise.resolve()
    })
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)

    act(() => vi.advanceTimersByTime(120_000))

    expect(result.current.error?.code).toBe('response_timeout')
    expect(channel.close).toHaveBeenCalledOnce()
    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
  })

  it('releases the next ordered response when the first lookup fails', async () => {
    const first = deferred()
    const second = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-fail-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-after-fail', 'Second') })
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
    second.resolve(jsonResponse({ ok: true, matched: true, context: 'second context' }))
    await act(async () => { await second.promise; await Promise.resolve() })
    expect(channel.send).not.toHaveBeenCalled()

    first.reject(new Error('lookup failed'))

    await waitFor(() => expect(sentEvents(channel, 'response.create')).toHaveLength(1))
    act(() => channel.onmessage({ data: responseDoneFor(currentResponseCreate(channel)) }))
    expect(channel.send.mock.calls.map(([value]) => JSON.parse(value).type)).toEqual([
      'response.create',
      'conversation.item.create',
      'response.create',
    ])
  })

  it('releases the next ordered response when the first lookup times out', async () => {
    const second = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'AbortError' })), { once: true })
      }))
      .mockReturnValueOnce(second.promise)
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    vi.useFakeTimers()
    act(() => {
      channel.onmessage({ data: transcriptionEvent('event-timeout-first', 'First') })
      channel.onmessage({ data: transcriptionEvent('event-after-timeout', 'Second') })
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    second.resolve(jsonResponse({ ok: true, matched: false, context: '' }))
    await act(async () => { await second.promise; await Promise.resolve() })
    expect(channel.send).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })

    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
    act(() => channel.onmessage({ data: responseDoneFor(currentResponseCreate(channel)) }))
    expect(sentEvents(channel, 'response.create')).toHaveLength(2)
  })

  it('bounds a hanging about-friend lookup and still creates the AI response', async () => {
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockImplementationOnce((_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { name: 'AbortError' })), { once: true })
      }))
    renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    vi.useFakeTimers()
    act(() => channel.onmessage({ data: transcriptionEvent('event-timeout', 'Tell me about Amy') }))
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await act(async () => {
      vi.advanceTimersByTime(5_000)
      await Promise.resolve()
    })

    expect(sentEvents(channel, 'response.create')).toHaveLength(1)
    vi.useRealTimers()
  })

  it('aborts an in-flight about-friend lookup on hangup', async () => {
    const contextResponse = deferred()
    fetchMock.mockReset()
      .mockResolvedValueOnce(jsonResponse({ ok: true, client_secret: 'ephemeral', model: 'gpt-realtime-2.1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, text: vi.fn(async () => 'answer-sdp') })
      .mockReturnValueOnce(contextResponse.promise)
    const { result } = renderHook(() => useOpenAIRealtime({ active: true, apiBaseUrl: '', mode: 'ai', contactId: 'pisces-core' }))
    await waitFor(() => expect(peer.setRemoteDescription).toHaveBeenCalled())
    const channel = peer.createDataChannel.mock.results[0].value
    channel.readyState = 'open'
    act(() => channel.onmessage({ data: transcriptionEvent('event-abort', 'What about Amy?') }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const contextSignal = fetchMock.mock.calls[2][1].signal

    act(() => result.current.hangUp())

    expect(contextSignal.aborted).toBe(true)
    expect(sentEvents(channel, 'response.create')).toHaveLength(0)
  })
})
