import { useEffect, useLayoutEffect, useRef } from 'react'
import ConversationHeader from './ConversationHeader.jsx'
import MessageRow from './MessageRow.jsx'

export default function Conversation({ contact, messages = [], locale = 'en', loading = false, onBack, onCall, aiAssistMode, onAssistCall, onImageClick, renderAudio, composer }) {
  const scrollRef = useRef(null)
  const contentRef = useRef(null)
  const nearBottomRef = useRef(true)

  const scrollToBottom = () => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }

  useLayoutEffect(() => {
    nearBottomRef.current = true
    scrollToBottom()
  }, [contact?.id])

  useEffect(() => {
    if (!nearBottomRef.current) return
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (typeof ResizeObserver !== 'function' || !contentRef.current) return undefined
    const observer = new ResizeObserver(() => {
      if (nearBottomRef.current) scrollToBottom()
    })
    observer.observe(contentRef.current)
    return () => observer.disconnect()
  }, [contact?.id])

  return (
    <section className="conversation">
      <ConversationHeader contact={contact} locale={locale} onBack={onBack} onCall={onCall} aiAssistMode={aiAssistMode} onAssistCall={onAssistCall} />
      <div
        ref={scrollRef}
        data-testid="conversation-messages"
        className="conversation__messages"
        onLoadCapture={() => {
          if (nearBottomRef.current) scrollToBottom()
        }}
        onLoadedMetadataCapture={() => {
          if (nearBottomRef.current) scrollToBottom()
        }}
        onScroll={(event) => {
          const node = event.currentTarget
          nearBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96
        }}
      >
        <div ref={contentRef} className="conversation__content">
          {loading ? <div className="conversation__loading">{locale === 'zh-TW' ? '正在載入訊息…' : 'Loading messages…'}</div> : null}
          {messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              locale={locale}
              onImageClick={onImageClick}
              renderAudio={renderAudio}
            />
          ))}
          <div className="conversation__bottom-sentinel" aria-hidden="true" />
        </div>
      </div>
      <div className="conversation__composer">{composer}</div>
    </section>
  )
}
