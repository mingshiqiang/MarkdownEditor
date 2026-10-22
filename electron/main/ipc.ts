/**
 * All ipcMain handlers. The renderer (sandboxed, no Node) talks to these via
 * the preload bridge only. Inputs are validated; file writes are atomic
 * (tmp + rename) and recorded so the watcher does not flag them.
 */
import {
  app,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type BrowserWindow
} from 'electron'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { IPC } from '../../shared/types'
import type {
  AppSettings,
  ExternalChange,
  FileMeta,
  FileTreeNode,
  ImageInsertRequest,
  ImageInsertResult,
  ImageExportOptions,
  RecentFile,
  SaveResult,
  SearchMatch,
  SearchMode,
  SnapshotInfo,
  TableLayout,
  ThemeSetting
} from '../../shared/types'
import { toPosix } from '../../shared/paths'
import {
  appendRecent,
  clearRecent,
  normalizedSettings,
  readRecent,
  writeSettings
} from './fileStore'
import { recordWrite, syncWatch } from './watcher'
import {
  DEFAULT_IMAGE_OPTIONS,
  DEFAULT_PDF_OPTIONS,
  exportDocx,
  exportHtml,
  exportImage,
  exportPdf,
  type PdfOptions
} from './export'
import { applySpellChecker } from './spellcheck'
import { uploadImage } from './imageHost'
import { readTextFile, writeTextFileAtomic } from './fileIo'
import { readTableLayout, writeTableLayout } from './tableLayout'
import { checkForUpdates } from './updater'
import { setAcceleratorsSuspended } from './menu'
import {
  listUserThemes,
  nativeThemeSourceFor,
  openUserThemesFolder,
  writeExampleUserTheme
} from './userThemes'
import type { UserTheme } from '../../shared/userTheme'
import {
  buildTree,
  createEntry,
  deleteEntry,
  moveEntry,
  renameEntry,
  searchWorkspace
} from './workspace'
import { clearSnapshot, listSnapshots, readSnapshot, writeSnapshot } from './snapshot'

interface IpcContext {
  getWin: () => BrowserWindow | null
  rebuildMenu: () => void
  onExternalChange: (change: ExternalChange) => void
  /** Called when the renderer finished booting (drains pending open files). */
  onAppReady: () => void
}

let getWinFn: () => BrowserWindow | null = () => null
let rebuildMenu: () => void = () => {}
let onExternalChange: (change: ExternalChange) => void = () => {}
let onAppReady: () => void = () => {}
let dirtyCount = 0
let closingConfirmed = false
let queryCloseSent = false

const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mkd', 'txt'] },
  { name: 'All Files', extensions: ['*'] }
]

export function setIpcContext(ctx: IpcContext): void {
  getWinFn = ctx.getWin
  rebuildMenu = ctx.rebuildMenu
  onExternalChange = ctx.onExternalChange
  onAppReady = ctx.onAppReady
}

export function getDirtyCount(): number {
  return dirtyCount
}

export function isClosingConfirmed(): boolean {
  return closingConfirmed
}

export function isQueryCloseSent(): boolean {
  return queryCloseSent
}

export function markQueryCloseSent(): void {
  queryCloseSent = true
}

export function resetQueryCloseSent(): void {
  queryCloseSent = false
}

/* --------------------------------- helpers -------------------------------- */

function isStr(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0
}

/** The encoding of an existing file (UTF-8 for a new file). */
function readFileMeta(abs: string): FileMeta | null {
  const file = readTextFile(abs)
  if (!file) return null
  return {
    path: abs,
    name: path.basename(abs),
    dir: path.dirname(abs),
    size: file.size,
    mtimeMs: file.mtimeMs,
    content: file.content,
    encoding: file.encoding
  }
}

function atomicWrite(abs: string, content: string): SaveResult {
  const dir = path.dirname(abs)
  // Keep the encoding of the file: a GBK document stays a GBK document.
  writeTextFileAtomic(abs, content)
  const st = fs.statSync(abs)
  return {
    path: abs,
    name: path.basename(abs),
    dir,
    mtimeMs: st.mtimeMs,
    size: st.size
  }
}

/* ---------------------------------- file ---------------------------------- */

function registerFileHandlers(): void {
  ipcMain.handle(IPC.FileOpenDialog, async (): Promise<FileMeta[]> => {
    const w = getWinFn()
    const res = w
      ? await dialog.showOpenDialog(w, {
          title: 'Open',
          properties: ['openFile', 'multiSelections'],
          filters: MARKDOWN_FILTERS
        })
      : await dialog.showOpenDialog({
          properties: ['openFile', 'multiSelections'],
          filters: MARKDOWN_FILTERS
        })
    if (res.canceled || res.filePaths.length === 0) return []
    const metas = res.filePaths.map(readFileMeta).filter((m): m is FileMeta => m !== null)
    metas.forEach((m) => appendRecent(m.path))
    rebuildMenu()
    return metas
  })

  ipcMain.handle(IPC.FileRead, (_e, p: unknown): Promise<FileMeta | null> => {
    return Promise.resolve(isStr(p) ? readFileMeta(p) : null)
  })

  ipcMain.handle(IPC.FileWrite, (_e, p: unknown, content: unknown): Promise<SaveResult | null> => {
    if (!isStr(p) || typeof content !== 'string') return Promise.resolve(null)
    try {
      const result = atomicWrite(path.normalize(p), content)
      appendRecent(result.path)
      recordWrite(result.path, result.mtimeMs, result.size)
      rebuildMenu()
      return Promise.resolve(result)
    } catch {
      return Promise.resolve(null)
    }
  })

  ipcMain.handle(IPC.FileSaveAsDialog, async (_e, name: unknown): Promise<string | null> => {
    const suggested = isStr(name) ? name : 'untitled.md'
    const w = getWinFn()
    const res = w
      ? await dialog.showSaveDialog(w, {
          defaultPath: suggested,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
        })
      : await dialog.showSaveDialog({
          defaultPath: suggested,
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }]
        })
    return res.canceled || !res.filePath ? null : res.filePath
  })

  ipcMain.handle(IPC.FilePickDirectory, async (): Promise<string | null> => {
    const w = getWinFn()
    const res = w
      ? await dialog.showOpenDialog(w, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })

  ipcMain.handle(IPC.FileGetRecent, (): Promise<RecentFile[]> => Promise.resolve(readRecent()))
  ipcMain.handle(IPC.FileAppendRecent, (_e, p: unknown): Promise<RecentFile[]> => {
    if (!isStr(p)) return Promise.resolve(readRecent())
    const list = appendRecent(p)
    rebuildMenu()
    return Promise.resolve(list)
  })
  ipcMain.handle(IPC.FileClearRecent, (): Promise<RecentFile[]> => {
    const list = clearRecent()
    rebuildMenu()
    return Promise.resolve(list)
  })
}

/* ------------------------------- settings etc ------------------------------ */

function registerSettingsHandlers(): void {
  ipcMain.handle(IPC.SettingsGet, (): Promise<AppSettings> => Promise.resolve(normalizedSettings()))

  ipcMain.handle(IPC.SettingsSet, (_e, s: unknown): Promise<AppSettings> => {
    if (typeof s !== 'object' || s === null) return Promise.resolve(normalizedSettings())
    writeSettings(s as AppSettings)
    applyNativeTheme((s as AppSettings).theme)
    applySpellChecker(s as AppSettings)
    rebuildMenu()
    return Promise.resolve(normalizedSettings())
  })

  ipcMain.handle(IPC.SystemThemeGet, (): Promise<'light' | 'dark'> =>
    Promise.resolve(nativeTheme.shouldUseDarkColors ? 'dark' : 'light')
  )

  ipcMain.handle(IPC.NativeThemeSet, (_e, theme: unknown): Promise<void> => {
    applyNativeTheme(theme as ThemeSetting)
    return Promise.resolve()
  })

  ipcMain.handle(IPC.KeymapSuspend, (_e, suspended: unknown): Promise<void> => {
    setAcceleratorsSuspended(suspended === true)
    rebuildMenu()
    return Promise.resolve()
  })

  ipcMain.handle(IPC.UpdateCheck, async (): Promise<void> => {
    await checkForUpdates(() => getWinFn())
  })
}

function applyNativeTheme(theme: ThemeSetting | undefined): void {
  nativeTheme.themeSource = nativeThemeSourceFor(theme)
}

/* ---------------------------------- themes -------------------------------- */

function registerThemeHandlers(): void {
  ipcMain.handle(IPC.ThemesList, (): Promise<UserTheme[]> => Promise.resolve(listUserThemes()))

  ipcMain.handle(IPC.ThemesOpenFolder, async (): Promise<void> => {
    await openUserThemesFolder()
  })

  ipcMain.handle(IPC.ThemesCreateExample, (): Promise<string | null> =>
    Promise.resolve(writeExampleUserTheme())
  )
}

function registerMiscHandlers(): void {
  ipcMain.handle(IPC.ClipboardWriteText, (_e, text: unknown): Promise<void> => {
    if (typeof text === 'string') clipboard.writeText(text)
    return Promise.resolve()
  })

  ipcMain.handle(IPC.ClipboardWriteHtml, (_e, html: unknown, text: unknown): Promise<void> => {
    if (typeof html !== 'string') return Promise.resolve()
    clipboard.write([
      new ClipboardItem({
        'text/plain': typeof text === 'string' ? text : '',
        'text/html': html
      })
    ])
    return Promise.resolve()
  })

  ipcMain.handle(IPC.ShellOpenExternal, async (_e, url: unknown): Promise<void> => {
    if (!isStr(url)) return
    const decoded = url.replace(/&amp;/g, '&')
    if (!/^https?:\/\//i.test(decoded)) return
    await shell.openExternal(decoded)
  })

  ipcMain.handle(IPC.UtilResolvePath, (_e, base: unknown, rel: unknown): Promise<string | null> => {
    if (!isStr(base) || typeof rel !== 'string') return Promise.resolve(null)
    try {
      return Promise.resolve(path.resolve(base, rel))
    } catch {
      return Promise.resolve(null)
    }
  })
}

/* ---------------------------------- images --------------------------------- */

const MIME_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/bmp': '.bmp',
  'image/avif': '.avif',
  'image/svg+xml': '.svg'
}

function timestampName(ext: string): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  return `paste-${stamp}${ext}`
}

function uniqueTarget(dir: string, fileName: string): string {
  let target = path.join(dir, fileName)
  if (!fs.existsSync(target)) return target
  const ext = path.extname(fileName)
  const stem = path.basename(fileName, ext)
  for (let i = 2; i < 1000; i++) {
    target = path.join(dir, `${stem}-${i}${ext}`)
    if (!fs.existsSync(target)) return target
  }
  target = path.join(dir, `${Date.now()}${ext}`)
  return target
}

/**
 * Store image bytes according to the configured image mode and return the
 * path to embed into the markdown source.
 */
function storeImageBytes(
  bytes: Buffer,
  fileName: string,
  docPath: string | null,
  settings: AppSettings
): { absPath: string; mdPath: string } | null {
  const mode = docPath ? settings.imageStore.mode : 'global'
  if (mode === 'none') return null
  let storeDir: string
  let relative: boolean
  if (mode === 'assets' && docPath) {
    storeDir = path.join(path.dirname(path.normalize(docPath)), 'assets')
    relative = true
  } else {
    storeDir =
      settings.imageStore.globalDir || path.join(app.getPath('documents'), 'MarkdownEditorAssets')
    relative = false
  }
  fs.mkdirSync(storeDir, { recursive: true })
  const target = uniqueTarget(storeDir, fileName)
  fs.writeFileSync(target, bytes)
  const mdPath =
    relative && docPath
      ? toPosix(path.relative(path.dirname(path.normalize(docPath)), target))
      : toPosix(target)
  return { absPath: target, mdPath }
}

function registerImageHandlers(): void {
  ipcMain.handle(IPC.ImageInsert, (_e, req: unknown): Promise<ImageInsertResult | null> => {
    if (typeof req !== 'object' || req === null) return Promise.resolve(null)
    const r = req as ImageInsertRequest
    const settings = normalizedSettings()
    try {
      // Case 3: reference the original path without copying.
      if (r.docPath && settings.imageStore.mode === 'none' && r.source.kind === 'file') {
        const abs = path.normalize(r.source.absPath)
        if (!fs.existsSync(abs)) return Promise.resolve(null)
        return Promise.resolve({ absPath: abs, mdPath: toPosix(abs) })
      }

      if (r.source.kind === 'buffer') {
        const ext = MIME_EXT[r.source.mime] ?? '.png'
        const stored = storeImageBytes(
          Buffer.from(r.source.bytes),
          timestampName(ext),
          r.docPath,
          settings
        )
        return Promise.resolve(stored)
      }

      // A real file: copy it into the store directory.
      const source = path.normalize(r.source.absPath)
      if (!fs.existsSync(source)) return Promise.resolve(null)
      const bytes = fs.readFileSync(source)
      const stored = storeImageBytes(bytes, path.basename(source), r.docPath, settings)
      return Promise.resolve(stored)
    } catch {
      return Promise.resolve(null)
    }
  })

  ipcMain.handle(
    IPC.ImageDownload,
    async (
      _e,
      url: unknown,
      docPath: unknown,
      settings: unknown
    ): Promise<ImageInsertResult | null> => {
      if (!isStr(url) || !/^https?:\/\//i.test(url)) return Promise.resolve(null)
      const s = (settings as AppSettings) ?? normalizedSettings()
      const doc = isStr(docPath) ? docPath : null
      try {
        const { bytes, contentType } = await downloadUrl(url)
        const fileName =
          path.basename(new URL(url).pathname) ||
          `image-${Date.now()}${MIME_EXT[contentType] ?? '.png'}`
        const stored = storeImageBytes(bytes, fileName, doc, s)
        return stored
      } catch {
        return Promise.resolve(null)
      }
    }
  )

  ipcMain.handle(
    IPC.ImageUpload,
    async (_e, filePath: unknown, settings: unknown): Promise<string | null> => {
      if (!isStr(filePath)) return Promise.resolve(null)
      const s = (settings as AppSettings) ?? normalizedSettings()
      return uploadImage(path.normalize(filePath), s)
    }
  )
}

/** Download an http(s) resource. */
function downloadUrl(url: string): Promise<{ bytes: Buffer; contentType: string }> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, { timeout: 20000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        downloadUrl(new URL(res.headers.location, url).toString()).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        res.resume()
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () =>
        resolve({
          bytes: Buffer.concat(chunks),
          contentType: String(res.headers['content-type'] ?? '')
            .split(';')[0]
            .trim()
        })
      )
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/* ------------------------------ watch / lifecycle --------------------------- */

/* ------------------------------ watch / lifecycle --------------------------- */

/* --------------------------------- export ---------------------------------- */

function registerExportHandlers(): void {
  ipcMain.handle(
    IPC.ExportHtml,
    async (_e, html: unknown, name: unknown): Promise<string | null> => {
      if (typeof html !== 'string' || !isStr(name)) return Promise.resolve(null)
      return exportHtml(getWinFn(), html, name)
    }
  )

  ipcMain.handle(
    IPC.ExportPdf,
    async (_e, html: unknown, name: unknown, options: unknown): Promise<string | null> => {
      if (typeof html !== 'string' || !isStr(name)) return Promise.resolve(null)
      const opts = { ...DEFAULT_PDF_OPTIONS, ...(options as object) } as PdfOptions
      return exportPdf(getWinFn(), html, name, opts)
    }
  )

  ipcMain.handle(
    IPC.ExportDocx,
    async (_e, bytes: unknown, name: unknown): Promise<string | null> => {
      if (!(bytes instanceof ArrayBuffer) || !isStr(name)) return Promise.resolve(null)
      return exportDocx(getWinFn(), bytes, name)
    }
  )

  ipcMain.handle(
    IPC.ExportImage,
    async (_e, html: unknown, name: unknown, options: unknown): Promise<string | null> => {
      if (typeof html !== 'string' || !isStr(name)) return Promise.resolve(null)
      const opts = { ...DEFAULT_IMAGE_OPTIONS, ...(options as object) } as ImageExportOptions
      return exportImage(getWinFn(), html, name, opts)
    }
  )
}

function registerWorkspaceHandlers(): void {
  ipcMain.handle(IPC.WorkspaceOpenFolder, async (): Promise<string | null> => {
    const w = getWinFn()
    const res = w
      ? await dialog.showOpenDialog(w, {
          title: 'Open Folder',
          properties: ['openDirectory', 'createDirectory']
        })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  })

  ipcMain.handle(IPC.WorkspaceReadTree, async (_e, root: unknown): Promise<FileTreeNode[]> => {
    if (!isStr(root)) return Promise.resolve([])
    return buildTree(path.normalize(root))
  })

  ipcMain.handle(
    IPC.WorkspaceCreate,
    async (_e, parent: unknown, name: unknown, type: unknown): Promise<boolean> => {
      if (!isStr(parent) || !isStr(name)) return Promise.resolve(false)
      const kind = type === 'directory' ? 'directory' : 'file'
      return createEntry(path.normalize(parent), name, kind)
    }
  )

  ipcMain.handle(
    IPC.WorkspaceRename,
    async (_e, target: unknown, name: unknown): Promise<boolean> => {
      if (!isStr(target) || !isStr(name)) return Promise.resolve(false)
      return renameEntry(path.normalize(target), name)
    }
  )

  ipcMain.handle(IPC.WorkspaceDelete, async (_e, target: unknown): Promise<boolean> => {
    if (!isStr(target)) return Promise.resolve(false)
    return deleteEntry(path.normalize(target))
  })

  ipcMain.handle(IPC.WorkspaceMove, async (_e, from: unknown, toDir: unknown): Promise<boolean> => {
    if (!isStr(from) || !isStr(toDir)) return Promise.resolve(false)
    return moveEntry(path.normalize(from), path.normalize(toDir))
  })

  ipcMain.handle(
    IPC.WorkspaceSearch,
    async (_e, root: unknown, query: unknown, mode: unknown): Promise<SearchMatch[]> => {
      if (!isStr(root) || !isStr(query)) return Promise.resolve([])
      const kind: SearchMode = mode === 'content' ? 'content' : 'name'
      return searchWorkspace(path.normalize(root), query, kind)
    }
  )
}

/* ------------------------------- snapshots --------------------------------- */

function registerSnapshotHandlers(): void {
  ipcMain.handle(
    IPC.SnapshotWrite,
    (_e, p: unknown, content: unknown, mtime: unknown): Promise<boolean> => {
      if (!isStr(p) || typeof content !== 'string') return Promise.resolve(false)
      const info = writeSnapshot(p, content, typeof mtime === 'number' ? mtime : 0)
      return Promise.resolve(info !== null)
    }
  )

  ipcMain.handle(IPC.SnapshotList, (): Promise<SnapshotInfo[]> => Promise.resolve(listSnapshots()))

  ipcMain.handle(IPC.SnapshotRead, (_e, id: unknown): Promise<string | null> =>
    Promise.resolve(isStr(id) ? readSnapshot(id) : null)
  )

  ipcMain.handle(IPC.SnapshotClear, (_e, id: unknown): Promise<void> => {
    if (isStr(id)) clearSnapshot(id)
    return Promise.resolve()
  })
}

function registerWatchHandlers(): void {
  ipcMain.handle(IPC.WatchSync, (_e, paths: unknown): Promise<void> => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => isStr(p)) : []
    syncWatch(list, (change) => onExternalChange(change))
    return Promise.resolve()
  })
}

function registerTableLayoutHandlers(): void {
  ipcMain.handle(IPC.TableLayoutGet, (_e, path: unknown): Promise<TableLayout> =>
    Promise.resolve(isStr(path) ? readTableLayout(path) : {})
  )

  ipcMain.handle(IPC.TableLayoutSet, (_e, path: unknown, layout: unknown): Promise<void> => {
    if (isStr(path) && typeof layout === 'object' && layout !== null) {
      writeTableLayout(path, layout as TableLayout)
    }
    return Promise.resolve()
  })
}

function registerLifecycleHandlers(getWin: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.AppNotifyDirty, (_e, count: unknown): Promise<void> => {
    dirtyCount = typeof count === 'number' && count >= 0 ? Math.floor(count) : 0
    return Promise.resolve()
  })

  ipcMain.handle(IPC.AppConfirmClose, (_e, proceed: unknown): Promise<void> => {
    if (proceed === false) {
      // User cancelled the unsaved-changes dialog; allow re-querying later.
      resetQueryCloseSent()
      return Promise.resolve()
    }
    closingConfirmed = true
    resetQueryCloseSent()
    const w = getWin()
    if (w && !w.isDestroyed()) w.close()
    return Promise.resolve()
  })

  ipcMain.handle(IPC.AppReady, (): Promise<void> => {
    closingConfirmed = false
    resetQueryCloseSent()
    onAppReady()
    return Promise.resolve()
  })
}

export function registerIpcHandlers(ctx: IpcContext): void {
  setIpcContext(ctx)
  registerFileHandlers()
  registerSettingsHandlers()
  registerMiscHandlers()
  registerImageHandlers()
  registerExportHandlers()
  registerSnapshotHandlers()
  registerWorkspaceHandlers()
  registerWatchHandlers()
  registerThemeHandlers()
  registerTableLayoutHandlers()
  registerLifecycleHandlers(ctx.getWin)
}
