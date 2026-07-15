export default function ConversationEmptyState({ locale = 'en' }) {
  return (
    <section className="conversation-empty" aria-live="polite">
      <div className="conversation-empty__mark" aria-hidden="true">C</div>
      <p>{locale === 'zh-TW' ? '選擇一個對話即可開始傳訊' : 'Select a conversation to start messaging'}</p>
    </section>
  )
}
