/**
 * A text selection inside a *rendered* table cell.
 *
 * The browser selection lives in the widget, but CodeMirror clears the DOM
 * selection when a key is pressed. The selection is therefore captured when
 * the mouse is released and the formatting commands use the captured range.
 */

export interface CellSelection {
  /** Source range of the selected text. */
  from: number
  to: number
  /** The selected text, used to detect that the document changed. */
  text: string
}

let pending: CellSelection | null = null

export function setCellSelection(selection: CellSelection | null): void {
  pending = selection
}

/** The captured selection, if it still matches the document. */
export function cellSelection(textAt: (from: number, to: number) => string): CellSelection | null {
  if (!pending) return null
  const current = textAt(pending.from, pending.to)
  if (current !== pending.text) {
    pending = null
    return null
  }
  return pending
}
