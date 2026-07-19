import { useEffect, useId, useState } from 'react'
import Dialog from '../../components/Dialog.jsx'
import { LogoutIcon } from '../../components/icons.jsx'
import { GroupManagerPanel } from '../groups/GroupManagerDialog.jsx'

export default function SettingsDialog({
  open,
  locale = 'en',
  identifyCode,
  historyRange,
  error,
  saving,
  groups = [],
  onIdentifyCodeChange,
  onHistoryRangeChange,
  onSubmit,
  onClose,
  onLogout,
  onCreateGroup,
  onRenameGroup,
  onReorderGroups,
  onDeleteGroup,
  onRefreshGroups,
}) {
  const zh = locale === 'zh-TW'
  const [activeTab, setActiveTab] = useState('basic')
  const basicPanelId = useId()
  const groupsPanelId = useId()
  const basicTabId = useId()
  const groupsTabId = useId()

  useEffect(() => {
    if (open) setActiveTab('basic')
  }, [open])

  const basicLabel = zh ? '基本設定' : 'Basic settings'
  const groupsLabel = zh ? '群組管理' : 'Manage groups'

  return (
    <Dialog open={open} title={zh ? '設定' : 'Settings'} onClose={saving ? undefined : onClose} closeOnBackdrop={!saving} closeLabel={zh ? '關閉設定' : 'Close settings'}>
      <div className="settings-tabs" role="tablist" aria-label={zh ? '設定分頁' : 'Settings sections'}>
        <button type="button" id={basicTabId} role="tab" aria-selected={activeTab === 'basic'} aria-controls={basicPanelId} onClick={() => setActiveTab('basic')}>{basicLabel}</button>
        <button type="button" id={groupsTabId} role="tab" aria-selected={activeTab === 'groups'} aria-controls={groupsPanelId} onClick={() => setActiveTab('groups')}>{groupsLabel}</button>
      </div>

      {activeTab === 'basic' ? (
        <section id={basicPanelId} role="tabpanel" aria-labelledby={basicTabId}>
          <form className="form-stack" onSubmit={onSubmit}>
            <label><span>{zh ? '聯絡人驗證碼' : 'Contact verification code'}</span><input value={identifyCode} onChange={(event) => onIdentifyCodeChange(event.target.value)} placeholder={zh ? '選填' : 'Optional'} /></label>
            <p className="form-help">{zh ? '設定後，其他人需要輸入此驗證碼才能新增你；留白則只需你的 Google 帳號。' : 'When set, people need this code to add you. Leave it blank to allow requests using your Google account.'}</p>
            <label><span>{zh ? '歷史範圍' : 'History range'}</span><input type="number" min="10" max="60" step="1" value={historyRange} onChange={(event) => onHistoryRangeChange(event.target.value)} /></label>
            <p className="form-help">{zh ? '控制 AI 在傳訊或提供建議時，可讀取的近期對話訊息數量。' : 'Controls how many recent messages AI may read when sending messages or offering advice.'}</p>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="dialog-actions"><button type="button" disabled={saving} onClick={onClose}>{zh ? '取消' : 'Cancel'}</button><button type="submit" className="primary-button" disabled={saving}>{saving ? (zh ? '儲存中…' : 'Saving…') : (zh ? '儲存' : 'Save')}</button></div>
            <button type="button" className="logout-button" disabled={saving} onClick={onLogout}><LogoutIcon size={18} />{zh ? '登出' : 'Log out'}</button>
          </form>
        </section>
      ) : (
        <section id={groupsPanelId} role="tabpanel" aria-labelledby={groupsTabId}>
          <GroupManagerPanel
            locale={locale}
            groups={groups}
            onCreate={onCreateGroup}
            onRename={onRenameGroup}
            onReorder={onReorderGroups}
            onDelete={onDeleteGroup}
            onRefresh={onRefreshGroups}
          />
        </section>
      )}
    </Dialog>
  )
}
