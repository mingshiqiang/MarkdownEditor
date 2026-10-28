/**
 * Main process entry: app lifecycle, window creation, single-instance lock,
 * custom image scheme, native menu wiring, dirty-close confirmation flow.
 *
 * Security baseline (PRD §2.3/§4): contextIsolation + sandbox + no node
 * integration; external links always go to the system browser; navigation
 * outside the app itself is blocked.
 */
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { join } from 'node:path'
import { IPC } from '../../shared/types'
import type { EffectiveTheme, ExternalChange } from '../../shared/types'
import { buildAppMenu, type MenuContext } from './menu'
import {
  getDirtyCount,
  isClosingConfirmed,
  isQueryCloseSent,
  markQueryCloseSent,
  registerIpcHandlers
} from './ipc'
import { normalizedSettings, readRecent } from './fileStore'
import { registerImageHandler, registerImageScheme } from './protocol'
import { applySpellChecker } from './spellcheck'
import { nativeThemeSourceFor } from './userThemes'
import { createTray, destroyTray, showMainWindow, updateTray } from './tray'
import { checkForUpdates, initUpdater, updateFeedUrl } from './updater'
import { disposeWatch } from './watcher'

let mainWindow: BrowserWindow | null = null
let menuCtx: MenuContext = { settings: normalizedSettings(), recent: readRecent() }
let pendingFiles: string[] = []
let pendingFolder: string | null = null
/** True while the app is quitting (so the window may close for real). */
let isQuitting = false

/* --------------------------------- helpers -------------------------------- */

function isRendererUrl(url: string): boolean {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && url.startsWith(devUrl)) return true
  return url.startsWith('file://')
}

function mdFileFromArgv(argv: string[]): string[] {
  const out: string[] = []
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue
    if (!/\.(md|markdown|mkd|txt)$/i.test(a)) continue
    try {
      if (fs.existsSync(a) && fs.statSync(a).isFile()) out.push(path.resolve(a))
    } catch {
      /* skip */
    }
  }
  return out
}

/** Directories passed on the command line open as a workspace (M3). */
function folderFromArgv(argv: string[]): string | null {
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue
    try {
      if (fs.existsSync(a) && fs.statSync(a).isDirectory()) return path.resolve(a)
    } catch {
      /* skip */
    }
  }
  return null
}

function pushOpenFile(file: string): void {
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoadingMainFrame()) {
    mainWindow.webContents.send(IPC.OpenFile, file)
  } else {
    pendingFiles.push(file)
  }
}

function effectiveTheme(): EffectiveTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
}

function rebuildMenu(): void {
  menuCtx = { settings: normalizedSettings(), recent: readRecent() }
  if (mainWindow && !mainWindow.isDestroyed()) buildAppMenu(mainWindow, menuCtx)
  updateTray({ getWin: () => mainWindow, settings: menuCtx.settings })
}

function drainPendingFiles(): void {
  const files = pendingFiles
  pendingFiles = []
  for (const f of files) pushOpenFile(f)
  if (pendingFolder && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.WorkspaceOpenPath, pendingFolder)
    pendingFolder = null
  }
}

/**
 * Application icon.
 * - development: <project>/resources/icon.png
 * - packaged:    <resources>/icon.png (electron-builder `extraResources`)
 */
function appIconPath(): string {
  const packaged = join(process.resourcesPath, 'icon.png')
  if (app.isPackaged && fs.existsSync(packaged)) return packaged
  return join(__dirname, '../../resources/icon.png')
}

/* ------------------------------- main window ------------------------------ */

function createWindow(): BrowserWindow {
  const settings = normalizedSettings()
  const dark =
    nativeThemeSourceFor(settings.theme) === 'dark' ||
    (nativeThemeSourceFor(settings.theme) === 'system' && effectiveTheme() === 'dark')

  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    show: false,
    frame: false,
    resizable: true,
    // Native rounded corners (Windows 11 / supported platforms) plus the
    // standard invisible resize frame on all four edges and corners.
    roundedCorners: true,
    thickFrame: true,
    autoHideMenuBar: true,
    backgroundColor: dark ? '#1f2227' : '#ffffff',
    title: 'MarkdownEditor',
    // Taskbar / window icon (Windows & Linux).
    icon: appIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      webSecurity: true
    }
  })

  win.on('ready-to-show', () => win.show())

  // Keep the custom title bar's maximize/restore icon in sync, including
  // changes made through native shortcuts or the fullscreen menu item.
  const sendWindowState = (): void => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC.WindowMaximized, win.isMaximized() || win.isFullScreen())
    }
  }
  win.on('maximize', sendWindowState)
  win.on('unmaximize', sendWindowState)
  win.on('enter-full-screen', sendWindowState)
  win.on('leave-full-screen', sendWindowState)

  // ---- security: block in-app navigation & window.open --------------------
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isRendererUrl(url)) event.preventDefault()
  })

  // Forward renderer console (warnings/errors) to the terminal in dev.
  if (!app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      const info = event as unknown as { level?: string; message?: string }
      const lvl = String(info.level ?? '')
      const msg = String(info.message ?? '')
      if (lvl === 'warning' || lvl === 'error' || msg.includes('[mde]')) {
        console.log(`[renderer:${lvl}] ${msg}`)
      }
    })
  }

  // ---- dirty-close flow (F-03) --------------------------------------------
  win.on('close', (event) => {
    if (isClosingConfirmed()) return
    // Close to tray (S-06): hide the window instead of quitting the app.
    const settings = normalizedSettings()
    if (!isQuitting && settings.tray.enabled && settings.tray.closeToTray) {
      event.preventDefault()
      win.hide()
      return
    }
    if (getDirtyCount() === 0) return
    event.preventDefault()
    if (!isQueryCloseSent()) {
      markQueryCloseSent()
      win.webContents.send(IPC.QueryClose)
    }
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  return win
}

function loadRenderer(win: BrowserWindow): void {
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/* ------------------------------- app bootstrap ----------------------------- */

registerImageScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      showMainWindow(() => mainWindow)
    }
    for (const f of mdFileFromArgv(argv)) pushOpenFile(f)
  })

  app.setAppUserModelId('com.markdowneditor.app')

  app.whenReady().then(() => {
    registerImageHandler()
    mainWindow = createWindow()
    buildAppMenu(mainWindow, menuCtx)

    registerIpcHandlers({
      getWin: () => mainWindow,
      rebuildMenu,
      onExternalChange: (change: ExternalChange) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC.ExternalChange, change)
        }
      },
      onAppReady: drainPendingFiles
    })

    // Launch args (CLI / drag onto the exe icon / file association).
    for (const f of mdFileFromArgv(process.argv)) pendingFiles.push(f)
    pendingFolder = folderFromArgv(process.argv)
    // Development helper: open a file given via MDE_OPEN_FILE.
    if (!app.isPackaged && process.env.MDE_OPEN_FILE) {
      pendingFiles.push(path.resolve(process.env.MDE_OPEN_FILE))
    }

    // Theme: follow the persisted setting, notify the renderer on OS changes.
    nativeTheme.themeSource = nativeThemeSourceFor(normalizedSettings().theme)
    nativeTheme.on('updated', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.SystemTheme, effectiveTheme())
      }
    })

    // Spell checking (E-15): Chromium's built-in dictionaries.
    applySpellChecker(normalizedSettings())

    // Tray icon (S-06) and auto update (S-05).
    const settings = normalizedSettings()
    if (settings.tray.enabled) {
      createTray({ getWin: () => mainWindow, settings })
    }
    initUpdater(() => mainWindow, updateFeedUrl(settings.updates.feedUrl))
    if (settings.updates.autoCheck) {
      setTimeout(() => void checkForUpdates(() => mainWindow), 8000)
    }

    loadRenderer(mainWindow)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        buildAppMenu(mainWindow, menuCtx)
        loadRenderer(mainWindow)
      }
    })
  })

  app.on('open-file', (event, file) => {
    event.preventDefault()
    pushOpenFile(file)
  })

  app.on('window-all-closed', () => {
    disposeWatch()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    isQuitting = true
    destroyTray()
  })
}
