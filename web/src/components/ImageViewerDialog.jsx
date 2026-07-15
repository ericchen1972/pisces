import Dialog from './Dialog.jsx'

export default function ImageViewerDialog({ open, src, locale = 'en', onClose }) {
  const zh = locale === 'zh-TW'
  return (
    <Dialog open={open} title={zh ? '圖片預覽' : 'Image preview'} onClose={onClose} className="image-viewer-dialog" closeLabel={zh ? '關閉圖片預覽' : 'Close image preview'}>
      {src ? <img className="image-viewer-dialog__image" src={src} alt={zh ? '訊息圖片預覽' : 'Message image preview'} /> : null}
    </Dialog>
  )
}
