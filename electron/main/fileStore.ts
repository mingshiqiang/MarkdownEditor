/**
 * Persistent little stores (recent files + settings) kept as JSON under
 * the Electron userData directory. Writes are atomic (tmp + rename).
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { AppSettings, RecentFile } from '../../shared/types'

const RECENT_LIMIT = 12

function recentFile(): string {
  return path.join(app.getPath('userData'), 'recent.json')
}

function settingsFile(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function atomicWriteJson(file: string, data: unknown): void {
  const tmp = `${file}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, file)
}

/* --------------------------------- recent --------------------------------- */

export function readRecent(): RecentFile[] {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(recentFile(), 'utf-8'))
    if (!Array.isArray(raw)) return []
    const items: RecentFile[] = []
    for (const entry of raw) {
      if (
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).path === 'string'
      ) {
        const e = entry as { path: string; ts?: unknown }
        items.push({
          path: e.path,
          name: path.basename(e.path),
          ts: typeof e.ts === 'number' ? e.ts : Date.now()
        })
      }
    }
    // Hide entries whose files no longer exist.
    return items.filter((r) => fs.existsSync(r.path)).slice(0, RECENT_LIMIT)
  } catch {
    return []
  }
}

export function appendRecent(p: string): RecentFile[] {
  const list = readRecent().filter((r) => r.path !== p)
  list.unshift({ path: p, name: path.basename(p), ts: Date.now() })
  const trimmed = list.slice(0, RECENT_LIMIT)
  try {
    atomicWriteJson(recentFile(), trimmed)
  } catch {
    /* best-effort */
  }
  return trimmed
}

export function clearRecent(): RecentFile[] {
  try {
    atomicWriteJson(recentFile(), [])
  } catch {
    /* best-effort */
  }
  return []
}

/* -------------------------------- settings -------------------------------- */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function mergeDefaults<T>(defaults: T, saved: unknown): T {
  if (!isPlainObject(defaults)) {
    if (typeof saved === typeof defaults && saved !== undefined) return saved as T
    return defaults
  }
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) }
  if (isPlainObject(saved)) {
    for (const key of Object.keys(defaults as Record<string, unknown>)) {
      out[key] = mergeDefaults((defaults as Record<string, unknown>)[key], saved[key])
    }
  }
  return out as T
}

export function defaultGlobalDir(): string {
  return path.join(app.getPath('documents'), 'MarkdownEditorAssets')
}

export function readSettings(): AppSettings {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(settingsFile(), 'utf-8'))
    return mergeDefaults(DEFAULT_SETTINGS, raw)
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings
  }
}

export function writeSettings(settings: AppSettings): void {
  try {
    atomicWriteJson(settingsFile(), settings)
  } catch (err) {
    console.error('[mde] failed to persist settings:', err)
  }
}

/** Settings with a concrete global image dir (created on demand). */
export function normalizedSettings(): AppSettings {
  const s = readSettings()
  if (!s.imageStore.globalDir) s.imageStore.globalDir = defaultGlobalDir()
  return s
}
