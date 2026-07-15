export async function requestFriendDeletion({ apiBaseUrl, contactId, signal, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBaseUrl}/api/friend/delete`, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_user_id: contactId }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) throw new Error(data.error || `Delete failed (HTTP ${response.status})`)
  return data
}
