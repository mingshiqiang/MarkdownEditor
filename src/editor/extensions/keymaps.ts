/**
 * Editor commands & keymap (E-03/E-04/E-05/E-16):
 * headings Ctrl+1..6, mark toggles (bold/italic/strike/highlight/code/math),
 * link & table insertion, list item indent/dedent via Tab/Shift+Tab.
 * The key bindings come from the user's keymap (shared/keymap.ts).
 *
 * Note on selections: `state.changeByRange` uses the range returned for the
 * *first* selection verbatim (no mapping), so we compute the final cursor
 * positions ourselves and offset them by the length delta of the preceding
 * ranges (multi-cursor safe).
 */
import { EditorSelection } from '@codemirror/state'
import type { EditorState, SelectionRange, ChangeSpec } from '@codemirror/state'
import { EditorView, type Command } from '@codemirror/view'
import { segmentDoc } from '../segmenter'
import { cellSelection } from '../cellSelection'
import type { KeyActionId } from '../../../shared/keymap'
import { matchEditorShortcut } from '../../lib/shortcuts'

const RE_LINE_HEADING = /^( {0,3})(#{1,6})([ \t]|$)/

interface Plan {
  changes: ChangeSpec[]
  /** Selection in the coordinate space *after* this plan's own changes. */
  from: number
  to: number
  /** Net document length change of this plan. */
  delta: number
}

function dispatchPlans(view: EditorView, plans: Plan[]): void {
  const state = view.state
  const specs: ChangeSpec[] = []
  const ranges: SelectionRange[] = []
  let shift = 0
  for (const plan of plans) {
    specs.push(...plan.changes)
    ranges.push(EditorSelection.range(plan.from + shift, plan.to + shift))
    shift += plan.delta
  }
  view.dispatch({
    changes: specs,
    selection: EditorSelection.create(ranges, state.selection.mainIndex)
  })
}

/* -------------------------------- headings -------------------------------- */

export function setHeadingCommand(level: number): Command {
  return (view: EditorView): boolean => {
    const state = view.state
    const processed = new Set<number>()
    const plans: Plan[] = []

    for (const range of state.selection.ranges) {
      const line = state.doc.lineAt(range.head)
      if (processed.has(line.from)) {
        // Another cursor already handled this line.
        plans.push({ changes: [], from: range.from, to: range.to, delta: 0 })
        continue
      }
      processed.add(line.from)
      const m = RE_LINE_HEADING.exec(line.text)
      const hashes = '#'.repeat(level)
      if (level === 0) {
        // "Paragraph": drop an existing heading marker.
        if (!m) {
          plans.push({ changes: [], from: range.from, to: range.to, delta: 0 })
          continue
        }
        const oldLen = m[1].length + m[2].length + (m[3] === '' ? 0 : 1)
        const map = (p: number): number => {
          if (p <= line.from) return p
          if (p >= line.from + oldLen) return p - oldLen
          return line.from
        }
        plans.push({
          changes: [{ from: line.from, to: line.from + oldLen, insert: '' }],
          from: map(range.from),
          to: map(range.to),
          delta: -oldLen
        })
      } else if (m) {
        const oldLen = m[1].length + m[2].length + (m[3] === '' ? 0 : 1)
        const insert = `${m[1]}${hashes} `
        const newLen = insert.length
        const delta = newLen - oldLen
        const map = (p: number): number => {
          if (p <= line.from) return p
          if (p >= line.from + oldLen) return p + delta
          return line.from + newLen
        }
        plans.push({
          changes: [{ from: line.from, to: line.from + oldLen, insert }],
          from: map(range.from),
          to: map(range.to),
          delta
        })
      } else {
        const insert = `${hashes} `
        const delta = insert.length
        const map = (p: number): number => (p >= line.from ? p + delta : p)
        plans.push({
          changes: [{ from: line.from, insert }],
          from: map(range.from),
          to: map(range.to),
          delta
        })
      }
    }

    dispatchPlans(view, plans)
    return true
  }
}

/* ------------------------------ mark toggles ------------------------------- */

export function toggleWrapCommand(marker: string): Command {
  return (view: EditorView): boolean => {
    const state = view.state
    const L = marker.length
    const plans: Plan[] = []

    for (const range of state.selection.ranges) {
      const { from, to } = range
      const before = state.sliceDoc(Math.max(0, from - L), from)
      const after = state.sliceDoc(to, Math.min(state.doc.length, to + L))
      if (from - L >= 0 && to + L <= state.doc.length && before === marker && after === marker) {
        // unwrap: drop both markers
        plans.push({
          changes: [
            { from: from - L, to: from },
            { from: to, to: to + L }
          ],
          from: from - L,
          to: to - L,
          delta: -2 * L
        })
      } else if (range.empty) {
        // empty pair with the caret in the middle
        plans.push({
          changes: [{ from, insert: marker + marker }],
          from: from + L,
          to: from + L,
          delta: 2 * L
        })
      } else {
        plans.push({
          changes: [
            { from, insert: marker },
            { from: to, insert: marker }
          ],
          from: from + L,
          to: to + L,
          delta: 2 * L
        })
      }
    }

    dispatchPlans(view, plans)
    return true
  }
}

/* ---------------------------------- link ----------------------------------- */

export const insertLinkCommand: Command = (view: EditorView): boolean => {
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  const insert = `[${text}]()`
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + text.length + 3 } // caret inside the parens
  })
  return true
}

/* ---------------------------------- table ---------------------------------- */

const TABLE_SNIPPET = '|  |  |\n| --- | --- |\n|  |  |'

export const insertTableCommand: Command = (view: EditorView): boolean => {
  const line = view.state.doc.lineAt(view.state.selection.main.from)
  if (line.text.trim() === '') {
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: TABLE_SNIPPET },
      selection: { anchor: line.from + 2 }
    })
  } else {
    const at = line.to
    view.dispatch({
      changes: { from: at, insert: `\n\n${TABLE_SNIPPET}` },
      selection: { anchor: at + 4 }
    })
  }
  return true
}

/* ------------------------------- list indent ------------------------------- */

export function indentListItem(dir: 1 | -1): Command {
  return (view: EditorView): boolean => {
    const state: EditorState = view.state
    const head = state.selection.main.head
    const blocks = segmentDoc(state.doc)
    const block = blocks.find((b) => b.type === 'list-item' && head >= b.from && head <= b.to + 1)
    if (!block) return false
    const changes: ChangeSpec[] = []
    for (let ln = block.lineFrom; ln <= block.lineTo; ln++) {
      const line = state.doc.line(ln)
      if (dir > 0) {
        changes.push({ from: line.from, insert: '  ' })
      } else {
        const m = /^ {1,2}/.exec(line.text)
        if (m) changes.push({ from: line.from, to: line.from + m[0].length, insert: '' })
      }
    }
    if (changes.length === 0) return false
    view.dispatch({ changes, userEvent: 'input.indent.list' })
    return true
  }
}

/* --------------------------------- keymap ---------------------------------- */

/**
 * The source range of a text selection inside a *rendered* table cell. The
 * selection is captured when the mouse is released (CodeMirror clears the
 * DOM selection before a key press is handled).
 */
export function tableCellSelection(view: EditorView): { from: number; to: number } | null {
  const captured = cellSelection((from, to) => view.state.sliceDoc(from, to))
  if (!captured) return null
  return { from: captured.from, to: captured.to }
}

/**
 * Wraps (or unwraps) the given source range with a marker. Used for the
 * inline formatting inside a rendered table cell.
 */
export function wrapRangeCommand(marker: string): Command {
  return (view: EditorView): boolean => {
    const range = tableCellSelection(view)
    if (!range) return false
    const state = view.state
    const text = state.sliceDoc(range.from, range.to)
    const before = state.sliceDoc(Math.max(0, range.from - marker.length), range.from)
    const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + marker.length))
    if (before === marker && after === marker) {
      view.dispatch({
        changes: [
          { from: range.from - marker.length, to: range.from },
          { from: range.to, to: range.to + marker.length }
        ]
      })
    } else {
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: `${marker}${text}${marker}` }
      })
    }
    return true
  }
}

/** Toggles a marker: first on a rendered cell selection, then on the source. */
function toggleMarker(marker: string): Command {
  return (view: EditorView): boolean =>
    wrapRangeCommand(marker)(view) || toggleWrapCommand(marker)(view)
}

/** Editor commands by shortcut action id (the keys are user-configurable). */
const editorCommands: Partial<Record<KeyActionId, Command>> = {
  'markdown:heading-1': setHeadingCommand(1),
  'markdown:heading-2': setHeadingCommand(2),
  'markdown:heading-3': setHeadingCommand(3),
  'markdown:heading-4': setHeadingCommand(4),
  'markdown:heading-5': setHeadingCommand(5),
  'markdown:heading-6': setHeadingCommand(6),
  'markdown:bold': toggleMarker('**'),
  'markdown:italic': toggleMarker('*'),
  'markdown:strike': toggleMarker('~~'),
  'markdown:highlight': toggleMarker('=='),
  'markdown:math': toggleMarker('$'),
  'markdown:code': toggleMarker('`'),
  'markdown:link': insertLinkCommand,
  'markdown:table': insertTableCommand,
  'markdown:indent': indentListItem(1),
  'markdown:outdent': indentListItem(-1)
}

/**
 * Resolves the key press against the active shortcut table on every key
 * down, so a shortcut changed in the preferences applies immediately.
 */
export const editorShortcutExtension = EditorView.domEventHandlers({
  keydown(event, view) {
    const id = matchEditorShortcut(event)
    const run = id ? editorCommands[id] : undefined
    if (!run) return false
    const handled = run(view)
    if (handled) event.preventDefault()
    return handled
  }
})
