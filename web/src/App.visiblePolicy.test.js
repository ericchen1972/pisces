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
    expect(source).toContain('selectedContactIdRef.current === senderId')
    expect(source).not.toContain('apiBaseUrl, selectedContact?.id]')
  })

  it('wires durable client request identity through history, voice pending, and canonical success', () => {
    const source = readFileSync(`${process.cwd()}/src/App.jsx`, 'utf8')
    expect(source).toContain("requestId: message.client_request_id || ''")
    expect(source).toContain("const personVoiceRequestId = shouldUseAiVoiceFlow ? '' : createClientRequestId('person-voice')")
    expect(source).toContain('requestId: personVoiceRequestId')
    expect(source).toContain('reconcileCanonicalMessage(current, audioMessageId, canonicalVoiceMessage)')
    expect(source).toContain('reconcileCanonicalMessage(current, temporaryId, assistMessage)')
  })
})
