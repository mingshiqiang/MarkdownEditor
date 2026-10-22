import { describe, expect, it } from 'vitest'
import { findImageRefs, isRemoteRef } from './imageRefs'

describe('findImageRefs', () => {
  it('finds the images and their exact positions', () => {
    const md = '文字 ![图](assets/a.png) 结束 ![b](b.jpg "标题")'
    const refs = findImageRefs(md)
    expect(refs).toHaveLength(2)
    expect(refs[0].src).toBe('assets/a.png')
    expect(md.slice(refs[0].from, refs[0].to)).toBe('assets/a.png')
    expect(refs[1].src).toBe('b.jpg')
    expect(md.slice(refs[1].from, refs[1].to)).toBe('b.jpg')
  })

  it('ignores links that are not images', () => {
    expect(findImageRefs('[链接](a.md)')).toHaveLength(0)
  })

  it('detects remote references', () => {
    expect(isRemoteRef('https://example.com/a.png')).toBe(true)
    expect(isRemoteRef('data:image/png;base64,AAA')).toBe(true)
    expect(isRemoteRef('assets/a.png')).toBe(false)
    expect(isRemoteRef('D:\\dir\\a.png')).toBe(false)
  })
})
