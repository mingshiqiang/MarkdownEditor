import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  findMarkdownLinkAt,
  findMarkdownLinkByHref,
  insertBlock,
  removeLink,
  replaceLinkUrl,
  stripInlineFormat
} from './contextActions'

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

describe('markdown link helpers', () => {
  const text = 'See [the guide](docs/guide.md) and [site](https://example.com).'

  it('finds the link containing an offset', () => {
    const link = findMarkdownLinkAt(text, text.indexOf('guide'))
    expect(link?.label).toBe('the guide')
    expect(link?.url).toBe('docs/guide.md')
    expect(text.slice(link!.from, link!.to)).toBe('[the guide](docs/guide.md)')
  })

  it('does not treat an image as a link', () => {
    const image = '![alt](cover.png)'
    expect(findMarkdownLinkAt(image, 2)).toBeNull()
  })

  it('finds a link by destination', () => {
    const link = findMarkdownLinkByHref(text, 'https://example.com')
    expect(link?.label).toBe('site')
  })

  it('replaces the destination', () => {
    const link = findMarkdownLinkByHref(text, 'docs/guide.md')!
    expect(replaceLinkUrl(text, link, 'https://example.com/guide')).toBe(
      'See [the guide](https://example.com/guide) and [site](https://example.com).'
    )
  })

  it('removes the link syntax but keeps the label', () => {
    const link = findMarkdownLinkByHref(text, 'docs/guide.md')!
    expect(removeLink(text, link)).toBe('See the guide and [site](https://example.com).')
  })
})

describe('stripInlineFormat', () => {
  it('unwraps bold and nested emphasis', () => {
    expect(stripInlineFormat('**bold**')).toBe('bold')
    expect(stripInlineFormat('***bold italic***')).toBe('bold italic')
    expect(stripInlineFormat('~~gone~~')).toBe('gone')
    expect(stripInlineFormat('`code`')).toBe('code')
  })

  it('unwraps links to their label', () => {
    expect(stripInlineFormat('[label](https://example.com)')).toBe('label')
  })

  it('leaves plain text untouched', () => {
    expect(stripInlineFormat('plain **inside** text')).toBe('plain **inside** text')
  })

  it('does not corrupt a mixed multi-span selection', () => {
    expect(stripInlineFormat('**a** and *b*')).toBe('**a** and *b*')
  })
})

describe('insertBlock', () => {
  it('creates an empty fenced code block on an empty line', () => {
    const view = makeView('')
    insertBlock(view, 'code')
    expect(view.state.doc.toString()).toBe('```\n\n```')
    expect(view.state.selection.main.head).toBe(4)
  })

  it('wraps the selection in a math block', () => {
    const view = makeView('x + y', 0, 5)
    insertBlock(view, 'math')
    expect(view.state.doc.toString()).toBe('$$\nx + y\n$$')
  })

  it('turns selected lines into a bullet list', () => {
    const view = makeView('one\ntwo', 0, 7)
    insertBlock(view, 'bullet')
    expect(view.state.doc.toString()).toBe('- one\n- two')
  })

  it('turns selected lines into a numbered list', () => {
    const view = makeView('one\ntwo', 0, 7)
    insertBlock(view, 'ordered')
    expect(view.state.doc.toString()).toBe('1. one\n2. two')
  })

  it('turns selected lines into a task list', () => {
    const view = makeView('one\ntwo', 0, 7)
    insertBlock(view, 'task')
    expect(view.state.doc.toString()).toBe('- [ ] one\n- [ ] two')
  })

  it('adds a quote marker to the current line', () => {
    const view = makeView('hello')
    insertBlock(view, 'quote')
    expect(view.state.doc.toString()).toBe('> hello')
  })

  it('inserts a horizontal rule on its own line', () => {
    const view = makeView('hello')
    insertBlock(view, 'hr')
    expect(view.state.doc.toString()).toBe('hello\n\n---\n\n')
  })
})
