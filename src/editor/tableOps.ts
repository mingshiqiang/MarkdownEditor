/**
 * Table editing operations (E-05). Every operation rewrites the table
 * source and dispatches it as a single change (one undo step).
 */
import type { EditorView } from '@codemirror/view'
import { liveRefreshEffect } from './extensions/liveRender'
import { clearWidths } from './tableLayout'
import {
  insertColumn,
  insertRow,
  moveColumn,
  moveRow,
  parseTableText,
  removeColumn,
  removeRow,
  setColumnAlign,
  type Align,
  type ParsedTable
} from './tables'
import type { Block } from './segmenter'

export type TableOp =
  | { kind: 'row-add'; where: 'above' | 'below' }
  | { kind: 'row-remove' }
  | { kind: 'row-move'; dir: -1 | 1 }
  | { kind: 'col-add'; where: 'left' | 'right' }
  | { kind: 'col-remove' }
  | { kind: 'col-move'; dir: -1 | 1 }
  | { kind: 'align'; align: Align }
  | { kind: 'reset-widths' }
  | { kind: 'table-remove' }

export interface TableContext {
  block: Block
  table: ParsedTable
  /** Active cell: row 0 = header, 1..n = body rows. */
  cell: { row: number; col: number }
  /** Identity used by the column-width store. */
  key: string
  docId: string
}

/** Compute the new table source for an operation (null = no change). */
export function computeTableText(ctx: TableContext, op: TableOp): string | null {
  const { table, cell } = ctx
  const bodyIndex = cell.row > 0 ? cell.row - 1 : -1

  switch (op.kind) {
    case 'row-add':
      return insertRow(table, op.where === 'above' ? bodyIndex - 1 : bodyIndex)
    case 'row-remove':
      return bodyIndex >= 0 ? removeRow(table, bodyIndex) : null
    case 'row-move': {
      if (bodyIndex < 0) return null
      const target = bodyIndex + op.dir
      if (target < 0 || target >= table.rows.length) return null
      return moveRow(table, bodyIndex, target)
    }
    case 'col-add':
      return insertColumn(table, op.where === 'left' ? cell.col : cell.col + 1)
    case 'col-remove':
      return removeColumn(table, cell.col)
    case 'col-move': {
      const target = cell.col + op.dir
      if (target < 0 || target >= table.columns) return null
      return moveColumn(table, cell.col, target)
    }
    case 'align':
      return setColumnAlign(table, cell.col, op.align)
    case 'table-remove':
      return ''
    default:
      return null
  }
}

/** Apply an operation to the editor. */
export function applyTableOp(view: EditorView, ctx: TableContext, op: TableOp): boolean {
  if (op.kind === 'reset-widths') {
    clearWidths(ctx.docId, ctx.key)
    view.dispatch({ effects: liveRefreshEffect.of(null) })
    return true
  }
  const text = computeTableText(ctx, op)
  if (text === null) return false

  // Keep the caret in the same cell after the table was rewritten.
  const reparsed = parseTableText(text, ctx.block.from)
  const target =
    reparsed && ctx.cell.row === 0
      ? reparsed.header[ctx.cell.col]
      : reparsed?.rows[ctx.cell.row - 1]?.[ctx.cell.col]
  const anchor = target ? target.from : ctx.block.from

  view.dispatch({
    changes: { from: ctx.block.from, to: ctx.block.to, insert: text },
    selection: { anchor },
    userEvent: 'input.table'
  })
  return true
}
