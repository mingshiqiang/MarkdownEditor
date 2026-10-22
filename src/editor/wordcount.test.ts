import { describe, expect, it } from 'vitest'
import { computeStats } from './wordcount'

describe('computeStats', () => {
  it('counts chinese characters as words', () => {
    const s = computeStats('你好世界')
    expect(s.words).toBe(4)
    expect(s.chars).toBe(4)
    expect(s.lines).toBe(1)
  })

  it('counts latin words', () => {
    const s = computeStats('hello brave new world')
    expect(s.words).toBe(4)
  })

  it('mixes chinese and latin', () => {
    const s = computeStats('Typora 编辑器 体验')
    expect(s.words).toBe(1 + 5)
  })

  it('counts lines and ignores whitespace for chars', () => {
    const s = computeStats('a b\n\nc')
    expect(s.chars).toBe(3)
    expect(s.lines).toBe(3)
  })

  it('estimates reading time', () => {
    const short = computeStats('短')
    expect(short.readMinutes).toBe(1)
    const empty = computeStats('')
    expect(empty.readMinutes).toBe(0)
    expect(empty.lines).toBe(0)
  })
})
