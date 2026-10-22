/**
 * Bus between CodeMirror-level modules and the Vue host component.
 * Keeps editor code free of Pinia imports (avoids cycles, stays testable).
 *
 * Subscribers are collected in a Set: several editors can be alive at the same
 * time (split view), so a single callback slot would be overwritten.
 */
import type { ViewUpdate } from '@codemirror/view'

export type EditorListener = (docId: string, update: ViewUpdate) => void

export interface EditorBus {
  onDocChanged: Set<EditorListener>
  onCursorMoved: Set<EditorListener>
  onFocusChanged: Set<EditorListener>
}

export const editorBus: EditorBus = {
  onDocChanged: new Set(),
  onCursorMoved: new Set(),
  onFocusChanged: new Set()
}
