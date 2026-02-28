import { useEffect, useMemo, useState } from 'react'

const FALLBACK_API_BASE_URL = 'https://pisces-315346868518.asia-east1.run.app'
const LOCAL_API_BASE_URL = 'http://127.0.0.1:8080'

const CONTACTS = [
  {
    id: 'ai',
    name: 'Pisces AI',
    snippet: 'I drafted your reply to Judy. Ready to send?',
    time: '09:48',
    unread: 2,
    tone: 'AI Partner',
    color: '#3a86ff',
  },
  {
    id: 'boss',
    name: 'Michael (Boss)',
    snippet: 'Need the Q2 pitch deck by 3 PM.',
    time: '09:12',
    unread: 1,
    tone: 'Strategic',
    color: '#ff006e',
  },
  {
    id: 'judy',
    name: 'Judy',
    snippet: 'Dinner plan tonight? 😄',
    time: '08:41',
    unread: 0,
    tone: 'Gentle',
    color: '#fb5607',
  },
  {
    id: 'client',
    name: 'Nova Client Group',
    snippet: 'Thanks. Please share an updated timeline.',
    time: 'Yesterday',
    unread: 0,
    tone: 'Professional',
    color: '#8338ec',
  },
  {
    id: 'bestie',
    name: 'Leo (Bestie)',
    snippet: 'Bro, game night Friday?',
    time: 'Yesterday',
    unread: 5,
    tone: 'Banter',
    color: '#06d6a0',
  },
]

function getApiBaseUrl() {
  const envBase = (import.meta.env.VITE_API_BASE_URL || '').trim()
  if (envBase) {
    return envBase.replace(/\/$/, '')
  }

  const host = window.location.hostname
  const isLocalHost = host === 'localhost' || host === '127.0.0.1'
  return (isLocalHost ? LOCAL_API_BASE_URL : FALLBACK_API_BASE_URL).replace(/\/$/, '')
}

function navigateTo(pathname) {
  if (window.location.pathname === pathname) {
    return
  }
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

function MessengerHome() {
  return (
    <main
      style={{
        minHeight: '100vh',
        margin: 0,
        display: 'grid',
        placeItems: 'center',
        background:
          'radial-gradient(circle at 10% 10%, #2235c9 0%, #0d1238 35%, #060816 100%)',
        padding: '24px 12px',
        fontFamily: 'Avenir Next, Montserrat, Helvetica Neue, sans-serif',
      }}
    >
      <section
        style={{
          width: 360,
          maxWidth: '96vw',
          borderRadius: 36,
          overflow: 'hidden',
          background: 'linear-gradient(180deg, #f8fbff 0%, #e8eef7 100%)',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45)',
          border: '10px solid #0d0f17',
        }}
      >
        <header
          style={{
            padding: '14px 18px 8px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1d2d59 100%)',
            color: '#f6fbff',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.9 }}>
            <span>9:41</span>
            <span>5G • 87%</span>
          </div>
          <h1 style={{ margin: '10px 0 4px', fontSize: 24, letterSpacing: 0.3 }}>Pisces Messenger</h1>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>You + Your AI, speaking to the world.</p>
        </header>

        <div style={{ padding: 12 }}>
          <button
            type="button"
            onClick={() => navigateTo('/lab/chat-test')}
            style={{
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderRadius: 14,
              padding: '10px 12px',
              background: '#0f172a',
              color: '#f8fbff',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Open AI Chat Test Lab →
          </button>
        </div>

        <div style={{ padding: '0 12px 14px' }}>
          <input
            readOnly
            value="Search messages"
            style={{
              width: '100%',
              border: '1px solid #d5dfef',
              borderRadius: 12,
              padding: '10px 12px',
              background: '#f7faff',
              color: '#7c8baa',
            }}
          />
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: '0 10px 8px' }}>
          {CONTACTS.map((contact) => (
            <li
              key={contact.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '44px 1fr auto',
                gap: 10,
                alignItems: 'center',
                padding: '10px 8px',
                borderBottom: '1px solid #dde6f4',
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 14,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontWeight: 700,
                  background: contact.color,
                }}
              >
                {contact.name.slice(0, 1)}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <strong style={{ fontSize: 14 }}>{contact.name}</strong>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#2b4c8f',
                      background: '#e4efff',
                      borderRadius: 999,
                      padding: '2px 7px',
                    }}
                  >
                    {contact.tone}
                  </span>
                </div>
                <p
                  style={{
                    margin: '4px 0 0',
                    color: '#5e6d89',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {contact.snippet}
                </p>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#5e6d89' }}>{contact.time}</div>
                {contact.unread > 0 ? (
                  <span
                    style={{
                      marginTop: 6,
                      minWidth: 18,
                      display: 'inline-grid',
                      placeItems: 'center',
                      padding: '2px 6px',
                      borderRadius: 999,
                      background: '#ff3d71',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {contact.unread}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        <footer
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            borderTop: '1px solid #d5dfef',
            background: '#f4f8ff',
          }}
        >
          <button style={tabButtonStyle('#122047')}>Chats</button>
          <button style={tabButtonStyle('#6d7b99')}>Calls</button>
          <button style={tabButtonStyle('#6d7b99')}>Profile</button>
        </footer>
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
        style={{
          border: '1px solid #cad5e9',
          background: '#fff',
          borderRadius: 8,
          padding: '8px 12px',
          cursor: 'pointer',
        }}
      >
        ← Back to Messenger Home
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

function tabButtonStyle(color) {
  return {
    border: 0,
    background: 'transparent',
    padding: '12px 0',
    color,
    fontWeight: 700,
    cursor: 'pointer',
  }
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

  if (pathname === '/') {
    return <MessengerHome />
  }

  if (pathname === '/lab/chat-test') {
    return <ChatTestLab />
  }

  return <NotFound />
}
