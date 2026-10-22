/**
 * Table column widths are *display state*: markdown sources do not store
 * them (PRD E-05). They are kept per document and per table so that they
 * survive re-renders, but never leak into the file.
 *
 * The widths of a document are also persisted (per file path) so that the
 * layout survives a restart.
 */
import type { TableLayout } from '../../shared/types'

/** `${docId}::${tableKey}` -> column widths in px */
const widths = new Map<string, number[]>()

export const MIN_COLUMN_WIDTH = 40
export const DEFAULT_COLUMN_WIDTH = 120

/**
 * Stable-ish identity of a table inside a document: the normalized header
 * text plus the ordinal of the table with the same header.
 */
export function tableKey(headerText: string, ordinal: number): string {
  const normalized = headerText.replace(/\s+/g, ' ').trim().toLowerCase()
  return `${normalized}#${ordinal}`
}

function storageKey(docId: string, key: string): string {
  return `${docId}::${key}`
}

export function getWidths(docId: string, key: string): number[] | null {
  return widths.get(storageKey(docId, key)) ?? null
}

export function setWidths(docId: string, key: string, value: number[]): void {
  widths.set(storageKey(docId, key), value)
  notifyChanged(docId)
}

export function clearWidths(docId: string, key: string): void {
  widths.delete(storageKey(docId, key))
}

export function clearDoc(docId: string): void {
  const prefix = `${docId}::`
  for (const key of [...widths.keys()]) {
    if (key.startsWith(prefix)) widths.delete(key)
  }
}

/* ------------------------------ persistence ------------------------------- */

type LayoutListener = (docId: string, layout: TableLayout) => void

const listeners = new Set<LayoutListener>()
let saveTimer: ReturnType<typeof setTimeout> | null = null
const dirty = new Set<string>()

/** Notified when the widths of a document changed (for persisting them). */
export function onLayoutChanged(listener: LayoutListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function notifyChanged(docId: string): void {
  dirty.add(docId)
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    const ids = [...dirty]
    dirty.clear()
    for (const id of ids) {
      const layout = layoutFor(id)
      for (const listener of listeners) listener(id, layout)
    }
  }, 400)
}

/** All column widths of a document. */
export function layoutFor(docId: string): TableLayout {
  const prefix = `${docId}::`
  const layout: TableLayout = {}
  for (const [key, value] of widths) {
    if (!key.startsWith(prefix)) continue
    layout[key.slice(prefix.length)] = value
  }
  return layout
}

/** Restores the widths of a document (e.g. from the persisted layout). */
export function setDocumentLayout(docId: string, layout: TableLayout): void {
  for (const [key, value] of Object.entries(layout)) {
    if (!Array.isArray(value) || value.length === 0) continue
    widths.set(storageKey(docId, key), [...value])
  }
}
