import Dialog from '../../components/Dialog.jsx'

export default function EditContactDialog({ open, locale = 'en', form, error, busy = false, onFormChange, onSave, onClose }) {
  const zh = locale === 'zh-TW'
  if (!form) return null
  const update = (key) => (event) => onFormChange({ ...form, [key]: event.target.value })
  return (
    <Dialog open={open} title={zh ? '編輯聯絡人' : 'Edit contact'} onClose={busy ? undefined : onClose} closeOnBackdrop={!busy} showCloseButton={!busy} closeLabel={zh ? '關閉聯絡人編輯' : 'Close contact editor'}>
      <div className="form-stack">
        <div className="profile-editor"><img src={form.avatar} alt={zh ? `${form.alias} 的 Google 個人資料頭像` : `${form.alias} Google profile avatar`} /><span>{zh ? 'Google 個人資料頭像' : 'Google profile avatar'}</span></div>
        <label><span>{zh ? '名稱' : 'Name'}</span><input disabled={busy} minLength="2" value={form.alias || ''} onChange={update('alias')} /></label>
        <label><span>{zh ? '特殊提示' : 'Special prompt'}</span><textarea disabled={busy} rows="4" value={form.specialPrompt || ''} onChange={update('specialPrompt')} placeholder={zh ? 'AI 為你傳訊給這位聯絡人時優先使用。' : 'Used first when AI sends messages to this person for you.'} /></label>
        <label><span>{zh ? '關係' : 'Relationship'}</span><input disabled={busy} value={form.relationship || ''} onChange={update('relationship')} placeholder={zh ? '例如：朋友、主管' : 'For example: friend or manager'} /></label>
        <p className="form-help">{zh ? '關係標籤只供 AI 調整措辭，對方不會看到。' : 'This private label helps AI adjust wording; the other person never sees it.'}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="button" className="primary-button" disabled={busy} onClick={onSave}>{busy ? (zh ? '儲存中…' : 'Saving…') : (zh ? '儲存' : 'Save')}</button></div>
      </div>
    </Dialog>
  )
}
