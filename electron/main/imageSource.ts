/**
 * Image source helpers shared by the main-process image handlers.
 * Kept free of Electron imports so they can be unit-tested directly.
 */
import path from 'node:path'

export const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
}

/** Extensions offered by the image picker / save dialog. */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']

export function isRemoteImageSource(source: string): boolean {
  return /^https?:\/\//i.test(source)
}

/** Detect a common image MIME type from its magic bytes. */
export function sniffImageMime(bytes: Uint8Array): string {
  const ascii = (start: number, end: number): string =>
    String.fromCharCode(...bytes.subarray(start, Math.min(end, bytes.length)))
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 && ascii(0, 3) === 'GIF') return 'image/gif'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (bytes.length >= 2 && ascii(0, 2) === 'BM') return 'image/bmp'
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && /avi[fs]/.test(ascii(8, 12))) {
    return 'image/avif'
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(256, bytes.length))).trim()
  const lower = head.toLowerCase()
  if (lower.startsWith('<svg') || (lower.startsWith('<?xml') && lower.includes('<svg'))) {
    return 'image/svg+xml'
  }
  return ''
}

/** MIME type for a file extension (with or without the leading dot). */
export function mimeFromExtension(ext: string): string {
  const lower = ext.toLowerCase()
  const dotted = lower.startsWith('.') ? lower : `.${lower}`
  for (const [mime, candidate] of Object.entries(MIME_EXT)) {
    if (candidate === dotted) return mime
  }
  return ''
}

/**
 * Ensure a save-dialog file name has an extension. When the source name has
 * none, derive it from the response content type (falling back to `.png`).
 */
export function imageFileName(name: string, contentType: string): string {
  const base = name.trim() || 'image'
  if (path.extname(base)) return base
  const mime = contentType.split(';')[0].trim().toLowerCase()
  return `${base}${MIME_EXT[mime] ?? '.png'}`
}
