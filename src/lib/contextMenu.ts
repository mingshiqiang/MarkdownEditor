/**
 * Global context-menu state shared by the editor, tabs and the file tree.
 *
 * Menu items are plain data with an optional action closure. Keeping the state
 * outside Pinia avoids serialising functions in devtools and lets editor code
 * open menus without importing the Vue app.
 */
import { reactive } from 'vue'

export interface ContextMenuItem {
  /** Stable id used as the Vue key. */
  id?: string
  label?: string
  /** Already formatted accelerator text (e.g. `Ctrl+B`). */
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  checked?: boolean
  separator?: boolean
  submenu?: ContextMenuItem[]
  action?: () => void | Promise<void>
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextMenuItem[]
  /** Bumped on every open so the menu component resets its internal state. */
  rev: number
  /** Called once when the menu closes (used to restore editor focus). */
  onClose: (() => void) | null
}

export const contextMenu = reactive<ContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  items: [],
  rev: 0,
  onClose: null
})

/** Open a menu at the pointer position. Replaces an already open menu. */
export function openContextMenu(
  event: MouseEvent | { clientX: number; clientY: number },
  items: ContextMenuItem[],
  onClose?: () => void
): void {
  if (!items.length) return
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.items = items
  contextMenu.onClose = onClose ?? null
  contextMenu.rev += 1
  contextMenu.open = true
}

export function closeContextMenu(): void {
  if (!contextMenu.open) return
  const onClose = contextMenu.onClose
  contextMenu.open = false
  contextMenu.items = []
  contextMenu.onClose = null
  onClose?.()
}

/** Close the menu and run the selected item's action. */
export async function runContextMenuAction(item: ContextMenuItem): Promise<void> {
  if (item.disabled || !item.action) return
  closeContextMenu()
  try {
    await item.action()
  } catch (err) {
    console.error('[context-menu]', err)
  }
}
