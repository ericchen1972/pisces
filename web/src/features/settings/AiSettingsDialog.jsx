import { useCallback, useEffect, useRef, useState } from 'react'
import Dialog from '../../components/Dialog.jsx'
import { PlayIcon } from '../../components/icons.jsx'

export const OPENAI_VOICE_OPTIONS = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
export const VOICE_PREVIEW_TEXT = { en: 'Hello, I am your Convia AI voice.', 'zh-TW': '你好，我是 Convia 的 AI 語音。' }

export default function AiSettingsDialog({ open, ownerKey = '', locale = 'en', form, error, saving, uploading, preparingAvatar = false, avatarInputRef, onFormChange, onAvatarPick, onSave, onClose, apiBaseUrl = '', fetchImpl = fetch, audioFactory = (src) => new Audio(src) }) {
  const zh = locale === 'zh-TW'
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const generationRef = useRef(0)
  const ownerKeyRef = useRef(ownerKey)
  const controllerRef = useRef(null)
  const audioRef = useRef(null)
  const audioCleanupRef = useRef(null)

  const releaseAudio = useCallback(() => {
    audioCleanupRef.current?.()
    audioCleanupRef.current = null
    const audio = audioRef.current
    audioRef.current = null
    if (!audio) return
    audio.pause?.()
    audio.removeAttribute?.('src')
    audio.load?.()
  }, [])

  const stopPreview = useCallback(() => {
    generationRef.current += 1
    controllerRef.current?.abort()
    controllerRef.current = null
    releaseAudio()
    setPreviewing(false)
  }, [releaseAudio])

  useEffect(() => {
    const ownerChanged = ownerKeyRef.current !== ownerKey
    ownerKeyRef.current = ownerKey
    if (!open || ownerChanged) {
      stopPreview()
      setPreviewError('')
    }
  }, [open, ownerKey, stopPreview])

  useEffect(() => () => stopPreview(), [stopPreview])
  if (!form) return null
  const locked = Boolean(saving || uploading)
  const busy = Boolean(locked || preparingAvatar)
  const update = (key) => (event) => onFormChange({ ...form, [key]: event.target.value })
  const preview = async () => {
    stopPreview()
    const generation = generationRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setPreviewing(true)
    setPreviewError('')
    try {
      const response = await fetchImpl(`${apiBaseUrl}/api/speech/synthesize`, { method: 'POST', credentials: 'include', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: VOICE_PREVIEW_TEXT[zh ? 'zh-TW' : 'en'], voice: form.openaiVoice, instructions: 'Warm, natural, conversational delivery.' }) })
      const data = await response.json()
      if (!response.ok || !data.ok) throw new Error(data.error || `Preview failed (HTTP ${response.status})`)
      if (generation !== generationRef.current || controller.signal.aborted) return
      const audio = audioFactory(`data:${data.audio_mime_type || 'audio/wav'};base64,${data.audio_base64}`)
      audioRef.current = audio
      const finish = (event) => {
        if (generation !== generationRef.current) return
        if (event?.type === 'error') setPreviewError(zh ? '無法播放語音預覽。' : 'Unable to play voice preview.')
        releaseAudio()
        controllerRef.current = null
        setPreviewing(false)
      }
      audio.addEventListener?.('ended', finish)
      audio.addEventListener?.('error', finish)
      audioCleanupRef.current = () => {
        audio.removeEventListener?.('ended', finish)
        audio.removeEventListener?.('error', finish)
      }
      await audio.play()
    } catch (previewFailure) {
      if (generation !== generationRef.current || controller.signal.aborted) return
      setPreviewError(zh ? '無法預覽語音。' : (previewFailure?.message || 'Unable to preview voice.'))
      releaseAudio()
      controllerRef.current = null
      setPreviewing(false)
    }
  }
  return (
    <Dialog open={open} title={zh ? 'Convia AI 設定' : 'Convia AI settings'} onClose={locked ? undefined : onClose} closeOnBackdrop={!locked} showCloseButton={!locked} closeLabel={zh ? '關閉 AI 設定' : 'Close AI settings'}>
      <div className="form-stack">
        <div className="profile-editor">
          <button type="button" className="avatar-picker" onClick={() => avatarInputRef?.current?.click()} disabled={busy} aria-label={zh ? '更換 AI 頭像' : 'Replace AI avatar'}><img src={form.avatar} alt={zh ? 'Convia AI 頭像' : 'Convia AI avatar'} /></button>
          <label><span>{zh ? '名稱' : 'Name'}</span><input disabled={busy} minLength="2" value={form.alias || ''} onChange={update('alias')} /></label>
        </div>
        <label><span>{zh ? '語音' : 'Voice'}</span><select disabled={busy} value={form.openaiVoice} onChange={update('openaiVoice')}>{OPENAI_VOICE_OPTIONS.map((voice) => <option key={voice} value={voice}>{voice[0].toUpperCase() + voice.slice(1)}</option>)}</select></label>
        <div className="voice-preview-row"><p><strong>{zh ? 'AI 生成語音' : 'AI-generated voice'}</strong><br />{zh ? '你聽到的語音由 OpenAI 人工智慧產生，不是真人錄音。' : 'The voice you hear is generated by OpenAI and is not a human recording.'}</p><button type="button" onClick={preview} disabled={previewing || busy}><PlayIcon size={17} />{previewing ? (zh ? '播放中…' : 'Previewing…') : (zh ? '預覽語音' : 'Preview voice')}</button></div>
        {previewError ? <p className="form-error" role="alert">{previewError}</p> : null}
        <label><span>{zh ? '全域提示' : 'Global prompt'}</span><textarea disabled={busy} rows="5" value={form.globalPrompt || ''} onChange={update('globalPrompt')} /></label>
        <input ref={avatarInputRef} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={onAvatarPick} data-avatar-file />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={locked} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-button" disabled={busy} onClick={onSave}>{preparingAvatar ? (zh ? '處理頭像中…' : 'Preparing avatar…') : saving || uploading ? (zh ? '儲存中…' : 'Saving…') : (zh ? '儲存' : 'Save')}</button></div>
      </div>
    </Dialog>
  )
}
