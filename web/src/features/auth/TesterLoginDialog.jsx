import Dialog from '../../components/Dialog.jsx'

export default function TesterLoginDialog({ open, locale = 'en', email, avatarUrl, error, submitting, onEmailChange, onAvatarUrlChange, onSubmit, onClose }) {
  const zh = locale === 'zh-TW'
  return (
    <Dialog open={open} title={zh ? '測試帳號登入' : 'Tester login'} onClose={submitting ? undefined : onClose} closeOnBackdrop={!submitting} closeLabel={zh ? '關閉測試登入' : 'Close tester login'}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label><span>{zh ? 'Email' : 'Email'}</span><input type="email" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="tester@example.com" /></label>
        <label><span>{zh ? '頭像 URL' : 'Avatar URL'}</span><input type="url" value={avatarUrl} onChange={(event) => onAvatarUrlChange(event.target.value)} placeholder="https://…" /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={submitting} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? (zh ? '登入中…' : 'Signing in…') : (zh ? '登入' : 'Sign in')}</button></div>
      </form>
    </Dialog>
  )
}
