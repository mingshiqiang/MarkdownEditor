import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  indentBlock,
  indentCodeBlock,
  insertTableCommand,
  setHeadingCommand,
  toggleWrapCommand
} from './keymaps'

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

describe('indentCodeBlock', () => {
  const code = (lines: string[]): string => lines.join('\n')

  it('indents every selected code line and keeps the fence markers', () => {
    const doc = code(['```js', 'const a = 1', 'const b = 2', '```'])
    const from = doc.indexOf('const a')
    const to = doc.indexOf('const b') + 'const b = 2'.length
    const view = makeView(doc, from, to)
    expect(indentCodeBlock(1)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(code(['```js', '  const a = 1', '  const b = 2', '```']))
    expect(view.state.selection.main.from).toBe(from + 2)
    expect(view.state.selection.main.to).toBe(to + 4)
  })

  it('does not indent a line when the selection ends at its start', () => {
    const doc = code(['```', 'a', 'b', '```'])
    const view = makeView(doc, doc.indexOf('a'), doc.indexOf('b'))
    indentCodeBlock(1)(view)
    expect(view.state.doc.toString()).toBe(code(['```', '  a', 'b', '```']))
  })

  it('never indents the fence markers of a full-block selection', () => {
    const doc = code(['```', 'a', '```'])
    const view = makeView(doc, 0, doc.length)
    indentCodeBlock(1)(view)
    expect(view.state.doc.toString()).toBe(code(['```', '  a', '```']))
  })

  it('outdents by one unit instead of stripping all indentation', () => {
    const doc = code(['```', '  a', '    b', '```'])
    const view = makeView(doc, doc.indexOf('a'), doc.indexOf('b') + 1)
    indentCodeBlock(-1)(view)
    expect(view.state.doc.toString()).toBe(code(['```', 'a', '  b', '```']))
  })

  it('inserts a unit at a collapsed caret', () => {
    const doc = code(['```', 'abc', '```'])
    const view = makeView(doc, doc.indexOf('b'))
    expect(indentCodeBlock(1)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(code(['```', 'a  bc', '```']))
    expect(view.state.selection.main.head).toBe(doc.indexOf('b') + 2)
  })

  it('outdents the caret line when the selection is collapsed', () => {
    const doc = code(['```', '  abc', '```'])
    const view = makeView(doc, doc.indexOf('c'))
    expect(indentCodeBlock(-1)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(code(['```', 'abc', '```']))
  })

  it('consumes the key at column zero so focus cannot leave the editor', () => {
    const doc = code(['```', 'abc', '```'])
    const view = makeView(doc, doc.indexOf('a'))
    expect(indentCodeBlock(-1)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
  })

  it('leaves the document alone outside a fence', () => {
    const view = makeView('plain text', 0, 5)
    expect(indentCodeBlock(1)(view)).toBe(false)
    expect(view.state.doc.toString()).toBe('plain text')
  })
})

describe('indentBlock', () => {
  it('falls back to list indentation outside code blocks', () => {
    const view = makeView('- item', 2, 2)
    expect(indentBlock(1)(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('  - item')
  })
})
