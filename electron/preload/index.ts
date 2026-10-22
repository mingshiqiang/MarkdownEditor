/**
 * Preload (sandboxed): exposes a strictly typed, whitelisted `window.api`
 * via contextBridge. This is the ONLY bridge between the sandboxed renderer
 * and Node/Electron capabilities (PRD §2.3).
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../../shared/types'
import type { UserTheme } from '../../shared/userTheme'
import type {
  Api,
  AppSettings,
  EffectiveTheme,
  ExternalChange,
  FileMeta,
  FileTreeNode,
  ImageInsertRequest,
  ImageInsertResult,
  ImageExportOptions,
  MenuAction,
  PdfExportOptions,
  RecentFile,
  SaveResult,
  SearchMatch,
  SearchMode,
  SnapshotInfo,
  TableLayout,
  ThemeSetting,
  Unsubscribe,
  UpdateEvent
} from '../../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  // file dialogs & io
  openFileDialog: () => ipcRenderer.invoke(IPC.FileOpenDialog) as Promise<FileMeta[]>,
  readFile: (path: string) => ipcRenderer.invoke(IPC.FileRead, path) as Promise<FileMeta | null>,
  writeFile: (path: string, content: string) =>
    ipcRenderer.invoke(IPC.FileWrite, path, content) as Promise<SaveResult | null>,
  saveAsDialog: (suggestedName: string) =>
    ipcRenderer.invoke(IPC.FileSaveAsDialog, suggestedName) as Promise<string | null>,
  pickDirectory: () => ipcRenderer.invoke(IPC.FilePickDirectory) as Promise<string | null>,
  // recent
  getRecent: () => ipcRenderer.invoke(IPC.FileGetRecent) as Promise<RecentFile[]>,
  appendRecent: (path: string) =>
    ipcRenderer.invoke(IPC.FileAppendRecent, path) as Promise<RecentFile[]>,
  clearRecent: () => ipcRenderer.invoke(IPC.FileClearRecent) as Promise<RecentFile[]>,
  // settings & system
  getSettings: () => ipcRenderer.invoke(IPC.SettingsGet) as Promise<AppSettings>,
  setSettings: (settings) => ipcRenderer.invoke(IPC.SettingsSet, settings) as Promise<AppSettings>,
  getSystemTheme: () => ipcRenderer.invoke(IPC.SystemThemeGet) as Promise<EffectiveTheme>,
  setNativeTheme: (theme: ThemeSetting) =>
    ipcRenderer.invoke(IPC.NativeThemeSet, theme) as Promise<void>,
  setAcceleratorsSuspended: (suspended: boolean) =>
    ipcRenderer.invoke(IPC.KeymapSuspend, suspended) as Promise<void>,
  // user themes (U-02)
  listUserThemes: () => ipcRenderer.invoke(IPC.ThemesList) as Promise<UserTheme[]>,
  openUserThemesFolder: () => ipcRenderer.invoke(IPC.ThemesOpenFolder) as Promise<void>,
  createExampleUserTheme: () =>
    ipcRenderer.invoke(IPC.ThemesCreateExample) as Promise<string | null>,
  // misc
  clipboardWriteText: (text: string) =>
    ipcRenderer.invoke(IPC.ClipboardWriteText, text) as Promise<void>,
  clipboardWriteHtml: (html: string, text: string) =>
    ipcRenderer.invoke(IPC.ClipboardWriteHtml, html, text) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke(IPC.ShellOpenExternal, url) as Promise<void>,
  resolvePath: (baseDir: string, relPath: string) =>
    ipcRenderer.invoke(IPC.UtilResolvePath, baseDir, relPath) as Promise<string | null>,
  // images
  insertImage: (req: ImageInsertRequest) =>
    ipcRenderer.invoke(IPC.ImageInsert, req) as Promise<ImageInsertResult | null>,
  downloadImage: (url: string, docPath: string | null, settings: AppSettings) =>
    ipcRenderer.invoke(
      IPC.ImageDownload,
      url,
      docPath,
      settings
    ) as Promise<ImageInsertResult | null>,
  uploadImage: (filePath: string, settings: AppSettings) =>
    ipcRenderer.invoke(IPC.ImageUpload, filePath, settings) as Promise<string | null>,
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  // export (M4)
  exportHtml: (html: string, suggestedName: string) =>
    ipcRenderer.invoke(IPC.ExportHtml, html, suggestedName) as Promise<string | null>,
  exportPdf: (html: string, suggestedName: string, options: PdfExportOptions) =>
    ipcRenderer.invoke(IPC.ExportPdf, html, suggestedName, options) as Promise<string | null>,
  exportDocx: (bytes: ArrayBuffer, suggestedName: string) =>
    ipcRenderer.invoke(IPC.ExportDocx, bytes, suggestedName) as Promise<string | null>,
  exportImage: (html: string, suggestedName: string, options: ImageExportOptions) =>
    ipcRenderer.invoke(IPC.ExportImage, html, suggestedName, options) as Promise<string | null>,
  // snapshots (crash recovery)
  writeSnapshot: (path: string, content: string, fileMtime = 0) =>
    ipcRenderer.invoke(IPC.SnapshotWrite, path, content, fileMtime) as Promise<boolean>,
  listSnapshots: () => ipcRenderer.invoke(IPC.SnapshotList) as Promise<SnapshotInfo[]>,
  readSnapshot: (id: string) => ipcRenderer.invoke(IPC.SnapshotRead, id) as Promise<string | null>,
  clearSnapshot: (id: string) => ipcRenderer.invoke(IPC.SnapshotClear, id) as Promise<void>,
  // workspace (M3)
  openFolder: () => ipcRenderer.invoke(IPC.WorkspaceOpenFolder) as Promise<string | null>,
  readWorkspaceTree: (root: string) =>
    ipcRenderer.invoke(IPC.WorkspaceReadTree, root) as Promise<FileTreeNode[]>,
  createWorkspaceEntry: (parent: string, name: string, type: 'file' | 'directory') =>
    ipcRenderer.invoke(IPC.WorkspaceCreate, parent, name, type) as Promise<boolean>,
  renameWorkspaceEntry: (path: string, newName: string) =>
    ipcRenderer.invoke(IPC.WorkspaceRename, path, newName) as Promise<boolean>,
  deleteWorkspaceEntry: (path: string) =>
    ipcRenderer.invoke(IPC.WorkspaceDelete, path) as Promise<boolean>,
  moveWorkspaceEntry: (from: string, toDir: string) =>
    ipcRenderer.invoke(IPC.WorkspaceMove, from, toDir) as Promise<boolean>,
  searchWorkspace: (root: string, query: string, mode: SearchMode) =>
    ipcRenderer.invoke(IPC.WorkspaceSearch, root, query, mode) as Promise<SearchMatch[]>,
  // watching
  syncWatch: (paths: string[]) => ipcRenderer.invoke(IPC.WatchSync, paths) as Promise<void>,
  // table column widths (persisted per document)
  getTableLayout: (path: string) =>
    ipcRenderer.invoke(IPC.TableLayoutGet, path) as Promise<TableLayout>,
  setTableLayout: (path: string, layout: TableLayout) =>
    ipcRenderer.invoke(IPC.TableLayoutSet, path, layout) as Promise<void>,
  // lifecycle
  notifyDirty: (dirtyCount: number) =>
    ipcRenderer.invoke(IPC.AppNotifyDirty, dirtyCount) as Promise<void>,
  confirmClose: (proceed: boolean) =>
    ipcRenderer.invoke(IPC.AppConfirmClose, proceed) as Promise<void>,
  appReady: () => ipcRenderer.invoke(IPC.AppReady) as Promise<void>,
  // auto update (S-05)
  checkForUpdates: () => ipcRenderer.invoke(IPC.UpdateCheck) as Promise<void>,
  onUpdateEvent: (cb: (event: UpdateEvent) => void) => subscribe<UpdateEvent>(IPC.UpdateEvent, cb),
  // main -> renderer
  onMenuAction: (cb: (action: MenuAction) => void) => subscribe<MenuAction>(IPC.MenuAction, cb),
  onOpenFile: (cb: (path: string) => void) => subscribe<string>(IPC.OpenFile, cb),
  onOpenWorkspace: (cb: (path: string) => void) => subscribe<string>(IPC.WorkspaceOpenPath, cb),
  onExternalChange: (cb: (change: ExternalChange) => void) =>
    subscribe<ExternalChange>(IPC.ExternalChange, cb),
  onSystemTheme: (cb: (theme: EffectiveTheme) => void) =>
    subscribe<EffectiveTheme>(IPC.SystemTheme, cb),
  onQueryClose: (cb: () => void) => subscribe<void>(IPC.QueryClose, () => cb())
}

contextBridge.exposeInMainWorld('api', api)
