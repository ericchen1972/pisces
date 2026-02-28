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
    setIsLoading(true)

    try {
      const res = await fetch(`${apiBaseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Request failed.')
      }
      setReply(data.reply || '')
    } catch (err) {
      setError(err.message || 'Unable to reach API.')
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
    </main>
  )
}
