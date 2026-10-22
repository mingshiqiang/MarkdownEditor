import { describe, expect, it } from 'vitest'
import type { Block } from './segmenter'
import { markerOf, markerRange, sourceLineClasses } from './sourceStyle'

function block(over: Partial<Block>): Block {
  return {
    type: 'paragraph',
    from: 0,
    to: 10,
    lineFrom: 1,
    lineTo: 1,
    text: 'text',
    ...over
  }
}

describe('sourceLineClasses', () => {
  it('gives every block type its own class', () => {
    expect(sourceLineClasses(block({ type: 'paragraph' }), 1)).toContain('cm-md-src-p')
    expect(sourceLineClasses(block({ type: 'heading', level: 2 }), 1)).toContain('cm-md-src-h2')
    expect(sourceLineClasses(block({ type: 'list-item' }), 1)).toContain('cm-md-src-li')
    expect(sourceLineClasses(block({ type: 'blockquote' }), 1)).toContain('cm-md-src-quote')
    expect(sourceLineClasses(block({ type: 'fence' }), 1)).toContain('cm-md-src-code')
  })

  it('marks the first and the last line of a block', () => {
    const multi = block({ type: 'blockquote', lineFrom: 3, lineTo: 5 })
    expect(sourceLineClasses(multi, 3)).toContain('cm-md-src-first')
    expect(sourceLineClasses(multi, 3)).not.toContain('cm-md-src-last')
    expect(sourceLineClasses(multi, 4)).not.toContain('cm-md-src-first')
    expect(sourceLineClasses(multi, 5)).toContain('cm-md-src-last')
  })

  it('ignores blocks without a source styling', () => {
    expect(sourceLineClasses(block({ type: 'table' }), 1)).toEqual([])
    expect(sourceLineClasses(block({ type: 'math' }), 1)).toEqual([])
  })
})

describe('markerOf', () => {
  it('knows the blocks with a marker', () => {
    expect(markerOf(block({ type: 'heading' }))).toBe('heading')
    expect(markerOf(block({ type: 'list-item' }))).toBe('list')
    expect(markerOf(block({ type: 'blockquote' }))).toBe('quote')
    expect(markerOf(block({ type: 'paragraph' }))).toBeNull()
  })
})

describe('markerRange', () => {
  it('finds the marker of a heading', () => {
    const info = markerRange('## 标题', 100, 'heading')
    expect(info).toEqual({ from: 100, to: 103, label: '', level: 0 })
  })

  it('finds the marker of a list item', () => {
    const info = markerRange('- 内容', 10, 'list')
    expect(info).toEqual({ from: 10, to: 12, label: '', level: 0 })
  })

  it('keeps the number of an ordered list item', () => {
    const info = markerRange('3. 内容', 0, 'list')
    expect(info?.label).toBe('3')
    expect(info?.to).toBe(3)
  })

  it('counts the nesting level of a list item', () => {
    expect(markerRange('  - 内容', 0, 'list')?.level).toBe(1)
    expect(markerRange('    - 内容', 0, 'list')?.level).toBe(2)
  })

  it('finds the marker of a quote', () => {
    const info = markerRange('> 内容', 5, 'quote')
    expect(info).toEqual({ from: 5, to: 7, label: '', level: 0 })
  })

  it('returns null when there is no marker', () => {
    expect(markerRange('普通文字', 0, 'heading')).toBeNull()
    expect(markerRange('普通文字', 0, 'list')).toBeNull()
    expect(markerRange('普通文字', 0, 'quote')).toBeNull()
  })
})
