import { describe, expect, it } from 'vitest'
import {
  acceleratorFromEvent,
  assignShortcut,
  canonicalAccelerator,
  defaultKeymap,
  displayAccelerator,
  formatAccelerator,
  keyNameFromEvent,
  matchesShortcut,
  overridesFor,
  parseAccelerator,
  resolveKeymap,
  type KeyEventLike
} from './keymap'

function ev(init: Partial<KeyEventLike> & { key: string }): KeyEventLike {
  return { code: '', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }
}

describe('parseAccelerator', () => {
  it('reads modifiers and the key', () => {
    expect(parseAccelerator('CmdOrCtrl+Shift+S')).toEqual({
      mod: true,
      ctrl: false,
      meta: false,
      alt: false,
      shift: true,
      key: 's'
    })
  })

  it('accepts punctuation and the plus key', () => {
    expect(parseAccelerator('CmdOrCtrl+,')?.key).toBe(',')
    expect(parseAccelerator('CmdOrCtrl++')?.key).toBe('+')
  })

  it('rejects unknown modifiers, unknown keys and empty input', () => {
    expect(parseAccelerator('Hyper+S')).toBeNull()
    expect(parseAccelerator('CmdOrCtrl+Banana')).toBeNull()
    expect(parseAccelerator('')).toBeNull()
    expect(parseAccelerator('CmdOrCtrl+')).toBeNull()
  })
})

describe('canonicalAccelerator', () => {
  it('normalizes case, aliases and order', () => {
    expect(canonicalAccelerator('shift+ctrl+s')).toBe('Ctrl+Shift+S')
    expect(canonicalAccelerator('cmdorctrl+shift+tab')).toBe('CmdOrCtrl+Shift+Tab')
    expect(canonicalAccelerator('Option+Command+f5')).toBe('Super+Alt+F5')
  })

  it('returns an empty string for invalid input', () => {
    expect(canonicalAccelerator('nope')).toBe('')
  })

  it('round-trips through formatAccelerator', () => {
    const parsed = parseAccelerator('CmdOrCtrl+Alt+Shift+F12')
    expect(parsed && formatAccelerator(parsed)).toBe('CmdOrCtrl+Alt+Shift+F12')
  })
})

describe('displayAccelerator', () => {
  it('uses words on Windows and Linux', () => {
    expect(displayAccelerator('CmdOrCtrl+Shift+S', false)).toBe('Ctrl+Shift+S')
    expect(displayAccelerator('Shift+Tab', false)).toBe('Shift+Tab')
  })

  it('uses symbols in Apple order on macOS', () => {
    expect(displayAccelerator('CmdOrCtrl+Shift+S', true)).toBe('⇧⌘S')
    expect(displayAccelerator('Ctrl+Alt+Left', true)).toBe('⌃⌥Left')
  })
})

describe('keyNameFromEvent', () => {
  it('prefers the physical key code', () => {
    expect(keyNameFromEvent(ev({ key: 'S', code: 'KeyS' }))).toBe('s')
    // Shift+1 produces "!" but the physical key is still "1".
    expect(keyNameFromEvent(ev({ key: '!', code: 'Digit1', shiftKey: true }))).toBe('1')
    expect(keyNameFromEvent(ev({ key: 'ArrowUp', code: 'ArrowUp' }))).toBe('up')
    expect(keyNameFromEvent(ev({ key: ',', code: 'Comma' }))).toBe(',')
  })

  it('falls back to the key value when no code is available', () => {
    expect(keyNameFromEvent(ev({ key: 'Tab' }))).toBe('tab')
    expect(keyNameFromEvent(ev({ key: 'b' }))).toBe('b')
  })

  it('does not treat modifier keys as shortcut keys', () => {
    expect(keyNameFromEvent(ev({ key: 'Shift', code: 'ShiftLeft' }))).toBeNull()
  })
})

describe('matchesShortcut', () => {
  const save = parseAccelerator('CmdOrCtrl+Shift+S')!

  it('matches Ctrl on Windows and Linux', () => {
    const e = ev({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(matchesShortcut(e, save, false)).toBe(true)
  })

  it('matches Cmd on macOS but not Ctrl', () => {
    const cmd = ev({ key: 'S', code: 'KeyS', metaKey: true, shiftKey: true })
    const ctrl = ev({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true })
    expect(matchesShortcut(cmd, save, true)).toBe(true)
    expect(matchesShortcut(ctrl, save, true)).toBe(false)
  })

  it('requires the exact modifier set', () => {
    const extra = ev({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true, altKey: true })
    const missing = ev({ key: 'S', code: 'KeyS', ctrlKey: true })
    expect(matchesShortcut(extra, save, false)).toBe(false)
    expect(matchesShortcut(missing, save, false)).toBe(false)
  })
})

describe('acceleratorFromEvent (recorder)', () => {
  it('records a modified key on Windows', () => {
    const e = ev({ key: 'O', code: 'KeyO', ctrlKey: true, shiftKey: true })
    expect(acceleratorFromEvent(e, false)).toBe('CmdOrCtrl+Shift+O')
  })

  it('records Cmd as CmdOrCtrl on macOS', () => {
    const e = ev({ key: 'k', code: 'KeyK', metaKey: true })
    expect(acceleratorFromEvent(e, true)).toBe('CmdOrCtrl+K')
  })

  it('accepts function keys without modifiers', () => {
    expect(acceleratorFromEvent(ev({ key: 'F5', code: 'F5' }), false)).toBe('F5')
  })

  it('rejects plain typing keys, modifier-only presses and Alt alone', () => {
    expect(acceleratorFromEvent(ev({ key: 'a', code: 'KeyA' }), false)).toBeNull()
    expect(
      acceleratorFromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), false)
    ).toBeNull()
    expect(
      acceleratorFromEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), false)
    ).toBeNull()
    expect(acceleratorFromEvent(ev({ key: 'x', code: 'KeyX', altKey: true }), false)).toBeNull()
  })

  it('rejects Escape and the Windows key', () => {
    expect(
      acceleratorFromEvent(ev({ key: 'Escape', code: 'Escape', ctrlKey: true }), false)
    ).toBeNull()
    expect(
      acceleratorFromEvent(ev({ key: 'k', code: 'KeyK', ctrlKey: true, metaKey: true }), false)
    ).toBeNull()
  })
})

describe('resolveKeymap', () => {
  it('uses the defaults without overrides', () => {
    const map = resolveKeymap(null)
    expect(map['file:save']).toBe('CmdOrCtrl+S')
    expect(map['markdown:bold']).toBe('CmdOrCtrl+B')
    expect(map).toEqual(defaultKeymap())
  })

  it('applies overrides and empty strings unbind', () => {
    const map = resolveKeymap({ 'file:save': 'CmdOrCtrl+Alt+S', 'file:new': '' })
    expect(map['file:save']).toBe('CmdOrCtrl+Alt+S')
    expect(map['file:new']).toBe('')
  })

  it('keeps the first action when two overrides collide', () => {
    // file:new comes first in the table, so it keeps the key.
    const map = resolveKeymap({ 'file:open': 'CmdOrCtrl+N' })
    expect(map['file:new']).toBe('CmdOrCtrl+N')
    expect(map['file:open']).toBe('')
  })

  it('ignores malformed overrides instead of throwing', () => {
    const map = resolveKeymap({ 'file:save': 'Hyper+Nope' })
    expect(map['file:save']).toBe('')
  })
})

describe('assignShortcut', () => {
  it('swaps keys with the action that owned the new key', () => {
    const { overrides, swapped } = assignShortcut(null, 'file:open', 'CmdOrCtrl+S')
    expect(swapped).toBe('file:save')
    const map = resolveKeymap(overrides)
    expect(map['file:open']).toBe('CmdOrCtrl+S')
    expect(map['file:save']).toBe('CmdOrCtrl+O')
  })

  it('unbinds without swapping', () => {
    const { overrides, swapped } = assignShortcut(null, 'file:save', '')
    expect(swapped).toBeNull()
    expect(resolveKeymap(overrides)['file:save']).toBe('')
  })

  it('stores only the differences from the defaults', () => {
    const { overrides } = assignShortcut(null, 'file:save', 'CmdOrCtrl+Alt+S')
    expect(overrides).toEqual({ 'file:save': 'CmdOrCtrl+Alt+S' })
    expect(overridesFor(defaultKeymap())).toEqual({})
  })
})
