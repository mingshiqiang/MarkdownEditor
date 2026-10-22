/**
 * Markdown table parsing & source-level operations (E-05).
 *
 * The parser maps a rendered table back to its source cells, which is what
 * makes cell-level editing (click a cell -> caret in that cell) and the
 * row/column operations possible. All operations return the *new table
 * source text*; the caller dispatches a single change (one undo step).
 */
import type { Block } from './segmenter'

export type Align = 'left' | 'center' | 'right' | null

export interface CellRange {
  /** Absolute document offsets of the cell content (trimmed). */
  from: number
  to: number
  text: string
}

export interface ParsedTable {
  columns: number
  header: CellRange[]
  alignRow: CellRange[] | null
  align: Align[]
  rows: CellRange[][]
  /** Absolute line ranges (from/to) of every table line. */
  lines: { from: number; to: number }[]
}

const DELIM_RE = /^:?-+:?$/

/** Split one markdown table row into cells (absolute offsets). */
export function splitRow(text: string, base: number): CellRange[] {
  const cells: CellRange[] = []
  let i = 0
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++
  if (text[i] === '|') i++
  let cellStart = i
  while (i < text.length) {
    if (text[i] === '\\' && i + 1 < text.length) {
      i += 2
      continue
    }
    if (text[i] === '|') {
      pushCell(cells, text, cellStart, i, base)
      i++
      cellStart = i
      continue
    }
    i++
  }
  if (cellStart < text.length) pushCell(cells, text, cellStart, text.length, base)

  return cells
}

function pushCell(
  cells: CellRange[],
  text: string,
  start: number,
  end: number,
  base: number
): void {
  let s = start
  let e = end
  while (s < e && (text[s] === ' ' || text[s] === '\t')) s++
  while (e > s && (text[e - 1] === ' ' || text[e - 1] === '\t')) e--
  cells.push({ from: base + s, to: base + e, text: text.slice(s, e) })
}

function alignOf(cellText: string): Align {
  const t = cellText.trim()
  if (!DELIM_RE.test(t)) return null
  const left = t.startsWith(':')
  const right = t.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

/** Parse a table block into cells/rows/alignments. */
export function parseTable(block: Block): ParsedTable | null {
  if (block.type !== 'table') return null
  return parseTableText(block.text, block.from)
}

/** Parse raw table source (with a document offset base). */
export function parseTableText(text: string, base = 0): ParsedTable | null {
  const lines = text.split('\n')
  if (lines.length < 2) return null

  const lineRanges: { from: number; to: number }[] = []
  let offset = base
  for (const line of lines) {
    lineRanges.push({ from: offset, to: offset + line.length })
    offset += line.length + 1
  }

  const header = splitRow(lines[0], lineRanges[0].from)
  const alignCells = splitRow(lines[1], lineRanges[1].from)
  const columns = Math.max(header.length, alignCells.length)
  if (columns === 0) return null

  const align: Align[] = []
  for (let c = 0; c < columns; c++) {
    align.push(alignOf(alignCells[c]?.text ?? ''))
  }

  const rows: CellRange[][] = []
  for (let i = 2; i < lines.length; i++) {
    rows.push(splitRow(lines[i], lineRanges[i].from))
  }

  return { columns, header, alignRow: alignCells, align, rows, lines: lineRanges }
}

/** Locate the cell that contains the given document position. */
export function cellAtPos(table: ParsedTable, pos: number): { row: number; col: number } | null {
  const allRows: CellRange[][] = [table.header, ...table.rows]
  for (let r = 0; r < allRows.length; r++) {
    for (let c = 0; c < allRows[r].length; c++) {
      const cell = allRows[r][c]
      if (pos >= cell.from && pos <= cell.to) return { row: r, col: c }
    }
  }
  return null
}

/* ------------------------------ text operations ---------------------------- */

export function formatAlign(align: Align): string {
  switch (align) {
    case 'left':
      return ':---'
    case 'center':
      return ':---:'
    case 'right':
      return '---:'
    default:
      return '---'
  }
}

function renderRow(cells: string[]): string {
  return `| ${cells.join(' | ')} |`
}

function cellsOfRow(table: ParsedTable, rowIndex: number): string[] {
  const row = rowIndex === 0 ? table.header : table.rows[rowIndex - 1]
  const out: string[] = []
  for (let c = 0; c < table.columns; c++) out.push(row[c]?.text ?? '')
  return out
}

/** Rebuild the whole table source with the given rows. */
function rebuild(rows: string[][], aligns: Align[]): string {
  const lines: string[] = []
  lines.push(renderRow(rows[0] ?? []))
  lines.push(renderRow(aligns.map((a) => formatAlign(a))))
  for (let i = 1; i < rows.length; i++) lines.push(renderRow(rows[i]))
  return lines.join('\n')
}

/** Insert an empty row after the given body row index (-1 = before first). */
export function insertRow(table: ParsedTable, bodyIndex: number): string {
  const rows: string[][] = [cellsOfRow(table, 0)]
  for (let i = 0; i < table.rows.length; i++) rows.push(cellsOfRow(table, i + 1))
  const empty = new Array(table.columns).fill('')
  const at = bodyIndex < 0 ? 1 : Math.min(bodyIndex + 2, rows.length)
  rows.splice(at, 0, empty)
  return rebuild(rows, table.align)
}

/** Remove a body row by index. */
export function removeRow(table: ParsedTable, bodyIndex: number): string | null {
  if (bodyIndex < 0 || bodyIndex >= table.rows.length) return null
  const rows: string[][] = [cellsOfRow(table, 0)]
  for (let i = 0; i < table.rows.length; i++) {
    if (i !== bodyIndex) rows.push(cellsOfRow(table, i + 1))
  }
  return rebuild(rows, table.align)
}

/** Insert a column at the given index. */
export function insertColumn(table: ParsedTable, colIndex: number): string {
  const rows: string[][] = []
  for (let r = 0; r <= table.rows.length; r++) {
    const cells = cellsOfRow(table, r)
    cells.splice(Math.max(0, Math.min(colIndex, cells.length)), 0, '')
    rows.push(cells)
  }
  const aligns = [...table.align]
  aligns.splice(Math.max(0, Math.min(colIndex, aligns.length)), 0, null)
  return rebuild(rows, aligns)
}

/** Remove a column by index. */
export function removeColumn(table: ParsedTable, colIndex: number): string | null {
  if (colIndex < 0 || colIndex >= table.columns) return null
  const rows: string[][] = []
  for (let r = 0; r <= table.rows.length; r++) {
    const cells = cellsOfRow(table, r)
    cells.splice(colIndex, 1)
    rows.push(cells)
  }
  const aligns = [...table.align]
  aligns.splice(colIndex, 1)
  return rebuild(rows, aligns)
}

/** Move a body row to another position. */
export function moveRow(table: ParsedTable, from: number, to: number): string | null {
  if (from < 0 || from >= table.rows.length) return null
  const target = Math.max(0, Math.min(to, table.rows.length - 1))
  if (from === target) return null
  const rows: string[][] = [cellsOfRow(table, 0)]
  for (let i = 0; i < table.rows.length; i++) rows.push(cellsOfRow(table, i + 1))
  const [moved] = rows.splice(from + 1, 1)
  rows.splice(target + 1, 0, moved)
  return rebuild(rows, table.align)
}

/** Move a column to another position. */
export function moveColumn(table: ParsedTable, from: number, to: number): string | null {
  if (from < 0 || from >= table.columns) return null
  const target = Math.max(0, Math.min(to, table.columns - 1))
  if (from === target) return null
  const rows: string[][] = []
  for (let r = 0; r <= table.rows.length; r++) {
    const cells = cellsOfRow(table, r)
    const [moved] = cells.splice(from, 1)
    cells.splice(target, 0, moved)
    rows.push(cells)
  }
  const aligns = [...table.align]
  const [movedAlign] = aligns.splice(from, 1)
  aligns.splice(target, 0, movedAlign)
  return rebuild(rows, aligns)
}

/** Change the alignment of one column (writes the `:---:` markers). */
export function setColumnAlign(table: ParsedTable, colIndex: number, align: Align): string | null {
  if (colIndex < 0 || colIndex >= table.columns) return null
  const aligns = [...table.align]
  aligns[colIndex] = align
  const rows: string[][] = []
  for (let r = 0; r <= table.rows.length; r++) rows.push(cellsOfRow(table, r))
  return rebuild(rows, aligns)
}

/** Convert TSV / spreadsheet text into a markdown table (Excel paste). */
export function textToTable(text: string): string | null {
  const rawLines = text.replace(/\r\n?/g, '\n').split('\n')
  while (rawLines.length && rawLines[rawLines.length - 1].trim() === '') rawLines.pop()
  if (rawLines.length === 0) return null
  const rows = rawLines.map((line) => line.split('\t'))
  const columns = Math.max(...rows.map((r) => r.length))
  if (columns < 2) return null
  const cell = (v: string) => v.trim().replace(/\|/g, '\\|')
  const lines = [renderRow(rows[0].map(cell))]
  lines.push(renderRow(new Array(columns).fill('---')))
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].map(cell)
    while (cells.length < columns) cells.push('')
    lines.push(renderRow(cells))
  }
  return lines.join('\n')
}
