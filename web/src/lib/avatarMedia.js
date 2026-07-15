export const MAX_AVATAR_INPUT_BYTES = 5 * 1024 * 1024
export const MAX_AVATAR_EDGE = 8192
export const MAX_AVATAR_PIXELS = 40_000_000
const SUPPORTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export class AvatarMediaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'AvatarMediaError'
    this.code = code
  }
}

const mediaError = (code, message) => new AvatarMediaError(code, message)

const AVATAR_ERROR_COPY = {
  unsupported_type: { en: 'Only jpg, png, and webp files are supported.', 'zh-TW': '僅支援 jpg、png 與 webp 圖片。' },
  empty: { en: 'Avatar image is empty.', 'zh-TW': '頭像圖片是空的。' },
  too_large: { en: 'Avatar image must be 5 MiB or smaller.', 'zh-TW': '頭像圖片必須小於或等於 5 MiB。' },
  dimensions: { en: 'Avatar image dimensions are unsupported.', 'zh-TW': '頭像圖片尺寸不受支援。' },
  invalid_image: { en: 'Unable to inspect avatar image dimensions.', 'zh-TW': '無法讀取頭像圖片尺寸。' },
}

export function avatarProcessingErrorMessage(error, locale = 'en') {
  const language = locale === 'zh-TW' ? 'zh-TW' : 'en'
  const known = AVATAR_ERROR_COPY[error?.code]?.[language]
  if (known) return known
  if (language === 'zh-TW') return '頭像處理失敗。'
  return error?.message || 'Avatar upload failed.'
}

export function createAvatarPreviewOwner(revoke = (url) => URL.revokeObjectURL(url)) {
  let generation = 0
  let currentUrl = ''
  const invalidate = () => {
    generation += 1
    if (currentUrl) revoke(currentUrl)
    currentUrl = ''
  }
  return {
    begin() {
      generation += 1
      return generation
    },
    isCurrent(token) {
      return token === generation
    },
    publish(token, url) {
      if (token !== generation) {
        if (url) revoke(url)
        return false
      }
      if (currentUrl && currentUrl !== url) revoke(currentUrl)
      currentUrl = url || ''
      return true
    },
    invalidate,
  }
}

export function validateAvatarFile(file) {
  if (!file || !SUPPORTED_TYPES.has(file.type)) throw mediaError('unsupported_type', 'Only jpg, png, and webp files are supported.')
  if (!Number.isFinite(file.size) || file.size <= 0) throw mediaError('empty', 'Avatar image is empty.')
  if (file.size > MAX_AVATAR_INPUT_BYTES) throw mediaError('too_large', 'Avatar image must be 5 MiB or smaller.')
}

export function validateAvatarDimensions(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_AVATAR_EDGE || height > MAX_AVATAR_EDGE || width * height > MAX_AVATAR_PIXELS) {
    throw mediaError('dimensions', 'Avatar image dimensions are unsupported.')
  }
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function parseJpegDimensions(bytes, view) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let offset = 2
  while (offset + 8 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (startOfFrame.has(marker)) {
      return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) }
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) break
    const segmentLength = view.getUint16(offset)
    if (segmentLength < 2) break
    offset += segmentLength
  }
  return null
}

function parseWebpDimensions(bytes, view) {
  if (ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WEBP') return null
  const chunk = ascii(bytes, 12, 4)
  if (chunk === 'VP8X' && bytes.length >= 30) {
    const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16)
    const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16)
    return { width, height }
  }
  if (chunk === 'VP8 ' && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const b1 = bytes[21]
    const b2 = bytes[22]
    const b3 = bytes[23]
    const b4 = bytes[24]
    return {
      width: 1 + b1 + ((b2 & 0x3f) << 8),
      height: 1 + (b2 >> 6) + (b3 << 2) + ((b4 & 0x0f) << 10),
    }
  }
  return null
}

export async function inspectAvatarDimensions(file) {
  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(mediaError('invalid_image', 'Unable to inspect avatar image dimensions.'))
        reader.readAsArrayBuffer(file)
      })
  const bytes = new Uint8Array(buffer)
  const view = new DataView(buffer)
  let dimensions = null
  if (file.type === 'image/png' && bytes.length >= 24 && ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n' && ascii(bytes, 12, 4) === 'IHDR') {
    dimensions = { width: view.getUint32(16), height: view.getUint32(20) }
  } else if (file.type === 'image/jpeg') {
    dimensions = parseJpegDimensions(bytes, view)
  } else if (file.type === 'image/webp') {
    dimensions = parseWebpDimensions(bytes, view)
  }
  if (!dimensions) throw mediaError('invalid_image', 'Unable to inspect avatar image dimensions.')
  return dimensions
}

export async function prepareAvatarPreview({ file, decode, normalize }) {
  validateAvatarFile(file)
  const headerDimensions = await inspectAvatarDimensions(file)
  validateAvatarDimensions(headerDimensions.width, headerDimensions.height)
  const decoded = await decode(file)
  validateAvatarDimensions(decoded?.width, decoded?.height)
  return normalize(decoded)
}
