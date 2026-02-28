import { useMemo, useState } from 'react'

const FALLBACK_API_BASE_URL = 'https://pisces-315346868518.asia-east1.run.app'

export default function App() {
  const apiBaseUrl = useMemo(
    () => (import.meta.env.VITE_API_BASE_URL || FALLBACK_API_BASE_URL).replace(/\/$/, ''),
    [],
  )
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
            {
              startedAt,
              requestUrl,
              status: res.status,
              statusText: res.statusText,
              response: data,
            },
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
            responsePreview: (data.reply || '').slice(0, 200),
          },
          null,
          2,
        ),
      )
    } catch (err) {
      const message = err?.message || 'Unable to reach API.'
      setError(message)
      setDebugLog(
        JSON.stringify(
          {
            startedAt,
            requestUrl,
            error: message,
            hint:
              message === 'Failed to fetch'
                ? 'Usually CORS, HTTPS/mixed-content, DNS, or backend unavailable.'
                : '',
          },
          null,
          2,
        ),
      )
      // Keep this for browser devtools inspection.
      console.error('Pisces chat request failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main
      style={{
        maxWidth: 720,
        margin: '40px auto',
        padding: 16,
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <h1>Pisces AI Chat Test</h1>
      <p>Frontend endpoint: https://pisces-plum.vercel.app</p>
      <p>Backend endpoint: {apiBaseUrl}</p>

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
        <textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Type a message for Gemini..."
          style={{ padding: 12, fontSize: 16 }}
        />
        <button type="submit" disabled={isLoading} style={{ width: 160, padding: '10px 12px' }}>
          {isLoading ? 'Sending...' : 'Send to AI'}
        </button>
      </form>

      <section style={{ marginTop: 24 }}>
        <h2>AI Reply</h2>
        <div
          style={{
            minHeight: 120,
            border: '1px solid #ccc',
            borderRadius: 8,
            padding: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
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
