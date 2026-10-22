/**
 * Renderer side of the keymap (U-05): the active shortcut table, the platform
 * flag and the matchers used by the window key handler and the editor.
 * The table is rebuilt whenever the user changes a shortcut.
 */
import {
  KEY_ACTIONS,
  matchesShortcut,
  parseAccelerator,
  resolveKeymap,
  type AppActionId,
  type KeyActionId,
  type Shortcut
} from '../../shared/keymap'

export const IS_MAC =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

interface Binding {
  id: KeyActionId
  scope: 'menu' | 'window' | 'editor'
  shortcut: Shortcut
}

let bindings: Binding[] = []
let suspended = false

/** Rebuild the active table from the user's overrides. */
export function applyKeymap(overrides: Record<string, string> | null | undefined): void {
  const map = resolveKeymap(overrides)
  const next: Binding[] = []
  for (const def of KEY_ACTIONS) {
    const shortcut = map[def.id] ? parseAccelerator(map[def.id]) : null
    if (shortcut) next.push({ id: def.id, scope: def.scope, shortcut })
  }
  bindings = next
}

/** Pause all shortcut handling (while the preferences record a new key). */
export function setShortcutsSuspended(value: boolean): void {
  suspended = value
}

function find(e: KeyboardEvent, scopes: readonly Binding['scope'][]): KeyActionId | null {
  // Never interfere with IME composition (E-17).
  if (suspended || e.isComposing) return null
  for (const b of bindings) {
    if (scopes.includes(b.scope) && matchesShortcut(e, b.shortcut, IS_MAC)) return b.id
  }
  return null
}

/** Menu / window actions bound to this key press (browser fallback path). */
export function matchAppShortcut(e: KeyboardEvent): AppActionId | null {
  return find(e, ['menu', 'window']) as AppActionId | null
}

/** Editor commands bound to this key press. */
export function matchEditorShortcut(e: KeyboardEvent): KeyActionId | null {
  return find(e, ['editor'])
}
