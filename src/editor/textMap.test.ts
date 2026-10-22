import { describe, expect, it } from 'vitest'
import { buildPlainTextMap, sourceRangeOfTextRange } from './textMap'

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
