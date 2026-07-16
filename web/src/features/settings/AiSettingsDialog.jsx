import { useEffect } from 'react'
import Dialog from '../../components/Dialog.jsx'

export const OPENAI_VOICE_OPTIONS = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
export const VOICE_PREVIEW_TEXT = { en: 'Hello, I am Convia.', 'zh-TW': '你好，我是 Convia。' }

export default function AiSettingsDialog({ open, locale = 'en', form, error, saving, uploading, preparingAvatar = false, avatarInputRef, onFormChange, onAvatarPick, onSave, onClose }) {
  const zh = locale === 'zh-TW'
  useEffect(() => {
    if (!open || !form || form.alias === 'Convia') return
    onFormChange?.({ ...form, alias: 'Convia' })
  }, [form, onFormChange, open])

  if (!form) return null
  const locked = Boolean(saving || uploading)
  const busy = Boolean(locked || preparingAvatar)
  const update = (key) => (event) => onFormChange({ ...form, [key]: event.target.value })
  return (
    <Dialog open={open} title={zh ? 'Convia 設定' : 'Convia settings'} onClose={locked ? undefined : onClose} closeOnBackdrop={!locked} showCloseButton={!locked} closeLabel={zh ? '關閉 Convia 設定' : 'Close Convia settings'}>
      <div className="form-stack">
        <div className="profile-editor profile-editor--ai">
          <button type="button" className="avatar-picker" onClick={() => avatarInputRef?.current?.click()} disabled={busy} aria-label={zh ? '更換 Convia 頭像' : 'Replace Convia avatar'}><img src={form.avatar} alt={zh ? 'Convia 頭像' : 'Convia avatar'} /></button>
          <strong>Convia</strong>
        </div>
        <label><span>{zh ? '全域提示' : 'Global prompt'}</span><textarea disabled={busy} rows="5" value={form.globalPrompt || ''} onChange={update('globalPrompt')} /></label>
        <input ref={avatarInputRef} disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" onChange={onAvatarPick} data-avatar-file />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={locked} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-button" disabled={busy} onClick={onSave}>{preparingAvatar ? (zh ? '處理頭像中…' : 'Preparing avatar…') : saving || uploading ? (zh ? '儲存中…' : 'Saving…') : (zh ? '儲存' : 'Save')}</button></div>
      </div>
    </Dialog>
  )
}
