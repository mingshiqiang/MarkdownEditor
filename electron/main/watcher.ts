/**
 * Watches the files currently open in the editor for external changes (F-07).
 * - A single chokidar instance watches an explicit set of file paths.
 * - Writes made by this app (atomic tmp+rename) are recognised via a signature
 *   map and do not raise external-change events.
 */
import fs from 'node:fs'
import { watch, type FSWatcher } from 'chokidar'
import type { ExternalChange } from '../../shared/types'

type ChangeHandler = (change: ExternalChange) => void

interface WriteRecord {
  mtimeMs: number
  size: number
  at: number
}

const ourWrites = new Map<string, WriteRecord>()
const wanted = new Set<string>()

let watcher: FSWatcher | null = null
let handler: ChangeHandler | null = null

/** Call right after the app itself wrote `p` (atomic write target stats). */
export function recordWrite(p: string, mtimeMs: number, size: number): void {
  ourWrites.set(p, { mtimeMs, size, at: Date.now() })
}

function handleEvent(p: string, kind: 'change' | 'unlink'): void {
  const rec = ourWrites.get(p)
  ourWrites.delete(p)
  if (rec && kind === 'change') {
    try {
      const st = fs.statSync(p)
      if (st.size === rec.size && Math.abs(st.mtimeMs - rec.mtimeMs) < 10) {
        return // our own write
      }
    } catch {
      /* treat as external */
    }
  }
  handler?.({ path: p, kind })
}

export function syncWatch(paths: string[], onExternal: ChangeHandler): void {
  handler = onExternal
  const next = new Set(paths.filter((p) => typeof p === 'string' && p.length > 0))
  // Drop stale entries so signatures never grow unbounded.
  for (const [p, rec] of ourWrites) {
    if (Date.now() - rec.at > 120_000) ourWrites.delete(p)
  }
  if (!watcher) {
    if (next.size === 0) return
    watcher = watch([...next], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 60 }
    })
    watcher.on('change', (p) => handleEvent(p, 'change'))
    watcher.on('unlink', (p) => handleEvent(p, 'unlink'))
    watcher.on('add', (p) => {
      // tmp file renamed onto a watched path arrives as `add` if the watcher
      // was (re)created; check signature the same way.
      handleEvent(p, 'change')
    })
    watcher.on('error', () => {
      /* ignore; chokidar keeps running */
    })
  } else {
    const add: string[] = []
    for (const p of next) if (!wanted.has(p)) add.push(p)
    if (add.length) watcher.add(add)
    const remove: string[] = []
    for (const p of wanted) if (!next.has(p)) remove.push(p)
    if (remove.length) watcher.unwatch(remove)
  }
  wanted.clear()
  for (const p of next) wanted.add(p)
}

export function disposeWatch(): void {
  void watcher?.close()
  watcher = null
  wanted.clear()
}
