import { describe, expect, it } from 'vitest'
import {
  imageFileName,
  isRemoteImageSource,
  mimeFromExtension,
  sniffImageMime
} from './imageSource'

describe('image source helpers', () => {
  it('detects remote image sources', () => {
    expect(isRemoteImageSource('https://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('http://example.com/a.png')).toBe(true)
    expect(isRemoteImageSource('D:/ImageCache/a.png')).toBe(false)
    expect(isRemoteImageSource('mdimg://local/D%3A%2FImageCache%2Fa.png')).toBe(false)
  })

  it('maps extensions to MIME types', () => {
    expect(mimeFromExtension('.PNG')).toBe('image/png')
    expect(mimeFromExtension('jpg')).toBe('image/jpeg')
    expect(mimeFromExtension('unknown')).toBe('')
  })

  it('sniffs common image signatures', () => {
    expect(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png'
    )
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(sniffImageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBe(
      'image/svg+xml'
    )
    expect(sniffImageMime(Buffer.from('not an image'))).toBe('')
  })

  it('keeps an existing extension', () => {
    expect(imageFileName('photo.png', 'image/jpeg')).toBe('photo.png')
  })

  it('adds an extension from the content type', () => {
    expect(imageFileName('photo', 'image/jpeg')).toBe('photo.jpg')
    expect(imageFileName('photo', 'text/plain')).toBe('photo.png')
    expect(imageFileName('', 'image/webp')).toBe('image.webp')
  })
})
