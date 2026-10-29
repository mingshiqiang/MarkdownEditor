import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { insertPastedText } from './images'

function makeView(doc: string, from = 0, to = from) {
  let state = EditorState.create({
    doc,
    selection: { anchor: from, head: to }
  })
  const view = {
    get state() {
      return state
    },
    dispatch(spec: Parameters<EditorState['update']>[0]) {
      state = state.update(spec).state
    },
    focus() {}
  }
  return view as unknown as EditorView & { state: EditorState }
}

describe('insertPastedText', () => {
  it('converts tab separated text into a markdown table', () => {
    const view = makeView('')
    expect(insertPastedText(view, 'a\tb\n1\t2')).toBe(true)
    expect(view.state.doc.toString()).toContain('| a | b |')
    expect(view.state.doc.toString()).toContain('| 1 | 2 |')
  })

  it('wraps a URL pasted over a selection as a link', () => {
    const view = makeView('label', 0, 5)
    expect(insertPastedText(view, 'https://example.com')).toBe(true)
    expect(view.state.doc.toString()).toBe('[label](https://example.com)')
  })

  it('returns false for ordinary text', () => {
    const view = makeView('')
    expect(insertPastedText(view, 'hello')).toBe(false)
    expect(view.state.doc.toString()).toBe('')
  })
})
