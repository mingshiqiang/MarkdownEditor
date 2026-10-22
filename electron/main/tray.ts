/**
 * Tray icon (S-06): a permanent entry in the system tray that can show the
 * window again, create a document or quit the app. It is also used for the
 * "close to tray" behaviour.
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '../../shared/types'
import type { AppSettings } from '../../shared/types'
import { dictionaries, resolveLocale } from '../../shared/i18n'

export interface TrayContext {
  getWin: () => BrowserWindow | null
  settings: AppSettings
}

let tray: Tray | null = null

function trayIconPath(): string {
  const packaged = path.join(process.resourcesPath, 'icon.png')
  if (app.isPackaged && fs.existsSync(packaged)) return packaged
  return path.join(__dirname, '../../resources/icon.png')
}

/** Brings the main window back to the front. */
export function showMainWindow(getWin: () => BrowserWindow | null): void {
  const win = getWin()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildTrayMenu(ctx: TrayContext): Electron.MenuItemConstructorOptions[] {
  const s = dictionaries[resolveLocale(ctx.settings.locale, app.getLocale())]
  const win = ctx.getWin()
  const send = (id: string): void => {
    if (win && !win.isDestroyed()) win.webContents.send(IPC.MenuAction, { id })
  }
  return [
    { label: s.tray.show, click: () => showMainWindow(ctx.getWin) },
    { label: s.tray.new, click: () => send('file:new') },
    { type: 'separator' },
    { label: s.tray.quit, click: () => app.quit() }
  ]
}

/** Creates the tray icon (no-op when it already exists). */
export function createTray(ctx: TrayContext): void {
  if (tray) return
  try {
    const image = nativeImage.createFromPath(trayIconPath())
    if (image.isEmpty()) return
    tray = new Tray(image)
    tray.setToolTip('MarkdownEditor')
    console.log('[mde] tray icon created')
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(ctx)))
    tray.on('click', () => showMainWindow(ctx.getWin))
    tray.on('double-click', () => showMainWindow(ctx.getWin))
  } catch {
    tray = null
  }
}

/** Creates, updates or removes the tray icon (after a settings change). */
export function updateTray(ctx: TrayContext): void {
  if (!ctx.settings.tray.enabled) {
    destroyTray()
    return
  }
  if (!tray) {
    createTray(ctx)
    return
  }
  try {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenu(ctx)))
    tray.setToolTip('MarkdownEditor')
  } catch {
    /* the tray may be gone on some desktops */
  }
}

export function destroyTray(): void {
  if (!tray) return
  try {
    tray.destroy()
  } catch {
    /* ignore */
  }
  tray = null
}

export function hasTray(): boolean {
  return tray !== null
}
