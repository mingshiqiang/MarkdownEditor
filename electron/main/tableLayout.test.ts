// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLayoutFile, writeLayoutFile } from './tableLayout'

let dir = ''

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-layout-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('the table layout file', () => {
  it('stores the widths per document and per table', () => {
    const file = path.join(dir, 'table-layout.json')
    writeLayoutFile(file, {
      'C:/docs/a.md': { 'name#0': [120, 240] },
      'C:/docs/b.md': { 'title#0': [80] }
    })
    const all = readLayoutFile(file)
    expect(all['C:/docs/a.md']['name#0']).toEqual([120, 240])
    expect(all['C:/docs/b.md']['title#0']).toEqual([80])
  })

  it('drops invalid entries', () => {
    const file = path.join(dir, 'table-layout.json')
    fs.writeFileSync(
      file,
      JSON.stringify({
        'a.md': { t: [100, 'x', -5, 0], bad: 'nope' },
        'b.md': { u: [] }
      })
    )
    const all = readLayoutFile(file)
    expect(all['a.md'].t).toEqual([100])
    expect(all['a.md'].bad).toBeUndefined()
    expect(all['b.md']).toBeUndefined()
  })

  it('returns an empty object for a missing or broken file', () => {
    expect(readLayoutFile(path.join(dir, 'missing.json'))).toEqual({})
    const broken = path.join(dir, 'broken.json')
    fs.writeFileSync(broken, 'not json')
    expect(readLayoutFile(broken)).toEqual({})
  })
})
