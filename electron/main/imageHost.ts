/**
 * Image host (X-06): uploads a local image to a user configured multipart
 * endpoint and returns the URL of the uploaded image.
 *
 * The endpoint is generic: any service that accepts a multipart form field
 * and answers with JSON works (PicGo, sm.ms, custom backends, ...).
 */
import fs from 'node:fs'
import path from 'node:path'
import type { AppSettings } from '../../shared/types'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml'
}

/** Reads a dotted path ("data.url", "data.0.url") out of a JSON value. */
export function pickByPath(value: unknown, pathExpr: string): string | null {
  if (!pathExpr) return null
  let current: unknown = value
  for (const part of pathExpr.split('.')) {
    if (current === null || current === undefined) return null
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index)) return null
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === 'string' ? current : null
}

function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim()
    if (key) headers[key] = value
  }
  return headers
}

/** Uploads an image and returns its URL, or null when the upload failed. */
export async function uploadImage(filePath: string, settings: AppSettings): Promise<string | null> {
  const config = settings.imageHost
  if (!config?.enabled || !config.url) return null
  try {
    const bytes = fs.readFileSync(filePath)
    const name = path.basename(filePath)
    const type = MIME_BY_EXT[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
    const form = new FormData()
    form.append(config.field || 'file', new Blob([bytes], { type }), name)

    const res = await fetch(config.url, {
      method: 'POST',
      body: form,
      headers: parseHeaders(config.headers)
    })
    if (!res.ok) return null
    const text = await res.text()
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (json === undefined) {
      // Some services answer with the URL as plain text.
      const trimmed = text.trim()
      return /^https?:\/\//i.test(trimmed) ? trimmed : null
    }
    const url = pickByPath(json, config.responsePath || 'url')
    if (!url || !/^https?:\/\//i.test(url)) return null
    return url
  } catch {
    return null
  }
}
