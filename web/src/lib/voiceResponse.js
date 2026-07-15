export function requireSuccessfulVoiceResponse(response, data) {
  if (!response?.ok) throw new Error(data?.error || `Request failed (${response?.status || 0})`)
  return data
}
