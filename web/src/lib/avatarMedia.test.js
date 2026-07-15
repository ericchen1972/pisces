import { describe, expect, it, vi } from 'vitest'
import { avatarProcessingErrorMessage, createAvatarPreviewOwner, inspectAvatarDimensions, prepareAvatarPreview } from './avatarMedia.js'

function pngFile(width, height) {
  const bytes = new Uint8Array(24)
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
  bytes.set([73, 72, 68, 82], 12)
  new DataView(bytes.buffer).setUint32(16, width)
  new DataView(bytes.buffer).setUint32(20, height)
  return new File([bytes], 'avatar.png', { type: 'image/png' })
}

function webpFile(width, height) {
  const bytes = new Uint8Array(30)
  bytes.set([...'RIFF'].map((char) => char.charCodeAt(0)), 0)
  bytes.set([...'WEBPVP8X'].map((char) => char.charCodeAt(0)), 8)
  const view = new DataView(bytes.buffer)
  view.setUint32(4, 22, true)
  const w = width - 1
  const h = height - 1
  bytes.set([w & 255, (w >> 8) & 255, (w >> 16) & 255], 24)
  bytes.set([h & 255, (h >> 8) & 255, (h >> 16) & 255], 27)
  return new File([bytes], 'avatar.webp', { type: 'image/webp' })
}

describe('prepareAvatarPreview', () => {
  it('rejects files over 5 MiB before decoding', async () => {
    const decode = vi.fn()
    const file = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'huge.webp', { type: 'image/webp' })
    await expect(prepareAvatarPreview({ file, decode })).rejects.toThrow('5 MiB')
    expect(decode).not.toHaveBeenCalled()
  })

  it('accepts WebP and returns a normalized preview blob', async () => {
    const normalized = new Blob(['normalized'], { type: 'image/webp' })
    const decode = vi.fn().mockResolvedValue({ width: 640, height: 480, source: {} })
    const normalize = vi.fn().mockResolvedValue(normalized)
    const file = webpFile(640, 480)
    await expect(prepareAvatarPreview({ file, decode, normalize })).resolves.toBe(normalized)
    expect(decode).toHaveBeenCalledWith(file)
    expect(normalize).toHaveBeenCalledWith(expect.objectContaining({ width: 640, height: 480 }))
  })

  it('rejects unsafe decoded dimensions before normalization', async () => {
    const normalize = vi.fn()
    const file = webpFile(640, 480)
    await expect(prepareAvatarPreview({ file, decode: async () => ({ width: 20000, height: 100, source: {} }), normalize })).rejects.toThrow('dimensions')
    expect(normalize).not.toHaveBeenCalled()
  })

  it('rejects oversized header dimensions before browser image decode', async () => {
    const decode = vi.fn()
    await expect(prepareAvatarPreview({ file: pngFile(20000, 100), decode, normalize: vi.fn() })).rejects.toThrow('dimensions')
    expect(decode).not.toHaveBeenCalled()
  })

  it('inspects JPEG, PNG, and WebP dimensions from compressed headers', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03, 0x01, 0x11, 0x00])
    await expect(inspectAvatarDimensions(new File([jpeg], 'a.jpg', { type: 'image/jpeg' }))).resolves.toEqual({ width: 640, height: 480 })
    await expect(inspectAvatarDimensions(pngFile(320, 240))).resolves.toEqual({ width: 320, height: 240 })
    await expect(inspectAvatarDimensions(webpFile(800, 600))).resolves.toEqual({ width: 800, height: 600 })
  })

  it('revokes stale output when its dialog or account generation no longer owns it', () => {
    const revoke = vi.fn()
    const owner = createAvatarPreviewOwner(revoke)
    const accountA = owner.begin()
    owner.invalidate()
    expect(owner.publish(accountA, 'blob:stale')).toBe(false)
    expect(revoke).toHaveBeenCalledWith('blob:stale')

    const accountB = owner.begin()
    expect(owner.publish(accountB, 'blob:current')).toBe(true)
    owner.invalidate()
    expect(revoke).toHaveBeenCalledWith('blob:current')
  })

  it('keeps the current valid preview while a replacement is still being validated', () => {
    const revoke = vi.fn()
    const owner = createAvatarPreviewOwner(revoke)
    const first = owner.begin()
    expect(owner.publish(first, 'blob:valid')).toBe(true)
    owner.begin()
    expect(revoke).not.toHaveBeenCalledWith('blob:valid')
    owner.invalidate()
    expect(revoke).toHaveBeenCalledWith('blob:valid')
  })

  it('never exposes raw English processing errors in Traditional Chinese', () => {
    expect(avatarProcessingErrorMessage({ code: 'too_large' }, 'zh-TW')).toContain('5 MiB')
    expect(avatarProcessingErrorMessage(new Error('Canvas context is not available.'), 'zh-TW')).toBe('頭像處理失敗。')
    expect(avatarProcessingErrorMessage(new Error('Canvas context is not available.'), 'en')).toBe('Canvas context is not available.')
  })
})
