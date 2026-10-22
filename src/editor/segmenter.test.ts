import { describe, expect, it } from 'vitest'
import { segmentLines } from './segmenter'

describe('segmentLines', () => {
  it('splits headings, paragraphs and blank lines', () => {
    const blocks = segmentLines(['# Title', '', 'Some text', 'more text', '', '## Sub'])
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading'])
    expect(blocks[0].level).toBe(1)
    expect(blocks[1].lineFrom).toBe(2)
    expect(blocks[1].lineTo).toBe(3)
    expect(blocks[2].level).toBe(2)
  })

  it('groups fenced code blocks with their language', () => {
    const blocks = segmentLines(['```ts', 'const a = 1', '```', 'after'])
    expect(blocks).toHaveLength(2)
    expect(blocks[0].type).toBe('fence')
    expect(blocks[0].lang).toBe('ts')
    expect(blocks[0].lineFrom).toBe(0)
    expect(blocks[0].lineTo).toBe(2)
    expect(blocks[1].type).toBe('paragraph')
  })

  it('marks mermaid fences', () => {
    const blocks = segmentLines(['```mermaid', 'graph TD; A-->B;', '```'])
    expect(blocks[0].mermaid).toBe(true)
  })

  it('detects tables (header + delimiter + rows)', () => {
    const blocks = segmentLines(['| a | b |', '| --- | --- |', '| 1 | 2 |', 'text'])
    expect(blocks.map((b) => b.type)).toEqual(['table', 'paragraph'])
    expect(blocks[0].lineTo).toBe(2)
  })

  it('does not treat a pipe line without delimiter as a table', () => {
    const blocks = segmentLines(['| a | b |', 'text'])
    expect(blocks[0].type).toBe('paragraph')
  })

  it('splits list items and keeps indented continuations', () => {
    const blocks = segmentLines(['- one', '  continued', '- two'])
    expect(blocks.map((b) => b.type)).toEqual(['list-item', 'list-item'])
    expect(blocks[0].lineTo).toBe(1)
    expect(blocks[1].lineFrom).toBe(2)
  })

  it('detects task list items', () => {
    const blocks = segmentLines(['- [x] done', '- [ ] todo'])
    expect(blocks[0].task?.checked).toBe(true)
    expect(blocks[1].task?.checked).toBe(false)
  })

  it('detects ordered lists', () => {
    const blocks = segmentLines(['1. first', '2. second'])
    expect(blocks[0].ordered).toBe(true)
    expect(blocks[1].ordered).toBe(true)
  })

  it('collects blockquotes including lazy continuation', () => {
    const blocks = segmentLines(['> quoted', 'lazy line', '', 'after'])
    expect(blocks[0].type).toBe('blockquote')
    expect(blocks[0].lineTo).toBe(1)
    expect(blocks[1].type).toBe('paragraph')
  })

  it('detects math blocks', () => {
    const blocks = segmentLines(['$$', 'a^2 + b^2 = c^2', '$$', 'after'])
    expect(blocks[0].type).toBe('math')
    expect(blocks[0].lineTo).toBe(2)
    expect(blocks[1].type).toBe('paragraph')
  })

  it('detects thematic breaks', () => {
    const blocks = segmentLines(['---'])
    expect(blocks[0].type).toBe('hr')
  })

  it('reads frontmatter at the very beginning only', () => {
    const blocks = segmentLines(['---', 'title: x', '---', 'body'])
    expect(blocks[0].type).toBe('frontmatter')
    expect(blocks[0].lineTo).toBe(2)
    expect(blocks[1].type).toBe('paragraph')
  })

  it('treats an unclosed frontmatter opener as a thematic break', () => {
    const blocks = segmentLines(['---', 'title: x'])
    expect(blocks[0].type).toBe('hr')
  })
})
