import { describe, expect, it } from 'vitest'
import { caretScrollDelta, dragMovesForward } from './selectionGeometry'

describe('dragMovesForward', () => {
  it('is forward when dragging down', () => {
    expect(dragMovesForward(100, 100, 20, 200)).toBe(true)
  })

  it('is backward when dragging up', () => {
    expect(dragMovesForward(100, 200, 20, 100)).toBe(false)
  })

  it('uses the horizontal direction within one line', () => {
    expect(dragMovesForward(100, 100, 150, 100)).toBe(true)
    expect(dragMovesForward(100, 100, 50, 100)).toBe(false)
  })
})

describe('caretScrollDelta', () => {
  it('does not scroll when the caret kept its position', () => {
    expect(caretScrollDelta({ top: 100, bottom: 116 }, { top: 100, bottom: 116 })).toBe(0)
  })

  it('scrolls by the distance the caret moved', () => {
    expect(caretScrollDelta({ top: 100, bottom: 116 }, { top: 120, bottom: 136 })).toBe(20)
    expect(caretScrollDelta({ top: 100, bottom: 116 }, { top: 80, bottom: 96 })).toBe(-20)
  })

  it('ignores sub-pixel jitter and unsettled layouts', () => {
    expect(caretScrollDelta({ top: 100, bottom: 116 }, { top: 100.2, bottom: 116.2 })).toBe(0)
    expect(caretScrollDelta({ top: 100, bottom: 116 }, { top: 600, bottom: 616 })).toBe(0)
  })

  it('does nothing without both caret rects', () => {
    expect(caretScrollDelta(null, { top: 0, bottom: 16 })).toBe(0)
    expect(caretScrollDelta({ top: 0, bottom: 16 }, null)).toBe(0)
  })
})
