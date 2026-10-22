// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import iconv from 'iconv-lite'
import { readTextFile, writeTextFileAtomic } from './fileIo'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-fileio-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('readTextFile', () => {
  it('reads a UTF-8 file', () => {
    const file = path.join(dir, 'a.md')
    fs.writeFileSync(file, '# 标题\n正文', 'utf-8')
    const result = readTextFile(file)
    expect(result?.content).toBe('# 标题\n正文')
    expect(result?.encoding).toBe('utf-8')
  })

  it('reads a GBK file', () => {
    const file = path.join(dir, 'gbk.md')
    fs.writeFileSync(file, iconv.encode('# 中文标题\n正文内容', 'gb18030'))
    const result = readTextFile(file)
    expect(result?.content).toBe('# 中文标题\n正文内容')
    expect(result?.encoding).toBe('gb18030')
  })

  it('returns null for a missing file', () => {
    expect(readTextFile(path.join(dir, 'missing.md'))).toBeNull()
  })
})

describe('writeTextFileAtomic', () => {
  it('keeps the encoding of a GBK file', () => {
    const file = path.join(dir, 'gbk.md')
    fs.writeFileSync(file, iconv.encode('# 标题', 'gb18030'))
    writeTextFileAtomic(file, '# 新标题\n正文')
    const raw = fs.readFileSync(file)
    // The bytes are still GBK (not UTF-8).
    expect(raw.equals(iconv.encode('# 新标题\n正文', 'gb18030'))).toBe(true)
    expect(readTextFile(file)?.content).toBe('# 新标题\n正文')
    expect(readTextFile(file)?.encoding).toBe('gb18030')
  })

  it('writes new files as UTF-8', () => {
    const file = path.join(dir, 'new.md')
    writeTextFileAtomic(file, '# 新文件')
    expect(readTextFile(file)?.encoding).toBe('utf-8')
    expect(readTextFile(file)?.content).toBe('# 新文件')
  })

  it('keeps the UTF-8 BOM', () => {
    const file = path.join(dir, 'bom.md')
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi')]))
    writeTextFileAtomic(file, 'hello')
    const result = readTextFile(file)
    expect(result?.encoding).toBe('utf-8-bom')
    expect(result?.content).toBe('hello')
  })
})
