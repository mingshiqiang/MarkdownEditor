import { describe, expect, it } from 'vitest'
import { estimateBlockHeight, type BlockMetrics } from './blockHeight'
import type { Block } from './segmenter'

const metrics: BlockMetrics = { font: 16, line: 27.2, width: 772 }

function block(type: Block['type'], text: string, extra: Partial<Block> = {}): Block {
  return { type, text, from: 0, to: 0, lineFrom: 1, lineTo: 1, ...extra }
}

describe('estimateBlockHeight', () => {
  it('estimates a short paragraph as one line plus the widget padding', () => {
    expect(estimateBlockHeight(block('paragraph', 'hello'), metrics)).toBeCloseTo(27.2 + 14.4)
  })

  it('estimates rendered paragraphs from their wrapped line count', () => {
    const short = estimateBlockHeight(block('paragraph', 'hello'), metrics)
    const long = estimateBlockHeight(block('paragraph', 'word '.repeat(300)), metrics)
    expect(long).toBeGreaterThan(short * 5)
  })

  it('treats CJK characters as full-width', () => {
    const cjk = estimateBlockHeight(block('paragraph', '汉'.repeat(200)), metrics)
    const latin = estimateBlockHeight(block('paragraph', 'a'.repeat(200)), metrics)
    expect(cjk).toBeGreaterThan(latin)
  })

  it('grows with the number of code lines', () => {
    const one = estimateBlockHeight(block('fence', '```\na\n```'), metrics)
    const five = estimateBlockHeight(block('fence', '```\na\nb\nc\nd\ne\n```'), metrics)
    expect(five - one).toBeCloseTo(4 * 1.32 * metrics.font)
  })

  it('estimates headings by level', () => {
    const h1 = estimateBlockHeight(block('heading', '# Title', { level: 1 }), metrics)
    const h2 = estimateBlockHeight(block('heading', '## Title', { level: 2 }), metrics)
    const h6 = estimateBlockHeight(block('heading', '###### Title', { level: 6 }), metrics)
    expect(h1).toBeGreaterThan(h2)
    expect(h2).toBeGreaterThan(h6)
  })

  it('estimates tables from their rows', () => {
    const small = estimateBlockHeight(block('table', '| a |\n| --- |\n| 1 |'), metrics)
    const big = estimateBlockHeight(
      block('table', '| a |\n| --- |\n| 1 |\n| 2 |\n| 3 |\n| 4 |'),
      metrics
    )
    expect(big).toBeGreaterThan(small)
  })

  it('never estimates less than a text line', () => {
    for (const type of ['paragraph', 'list-item', 'blockquote', 'html', 'footnote'] as const) {
      expect(estimateBlockHeight(block(type, 'x'), metrics)).toBeGreaterThan(20)
    }
  })
})
