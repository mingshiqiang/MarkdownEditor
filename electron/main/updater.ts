/**
 * Auto update (S-05).
 *
 * The update source is a "generic" feed (a directory with the installer and
 * the update metadata) that can be configured in the preferences or through
 * the `MDE_UPDATE_URL` environment variable. Without a feed the app only
 * reports that no update source is configured.
 */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '../../shared/types'
import type { UpdateEvent, UpdateStatus } from '../../shared/types'
import type { BrowserWindow } from 'electron'

export type { UpdateEvent, UpdateStatus }

let initialized = false

function send(getWin: () => BrowserWindow | null, event: UpdateEvent): void {
  const win = getWin()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.UpdateEvent, event)
}

/** Prepares the updater. Safe to call more than once. */
export function initUpdater(getWin: () => BrowserWindow | null, feedUrl: string): void {
  if (initialized) return
  initialized = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  const url = feedUrl.trim()
  if (url) {
    try {
      autoUpdater.setFeedURL({ provider: 'generic', url })
    } catch {
      send(getWin, { status: 'error', message: `Invalid update feed: ${url}` })
    }
  }

  autoUpdater.on('update-available', (info) => {
    send(getWin, { status: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    send(getWin, { status: 'not-available' })
  })
  autoUpdater.on('download-progress', (progress) => {
    send(getWin, { status: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('update-downloaded', (info) => {
    send(getWin, { status: 'downloaded', version: info.version })
  })
  autoUpdater.on('error', (error) => {
    send(getWin, { status: 'error', message: error?.message ?? String(error) })
  })
}

/** The feed URL from the settings or the environment. */
export function updateFeedUrl(configured: string): string {
  return configured.trim() || (process.env.MDE_UPDATE_URL ?? '').trim()
}

/** Checks for updates (only in a packaged app). */
export async function checkForUpdates(getWin: () => BrowserWindow | null): Promise<void> {
  if (!app.isPackaged) {
    send(getWin, { status: 'unsupported', message: 'development build' })
    return
  }
  send(getWin, { status: 'checking' })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    send(getWin, { status: 'error', message })
  }
}
