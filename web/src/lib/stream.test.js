import { describe, expect, it, vi } from 'vitest'
import { mergeStreamMessage, readNdjson, streamAiTurn } from './stream.js'

function responseFromChunks(chunks, { ok = true, status = 200 } = {}) {
  const encoder = new TextEncoder()
  let index = 0
  return {
    ok,
    status,
    body: new ReadableStream({
      pull(controller) {
        if (index >= chunks.length) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
      },
    }),
  }
}

describe('readNdjson', () => {
  it('decodes records split across chunks and a final unterminated line', async () => {
    const events = []
    await readNdjson(responseFromChunks(['{"type":"del', 'ta","delta":"你"}\n{"type":"done"}']), (event) => events.push(event))
    expect(events).toEqual([
      { type: 'delta', delta: '你' },
      { type: 'done' },
    ])
  })

  it('rejects failed or bodyless responses', async () => {
    await expect(readNdjson({ ok: false, status: 503, body: null }, () => {})).rejects.toThrow('Request failed (503)')
    await expect(readNdjson({ ok: true, status: 200, body: null }, () => {})).rejects.toThrow('Request failed (200)')
  })
})

describe('streamAiTurn', () => {
  it('keeps partial text incomplete and retries with the original input', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(responseFromChunks([
        '{"type":"delta","text":"partial"}\n',
        '{"type":"error","error":"provider failed"}\n',
      ]))
      .mockResolvedValueOnce(responseFromChunks([
        '{"type":"delta","text":"complete"}\n',
        '{"type":"audio","audio_base64":"UklGRg==","audio_mime_type":"audio/wav"}\n',
        '{"type":"done","message_id":"server-ai","reply":"complete","image_url":"/image","music_url":"/music"}\n',
      ]))
    const snapshots = []

    const first = await streamAiTurn({
      fetchImpl,
      url: '/api/chat/stream',
      input: 'original prompt',
      contactId: 'pisces-core',
      onMessage: (message) => snapshots.push(message),
    })

    expect(first.message).toMatchObject({ text: 'partial', status: 'incomplete', error: 'provider failed' })
    expect(first.retry).toEqual(expect.any(Function))

    await first.retry()
    const firstBody = JSON.parse(fetchImpl.mock.calls[0][1].body)
    const retryBody = JSON.parse(fetchImpl.mock.calls[1][1].body)
    expect(retryBody).toMatchObject({ message: 'original prompt', contact_id: 'pisces-core', request_id: firstBody.request_id })
    expect(snapshots.at(-1)).toMatchObject({
      id: 'server-ai',
      text: 'complete',
      status: 'complete',
      audioUrl: 'data:audio/wav;base64,UklGRg==',
      imageUrl: '/image',
      musicUrl: '/music',
    })
  })
})

describe('mergeStreamMessage', () => {
  it('continues matching a stream after the server-facing temporary id replaces the UI placeholder id', () => {
    const initial = [{ id: 'ui-placeholder', role: 'ai', text: '', status: 'streaming' }]
    const firstDelta = mergeStreamMessage(initial, 'ui-placeholder', {
      id: 'stream-request-1',
      requestId: 'request-1',
      role: 'ai',
      text: 'one',
      status: 'streaming',
    })
    const secondDelta = mergeStreamMessage(firstDelta, 'ui-placeholder', {
      id: 'stream-request-1',
      requestId: 'request-1',
      role: 'ai',
      text: 'one two',
      status: 'streaming',
    })
    expect(secondDelta).toEqual([expect.objectContaining({ text: 'one two', requestId: 'request-1' })])
  })

  it('replaces an incomplete attempt by request id before retry instead of duplicating it', () => {
    const messages = [{ id: 'stream-request-1', requestId: 'request-1', role: 'ai', text: 'partial', status: 'incomplete' }]
    const next = mergeStreamMessage(messages, 'new-ui-placeholder', {
      id: 'new-ui-placeholder',
      requestId: 'request-1',
      role: 'ai',
      text: '',
      status: 'streaming',
    })
    expect(next).toHaveLength(1)
    expect(next[0]).toMatchObject({ id: 'new-ui-placeholder', status: 'streaming' })
  })
})
