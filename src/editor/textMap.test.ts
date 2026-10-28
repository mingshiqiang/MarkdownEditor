import { describe, expect, it } from 'vitest'
import { buildPlainTextMap, sourceRangeOfTextRange, textOffsetIn } from './textMap'

describe('buildPlainTextMap', () => {
  it('keeps plain text as is', () => {
    const map = buildPlainTextMap('hello world')
    expect(map.text).toBe('hello world')
    expect(map.sourceIndex[0]).toBe(0)
    expect(map.sourceIndex[6]).toBe(6)
  })

  it('skips the emphasis markers', () => {
    const map = buildPlainTextMap('a **bold** b')
    expect(map.text).toBe('a bold b')
    // "bold" starts at the source offset of the second "*"
    expect(map.sourceIndex[2]).toBe(4)
  })

  it('skips the code and math delimiters', () => {
    expect(buildPlainTextMap('`code`').text).toBe('code')
    expect(buildPlainTextMap('$x+1$').text).toBe('x+1')
  })

  it('keeps the link text but drops the target', () => {
    const map = buildPlainTextMap('[label](https://example.com)')
    expect(map.text).toBe('label')
    expect(map.sourceIndex[0]).toBe(1)
  })

  it('drops images completely', () => {
    expect(buildPlainTextMap('![alt](pic.png)').text).toBe('')
  })

  it('handles escaped characters', () => {
    const map = buildPlainTextMap('a \\* b')
    expect(map.text).toBe('a * b')
    expect(map.sourceIndex[2]).toBe(3)
  })

  it('skips both single-emphasis delimiters', () => {
    const source = 'a *italic* b'
    const map = buildPlainTextMap(source)
    expect(map.text).toBe('a italic b')
    expect(map.sourceIndex[9]).toBe(source.indexOf('b'))
  })

  it('skips heading, list, task and quote markers', () => {
    expect(buildPlainTextMap('# heading').text).toBe('heading')
    const task = buildPlainTextMap('- [x] task')
    expect(task.text).toBe(' task')
    expect(task.sourceIndex[1]).toBe(6)
    expect(buildPlainTextMap('> quoted').text).toBe('quoted')
  })

  it('maps decoded entities and raw HTML text to their source', () => {
    const entitySource = 'a &amp; b'
    const entityMap = buildPlainTextMap(entitySource)
    expect(entityMap.text).toBe('a & b')
    expect(entityMap.sourceIndex[4]).toBe(entitySource.indexOf('b'))

    const htmlSource = 'a <span>x</span> b'
    const htmlMap = buildPlainTextMap(htmlSource)
    expect(htmlMap.text).toBe('a x b')
    expect(htmlMap.sourceIndex[4]).toBe(htmlSource.indexOf('b'))
  })

  it('can map a formula as one atomic character', () => {
    const source = 'a $\\alpha$ b'
    const map = buildPlainTextMap(source, { atomicMath: true })
    expect(map.text).toBe('a \uFFFC b')
    expect(map.sourceIndex[2]).toBe(source.indexOf('$'))
    expect(map.sourceIndex[4]).toBe(source.indexOf('b'))
  })
})

describe('textOffsetIn', () => {
  it('counts a KaTeX formula once and ignores its hidden MathML copy', () => {
    const root = document.createElement('div')
    root.innerHTML =
      '前<span class="katex"><span class="katex-mathml">alpha</span>' +
      '<span class="katex-html">α</span></span><span id="after">后</span>'
    const after = root.querySelector('#after')?.firstChild
    expect(after).not.toBeNull()
    expect(textOffsetIn(root, after as Node, 0, { atomicMath: true })).toBe(2)
    expect(textOffsetIn(root, after as Node, 0)).toBe(2)
  })

  it('maps a click inside an atomic formula to its start', () => {
    const root = document.createElement('div')
    root.innerHTML = '前<span class="katex"><span class="katex-html">α</span></span>后'
    const math = root.querySelector('.katex-html')?.firstChild
    expect(math).not.toBeNull()
    expect(textOffsetIn(root, math as Node, 1, { atomicMath: true })).toBe(1)
  })

  it('does not count widget controls as document text', () => {
    const root = document.createElement('div')
    root.innerHTML = '<button>复制</button><span id="target">正文</span>'
    const target = root.querySelector('#target')?.firstChild
    expect(target).not.toBeNull()
    expect(textOffsetIn(root, target as Node, 0)).toBe(0)
  })

  it('ignores formatting newlines between rendered block elements', () => {
    const root = document.createElement('div')
    root.innerHTML = '<ul>\n<li><span id="target">正文</span></li>\n</ul>\n'
    const target = root.querySelector('#target')?.firstChild
    expect(target).not.toBeNull()
    expect(textOffsetIn(root, target as Node, 0)).toBe(0)
  })
})

describe('sourceRangeOfTextRange', () => {
  it('maps a visible range back to the source', () => {
    const source = 'a **bold** b'
    const range = sourceRangeOfTextRange(source, 100, 2, 6)
    expect(range).toEqual({ from: 104, to: 108 })
  })

  it('returns null for an empty range', () => {
    expect(sourceRangeOfTextRange('abc', 0, 1, 1)).toBeNull()
  })

  it('clamps to the text length', () => {
    const range = sourceRangeOfTextRange('abc', 0, 0, 99)
    expect(range).toEqual({ from: 0, to: 3 })
  })
})
