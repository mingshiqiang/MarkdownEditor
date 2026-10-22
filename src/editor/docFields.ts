/**
 * Per-editor-state metadata fields: which tab (docId) a state belongs to and
 * which directory the document lives in (docDir, for relative image links).
 */
import { StateEffect, StateField } from '@codemirror/state'

export const setDocId = StateEffect.define<string>()
export const setDocDir = StateEffect.define<string>()

export const docIdField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDocId)) return e.value
    }
    return value
  }
})

export const docDirField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDocDir)) return e.value
    }
    return value
  }
})
