/**
 * Keyboard shortcuts (U-05).
 *
 * Every shortcut of the app is listed once in `KEY_ACTIONS` with its default
 * accelerator in Electron syntax (`CmdOrCtrl+Shift+S`). Users override them in
 * the preferences; the native menu, the window key handler and the editor
 * keymap all resolve the same table through `resolveKeymap`.
 *
 * Scopes:
 * - `menu`:   listed in the native menu; Electron handles the key and sends the action.
 * - `window`: no menu item; the renderer handles the key (used for Tab cycling).
 * - `editor`: CodeMirror commands, active while the editor has focus.
 *
 * Pure module (no Electron / DOM imports): shared by main, preload and renderer.
 */

export type ShortcutScope = 'menu' | 'window' | 'editor'
export type ShortcutGroup = 'file' | 'edit' | 'view' | 'markdown'

export const KEY_ACTIONS = [
  { id: 'file:new', group: 'file', scope: 'menu', key: 'CmdOrCtrl+N' },
  { id: 'file:open', group: 'file', scope: 'menu', key: 'CmdOrCtrl+O' },
  { id: 'file:open-folder', group: 'file', scope: 'menu', key: 'CmdOrCtrl+Shift+O' },
  { id: 'file:save', group: 'file', scope: 'menu', key: 'CmdOrCtrl+S' },
  { id: 'file:save-as', group: 'file', scope: 'menu', key: 'CmdOrCtrl+Shift+S' },
  { id: 'file:close-tab', group: 'file', scope: 'menu', key: 'CmdOrCtrl+W' },
  { id: 'file:exit', group: 'file', scope: 'menu', key: 'CmdOrCtrl+Q' },
  { id: 'file:export-pdf', group: 'file', scope: 'menu', key: '' },
  { id: 'file:export-html', group: 'file', scope: 'menu', key: '' },
  { id: 'file:export-word', group: 'file', scope: 'menu', key: '' },
  { id: 'file:export-image', group: 'file', scope: 'menu', key: '' },
  { id: 'file:upload-images', group: 'file', scope: 'menu', key: '' },
  { id: 'view:settings', group: 'file', scope: 'menu', key: 'CmdOrCtrl+,' },
  { id: 'edit:find', group: 'edit', scope: 'menu', key: 'CmdOrCtrl+F' },
  { id: 'edit:replace', group: 'edit', scope: 'menu', key: 'CmdOrCtrl+H' },
  { id: 'edit:copy-rich', group: 'edit', scope: 'menu', key: 'CmdOrCtrl+Shift+C' },
  { id: 'view:cycle-mode', group: 'view', scope: 'menu', key: 'CmdOrCtrl+/' },
  { id: 'view:mode-live', group: 'view', scope: 'menu', key: '' },
  { id: 'view:mode-source', group: 'view', scope: 'menu', key: '' },
  { id: 'view:mode-preview', group: 'view', scope: 'menu', key: '' },
  { id: 'view:theme-toggle', group: 'view', scope: 'menu', key: 'CmdOrCtrl+Shift+L' },
  { id: 'view:toggle-sidebar', group: 'view', scope: 'menu', key: 'CmdOrCtrl+Shift+B' },
  { id: 'view:toggle-focus-mode', group: 'view', scope: 'menu', key: 'CmdOrCtrl+Shift+F' },
  { id: 'view:toggle-typewriter', group: 'view', scope: 'menu', key: '' },
  { id: 'view:toggle-split', group: 'view', scope: 'menu', key: '' },
  { id: 'view:next-tab', group: 'view', scope: 'menu', key: 'CmdOrCtrl+Tab' },
  { id: 'view:prev-tab', group: 'view', scope: 'menu', key: 'CmdOrCtrl+Shift+Tab' },
  { id: 'markdown:heading-1', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+1' },
  { id: 'markdown:heading-2', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+2' },
  { id: 'markdown:heading-3', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+3' },
  { id: 'markdown:heading-4', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+4' },
  { id: 'markdown:heading-5', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+5' },
  { id: 'markdown:heading-6', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+6' },
  { id: 'markdown:bold', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+B' },
  { id: 'markdown:italic', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+I' },
  { id: 'markdown:strike', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+Shift+X' },
  { id: 'markdown:highlight', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+Shift+H' },
  { id: 'markdown:code', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+E' },
  { id: 'markdown:math', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+Shift+M' },
  { id: 'markdown:link', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+K' },
  { id: 'markdown:table', group: 'markdown', scope: 'editor', key: 'CmdOrCtrl+T' },
  { id: 'markdown:indent', group: 'markdown', scope: 'editor', key: 'Tab' },
  { id: 'markdown:outdent', group: 'markdown', scope: 'editor', key: 'Shift+Tab' }
] as const

export type KeyActionId = (typeof KEY_ACTIONS)[number]['id']
/** Actions that travel through the menu / window key path (not the editor). */
export type AppActionId = Extract<(typeof KEY_ACTIONS)[number], { scope: 'menu' | 'window' }>['id']
export type Keymap = Record<KeyActionId, string>

/* ------------------------------ parsing ---------------------------------- */

/** A parsed accelerator. `mod` is Cmd on macOS and Ctrl elsewhere. */
export interface Shortcut {
  mod: boolean
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
  /** Lower-case key name: `s`, `1`, `,`, `tab`, `f5`, `up`, `+` … */
  key: string
}

const MODIFIER_TOKENS: Record<string, keyof Omit<Shortcut, 'key'>> = {
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
  cmd: 'meta',
  command: 'meta',
  meta: 'meta',
  super: 'meta',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift'
}

const KEY_ALIASES: Record<string, string> = {
  plus: '+',
  space: 'space',
  tab: 'tab',
  enter: 'enter',
  return: 'enter',
  escape: 'escape',
  esc: 'escape',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  up: 'up',
  arrowup: 'up',
  down: 'down',
  arrowdown: 'down',
  left: 'left',
  arrowleft: 'left',
  right: 'right',
  arrowright: 'right'
}

const PUNCTUATION = ",./;'[]\\-=`"

const DISPLAY_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  escape: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  '+': 'Plus'
}

function normalizeKeyName(raw: string): string | null {
  const lower = raw.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(KEY_ALIASES, lower)) return KEY_ALIASES[lower]
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower
  if (raw === '+') return '+'
  if (raw.length === 1 && (/^[a-z0-9]$/i.test(raw) || PUNCTUATION.includes(raw))) return lower
  return null
}

/** Parse an Electron-style accelerator. Returns null for anything invalid. */
export function parseAccelerator(accel: string): Shortcut | null {
  const text = accel.trim()
  if (!text) return null
  // `CmdOrCtrl++` means "Plus": the trailing `+` is the key itself.
  const parts = text.endsWith('++') ? [...text.slice(0, -2).split('+'), '+'] : text.split('+')
  const rawKey = parts.pop() ?? ''
  const shortcut: Shortcut = {
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
    key: ''
  }
  for (const token of parts) {
    const flag = MODIFIER_TOKENS[token.trim().toLowerCase()]
    if (!flag) return null
    shortcut[flag] = true
  }
  const key = normalizeKeyName(rawKey)
  if (!key) return null
  shortcut.key = key
  return shortcut
}

function displayKey(key: string): string {
  return DISPLAY_KEYS[key] ?? key.toUpperCase()
}

/** Canonical accelerator text for a parsed shortcut (stable for comparisons). */
export function formatAccelerator(s: Shortcut): string {
  const parts: string[] = []
  if (s.mod) parts.push('CmdOrCtrl')
  if (s.ctrl) parts.push('Ctrl')
  if (s.meta) parts.push('Super')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  parts.push(displayKey(s.key))
  return parts.join('+')
}

/** Normalize an accelerator; returns '' when it is empty or invalid. */
export function canonicalAccelerator(accel: string): string {
  const parsed = parseAccelerator(accel)
  return parsed ? formatAccelerator(parsed) : ''
}

/**
 * Human readable label: `Ctrl+Shift+S` on Windows/Linux, `⌘⇧S` on macOS.
 */
export function displayAccelerator(accel: string, isMac: boolean): string {
  const s = parseAccelerator(accel)
  if (!s) return ''
  const key = displayKey(s.key)
  if (isMac) {
    let out = ''
    if (s.ctrl) out += '⌃'
    if (s.alt) out += '⌥'
    if (s.shift) out += '⇧'
    if (s.mod || s.meta) out += '⌘'
    return out + key
  }
  const parts: string[] = []
  if (s.mod || s.ctrl) parts.push('Ctrl')
  if (s.meta) parts.push('Win')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

/* ------------------------------ matching --------------------------------- */

/** The subset of a KeyboardEvent the matcher needs (easy to fake in tests). */
export interface KeyEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const CODE_KEYS: Record<string, string> = {
  Space: 'space',
  Tab: 'tab',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Escape: 'escape',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`'
}

/**
 * Key name of a keyboard event. Physical key codes are preferred so that
 * shortcuts keep working with Shift (`Shift+1` is still "1") and with
 * non-Latin keyboard layouts.
 */
export function keyNameFromEvent(e: KeyEventLike): string | null {
  const code = e.code ?? ''
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1].toLowerCase()
  m = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^F(\d{1,2})$/.exec(code)
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 24) return `f${m[1]}`
  if (Object.prototype.hasOwnProperty.call(CODE_KEYS, code)) return CODE_KEYS[code]
  const key = e.key
  if (!key) return null
  if (key.length === 1) return key.toLowerCase()
  return normalizeKeyName(key)
}

/** Whether a keyboard event triggers the given parsed shortcut. */
export function matchesShortcut(e: KeyEventLike, s: Shortcut, isMac: boolean): boolean {
  const wantMeta = s.meta || (s.mod && isMac)
  const wantCtrl = s.ctrl || (s.mod && !isMac)
  return (
    e.metaKey === wantMeta &&
    e.ctrlKey === wantCtrl &&
    e.altKey === s.alt &&
    e.shiftKey === s.shift &&
    keyNameFromEvent(e) === s.key
  )
}

/**
 * Accelerator for a key press typed into the shortcut recorder, or null when
 * the press is not a usable shortcut (modifier only, plain typing keys, Escape).
 */
export function acceleratorFromEvent(e: KeyEventLike, isMac: boolean): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS'].includes(e.key)) return null
  const key = keyNameFromEvent(e)
  if (!key || key === 'escape') return null
  let mod: boolean
  let ctrl: boolean
  if (isMac) {
    mod = e.metaKey
    ctrl = e.ctrlKey
  } else {
    mod = e.ctrlKey
    ctrl = false
    // The Windows / Super key is reserved by the OS; not recordable.
    if (e.metaKey) return null
  }
  const isFunctionKey = /^f\d+$/.test(key)
  // Plain typing keys (and Alt alone, which opens the menu bar) are not shortcuts.
  if (!(mod || ctrl) && !isFunctionKey) return null
  return formatAccelerator({
    mod,
    ctrl,
    meta: false,
    alt: e.altKey,
    shift: e.shiftKey,
    key
  })
}

/* ------------------------------ resolving -------------------------------- */

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

/** Default accelerators (canonical form). */
export function defaultKeymap(): Keymap {
  return resolveKeymap(null)
}

/**
 * Resolve user overrides against the defaults. An empty string unbinds an
 * action. When two actions end up with the same key, the one listed first in
 * `KEY_ACTIONS` keeps it and the other is unbound (the preferences UI swaps
 * keys instead, so this only protects hand-edited settings files).
 */
export function resolveKeymap(overrides: Record<string, string> | null | undefined): Keymap {
  const result = {} as Keymap
  const taken = new Set<string>()
  for (const def of KEY_ACTIONS) {
    const raw = overrides && hasOwn(overrides, def.id) ? overrides[def.id] : def.key
    let accel = typeof raw === 'string' ? canonicalAccelerator(raw) : ''
    if (accel && taken.has(accel)) accel = ''
    if (accel) taken.add(accel)
    result[def.id] = accel
  }
  return result
}

/** The minimal override set that reproduces `keymap` on top of the defaults. */
export function overridesFor(keymap: Keymap): Record<string, string> {
  const out: Record<string, string> = {}
  for (const def of KEY_ACTIONS) {
    if (keymap[def.id] !== canonicalAccelerator(def.key)) out[def.id] = keymap[def.id]
  }
  return out
}

/**
 * Assign `accel` (or '' to unbind) to an action. If another action already
 * uses that key, the two actions swap keys, so the result never has conflicts.
 */
export function assignShortcut(
  overrides: Record<string, string> | null | undefined,
  id: KeyActionId,
  accel: string
): { overrides: Record<string, string>; swapped: KeyActionId | null } {
  const map = resolveKeymap(overrides)
  const next = canonicalAccelerator(accel)
  const previous = map[id]
  let swapped: KeyActionId | null = null
  if (next) {
    const other = KEY_ACTIONS.find((d) => d.id !== id && map[d.id] === next)
    if (other) {
      map[other.id] = previous
      swapped = other.id
    }
  }
  map[id] = next
  return { overrides: overridesFor(map), swapped }
}

/** Scope of an action (menu / window / editor). */
export function scopeOf(id: KeyActionId): ShortcutScope {
  const def = KEY_ACTIONS.find((d) => d.id === id)
  return def ? def.scope : 'editor'
}
