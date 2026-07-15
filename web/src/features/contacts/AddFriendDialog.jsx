import Dialog from '../../components/Dialog.jsx'

export default function AddFriendDialog({ open, locale = 'en', email, alias, verificationCode, error, success, submitting, onEmailChange, onAliasChange, onVerificationCodeChange, onSubmit, onClose }) {
  const zh = locale === 'zh-TW'
  return (
    <Dialog open={open} title={zh ? '新增好友' : 'Add friend'} onClose={submitting ? undefined : onClose} closeOnBackdrop={!submitting} closeLabel={zh ? '關閉新增好友' : 'Close add friend'}>
      <form className="form-stack" onSubmit={onSubmit}>
        <label><span>{zh ? 'Google 帳號' : 'Google account'}</span><input type="email" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="friend@gmail.com" /></label>
        <label><span>{zh ? '名稱' : 'Name'}</span><input required minLength="2" value={alias} onChange={(event) => onAliasChange(event.target.value)} placeholder={zh ? '聯絡人名稱' : 'Contact name'} /></label>
        <label><span>{zh ? '好友驗證碼' : 'Friend verification code'}</span><input value={verificationCode} onChange={(event) => onVerificationCodeChange(event.target.value)} placeholder={zh ? '選填' : 'Optional'} /></label>
        <p className="form-help">{zh ? '若對方設定了驗證碼，請在此輸入。' : 'Enter this only when the other person requires a verification code.'}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {success ? <p className="form-success" role="status">{success}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={submitting} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? (zh ? '檢查中…' : 'Checking…') : (zh ? '送出' : 'Submit')}</button></div>
      </form>
    </Dialog>
  )
}
