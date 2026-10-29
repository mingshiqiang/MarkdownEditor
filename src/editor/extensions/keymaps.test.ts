import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { insertTableCommand, setHeadingCommand, toggleWrapCommand } from './keymaps'

/** Minimal headless EditorView stand-in (state + dispatch). */
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

describe('toggleWrapCommand', () => {
  it('wraps the selection', () => {
    const view = makeView('hello', 0, 5)
    toggleWrapCommand('**')(view)
    expect(view.state.doc.toString()).toBe('**hello**')
    // the selection now covers the wrapped content
    expect(view.state.selection.main.from).toBe(2)
    expect(view.state.selection.main.to).toBe(7)
  })

  it('unwraps an already wrapped selection', () => {
    const view = makeView('**hello**', 2, 7)
    toggleWrapCommand('**')(view)
    expect(view.state.doc.toString()).toBe('hello')
  })

  it('inserts an empty pair for an empty selection', () => {
    const view = makeView('', 0, 0)
    toggleWrapCommand('*')(view)
    expect(view.state.doc.toString()).toBe('**')
    expect(view.state.selection.main.head).toBe(1)
  })
})

describe('setHeadingCommand', () => {
  it('turns a paragraph into a heading', () => {
    const view = makeView('hello')
    setHeadingCommand(2)(view)
    expect(view.state.doc.toString()).toBe('## hello')
  })

  it('replaces an existing heading level', () => {
    const view = makeView('# hello')
    setHeadingCommand(3)(view)
    expect(view.state.doc.toString()).toBe('### hello')
  })

  it('turns a heading back into a paragraph', () => {
    const view = makeView('## hello')
    setHeadingCommand(0)(view)
    expect(view.state.doc.toString()).toBe('hello')
  })

  it('leaves a paragraph unchanged at level 0', () => {
    const view = makeView('hello')
    setHeadingCommand(0)(view)
    expect(view.state.doc.toString()).toBe('hello')
  })
})

describe('insertTableCommand', () => {
  it('inserts a 2x2 table skeleton', () => {
    const view = makeView('')
    insertTableCommand(view)
    const text = view.state.doc.toString()
    expect(text).toContain('| --- | --- |')
    expect(text.split('\n')).toHaveLength(3)
  })
})
