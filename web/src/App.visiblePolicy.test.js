import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('remaining visible interface policy', () => {
  it('contains no legacy Pisces, Gemini, phone-frame, or image-branding UI copy', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).not.toMatch(/Pisces AI|Gemini|9:41|Bluetooth|background\.webp|logo\.webp/)
  })

  it('does not keep dead legacy modal branches in the authenticated tree', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).not.toContain('false &&')
    expect(source).not.toContain("rgba(55, 30, 78")
  })

  it('contains no purple avatar fallback in visible styles', () => {
    const source = readFileSync(`${process.cwd()}/src/styles/app-shell.css`, 'utf8')
    expect(source).not.toContain('#5b5bd6')
  })

  it('does not hardcode English-only validation in the localized shell', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).not.toContain("setTesterError('Email is required.')")
    expect(source).not.toContain("setGoogleError('Google Sign-In failed to load.')")
  })

  it('wires recipient polling to bounded canonical-tail history reconciliation', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).toContain('loadContactHistory(selectedId, { limit: 100, merge: true, silent: true })')
    expect(source).toContain('mergeCanonicalHistoryTail(current, nextMessages)')
  })

  it('keeps one Ably client across contact switches and reconciles reconnects only', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).toContain('const reconnectGate = createReconnectGate()')
    expect(source).toContain('if (!reconnectGate.shouldReconcile()) return')
    expect(source).toContain('document.hasFocus()')
    expect(source).toContain('shouldAutoMarkIncomingRead({ selectedContactId: selectedContactIdRef.current, conversationId, windowFocused })')
    expect(source).not.toContain('apiBaseUrl, selectedContact?.id]')
  })

  it('allows the selected Convia conversation to clear its durable unread count', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    const markRead = source.slice(source.indexOf('const markContactAsRead = async'), source.indexOf('const loginTesterAccount'))

    expect(markRead).not.toContain("contactId === 'pisces-core'")
    expect(markRead).toContain('/api/chat/mark-read')
  })

  it('wires durable client request identity through history, voice pending, and shared Convia success', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).toContain("requestId: message.client_request_id || ''")
    expect(source).toContain("const personVoiceRequestId = shouldUseAiVoiceFlow ? '' : createClientRequestId('person-voice')")
    expect(source).toContain('requestId: personVoiceRequestId')
    expect(source).toContain('reconcileCanonicalMessage(current, audioMessageId, canonicalVoiceMessage)')
    expect(source).toContain("const pendingMessageId = `pending-${identity.requestId}`")
    expect(source).toContain('reconcileCanonicalMessage(current, pendingMessageId, message)')
    expect(source).toContain('reconcileCanonicalMessage(withMessage, \'\', conviaMessage)')
  })

  it('derives tester-login visibility only from the session capability response', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    const restore = source.slice(source.indexOf('const restore = async () =>'), source.indexOf('const rawUi = localStorage'))
    const settingsSave = source.slice(source.indexOf('const saveUserSettings = async'), source.indexOf('const openAddFriendModal'))
    expect(restore).toContain('setTesterLoginEnabled(data?.tester_login_enabled === true)')
    expect(source).not.toContain('judy_login_enabled')
    expect(source).not.toContain('JUDY_LOGIN_ALLOWED_IP')
    expect(settingsSave).not.toContain('setTesterLoginEnabled')
  })

  it('routes both public demo accounts through isolated windows', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).toContain('openDemoWindow(key)')
    expect(source).toContain('onOpenDemoAccount={openDemoAccount}')
    expect(source).not.toContain('loginAsJudy')
  })

  it('uses same-origin API calls on the production host', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    const getApiBaseUrl = source.slice(source.indexOf('function getApiBaseUrl()'), source.indexOf('function navigateTo'))
    expect(getApiBaseUrl).toContain("if (!isLocalHost) return ''")
    expect(getApiBaseUrl).not.toContain('FALLBACK_API_BASE_URL')
  })
})
