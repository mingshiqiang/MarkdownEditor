// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decodeBuffer, encodeText } from './encoding'

describe('decodeBuffer', () => {
  it('reads UTF-8 without a BOM', () => {
    const buffer = Buffer.from('# 标题\n正文', 'utf-8')
    const result = decodeBuffer(buffer)
    expect(result.encoding).toBe('utf-8')
    expect(result.text).toBe('# 标题\n正文')
  })

  it('reads UTF-8 with a BOM and keeps the marker for writing', () => {
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('héllo', 'utf-8')])
    const result = decodeBuffer(buffer)
    expect(result.encoding).toBe('utf-8-bom')
    expect(result.text).toBe('héllo')
  })

  it('reads UTF-16 (little and big endian)', () => {
    const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hi', 'utf16le')])
    expect(decodeBuffer(le)).toEqual({ text: 'hi', encoding: 'utf-16le' })
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('hi', 'utf16le').swap16()])
    expect(decodeBuffer(be)).toEqual({ text: 'hi', encoding: 'utf-16be' })
  })

  it('reads GBK / GB18030 documents', () => {
    const buffer = Buffer.from([0xd6, 0xd0, 0xce, 0xc4]) // 中文 in GBK
    const result = decodeBuffer(buffer)
    expect(result.encoding).toBe('gb18030')
    expect(result.text).toBe('中文')
  })

  it('falls back to windows-1252 for other bytes', () => {
    const result = decodeBuffer(Buffer.from([0xe9, 0x20, 0x61]))
    expect(result.encoding).toBe('windows-1252')
    expect(result.text).toBe('é a')
  })
})

describe('encodeText', () => {
  it('round-trips UTF-8', () => {
    const text = '# 标题\n正文'
    const encoded = encodeText(text, 'utf-8')
    expect(decodeBuffer(encoded)).toEqual({ text, encoding: 'utf-8' })
  })

  it('keeps the UTF-8 BOM', () => {
    const encoded = encodeText('hi', 'utf-8-bom')
    expect(encoded[0]).toBe(0xef)
    expect(decodeBuffer(encoded)).toEqual({ text: 'hi', encoding: 'utf-8-bom' })
  })

  it('round-trips GB18030', () => {
    const text = '中文内容'
    const encoded = encodeText(text, 'gb18030')
    expect(decodeBuffer(encoded)).toEqual({ text, encoding: 'gb18030' })
  })

  it('round-trips UTF-16', () => {
    expect(decodeBuffer(encodeText('hi', 'utf-16le'))).toEqual({
      text: 'hi',
      encoding: 'utf-16le'
    })
    expect(decodeBuffer(encodeText('hi', 'utf-16be'))).toEqual({
      text: 'hi',
      encoding: 'utf-16be'
    })
  })
})
