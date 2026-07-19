import { useEffect, useMemo, useState } from 'react'
import Dialog from '../../components/Dialog.jsx'
import { ArrowDownIcon, ArrowUpIcon, EditIcon, TrashIcon } from '../../components/icons.jsx'
import { normalizeGroupName } from '../../lib/chatState.js'

const COPY = {
  en: {
    title: 'Manage groups', newName: 'New group name', create: 'Create group', duplicate: 'A group with this name already exists.', required: 'Enter a group name.', rename: 'Rename', groupName: 'Group name', save: 'Save group name', cancel: 'Cancel', up: 'Move up', down: 'Move down', remove: 'Delete', moveTo: 'Move contacts to', choose: 'Choose a group', deleteGroup: 'Delete group', deleting: 'Deleting…', saving: 'Saving…', unable: 'Unable to save groups.',
  },
  'zh-TW': {
    title: '管理群組', newName: '新群組名稱', create: '建立群組', duplicate: '已有相同名稱的群組。', required: '請輸入群組名稱。', rename: '重新命名', groupName: '群組名稱', save: '儲存群組名稱', cancel: '取消', up: '向上移動', down: '向下移動', remove: '刪除', moveTo: '將聯絡人移至', choose: '選擇群組', deleteGroup: '刪除群組', deleting: '刪除中…', saving: '儲存中…', unable: '無法儲存群組。',
  },
}

export function GroupManagerPanel({ active = true, locale = 'en', groups = [], onCreate, onRename, onReorder, onDelete, onRefresh, onBusyChange }) {
  const copy = COPY[locale] || COPY.en
  const ordered = useMemo(() => [...groups].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)), [groups])
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [deleteId, setDeleteId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!active) return
    setNewName('')
    setEditingId('')
    setRenameValue('')
    setDeleteId('')
    setDestinationId('')
    setError('')
  }, [active])

  const duplicate = (value, ignoredId = '') => {
    const normalized = normalizeGroupName(value)
    return Boolean(normalized && ordered.some((group) => group.id !== ignoredId && normalizeGroupName(group.name) === normalized))
  }

  const run = async (operation) => {
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    try {
      const authoritativeGroups = await operation()
      if (Array.isArray(authoritativeGroups)) onRefresh?.(authoritativeGroups)
      return true
    } catch (caught) {
      setError(locale === 'zh-TW' ? copy.unable : (caught?.message || copy.unable))
      return false
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  const createError = newName.trim() ? (duplicate(newName) ? copy.duplicate : '') : ''
  const renameError = renameValue.trim() ? (duplicate(renameValue, editingId) ? copy.duplicate : '') : ''
  const deleteGroup = ordered.find((group) => group.id === deleteId)

  return (
    <>
      <form className="group-create" onSubmit={async (event) => {
        event.preventDefault()
        if (!newName.trim() || createError || busy) return
        if (await run(() => onCreate(newName.trim()))) setNewName('')
      }}>
        <label><span>{copy.newName}</span><input data-autofocus aria-label={copy.newName} value={newName} onChange={(event) => setNewName(event.target.value)} /></label>
        {createError ? <p className="form-error" role="alert">{createError}</p> : null}
        <button type="submit" className="primary-button" disabled={!newName.trim() || Boolean(createError) || busy}>{busy ? copy.saving : copy.create}</button>
      </form>

      <div className="group-manager-list">
        {ordered.map((group, index) => (
          <div className="group-manager-row" key={group.id}>
            {editingId === group.id ? (
              <form className="group-rename" onSubmit={async (event) => {
                event.preventDefault()
                if (!renameValue.trim() || renameError || busy) return
                if (await run(() => onRename(group.id, renameValue.trim()))) setEditingId('')
              }}>
                <label className="sr-only" htmlFor={`rename-${group.id}`}>{copy.groupName}</label>
                <input id={`rename-${group.id}`} aria-label={copy.groupName} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                {renameError ? <p className="form-error" role="alert">{renameError}</p> : null}
                <button type="submit" disabled={!renameValue.trim() || Boolean(renameError) || busy}>{copy.save}</button>
                <button type="button" onClick={() => setEditingId('')}>{copy.cancel}</button>
              </form>
            ) : (
              <>
                <strong className="group-manager-row__name">{group.name}</strong>
                <span className="group-manager-row__actions">
                  <button type="button" className="icon-button" aria-label={`${copy.rename} ${group.name}`} onClick={() => { setEditingId(group.id); setRenameValue(group.name); setDeleteId('') }}><EditIcon size={17} /></button>
                  <button type="button" className="icon-button" aria-label={locale === 'zh-TW' ? `${copy.up} ${group.name}` : `Move ${group.name} up`} disabled={index === 0 || busy} onClick={() => { const ids = ordered.map((item) => item.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; run(() => onReorder(ids)) }}><ArrowUpIcon size={17} /></button>
                  <button type="button" className="icon-button" aria-label={locale === 'zh-TW' ? `${copy.down} ${group.name}` : `Move ${group.name} down`} disabled={index === ordered.length - 1 || busy} onClick={() => { const ids = ordered.map((item) => item.id); [ids[index + 1], ids[index]] = [ids[index], ids[index + 1]]; run(() => onReorder(ids)) }}><ArrowDownIcon size={17} /></button>
                  <button type="button" className="icon-button icon-button--danger" aria-label={`${copy.remove} ${group.name}`} disabled={ordered.length < 2 || busy} onClick={() => { setDeleteId(group.id); setDestinationId(''); setEditingId('') }}><TrashIcon size={17} /></button>
                </span>
              </>
            )}
          </div>
        ))}
      </div>

      {deleteGroup ? (
        <section className="delete-group-panel" aria-label={locale === 'zh-TW' ? `刪除 ${deleteGroup.name}` : `Delete ${deleteGroup.name}`}>
          <p>{locale === 'zh-TW' ? `刪除「${deleteGroup.name}」前，請選擇聯絡人的移動群組。` : `Choose where contacts from “${deleteGroup.name}” should move.`}</p>
          <label><span>{copy.moveTo}</span><select aria-label={copy.moveTo} value={destinationId} onChange={(event) => setDestinationId(event.target.value)}><option value="">{copy.choose}</option>{ordered.filter((group) => group.id !== deleteId).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <div className="dialog-actions"><button type="button" onClick={() => setDeleteId('')}>{copy.cancel}</button><button type="button" className="danger-button" disabled={!destinationId || busy} onClick={async () => { if (await run(() => onDelete(deleteId, destinationId))) { setDeleteId(''); setDestinationId('') } }}>{busy ? copy.deleting : copy.deleteGroup}</button></div>
        </section>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </>
  )
}

export default function GroupManagerDialog({ open, locale = 'en', groups = [], onClose, onCreate, onRename, onReorder, onDelete, onRefresh }) {
  const copy = COPY[locale] || COPY.en
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) setBusy(false)
  }, [open])

  return (
    <Dialog open={open} title={copy.title} onClose={busy ? undefined : onClose} closeOnBackdrop={!busy} closeLabel={locale === 'zh-TW' ? '關閉對話框' : 'Close dialog'} className="group-manager-dialog">
      <GroupManagerPanel
        active={open}
        locale={locale}
        groups={groups}
        onCreate={onCreate}
        onRename={onRename}
        onReorder={onReorder}
        onDelete={onDelete}
        onRefresh={onRefresh}
        onBusyChange={setBusy}
      />
    </Dialog>
  )
}
