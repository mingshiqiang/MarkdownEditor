/**
 * Table widget enhancement (E-05): column widths (display state), drag
 * handles for resizing columns, active-cell rendering (raw source + fake
 * caret) and cell-level hit testing.
 *
 * Tables stay rendered in live mode even when the caret is inside them,
 * otherwise the resize handles would disappear as soon as the user clicks
 * a cell.
 */
import { DEFAULT_COLUMN_WIDTH, MIN_COLUMN_WIDTH, getWidths, setWidths } from './tableLayout'
import { cellAtPos, parseTable, type ParsedTable } from './tables'
import type { Block } from './segmenter'

export interface TableWidgetContext {
  docId: string
  /** Stable-ish table identity (header text + ordinal). */
  key: string
  block: Block
  /** Cell that currently holds the caret (0 = header row). */
  activeCell: { row: number; col: number } | null
}

const CJK_RE = /[\u3000-\u9fff\uff00-\uffef]/
const CHAR_WIDTH = 8.2
const CJK_WIDTH = 15.5
const CELL_PADDING = 26

/** Rough text width of a cell (used as the natural column width). */
function estimateWidth(text: string): number {
  let w = 0
  for (const ch of text) w += CJK_RE.test(ch) ? CJK_WIDTH : CHAR_WIDTH
  return w + CELL_PADDING
}

/** Natural column widths derived from the cell contents. */
export function naturalWidths(table: ParsedTable): number[] {
  const widths: number[] = new Array(table.columns).fill(MIN_COLUMN_WIDTH)
  const rows: string[][] = [
    table.header.map((c) => c.text),
    ...table.rows.map((r) => r.map((c) => c.text))
  ]
  for (const row of rows) {
    for (let c = 0; c < table.columns; c++) {
      const w = estimateWidth(row[c] ?? '')
      if (w > widths[c]) widths[c] = w
    }
  }
  return widths.map((w) => Math.max(MIN_COLUMN_WIDTH, Math.min(Math.round(w), 420)))
}

/** Apply explicit column widths to the table element. */
export function applyWidths(table: HTMLTableElement, widths: number[]): void {
  table.style.tableLayout = 'fixed'
  let colgroup = table.querySelector('colgroup')
  if (!colgroup) {
    colgroup = document.createElement('colgroup')
    table.insertBefore(colgroup, table.firstChild)
  }
  while (colgroup.children.length > widths.length) colgroup.lastChild?.remove()
  while (colgroup.children.length < widths.length)
    colgroup.appendChild(document.createElement('col'))
  widths.forEach((w, i) => {
    const col = colgroup.children[i] as HTMLTableColElement
    col.style.width = `${w}px`
  })
  table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`
}

function readWidths(table: HTMLTableElement, count: number): number[] {
  const colgroup = table.querySelector('colgroup')
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const col = colgroup?.children[i] as HTMLTableColElement | undefined
    const w = col ? parseFloat(col.style.width) : NaN
    out.push(Number.isFinite(w) ? w : DEFAULT_COLUMN_WIDTH)
  }
  return out
}

/** Attach the drag handles to the header cells. */
function addHandles(table: HTMLTableElement, columns: number): void {
  const headerRow = table.querySelector('tr')
  if (!headerRow) return
  const cells = headerRow.children
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i] as HTMLElement
    cell.classList.add('md-col')
    if (i < columns - 1) {
      let handle = cell.querySelector('.md-col-handle') as HTMLElement | null
      if (!handle) {
        handle = document.createElement('span')
        handle.className = 'md-col-handle'
        handle.dataset.col = String(i)
        cell.appendChild(handle)
      }
    }
  }
}

/** Render the active cell with its raw markdown source + a fake caret. */
function highlightActiveCell(
  table: HTMLTableElement,
  parsed: ParsedTable,
  active: { row: number; col: number } | null
): void {
  for (const cell of table.querySelectorAll('.md-cell-active')) {
    cell.classList.remove('md-cell-active')
    cell.classList.remove('md-cell-raw')
  }
  if (!active) return
  const rows = table.querySelectorAll('tr')
  const row = rows[active.row]
  if (!row) return
  const cell = row.children[active.col] as HTMLElement | undefined
  if (!cell) return
  const source =
    active.row === 0
      ? (parsed.header[active.col]?.text ?? '')
      : (parsed.rows[active.row - 1]?.[active.col]?.text ?? '')
  cell.classList.add('md-cell-active')
  if (source) {
    cell.classList.add('md-cell-raw')
    cell.textContent = source
  }
}

/**
 * Enhance a rendered table widget: widths, handles, active cell and the
 * drag behaviour. Returns the parsed table for the host.
 */
export function enhanceTable(container: HTMLElement, ctx: TableWidgetContext): ParsedTable | null {
  const table = container.querySelector('table') as HTMLTableElement | null
  const parsed = parseTable(ctx.block)
  if (!table || !parsed) return null

  container.classList.add('md-table-scroll')

  const stored = getWidths(ctx.docId, ctx.key)
  const widths = stored && stored.length === parsed.columns ? stored : naturalWidths(parsed)
  if (!stored) setWidths(ctx.docId, ctx.key, widths)

  applyWidths(table, widths)
  addHandles(table, parsed.columns)
  highlightActiveCell(table, parsed, ctx.activeCell)

  // Mark cells so that clicks can be mapped back to the source.
  const rows = table.querySelectorAll('tr')
  rows.forEach((row, r) => {
    Array.from(row.children).forEach((cell, c) => {
      ;(cell as HTMLElement).dataset.cellRow = String(r)
      ;(cell as HTMLElement).dataset.cellCol = String(c)
      // The source range of the cell: a selection inside the rendered cell
      // is mapped back to it.
      const range = r === 0 ? parsed.header[c] : parsed.rows[r - 1]?.[c]
      if (range) {
        ;(cell as HTMLElement).dataset.cellFrom = String(range.from)
        ;(cell as HTMLElement).dataset.cellTo = String(range.to)
      }
    })
  })

  // --- drag to resize -----------------------------------------------------
  const handles = container.querySelectorAll<HTMLElement>('.md-col-handle')
  for (const handle of handles) {
    handle.addEventListener('pointerdown', (e) => {
      const event = e as PointerEvent
      event.preventDefault()
      event.stopPropagation()
      const colIndex = Number(handle.dataset.col ?? '0')
      const startX = event.clientX
      const current = readWidths(table, parsed.columns)
      const startWidth = current[colIndex] ?? DEFAULT_COLUMN_WIDTH

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX
        const next = Math.max(MIN_COLUMN_WIDTH, Math.round(startWidth + delta))
        const updated = [...current]
        updated[colIndex] = next
        applyWidths(table, updated)
      }
      const onUp = () => {
        handle.removeEventListener('pointermove', onMove)
        handle.removeEventListener('pointerup', onUp)
        handle.removeEventListener('pointercancel', onUp)
        setWidths(ctx.docId, ctx.key, readWidths(table, parsed.columns))
      }
      try {
        handle.setPointerCapture?.(event.pointerId)
      } catch {
        /* capture is optional (synthetic events) */
      }
      handle.addEventListener('pointermove', onMove)
      handle.addEventListener('pointerup', onUp)
      handle.addEventListener('pointercancel', onUp)
    })
  }

  return parsed
}

/** Cell that contains the given document position (or null). */
export function activeCellFor(block: Block, pos: number): { row: number; col: number } | null {
  const parsed = parseTable(block)
  if (!parsed) return null
  return cellAtPos(parsed, pos)
}
