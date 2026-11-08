import { describe, expect, it } from 'vitest'
import { outlineRows, parseOutline } from './outline'

/** Visible rows, optionally folding the headings with the given texts. */
function rowsOf(text: string, collapsedTexts: string[] = []) {
  const items = parseOutline(text)
  const collapsed = new Set(
    outlineRows(items, new Set())
      .filter((row) => collapsedTexts.includes(row.item.text))
      .map((row) => row.key)
  )
  return outlineRows(items, collapsed)
}

describe('parseOutline', () => {
  it('extracts headings with level, text and position', () => {
    const text = ['# 一级', '', '正文', '', '## 二级', '### 三级'].join('\n')
    const items = parseOutline(text)
    expect(items).toHaveLength(3)
    expect(items[0]).toMatchObject({ level: 1, text: '一级', line: 1, pos: 0 })
    expect(items[1]).toMatchObject({ level: 2, text: '二级', line: 5 })
    expect(items[2]).toMatchObject({ level: 3, text: '三级', line: 6 })
  })

  it('computes absolute positions', () => {
    const text = ['# A', 'x', '## B'].join('\n')
    const items = parseOutline(text)
    expect(items[0].pos).toBe(0)
    // '# A\n' is 4 characters, so '## B' starts at 6
    expect(items[1].pos).toBe(6)
  })

  it('ignores empty headings and non heading lines', () => {
    const text = ['#', 'not a heading', '#real', '#### deep'].join('\n')
    const items = parseOutline(text)
    // CommonMark requires a space after the # sequence: '#real' is not a heading
    expect(items.map((i) => i.text)).toEqual(['deep'])
  })

  it('ignores hash lines inside fenced code blocks', () => {
    const text = [
      '# Title',
      '',
      '```bash',
      'brew upgrade claude-code # 稳定版通道',
      '# 或',
      'brew upgrade claude-code@latest # 最新版通道',
      '```',
      '',
      '## After'
    ].join('\n')
    expect(parseOutline(text).map((item) => item.text)).toEqual(['Title', 'After'])
  })

  it('handles tilde and unclosed fences', () => {
    expect(
      parseOutline(['~~~', '# not a heading', '~~~', '# yes'].join('\n')).map((i) => i.text)
    ).toEqual(['yes'])
    expect(parseOutline(['```', '# still code', 'more code'].join('\n'))).toHaveLength(0)
  })

  it('ignores hash comments in frontmatter', () => {
    const text = ['---', '# yaml comment', 'title: x', '---', '', '# Real heading'].join('\n')
    expect(parseOutline(text).map((item) => item.text)).toEqual(['Real heading'])
  })

  it('accepts headings indented by up to three spaces', () => {
    expect(parseOutline('   # Indented').map((item) => item.text)).toEqual(['Indented'])
  })
})

describe('outlineRows', () => {
  it('marks headings that have sub-headings', () => {
    const rows = rowsOf('# A\n## B\n## C\n# D')
    expect(rows.map((row) => [row.item.text, row.hasChildren])).toEqual([
      ['A', true],
      ['B', false],
      ['C', false],
      ['D', false]
    ])
  })

  it('hides the descendants of a collapsed heading', () => {
    const rows = rowsOf('# A\n## B\n### C\n## D\n# E', ['B'])
    expect(rows.map((row) => row.item.text)).toEqual(['A', 'B', 'D', 'E'])
    expect(rows.find((row) => row.item.text === 'B')?.collapsed).toBe(true)
  })

  it('keeps nested folds that are hidden under a collapsed parent', () => {
    const items = parseOutline('# A\n## B\n### C\n#### D')
    const all = outlineRows(items, new Set())
    const b = all.find((row) => row.item.text === 'B')!
    const c = all.find((row) => row.item.text === 'C')!

    // C stays folded while B is expanded -> D remains hidden.
    expect(outlineRows(items, new Set([c.key])).map((row) => row.item.text)).toEqual([
      'A',
      'B',
      'C'
    ])
    // Folding B hides C (and D) even though C is folded too.
    expect(outlineRows(items, new Set([b.key, c.key])).map((row) => row.item.text)).toEqual([
      'A',
      'B'
    ])
  })

  it('gives duplicate headings different keys', () => {
    const rows = rowsOf('# A\n## Same\n## Same')
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length)
  })

  it('keeps keys stable when text above the headings changes', () => {
    const before = rowsOf('# One\n## Two')
    const after = rowsOf('intro\n\n# One\n\n## Two')
    expect(after.map((row) => row.key)).toEqual(before.map((row) => row.key))
  })
})
