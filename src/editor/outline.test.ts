import { describe, expect, it } from 'vitest'
import { parseOutline } from './outline'

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
})
