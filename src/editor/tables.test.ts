import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { segmentDoc } from './segmenter'
import {
  cellAtPos,
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTable,
  removeColumn,
  removeRow,
  setColumnAlign,
  textToTable
} from './tables'

function tableBlock(source: string) {
  const doc = EditorState.create({ doc: source }).doc
  const block = segmentDoc(doc).find((b) => b.type === 'table')
  if (!block) throw new Error('no table block found')
  return block
}

const SOURCE = [
  '| 名称 | 说明 | 状态 |',
  '| --- | :---: | ---: |',
  '| 实时渲染 | Typora 式 | OK |',
  '| 查找替换 | 全文检索 | OK |'
].join('\n')

describe('parseTable', () => {
  it('parses header, alignment and body rows', () => {
    const table = parseTable(tableBlock(SOURCE))
    expect(table).toBeTruthy()
    expect(table!.columns).toBe(3)
    expect(table!.header.map((c) => c.text)).toEqual(['名称', '说明', '状态'])
    expect(table!.align).toEqual([null, 'center', 'right'])
    expect(table!.rows.length).toBe(2)
    expect(table!.rows[0].map((c) => c.text)).toEqual(['实时渲染', 'Typora 式', 'OK'])
  })

  it('maps cell positions back to the source', () => {
    const block = tableBlock(SOURCE)
    const table = parseTable(block)!
    const cell = table.rows[0][1]
    const found = cellAtPos(table, cell.from)
    expect(found).toEqual({ row: 1, col: 1 })
    // the offsets really point at the cell content
    expect(block.text.slice(cell.from - block.from, cell.to - block.from)).toBe('Typora 式')
  })

  it('handles tables without a leading pipe', () => {
    const block = tableBlock('a | b\n--- | ---\n1 | 2')
    const table = parseTable(block)!
    expect(table.columns).toBe(2)
    expect(table.header.map((c) => c.text)).toEqual(['a', 'b'])
  })
})

describe('row operations', () => {
  it('inserts a row below', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = insertRow(table, 0)
    expect(text.split('\n')).toHaveLength(5)
    expect(text.split('\n')[3]).toBe('|  |  |  |')
  })

  it('inserts a row above the first body row', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = insertRow(table, -1)
    expect(text.split('\n')[2]).toBe('|  |  |  |')
  })

  it('removes a body row', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = removeRow(table, 0)!
    expect(text.split('\n')).toHaveLength(3)
    expect(text).not.toContain('实时渲染')
  })

  it('moves a row', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = moveRow(table, 0, 1)!
    const rows = text.split('\n')
    expect(rows[2]).toContain('查找替换')
    expect(rows[3]).toContain('实时渲染')
  })
})

describe('column operations', () => {
  it('inserts a column', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = insertColumn(table, 1)
    expect(text.split('\n')[0]).toBe('| 名称 |  | 说明 | 状态 |')
    expect(text.split('\n')[1]).toBe('| --- | --- | :---: | ---: |')
  })

  it('removes a column', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = removeColumn(table, 1)!
    expect(text.split('\n')[0]).toBe('| 名称 | 状态 |')
  })

  it('moves a column', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = moveColumn(table, 0, 2)!
    expect(text.split('\n')[0]).toBe('| 说明 | 状态 | 名称 |')
  })

  it('writes the alignment markers', () => {
    const table = parseTable(tableBlock(SOURCE))!
    const text = setColumnAlign(table, 0, 'center')!
    expect(text.split('\n')[1]).toBe('| :---: | :---: | ---: |')
    const left = setColumnAlign(table, 2, 'left')!
    expect(left.split('\n')[1]).toBe('| --- | :---: | :--- |')
  })
})

describe('textToTable', () => {
  it('converts spreadsheet text into a markdown table', () => {
    const text = textToTable('a\tb\tc\n1\t2\t3')!
    expect(text).toBe('| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |')
  })

  it('escapes pipes and pads short rows', () => {
    const text = textToTable('a|b\tc\n1')!
    expect(text).toContain('a\\|b')
    expect(text.split('\n')[2]).toBe('| 1 |  |')
  })

  it('returns null for single column text', () => {
    expect(textToTable('just text')).toBeNull()
  })
})
