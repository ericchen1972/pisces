export function resetAccountScopedRefs({
  restoredSelectedContactIdRef,
  phoneLiveContextRef,
  liveAboutFriendInjectedRef,
  liveAboutFriendPendingRef,
} = {}) {
  if (restoredSelectedContactIdRef) restoredSelectedContactIdRef.current = null
  if (phoneLiveContextRef) phoneLiveContextRef.current = ''
  liveAboutFriendInjectedRef?.current?.clear?.()
  liveAboutFriendPendingRef?.current?.clear?.()
}

export function stopActiveRecordingResources({
  mediaRecorderRef,
  mediaStreamRef,
  recordChunksRef,
  clearTimers,
} = {}) {
  const recorder = mediaRecorderRef?.current
  if (mediaRecorderRef) mediaRecorderRef.current = null
  if (recorder) {
    recorder.ondataavailable = null
    recorder.onstop = null
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // ignore recorder teardown errors
      }
    }
  }

  const stream = mediaStreamRef?.current
  if (mediaStreamRef) mediaStreamRef.current = null
  stream?.getTracks?.().forEach((track) => track.stop())
  if (recordChunksRef) recordChunksRef.current = []
  clearTimers?.()
}
