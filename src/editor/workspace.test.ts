import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildTree,
  createEntry,
  isMarkdownFile,
  renameEntry,
  searchWorkspace
} from '../../electron/main/workspace'

let root = ''

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-ws-'))
  fs.mkdirSync(path.join(root, 'docs'))
  fs.mkdirSync(path.join(root, 'docs', 'nested'))
  fs.mkdirSync(path.join(root, 'node_modules'))
  fs.writeFileSync(path.join(root, 'docs', 'a.md'), '# 标题\n\n正文内容 needle\n')
  fs.writeFileSync(path.join(root, 'docs', 'nested', 'b.md'), 'second needle line\n')
  fs.writeFileSync(path.join(root, 'docs', 'image.png'), 'binary')
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.md'), 'should not appear')
  fs.writeFileSync(path.join(root, '.hidden.md'), 'hidden')
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('buildTree', () => {
  it('lists directories first and marks markdown/image files', async () => {
    const nodes = await buildTree(root)
    const names = nodes.map((n) => n.name)
    expect(names[0]).toBe('docs')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('.hidden.md')

    const docs = nodes.find((n) => n.name === 'docs')!
    const fileNames = docs.children!.map((c) => c.name)
    expect(fileNames).toContain('a.md')
    expect(fileNames).toContain('image.png')
    const md = docs.children!.find((c) => c.name === 'a.md')!
    expect(md.markdown).toBe(true)
    expect(md.image).toBe(false)
    const img = docs.children!.find((c) => c.name === 'image.png')!
    expect(img.image).toBe(true)
  })

  it('walks nested directories', async () => {
    const nodes = await buildTree(root)
    const docs = nodes.find((n) => n.name === 'docs')!
    const nested = docs.children!.find((c) => c.name === 'nested')!
    expect(nested.type).toBe('directory')
    expect(nested.children!.map((c) => c.name)).toContain('b.md')
  })
})

describe('entry operations', () => {
  it('creates and renames files', async () => {
    const created = await createEntry(root, 'new-file.md', 'file')
    expect(created).toBe(true)
    expect(fs.existsSync(path.join(root, 'new-file.md'))).toBe(true)

    const renamed = await renameEntry(path.join(root, 'new-file.md'), 'renamed.md')
    expect(renamed).toBe(true)
    expect(fs.existsSync(path.join(root, 'renamed.md'))).toBe(true)
  })

  it('rejects invalid names and duplicates', async () => {
    expect(await createEntry(root, 'bad/name.md', 'file')).toBe(false)
    expect(await createEntry(root, '', 'file')).toBe(false)
    expect(await createEntry(root, 'renamed.md', 'file')).toBe(false)
  })
})

describe('searchWorkspace', () => {
  it('finds files by name', async () => {
    const matches = await searchWorkspace(root, 'a.md', 'name')
    expect(matches.length).toBe(1)
    expect(matches[0].name).toBe('a.md')
  })

  it('finds content matches with line numbers', async () => {
    const matches = await searchWorkspace(root, 'needle', 'content')
    expect(matches.length).toBe(2)
    const first = matches.find((m) => m.name === 'a.md')!
    expect(first.line).toBe(3)
    expect(first.preview).toContain('needle')
  })

  it('is case insensitive and ignores ignored folders', async () => {
    const matches = await searchWorkspace(root, 'NEEDLE', 'content')
    expect(matches.length).toBe(2)
  })

  it('returns nothing for an empty query', async () => {
    expect(await searchWorkspace(root, '   ', 'content')).toEqual([])
  })
})

describe('isMarkdownFile', () => {
  it('recognises markdown extensions', () => {
    expect(isMarkdownFile('a.md')).toBe(true)
    expect(isMarkdownFile('a.markdown')).toBe(true)
    expect(isMarkdownFile('a.png')).toBe(false)
  })
})
