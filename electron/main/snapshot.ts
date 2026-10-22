/**
 * Crash recovery snapshots (F-02).
 *
 * While a document has unsaved changes, a snapshot of its content is written
 * to the userData folder. If the app dies, the next start can offer to
 * restore the lost content. Snapshots live outside the document folder, so
 * they can never damage the original file.
 */
import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface SnapshotInfo {
  /** Stable id (hash of the file path). */
  id: string
  /** Absolute path of the original document. */
  path: string
  name: string
  /** Snapshot timestamp (ms). */
  ts: number
  size: number
  /** Mtime of the document on disk (0 when it was never saved). */
  fileMtime: number
}

function snapshotDir(): string {
  return path.join(app.getPath('userData'), 'snapshots')
}

function snapshotFile(id: string): string {
  return path.join(snapshotDir(), `${id}.md`)
}

function metaFile(id: string): string {
  return path.join(snapshotDir(), `${id}.json`)
}

export function snapshotId(filePath: string): string {
  return crypto.createHash('sha1').update(path.resolve(filePath)).digest('hex').slice(0, 16)
}

/** Store a snapshot of a document. */
export function writeSnapshot(
  filePath: string,
  content: string,
  fileMtime = 0
): SnapshotInfo | null {
  try {
    fs.mkdirSync(snapshotDir(), { recursive: true })
    const id = snapshotId(filePath)
    fs.writeFileSync(snapshotFile(id), content, 'utf-8')
    const info: SnapshotInfo = {
      id,
      path: path.resolve(filePath),
      name: path.basename(filePath),
      ts: Date.now(),
      size: Buffer.byteLength(content, 'utf-8'),
      fileMtime
    }
    fs.writeFileSync(metaFile(id), JSON.stringify(info, null, 2), 'utf-8')
    return info
  } catch {
    return null
  }
}

/** All snapshots, newest first. */
export function listSnapshots(): SnapshotInfo[] {
  try {
    const entries = fs.readdirSync(snapshotDir()).filter((f) => f.endsWith('.json'))
    const out: SnapshotInfo[] = []
    for (const entry of entries) {
      try {
        const info = JSON.parse(
          fs.readFileSync(path.join(snapshotDir(), entry), 'utf-8')
        ) as SnapshotInfo
        if (info && typeof info.id === 'string' && fs.existsSync(snapshotFile(info.id))) {
          out.push(info)
        }
      } catch {
        /* skip broken entries */
      }
    }
    return out.sort((a, b) => b.ts - a.ts)
  } catch {
    return []
  }
}

export function readSnapshot(id: string): string | null {
  try {
    return fs.readFileSync(snapshotFile(id), 'utf-8')
  } catch {
    return null
  }
}

export function clearSnapshot(id: string): void {
  try {
    fs.unlinkSync(snapshotFile(id))
  } catch {
    /* ignore */
  }
  try {
    fs.unlinkSync(metaFile(id))
  } catch {
    /* ignore */
  }
}

/** Remove snapshots of documents that are not dirty any more. */
export function pruneSnapshots(activeIds: string[]): void {
  const keep = new Set(activeIds)
  for (const info of listSnapshots()) {
    if (!keep.has(info.id)) clearSnapshot(info.id)
  }
}
