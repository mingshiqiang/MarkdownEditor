/**
 * Native menu (U-05): locale-aware (zh-CN/en), dynamic "Recent Files" submenu,
 * mode radios reflecting persisted settings, platform-adapted structure.
 *
 * Accelerators come from the user's keymap (shared/keymap.ts). Menu items
 * either use Electron roles (edit ops) or send IPC actions that the renderer
 * dispatches to the active editor.
 */
import { app, dialog, Menu, type BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import type {
  AppMenuId,
  AppSettings,
  MenuAction,
  MenuActionId,
  RecentFile
} from '../../shared/types'
import { resolveKeymap, type KeyActionId } from '../../shared/keymap'
import { dictionaries, resolveLocale } from '../../shared/i18n'

export interface MenuContext {
  settings: AppSettings
  recent: RecentFile[]
}

let acceleratorsSuspended = false
let popupMenus: Partial<Record<AppMenuId, Menu>> = {}

/** Open a top-level menu from the custom title bar. */
export function popupAppMenu(id: AppMenuId, win: BrowserWindow, x: number, y: number): void {
  const menu = popupMenus[id]
  if (!menu || win.isDestroyed()) return
  menu.popup({
    window: win,
    x: Number.isFinite(x) ? Math.max(0, Math.round(x)) : undefined,
    y: Number.isFinite(y) ? Math.max(0, Math.round(y)) : undefined
  })
}

/**
 * While a shortcut is being recorded in the preferences, the menu accelerators
 * are removed so that the pressed combination reaches the recorder instead of
 * triggering an action. The caller rebuilds the menu afterwards.
 */
export function setAcceleratorsSuspended(suspended: boolean): void {
  acceleratorsSuspended = suspended
}

export function buildAppMenu(win: BrowserWindow, ctx: MenuContext): void {
  const isMac = process.platform === 'darwin'
  const locale = resolveLocale(ctx.settings.locale, app.getLocale())
  const s = dictionaries[locale]
  const keys = resolveKeymap(ctx.settings.keymap)
  const mode = ctx.settings.mode

  const send = (action: MenuAction) => {
    if (!win.isDestroyed()) win.webContents.send(IPC.MenuAction, action)
  }
  const accel = (id: KeyActionId): string | undefined =>
    acceleratorsSuspended ? undefined : keys[id] || undefined
  /** A plain action item bound to a keymap entry. */
  const action = (
    id: MenuActionId,
    label: string,
    keyId?: KeyActionId
  ): Electron.MenuItemConstructorOptions => ({
    label,
    accelerator: keyId ? accel(keyId) : undefined,
    click: () => send({ id })
  })

  const fileMenu: Electron.MenuItemConstructorOptions = {
    label: s.menu.file,
    submenu: [
      action('file:new', s.menu.new, 'file:new'),
      action('file:open', s.menu.open, 'file:open'),
      {
        label: s.menu.recent,
        submenu: ctx.recent.length
          ? [
              ...ctx.recent.map((r) => ({
                label: r.name,
                click: () => send({ id: 'file:open-recent', payload: r.path })
              })),
              { type: 'separator' },
              action('file:clear-recent', s.menu.recentClear)
            ]
          : [{ label: s.menu.recentEmpty, enabled: false }]
      },
      { type: 'separator' },
      action('file:open-folder', s.menu.openFolder, 'file:open-folder'),
      action('file:save', s.menu.save, 'file:save'),
      action('file:save-as', s.menu.saveAs, 'file:save-as'),
      { type: 'separator' },
      {
        label: s.menu.export,
        submenu: [
          action('file:export-pdf', s.menu.exportPdf, 'file:export-pdf'),
          action('file:export-html', s.menu.exportHtml, 'file:export-html'),
          action('file:export-word', s.menu.exportWord, 'file:export-word'),
          action('file:export-image', s.menu.exportImage, 'file:export-image')
        ]
      },
      action('file:upload-images', s.menu.uploadImages, 'file:upload-images'),
      { type: 'separator' },
      action('view:settings', s.menu.preferences, 'view:settings'),
      { type: 'separator' },
      action('file:close-tab', s.menu.closeTab, 'file:close-tab'),
      { type: 'separator' },
      isMac
        ? { role: 'quit', accelerator: accel('file:exit') }
        : { role: 'quit', label: s.menu.exit, accelerator: accel('file:exit') }
    ]
  }

  const editMenu: Electron.MenuItemConstructorOptions = {
    label: s.menu.edit,
    submenu: [
      { role: 'undo', label: s.menu.undo },
      { role: 'redo', label: s.menu.redo },
      { type: 'separator' },
      { role: 'cut', label: s.menu.cut },
      { role: 'copy', label: s.menu.copy },
      { role: 'paste', label: s.menu.paste },
      { role: 'selectAll', label: s.menu.selectAll },
      { type: 'separator' },
      action('edit:find', s.menu.find, 'edit:find'),
      action('edit:replace', s.menu.replace, 'edit:replace'),
      { type: 'separator' },
      action('edit:copy-rich', s.menu.copyRich, 'edit:copy-rich')
    ]
  }

  const modeItem = (id: MenuActionId, label: string, checked: boolean, keyId: KeyActionId) => ({
    label,
    type: 'radio' as const,
    checked,
    accelerator: accel(keyId),
    click: () => send({ id })
  })

  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: s.menu.view,
    submenu: [
      modeItem('view:mode-live', s.menu.modeLive, mode === 'live', 'view:mode-live'),
      modeItem('view:mode-source', s.menu.modeSource, mode === 'source', 'view:mode-source'),
      modeItem('view:mode-preview', s.menu.modePreview, mode === 'preview', 'view:mode-preview'),
      action('view:cycle-mode', s.menu.cycleMode, 'view:cycle-mode'),
      { type: 'separator' },
      action('view:theme-toggle', s.menu.themeToggle, 'view:theme-toggle'),
      { type: 'separator' },
      action('view:toggle-sidebar', s.menu.toggleSidebar, 'view:toggle-sidebar'),
      action('view:toggle-focus-mode', s.menu.focusMode, 'view:toggle-focus-mode'),
      action('view:toggle-typewriter', s.menu.typewriterMode, 'view:toggle-typewriter'),
      action('view:toggle-split', s.menu.splitView, 'view:toggle-split'),
      { type: 'separator' },
      action('view:next-tab', s.menu.nextTab, 'view:next-tab'),
      action('view:prev-tab', s.menu.prevTab, 'view:prev-tab'),
      { type: 'separator' },
      { role: 'togglefullscreen' }
    ]
  }

  const helpMenu: Electron.MenuItemConstructorOptions = {
    label: s.menu.help,
    submenu: [
      {
        label: s.menu.checkUpdates,
        click: () => send({ id: 'help:check-updates' })
      },
      { type: 'separator' },
      {
        label: s.menu.about,
        click: () =>
          dialog.showMessageBox(win, {
            type: 'info',
            title: s.menu.about,
            message: 'MarkdownEditor',
            detail: `${s.ui.version}: ${app.getVersion()}`,
            buttons: [s.ui.close],
            defaultId: 0,
            noLink: true
          })
      }
    ]
  }

  const template: Electron.MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            action('view:settings', s.menu.preferences, 'view:settings'),
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', accelerator: accel('file:exit') }
          ]
        },
        fileMenu,
        editMenu,
        viewMenu,
        { role: 'windowMenu' },
        helpMenu
      ]
    : [fileMenu, editMenu, viewMenu, helpMenu]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  // The frameless window has no native menu bar. Reuse the exact same items
  // (roles, submenus, radios, recent files and accelerators) as native popups.
  const submenu = (item: Electron.MenuItemConstructorOptions) =>
    Menu.buildFromTemplate((item.submenu as Electron.MenuItemConstructorOptions[]) ?? [])
  popupMenus = {
    file: submenu(fileMenu),
    edit: submenu(editMenu),
    view: submenu(viewMenu),
    help: submenu(helpMenu)
  }
}
