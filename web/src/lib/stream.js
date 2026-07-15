function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function readNdjson(response, onEvent) {
  if (!response?.ok || !response.body) throw new Error(`Request failed (${response?.status ?? 0})`)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.trim()) await onEvent(JSON.parse(line))
    }
    if (done) break
  }

  if (buffer.trim()) await onEvent(JSON.parse(buffer))
}

function audioDataUrl(event) {
  if (!event?.audio_base64) return ''
  return `data:${event.audio_mime_type || 'audio/wav'};base64,${event.audio_base64}`
}

export function mergeStreamMessage(messages, placeholderId, nextMessage) {
  const requestId = nextMessage?.requestId
  let replaced = false
  const next = (messages || []).map((message) => {
    const matches = message.id === placeholderId || (
      requestId && message.requestId === requestId
    )
    if (!matches) return message
    replaced = true
    return nextMessage
  })
  return replaced ? next : [...next, nextMessage]
}

export async function streamAiTurn({
  fetchImpl = fetch,
  url,
  input,
  contactId,
  requestId = createRequestId(),
  signal,
  onMessage = () => {},
}) {
  let message = { id: `stream-${requestId}`, role: 'ai', text: '', status: 'streaming', requestId, originalInput: input }
  let audioUrl = ''
  let terminal = false
  const publish = (next) => {
    message = { ...message, ...next }
    onMessage(message)
  }
  publish({})

  const retry = () => streamAiTurn({ fetchImpl, url, input, contactId, requestId, signal, onMessage })

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input, contact_id: contactId, request_id: requestId }),
    })

    await readNdjson(response, (event) => {
      if (terminal) return
      if (event.type === 'delta') {
        publish({ text: `${message.text || ''}${event.text || ''}` })
        return
      }
      if (event.type === 'audio') {
        audioUrl = audioDataUrl(event)
        publish({ audioUrl })
        return
      }
      if (event.type === 'error') {
        terminal = true
        publish({ status: 'incomplete', error: event.error || 'AI reply was interrupted', retry })
        return
      }
      if (event.type === 'done') {
        terminal = true
        publish({
          id: event.message_id || message.id,
          text: event.reply || message.text,
          status: 'complete',
          error: '',
          retry: undefined,
          audioUrl,
          imageUrl: event.image_url || '',
          musicUrl: event.music_url || '',
        })
      }
    })

    if (!terminal) publish({ status: 'incomplete', error: 'AI reply was interrupted', retry })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    publish({ status: 'incomplete', error: error?.message || 'AI reply was interrupted', retry })
  }

  return { message, retry }
}
