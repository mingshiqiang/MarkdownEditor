/**
 * Table column widths (E-05) are display state, so they are not stored in
 * the markdown file. They are kept per document in the user data folder, so
 * the layout survives a restart.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { TableLayout } from '../../shared/types'

const MAX_DOCUMENTS = 200

function layoutFile(): string {
  return path.join(app.getPath('userData'), 'table-layout.json')
}

/** Reads the layout file and drops the invalid entries. */
export function readLayoutFile(file: string): Record<string, TableLayout> {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return {}
    const out: Record<string, TableLayout> = {}
    for (const [doc, layout] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof layout !== 'object' || layout === null) continue
      const tables: TableLayout = {}
      for (const [key, widths] of Object.entries(layout as Record<string, unknown>)) {
        if (!Array.isArray(widths)) continue
        const numbers = widths.filter((w): w is number => typeof w === 'number' && w > 0)
        if (numbers.length) tables[key] = numbers
      }
      if (Object.keys(tables).length) out[doc] = tables
    }
    return out
  } catch {
    return {}
  }
}

/** Writes the layout file (atomic). */
export function writeLayoutFile(file: string, all: Record<string, TableLayout>): void {
  try {
    const tmp = `${file}.tmp-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf-8')
    fs.renameSync(tmp, file)
  } catch (error) {
    console.error('[mde] could not persist the table layout:', error)
  }
}

function readAll(): Record<string, TableLayout> {
  return readLayoutFile(layoutFile())
}

function writeAll(all: Record<string, TableLayout>): void {
  writeLayoutFile(layoutFile(), all)
}

/** The stored column widths of a document. */
export function readTableLayout(docPath: string): TableLayout {
  if (!docPath) return {}
  return readAll()[docPath] ?? {}
}

/** Stores the column widths of a document. */
export function writeTableLayout(docPath: string, layout: TableLayout): void {
  if (!docPath) return
  const all = readAll()
  if (Object.keys(layout).length) {
    all[docPath] = layout
  } else {
    delete all[docPath]
  }
  // Keep the file small: drop the oldest entries.
  const keys = Object.keys(all)
  if (keys.length > MAX_DOCUMENTS) {
    for (const key of keys.slice(0, keys.length - MAX_DOCUMENTS)) delete all[key]
  }
  writeAll(all)
}
