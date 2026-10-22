// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pickByPath, uploadImage } from './imageHost'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { AppSettings } from '../../shared/types'

function settings(overrides: Partial<AppSettings['imageHost']>): AppSettings {
  return {
    ...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    imageHost: { ...DEFAULT_SETTINGS.imageHost, ...overrides }
  }
}

describe('pickByPath', () => {
  const data = {
    url: 'https://a.test/x.png',
    data: { url: 'https://b.test/y.png' },
    list: [{ u: 'https://c.test/z.png' }]
  }

  it('reads plain and nested paths', () => {
    expect(pickByPath(data, 'url')).toBe('https://a.test/x.png')
    expect(pickByPath(data, 'data.url')).toBe('https://b.test/y.png')
  })

  it('reads array entries', () => {
    expect(pickByPath(data, 'list.0.u')).toBe('https://c.test/z.png')
  })

  it('ignores values that are not strings', () => {
    expect(pickByPath({ n: 1 }, 'n')).toBeNull()
  })

  it('returns null for missing paths', () => {
    expect(pickByPath(data, 'nope')).toBeNull()
    expect(pickByPath(data, 'data.url.deep')).toBeNull()
    expect(pickByPath(data, '')).toBeNull()
  })
})

describe('uploadImage', () => {
  let server: http.Server
  let port = 0
  let lastBody = ''
  let lastContentType = ''

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf-8')
        lastContentType = req.headers['content-type'] ?? ''
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { url: 'https://cdn.test/uploaded.png' } }))
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as { port: number }).port
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('uploads a file and returns the URL from the response', async () => {
    const file = path.join(os.tmpdir(), 'mde-upload-test.png')
    fs.writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    try {
      const url = await uploadImage(
        file,
        settings({
          enabled: true,
          url: `http://127.0.0.1:${port}/upload`,
          field: 'file',
          responsePath: 'data.url'
        })
      )
      expect(url).toBe('https://cdn.test/uploaded.png')
      expect(lastContentType).toContain('multipart/form-data')
      expect(lastBody).toContain('name="file"')
      expect(lastBody).toContain('mde-upload-test.png')
    } finally {
      fs.unlinkSync(file)
    }
  })

  it('does nothing when the host is disabled or has no URL', async () => {
    const file = path.join(os.tmpdir(), 'mde-upload-test2.png')
    fs.writeFileSync(file, 'x')
    try {
      expect(await uploadImage(file, settings({ enabled: false, url: 'http://x' }))).toBeNull()
      expect(await uploadImage(file, settings({ enabled: true, url: '' }))).toBeNull()
    } finally {
      fs.unlinkSync(file)
    }
  })
})
