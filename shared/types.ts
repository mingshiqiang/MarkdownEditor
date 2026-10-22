/**
 * Shared types between the main process, the preload script and the renderer.
 * Keep this module dependency-free (types + plain consts only) so it can be
 * bundled into every process by electron-vite.
 */
import type { AppActionId } from './keymap'
import type { UserTheme } from './userTheme'

/* ---------------------------------- app ---------------------------------- */

export type EditorMode = 'live' | 'source' | 'preview'
/** Built-in themes. A user theme is referenced as `user:<id>` (see shared/userTheme.ts). */
export type BuiltinTheme = 'light' | 'light-warm' | 'dark' | 'dark-purple'
export type ThemeSetting = 'auto' | BuiltinTheme | `user:${string}`
/** The built-in theme that is actually applied (user themes map to their base). */
export type EffectiveTheme = BuiltinTheme
export type LocaleSetting = 'auto' | 'zh-CN' | 'en'
export type Locale = 'zh-CN' | 'en'
export type ImageStoreMode = 'assets' | 'global' | 'none'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'auto',
  mode: 'live',
  locale: 'auto',
  autosave: { enabled: true, intervalSec: 30, onBlur: true },
  imageStore: { mode: 'assets', globalDir: '' },
  imageHost: {
    enabled: false,
    url: '',
    field: 'file',
    headers: '',
    responsePath: 'url'
  },
  editor: {
    fontFamily: "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    monoFontFamily: "'Cascadia Code', Consolas, 'JetBrains Mono', monospace",
    fontSize: 16,
    lineHeight: 1.7,
    contentMaxWidth: 820,
    spellcheck: false,
    spellcheckLang: 'en-US'
  },
  workspace: {
    sidebarVisible: true,
    sidebarView: 'files',
    focusMode: false,
    typewriterMode: false,
    rootPath: '',
    splitView: false,
    secondDocId: ''
  },
  tray: { enabled: true, closeToTray: false },
  updates: { autoCheck: true, feedUrl: '' },
  keymap: {}
}

export interface AppSettings {
  theme: ThemeSetting
  mode: EditorMode
  locale: LocaleSetting
  autosave: { enabled: boolean; intervalSec: number; onBlur: boolean }
  imageStore: { mode: ImageStoreMode; globalDir: string }
  /** Image host (X-06): a generic multipart upload endpoint. */
  imageHost: {
    enabled: boolean
    /** Upload endpoint. */
    url: string
    /** Form field name of the uploaded file. */
    field: string
    /** Extra request headers, one "Key: Value" per line. */
    headers: string
    /** Dotted path of the image URL inside the JSON response, e.g. "data.url". */
    responsePath: string
  }
  /** Shortcut overrides (action id -> accelerator, '' = unbound); see shared/keymap.ts. */
  keymap: Record<string, string>
  editor: {
    fontFamily: string
    monoFontFamily: string
    fontSize: number
    lineHeight: number
    contentMaxWidth: number
    /** Spell checking (E-15). */
    spellcheck: boolean
    spellcheckLang: string
  }
  /** Sidebar & writing aids (M3). */
  workspace: {
    sidebarVisible: boolean
    sidebarView: 'files' | 'outline' | 'search'
    focusMode: boolean
    typewriterMode: boolean
    /** Last opened workspace folder (restored on startup). */
    rootPath: string
    /** Split editing: a second pane next to the main editor. */
    splitView: boolean
    secondDocId: string
  }
  /** System tray (S-06). */
  tray: {
    /** Show the tray icon. */
    enabled: boolean
    /** Closing the window hides it instead of quitting the app. */
    closeToTray: boolean
  }
  /** Auto update (S-05). */
  updates: {
    /** Check for updates when the app starts. */
    autoCheck: boolean
    /** Generic update feed URL; empty = use the build configuration. */
    feedUrl: string
  }
}

/* ---------------------------------- docs --------------------------------- */

export interface FileMeta {
  path: string
  name: string
  dir: string
  size: number
  mtimeMs: number
  content: string
  /** The encoding the file was read with (e.g. `utf-8`, `gb18030`). */
  encoding: string
}

export interface RecentFile {
  path: string
  name: string
  ts: number
}

export interface SaveResult {
  path: string
  name: string
  dir: string
  mtimeMs: number
  size: number
}

/* --------------------------------- images -------------------------------- */

export interface ImageInsertRequest {
  source:
    | { kind: 'buffer'; name: string; bytes: ArrayBuffer; mime: string }
    | { kind: 'file'; absPath: string }
  /** Absolute path of the markdown document (null = untitled). */
  docPath: string | null
  settings: AppSettings
}

export interface ImageInsertResult {
  /** Absolute location the image file ended up at. */
  absPath: string
  /** Path to embed into the markdown text (relative or absolute per mode). */
  mdPath: string
}

/* --------------------------------- events -------------------------------- */

/** Actions sent from the native menu / window key handler to the renderer. */
export type MenuActionId =
  AppActionId | 'file:exit' | 'file:clear-recent' | 'help:about' | 'help:check-updates'

export interface MenuAction {
  id: MenuActionId | 'file:open-recent'
  payload?: string
}

export interface ExternalChange {
  path: string
  kind: 'change' | 'unlink'
}

/* -------------------------------- workspace ------------------------------- */

export interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  size?: number
  mtimeMs?: number
  /** True for markdown documents (highlighted in the tree). */
  markdown?: boolean
  /** True for image files (highlighted in the tree). */
  image?: boolean
}

export interface SearchMatch {
  path: string
  name: string
  /** 1-based line number. */
  line: number
  /** 1-based column of the match. */
  column: number
  preview: string
}

export interface WorkspaceInfo {
  root: string
  nodes: FileTreeNode[]
}

export type SearchMode = 'name' | 'content'

/** Column widths of the tables of a document (table key -> widths in px). */
export type TableLayout = Record<string, number[]>

/* --------------------------------- export --------------------------------- */

export type ExportFormat = 'html' | 'pdf' | 'docx' | 'png'

export interface ImageExportOptions {
  /** CSS width of the exported image. */
  width: number
  /** Render scale (1 = 1 CSS pixel per image pixel, 2 = retina). */
  scale: number
  /** Page background behind the content. */
  background: 'light' | 'dark' | 'transparent'
}

export interface PdfExportOptions {
  pageSize: 'A4' | 'Letter' | 'A3' | 'Legal'
  landscape: boolean
  marginType: 'default' | 'none' | 'custom'
  margins: { top: number; bottom: number; left: number; right: number }
  printBackground: boolean
  scale: number
  footer: string
}

export interface SnapshotInfo {
  id: string
  path: string
  name: string
  ts: number
  size: number
  fileMtime: number
}

/* --------------------------------- updates -------------------------------- */

export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'unsupported'

export interface UpdateEvent {
  status: UpdateStatus
  version?: string
  percent?: number
  message?: string
}

/* --------------------------------- channels ------------------------------- */

export const IPC = {
  // file
  FileOpenDialog: 'file:open-dialog',
  FileRead: 'file:read',
  FileWrite: 'file:write',
  FileSaveAsDialog: 'file:save-as-dialog',
  FileGetRecent: 'file:get-recent',
  FileAppendRecent: 'file:append-recent',
  FileClearRecent: 'file:clear-recent',
  FilePickDirectory: 'file:pick-directory',
  // export (M4)
  ExportHtml: 'export:html',
  ExportPdf: 'export:pdf',
  ExportDocx: 'export:docx',
  ExportImage: 'export:image',
  // snapshots (crash recovery)
  SnapshotWrite: 'snapshot:write',
  SnapshotList: 'snapshot:list',
  SnapshotRead: 'snapshot:read',
  SnapshotClear: 'snapshot:clear',
  // workspace (M3)
  WorkspaceOpenFolder: 'workspace:open-folder',
  WorkspaceOpenPath: 'workspace:open-path',
  WorkspaceReadTree: 'workspace:read-tree',
  WorkspaceCreate: 'workspace:create',
  WorkspaceRename: 'workspace:rename',
  WorkspaceDelete: 'workspace:delete',
  WorkspaceMove: 'workspace:move',
  WorkspaceSearch: 'workspace:search',
  // settings / misc
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',
  SystemThemeGet: 'system-theme:get',
  NativeThemeSet: 'native-theme:set',
  // keyboard: menu accelerators are removed while a shortcut is recorded
  KeymapSuspend: 'keymap:suspend',
  // auto update (S-05)
  UpdateCheck: 'update:check',
  UpdateEvent: 'update:event',
  ClipboardWriteText: 'clipboard:write-text',
  ClipboardWriteHtml: 'clipboard:write-html',
  ShellOpenExternal: 'shell:open-external',
  UtilResolvePath: 'util:resolve-path',
  // images
  ImageInsert: 'image:insert',
  ImageDownload: 'image:download',
  ImageUpload: 'image:upload',
  // user themes (U-02)
  ThemesList: 'themes:list',
  ThemesOpenFolder: 'themes:open-folder',
  ThemesCreateExample: 'themes:create-example',
  // watching
  WatchSync: 'watch:sync',
  // table column widths (display state, persisted per document)
  TableLayoutGet: 'table-layout:get',
  TableLayoutSet: 'table-layout:set',
  // window lifecycle
  AppNotifyDirty: 'app:notify-dirty',
  AppConfirmClose: 'app:confirm-close',
  AppReady: 'app:ready',
  // main -> renderer events
  MenuAction: 'menu:action',
  OpenFile: 'open:file',
  ExternalChange: 'fs:external-change',
  SystemTheme: 'native-theme:changed',
  QueryClose: 'app:query-close'
} as const

/* ---------------------------------- api ----------------------------------- */

export interface Api {
  // file dialogs & io
  openFileDialog(): Promise<FileMeta[]>
  readFile(path: string): Promise<FileMeta | null>
  writeFile(path: string, content: string): Promise<SaveResult | null>
  saveAsDialog(suggestedName: string): Promise<string | null>
  pickDirectory(): Promise<string | null>
  // recent
  getRecent(): Promise<RecentFile[]>
  appendRecent(path: string): Promise<RecentFile[]>
  clearRecent(): Promise<RecentFile[]>
  // settings & system
  getSettings(): Promise<AppSettings>
  setSettings(settings: AppSettings): Promise<AppSettings>
  getSystemTheme(): Promise<EffectiveTheme>
  setNativeTheme(theme: ThemeSetting): Promise<void>
  // user themes (U-02)
  listUserThemes(): Promise<UserTheme[]>
  openUserThemesFolder(): Promise<void>
  /** Writes the example theme (keeps an existing file) and returns its path. */
  createExampleUserTheme(): Promise<string | null>
  /** Temporarily drop menu accelerators (while the shortcut recorder is open). */
  setAcceleratorsSuspended(suspended: boolean): Promise<void>
  // misc
  clipboardWriteText(text: string): Promise<void>
  /** Copy rich text (HTML) with a plain text fallback (X-05). */
  clipboardWriteHtml(html: string, text: string): Promise<void>
  openExternal(url: string): Promise<void>
  resolvePath(baseDir: string, relPath: string): Promise<string | null>
  // images
  insertImage(req: ImageInsertRequest): Promise<ImageInsertResult | null>
  /** Download a remote image and store it locally (E-09). */
  downloadImage(
    url: string,
    docPath: string | null,
    settings: AppSettings
  ): Promise<ImageInsertResult | null>
  /** Upload a local image to the configured image host (X-06). */
  uploadImage(filePath: string, settings: AppSettings): Promise<string | null>
  // drag & drop: File -> absolute path (Electron >= 32 way)
  pathForFile(file: File): string
  // export (M4)
  exportHtml(html: string, suggestedName: string): Promise<string | null>
  exportPdf(html: string, suggestedName: string, options: PdfExportOptions): Promise<string | null>
  exportDocx(bytes: ArrayBuffer, suggestedName: string): Promise<string | null>
  /** Long image export (X-04). */
  exportImage(
    html: string,
    suggestedName: string,
    options: ImageExportOptions
  ): Promise<string | null>
  // snapshots (crash recovery)
  writeSnapshot(path: string, content: string, fileMtime?: number): Promise<boolean>
  listSnapshots(): Promise<SnapshotInfo[]>
  readSnapshot(id: string): Promise<string | null>
  clearSnapshot(id: string): Promise<void>
  // workspace (M3)
  openFolder(): Promise<string | null>
  readWorkspaceTree(root: string): Promise<FileTreeNode[]>
  createWorkspaceEntry(parent: string, name: string, type: 'file' | 'directory'): Promise<boolean>
  renameWorkspaceEntry(path: string, newName: string): Promise<boolean>
  deleteWorkspaceEntry(path: string): Promise<boolean>
  moveWorkspaceEntry(from: string, toDir: string): Promise<boolean>
  searchWorkspace(root: string, query: string, mode: SearchMode): Promise<SearchMatch[]>
  // watching
  syncWatch(paths: string[]): Promise<void>
  // table column widths (persisted per document)
  getTableLayout(path: string): Promise<TableLayout>
  setTableLayout(path: string, layout: TableLayout): Promise<void>
  // lifecycle
  notifyDirty(dirtyCount: number): Promise<void>
  /** Confirm or cancel the pending dirty-close dialog. */
  confirmClose(proceed: boolean): Promise<void>
  appReady(): Promise<void>
  // auto update (S-05)
  checkForUpdates(): Promise<void>
  onUpdateEvent(cb: (event: UpdateEvent) => void): Unsubscribe
  // main -> renderer
  onMenuAction(cb: (action: MenuAction) => void): Unsubscribe
  onOpenFile(cb: (path: string) => void): Unsubscribe
  onOpenWorkspace(cb: (path: string) => void): Unsubscribe
  onExternalChange(cb: (change: ExternalChange) => void): Unsubscribe
  onSystemTheme(cb: (theme: EffectiveTheme) => void): Unsubscribe
  onQueryClose(cb: () => void): Unsubscribe
}

export type Unsubscribe = () => void
