/**
 * Custom `mdimg://` scheme: serves local image files to the renderer so that
 * relative markdown image paths resolve against the *document's* directory
 * (not the app URL), without granting the renderer arbitrary file access.
 * Only a whitelist of image extensions is served.
 *
 * URI shape: mdimg://local/<percent-encoded absolute posix path>
 */
import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const IMAGE_SCHEME = 'mdimg'

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

const ALLOWED = new Set(Object.keys(MIME))

function notFound(): Response {
  return new Response('Not Found', { status: 404 })
}

/** Must be called before app `ready`. */
export function registerImageScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: IMAGE_SCHEME,
      privileges: {
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false
      }
    }
  ])
}

/** Must be called after app `ready`. */
export function registerImageHandler(): void {
  protocol.handle(IMAGE_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return notFound()
      const decoded = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const abs = path.normalize(decoded)
      if (!path.isAbsolute(abs)) return notFound()
      const ext = path.extname(abs).toLowerCase()
      if (!ALLOWED.has(ext)) return notFound()
      const st = fs.statSync(abs)
      if (!st.isFile()) return notFound()
      const data = fs.readFileSync(abs)
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' }
      })
    } catch {
      return notFound()
    }
  })
}
