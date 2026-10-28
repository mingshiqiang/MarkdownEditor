/**
 * Browser fallback for the preload bridge.
 *
 * In Electron the preload script always provides `window.api`. When the
 * renderer is opened in a plain browser (e.g. for UI preview during
 * development) this mock keeps the app usable: settings fall back to
 * defaults and file operations become no-ops.
 */
import { DEFAULT_SETTINGS } from '../../shared/types'
import { EXAMPLE_USER_THEME, parseUserTheme, type UserTheme } from '../../shared/userTheme'
import type {
  Api,
  AppMenuId,
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

const noopUnsubscribe: Unsubscribe = () => {}

/** Small fake workspace so the sidebar can be exercised in a browser preview. */
const MOCK_ROOT = 'C:/Users/demo/notes'
const MOCK_NODES: FileTreeNode[] = [
  {
    name: 'docs',
    path: `${MOCK_ROOT}/docs`,
    type: 'directory',
    children: [
      {
        name: 'guide.md',
        path: `${MOCK_ROOT}/docs/guide.md`,
        type: 'file',
        markdown: true,
        size: 120
      },
      {
        name: 'notes',
        path: `${MOCK_ROOT}/docs/notes`,
        type: 'directory',
        children: [
          {
            name: 'todo.md',
            path: `${MOCK_ROOT}/docs/notes/todo.md`,
            type: 'file',
            markdown: true,
            size: 40
          }
        ]
      }
    ]
  },
  {
    name: 'README.md',
    path: `${MOCK_ROOT}/README.md`,
    type: 'file',
    markdown: true,
    size: 200
  },
  {
    name: 'cover.png',
    path: `${MOCK_ROOT}/cover.png`,
    type: 'file',
    image: true,
    size: 1024
  }
]

export function createMockApi(): Api {
  const settings: AppSettings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  // The browser preview has no native menu, so the menu actions can be
  // triggered from the console: window.__mdeMenu('file:export-pdf').
  const menuCallbacks: ((action: MenuAction) => void)[] = []
  const maximizedCallbacks: ((maximized: boolean) => void)[] = []
  let maximized = false
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__mdeMenu = (id: string, payload?: string) => {
      for (const cb of menuCallbacks) cb({ id: id as MenuAction['id'], payload })
    }
  }
  return {
    openFileDialog: async (): Promise<FileMeta[]> => [],
    readFile: async (path: string): Promise<FileMeta | null> => {
      const name = path.split(/[\\/]/).pop() ?? path
      if (!MOCK_NODES.length) return null
      return {
        path,
        name,
        dir: path.replace(/[\\/][^\\/]*$/, ''),
        size: 128,
        mtimeMs: Date.now(),
        content: `# ${name}\n\n模拟文档内容\n\n## 小节\n\n更多内容\n`,
        encoding: 'utf-8'
      }
    },
    writeFile: async (): Promise<SaveResult | null> => null,
    saveAsDialog: async (): Promise<string | null> => null,
    pickDirectory: async (): Promise<string | null> => null,
    getRecent: async (): Promise<RecentFile[]> => [],
    appendRecent: async (): Promise<RecentFile[]> => [],
    clearRecent: async (): Promise<RecentFile[]> => [],
    getSettings: async (): Promise<AppSettings> => settings,
    setSettings: async (next: AppSettings): Promise<AppSettings> => {
      Object.assign(settings, next)
      return settings
    },
    getSystemTheme: async (): Promise<EffectiveTheme> => 'light',
    setNativeTheme: async (_theme: ThemeSetting): Promise<void> => {},
    setAcceleratorsSuspended: async (_suspended: boolean): Promise<void> => {},
    listUserThemes: async (): Promise<UserTheme[]> => [
      parseUserTheme('example-ocean.css', EXAMPLE_USER_THEME)
    ],
    openUserThemesFolder: async (): Promise<void> => {},
    createExampleUserTheme: async (): Promise<string | null> => null,
    clipboardWriteText: async (text: string): Promise<void> => {
      try {
        await navigator.clipboard?.writeText(text)
      } catch {
        /* ignore */
      }
    },
    clipboardWriteHtml: async (_html: string, _text: string): Promise<void> => {},
    openExternal: async (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener')
    },
    resolvePath: async (baseDir: string, relPath: string): Promise<string | null> => {
      if (/^https?:/i.test(relPath)) return relPath
      const base = baseDir.replace(/\\/g, '/').replace(/\/+$/, '')
      return `${base}/${relPath.replace(/^\.?\//, '')}`
    },
    insertImage: async (_req: ImageInsertRequest): Promise<ImageInsertResult | null> => null,
    downloadImage: async (
      _url: string,
      _docPath: string | null,
      _settings: AppSettings
    ): Promise<ImageInsertResult | null> => null,
    uploadImage: async (_filePath: string, _settings: AppSettings): Promise<string | null> => null,
    pathForFile: (_file: File): string => '',
    // export (M4)
    exportHtml: async (_html: string, _name: string): Promise<string | null> => null,
    exportPdf: async (
      _html: string,
      _name: string,
      _options: PdfExportOptions
    ): Promise<string | null> => null,
    exportDocx: async (_bytes: ArrayBuffer, _name: string): Promise<string | null> => null,
    exportImage: async (
      _html: string,
      _name: string,
      _options: ImageExportOptions
    ): Promise<string | null> => null,
    // snapshots (crash recovery)
    writeSnapshot: async (_path: string, _content: string, _fileMtime = 0) => true,
    listSnapshots: async (): Promise<SnapshotInfo[]> => [],
    readSnapshot: async (_id: string): Promise<string | null> => null,
    clearSnapshot: async (_id: string): Promise<void> => {},
    // workspace (M3)
    openFolder: async (): Promise<string | null> => MOCK_ROOT,
    readWorkspaceTree: async (_root: string): Promise<FileTreeNode[]> =>
      JSON.parse(JSON.stringify(MOCK_NODES)),
    createWorkspaceEntry: async (
      _parent: string,
      _name: string,
      _type: 'file' | 'directory'
    ): Promise<boolean> => true,
    renameWorkspaceEntry: async (_path: string, _newName: string): Promise<boolean> => true,
    deleteWorkspaceEntry: async (_path: string): Promise<boolean> => true,
    moveWorkspaceEntry: async (_from: string, _toDir: string): Promise<boolean> => true,
    searchWorkspace: async (
      _root: string,
      query: string,
      mode: SearchMode
    ): Promise<SearchMatch[]> => {
      const q = query.toLowerCase()
      if (mode === 'name') {
        const flat: FileTreeNode[] = []
        const walk = (nodes: FileTreeNode[]): void => {
          for (const node of nodes) {
            if (node.type === 'file') flat.push(node)
            if (node.children) walk(node.children)
          }
        }
        walk(MOCK_NODES)
        return flat
          .filter((n) => n.name.toLowerCase().includes(q))
          .map((n) => ({
            path: n.path,
            name: n.name,
            line: 0,
            column: 0,
            preview: n.path
          }))
      }
      return [
        {
          path: `${MOCK_ROOT}/docs/guide.md`,
          name: 'guide.md',
          line: 12,
          column: 4,
          preview: `包含关键词 ${query} 的一行`
        }
      ]
    },
    syncWatch: async (_paths: string[]): Promise<void> => {},
    getTableLayout: async (_path: string): Promise<TableLayout> => ({}),
    setTableLayout: async (_path: string, _layout: TableLayout): Promise<void> => {},
    popupAppMenu: async (_menu: AppMenuId, _x: number, _y: number): Promise<void> => {},
    windowMinimize: async (): Promise<void> => {},
    windowToggleMaximize: async (): Promise<boolean> => {
      maximized = !maximized
      for (const cb of maximizedCallbacks) cb(maximized)
      return maximized
    },
    windowClose: async (): Promise<void> => {},
    windowIsMaximized: async (): Promise<boolean> => maximized,
    onWindowMaximized: (cb: (value: boolean) => void): Unsubscribe => {
      maximizedCallbacks.push(cb)
      return () => {
        const index = maximizedCallbacks.indexOf(cb)
        if (index >= 0) maximizedCallbacks.splice(index, 1)
      }
    },
    notifyDirty: async (_count: number): Promise<void> => {},
    confirmClose: async (_proceed: boolean): Promise<void> => {},
    appReady: async (): Promise<void> => {},
    checkForUpdates: async (): Promise<void> => {},
    onUpdateEvent: (_cb: (event: UpdateEvent) => void): Unsubscribe => noopUnsubscribe,
    onMenuAction: (cb: (action: MenuAction) => void): Unsubscribe => {
      menuCallbacks.push(cb)
      return noopUnsubscribe
    },
    onOpenFile: (_cb: (path: string) => void): Unsubscribe => noopUnsubscribe,
    onOpenWorkspace: (_cb: (path: string) => void): Unsubscribe => noopUnsubscribe,
    onExternalChange: (_cb: (change: ExternalChange) => void): Unsubscribe => noopUnsubscribe,
    onSystemTheme: (_cb: (theme: EffectiveTheme) => void): Unsubscribe => noopUnsubscribe,
    onQueryClose: (_cb: () => void): Unsubscribe => noopUnsubscribe
  }
}

/** Install the fallback when the preload bridge is unavailable. */
export function ensureApi(): void {
  if (!window.api) {
    window.api = createMockApi()
    console.info('[mde] running without the Electron bridge (browser preview mode)')
  }
}
