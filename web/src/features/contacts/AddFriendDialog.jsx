import { useState } from 'react'
import Dialog from '../../components/Dialog.jsx'

export default function AddFriendDialog({ open, locale = 'en', email, alias, groupId = '', groups = [], verificationCode, error, success, submitting, onEmailChange, onAliasChange, onGroupChange, onVerificationCodeChange, onSubmit, onClose }) {
  const zh = locale === 'zh-TW'
  const [groupError, setGroupError] = useState('')
  const submit = (event) => {
    if (!groupId) {
      event.preventDefault()
      setGroupError(zh ? '請選擇群組。' : 'Please select a group.')
      return
    }
    setGroupError('')
    onSubmit(event)
  }
  return (
    <Dialog open={open} title={zh ? '新增聯絡人' : 'Add contact'} onClose={submitting ? undefined : onClose} closeOnBackdrop={!submitting} closeLabel={zh ? '關閉新增聯絡人' : 'Close add contact'}>
      <form className="form-stack" noValidate onSubmit={submit}>
        <label><span>{zh ? 'Google 帳號' : 'Google account'}</span><input type="email" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="friend@gmail.com" /></label>
        <label><span>{zh ? '名稱' : 'Name'}</span><input required minLength="2" value={alias} onChange={(event) => onAliasChange(event.target.value)} placeholder={zh ? '聯絡人名稱' : 'Contact name'} /></label>
        <label>
          <span>{zh ? '群組' : 'Group'}</span>
          <select required value={groupId} onChange={(event) => { setGroupError(''); onGroupChange?.(event.target.value) }}>
            <option value="">{zh ? '選擇群組' : 'Select group'}</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </select>
        </label>
        {groupError ? <p className="form-error" role="alert">{groupError}</p> : null}
        <label><span>{zh ? '聯絡人驗證碼' : 'Contact verification code'}</span><input value={verificationCode} onChange={(event) => onVerificationCodeChange(event.target.value)} placeholder={zh ? '選填' : 'Optional'} /></label>
        <p className="form-help">{zh ? '若對方設定了驗證碼，請在此輸入。' : 'Enter this only when the other person requires a verification code.'}</p>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {success ? <p className="form-success" role="status">{success}</p> : null}
        <div className="dialog-actions"><button type="button" disabled={submitting} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? (zh ? '加入中…' : 'Adding…') : (zh ? '加入' : 'Add')}</button></div>
      </form>
    </Dialog>
  )
}
