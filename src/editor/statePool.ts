/**
 * Per-document EditorState pool: switching tabs swaps states (history,
 * selection, scroll restored) instead of rebuilding editors.
 */
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { EditorMode } from '../../shared/types'
import { buildEditorState, modeCompartment, modeExtensions } from './config'
import { docIdField, docDirField, setDocDir } from './docFields'

const states = new Map<string, EditorState>()
const scrolls = new Map<string, number>()

export function ensureState(
  id: string,
  content: string,
  mode: EditorMode,
  docDir: string
): EditorState {
  let st = states.get(id)
  if (!st) {
    st = buildEditorState({ content, mode, docId: id, docDir })
    states.set(id, st)
  }
  return st
}

export function getState(id: string): EditorState | null {
  return states.get(id) ?? null
}

/**
 * Keep the pool in sync with the live editor state. Without this the pool
 * would still hold the state from *before* the last edits, which would make
 * saving write stale content and statistics stay at zero.
 */
export function updateState(id: string, state: EditorState): void {
  states.set(id, state)
}

export function dropState(id: string): void {
  states.delete(id)
  scrolls.delete(id)
}

export function peekStateText(id: string): string | null {
  const st = states.get(id)
  return st ? st.doc.toString() : null
}

/** Replace the whole text of a doc (external reload), keeping undo history. */
export function replaceDocText(view: EditorView | null, id: string, text: string): boolean {
  const st = states.get(id)
  if (!st) return false
  if (view && view.state.field(docIdField, false) === id) {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text }
    })
  } else {
    states.set(id, st.update({ changes: { from: 0, to: st.doc.length, insert: text } }).state)
  }
  return true
}

/** Update the docDir (after save-as / open in another dir). */
export function setDocDirFor(view: EditorView | null, id: string, dir: string): void {
  if (view && view.state.field(docIdField, false) === id) {
    view.dispatch({ effects: setDocDir.of(dir) })
  } else {
    const st = states.get(id)
    if (st) states.set(id, st.update({ effects: setDocDir.of(dir) }).state)
  }
}

export function getScroll(id: string): number {
  return scrolls.get(id) ?? 0
}

export function setScroll(id: string, top: number): void {
  scrolls.set(id, top)
}

/** Reconfigure the mode compartment of a live view. */
export function applyMode(mode: EditorMode, view: EditorView): void {
  view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode)) })
}

export { docDirField }
