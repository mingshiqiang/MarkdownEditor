/**
 * Image insertion via paste & drop (E-09).
 * - Paste a screenshot / copied image -> buffer upload through main
 *   (stored per the configured mode: ./assets | global dir).
 * - Drop/paste a real file -> keep original path per mode 'none', otherwise
 *   copy into the store dir with collision-safe naming.
 * - Pasting a URL over selected text auto-wraps it as a link (E-16).
 */
import { EditorView } from '@codemirror/view'
import type { DOMEventHandlers } from '@codemirror/view'
import { textToTable } from '../tables'

export type ImageInsertSource =
  | { kind: 'buffer'; bytes: ArrayBuffer; mime: string; name: string }
  | { kind: 'file'; absPath: string }

let insertFn: ((view: EditorView, source: ImageInsertSource) => Promise<void>) | null = null
let downloadFn: ((url: string) => Promise<string | null>) | null = null

export function setImageInsertFn(
  fn: (view: EditorView, source: ImageInsertSource) => Promise<void>
): void {
  insertFn = fn
}

/** Download a remote image and return the local markdown path (E-09). */
export function setDownloadImageFn(fn: (url: string) => Promise<string | null>): void {
  downloadFn = fn
}

export async function downloadRemoteImage(url: string): Promise<string | null> {
  return downloadFn?.(url) ?? null
}

export async function insertImageAtCursor(
  view: EditorView,
  source: ImageInsertSource
): Promise<void> {
  await insertFn?.(view, source)
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i
const URL_RE = /^(https?:\/\/|www\.)\S+$/i

function isImageFile(f: File): boolean {
  return f.type.startsWith('image/') || IMAGE_EXT.test(f.name)
}

async function insertFileImage(view: EditorView, file: File): Promise<void> {
  const abs = window.api.pathForFile(file)
  if (abs) {
    await insertImageAtCursor(view, { kind: 'file', absPath: abs })
    return
  }
  // In-memory blob (screenshot etc.)
  const bytes = await file.arrayBuffer()
  await insertImageAtCursor(view, {
    kind: 'buffer',
    bytes,
    mime: file.type || 'image/png',
    name: file.name || ''
  })
}

/**
 * Insert pasted text with the editor's special cases: tab-separated text
 * becomes a table and a URL pasted over a selection becomes a link.
 * Returns false when the caller should insert the text normally.
 */
export function insertPastedText(view: EditorView, raw: string): boolean {
  const text = raw.replace(/\r\n?/g, '\n')
  if (!text) return false

  if (text.includes('\t')) {
    const table = textToTable(text)
    if (table) {
      const { from, to } = view.state.selection.main
      const insert = view.state.sliceDoc(from, to) ? `\n\n${table}\n\n` : `${table}\n`
      view.dispatch({
        changes: { from, to, insert },
        userEvent: 'input.paste.table'
      })
      return true
    }
  }

  if (URL_RE.test(text.trim())) {
    const url = text.trim()
    const { from, to, empty } = view.state.selection.main
    if (!empty) {
      const label = view.state.sliceDoc(from, to)
      view.dispatch({
        changes: { from, to, insert: `[${label}](${url})` },
        userEvent: 'input.paste.link'
      })
      return true
    }
  }

  return false
}

export const editorDomHandlers: DOMEventHandlers<unknown> = {
  paste(event, view) {
    const dt = event.clipboardData
    if (!dt) return false

    // 1. Image(s) from clipboard (screenshot or copied image file)
    const fromItems: File[] = []
    for (const item of Array.from(dt.items ?? [])) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const f = item.getAsFile()
        if (f) fromItems.push(f)
      }
    }
    const fromFiles = Array.from(dt.files ?? []).filter(isImageFile)
    const images = fromItems.length ? fromItems : fromFiles
    if (images.length > 0) {
      event.preventDefault()
      for (const img of images) void insertFileImage(view, img)
      return true
    }

    // 2./3. Spreadsheet table or URL-over-selection handling.
    const text = dt.getData('text/plain')
    if (text && insertPastedText(view, text)) {
      event.preventDefault()
      return true
    }

    return false
  },

  drop(event, view) {
    const files = Array.from(event.dataTransfer?.files ?? [])
    const images = files.filter(isImageFile)
    if (images.length === 0) return false
    event.preventDefault()
    for (const img of images) void insertFileImage(view, img)
    return true
  }
}
