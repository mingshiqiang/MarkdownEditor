import { describe, expect, it } from 'vitest'
import { renderDoc, renderBlockSource } from './render'
import { segmentDoc } from '../segmenter'
import { EditorState } from '@codemirror/state'

const env = { docDir: '' }

describe('renderDoc', () => {
  it('removes active content (XSS hardening)', () => {
    const html = renderDoc('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">', env)
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('renders inline math with KaTeX', () => {
    const html = renderDoc('$e^{i\\pi}+1=0$', env)
    expect(html).toContain('katex')
  })

  it('renders block math', () => {
    const html = renderDoc('$$\n\\frac{a}{b}\n$$', env)
    expect(html).toContain('katex')
  })

  it('rewrites relative image sources to the mdimg scheme', () => {
    const html = renderDoc('![alt](assets/a.png)', { docDir: 'D:/docs' })
    expect(html).toContain('mdimg://local/')
    expect(html).toContain(encodeURIComponent('D:/docs/assets/a.png'))
  })

  it('keeps remote images untouched', () => {
    const html = renderDoc('![alt](https://example.com/a.png)', env)
    expect(html).toContain('https://example.com/a.png')
    expect(html).not.toContain('mdimg://')
  })

  it('renders task list checkboxes', () => {
    const html = renderDoc('- [x] done\n- [ ] todo', env)
    expect(html).toContain('task-list-item-checkbox')
    expect(html).toContain('checked')
  })

  it('renders tables with alignment markers', () => {
    const html = renderDoc('| a | b |\n| --- | ---: |\n| 1 | 2 |', env)
    expect(html).toContain('<table>')
    expect(html).toContain('text-align:right')
  })

  it('renders fenced code with a copy button', () => {
    const html = renderDoc('```js\nconst a = 1\n```', env)
    expect(html).toContain('md-copy-btn')
    expect(html).toContain('hljs')
  })

  it('renders blockquotes and rules', () => {
    const html = renderDoc('> quoted\n\n---', env)
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<hr')
  })

  it('supports highlight, superscript and subscript', () => {
    const html = renderDoc('==mark== H~2~O x^2^', env)
    expect(html).toContain('<mark>')
    expect(html).toContain('<sup>')
    expect(html).toContain('<sub>')
  })
})

describe('renderBlockSource', () => {
  it('renders a single block segment', () => {
    const doc = EditorState.create({ doc: '# Title\n\npara' }).doc
    const blocks = segmentDoc(doc)
    const heading = blocks.find((b) => b.type === 'heading')
    expect(heading).toBeTruthy()
    const html = renderBlockSource(heading!, env)
    expect(html).toContain('<h1>')
    expect(html).toContain('Title')
  })

  it('renders mermaid fences as a mount point', () => {
    const doc = EditorState.create({ doc: '```mermaid\ngraph TD; A-->B;\n```' }).doc
    const blocks = segmentDoc(doc)
    const fence = blocks.find((b) => b.type === 'fence')
    const html = renderBlockSource(fence!, env)
    expect(html).toContain('md-mermaid')
  })
})
