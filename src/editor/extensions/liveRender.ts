/**
 * Live-render extension (E-01): the Typora-style core.
 *
 * - Every block (heading/paragraph/list item/quote/table/code/math/hr/...)
 *   NOT containing the selection is replaced by a rendered widget.
 * - The block containing the cursor/selection shows source. An in-progress
 *   IME composition always sits inside the selection, so composition is
 *   never disturbed by decorations (E-17 IME safety).
 * - Rendered blocks are added to atomicRanges so the caret never lands
 *   inside hidden text.
 * - Widgets handle: task-checkbox toggling, code copy buttons, Ctrl/Cmd+
 *   click external links, relative .md links, and clicking into a block.
 *
 * Implementation note: block widgets may not be provided through a
 * ViewPlugin ("Block decorations may not be specified via plugins"), so the
 * decoration set is computed through the `EditorView.decorations` facet.
 */
import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import type { EditorState, Range, StateEffectType } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { docDirField, docIdField } from '../docFields'
import { segmentDoc, type Block } from '../segmenter'
import { renderBlockSource, extractFenceCode, type RenderEnv } from '../markdown/render'
import { renderMermaid, mermaidRenderRev } from '../markdown/mermaid'
import { attachImageHandlers } from '../markdown/images'
import { enhanceTable, activeCellFor } from '../tableWidget'
import { setCellSelection } from '../cellSelection'
import {
  buildPlainTextMap,
  clickedTextPosition,
  sourceRangeOfTextRange,
  textOffsetIn
} from '../textMap'
import { CODE_LANGUAGES, fenceLangRange, fenceLanguage } from '../fence'
import { addRemoteImageButtons } from '../remoteImage'
import { markerOf, markerRange, sourceLineClasses } from '../sourceStyle'
import { tableKey } from '../tableLayout'
import type { ParsedTable } from '../tables'
import { toast, requestOpenDoc } from '../../lib/bus'
import { t } from '../../lib/i18n'

/** Bump through the editor host (theme change etc.) to rebuild widgets. */
export const liveRefreshEffect: StateEffectType<null> = StateEffect.define<null>()

export function dispatchLiveRefresh(view: EditorView): void {
  view.dispatch({ effects: liveRefreshEffect.of(null) })
}

/** Counter bumped by {@link liveRefreshEffect}; used as a compute dependency. */
const liveRevField = StateField.define<number>({
  create: () => 0,
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(liveRefreshEffect)) return value + 1
    }
    return value
  }
})

/* --------------------------------- widget ---------------------------------- */

/**
 * The marker of a list item in the source view (`- `, `1. `). It replaces the
 * markdown marker, so the text keeps the position it has in the rendered
 * list (the bullet sits in the marker area of the list item).
 */
class BlockMarkerWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly level: number
  ) {
    super()
  }

  eq(other: BlockMarkerWidget): boolean {
    return other.label === this.label && other.level === this.level
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-src-marker'
    // The marker area of a list item (1.6em per nesting level).
    span.style.width = `${(this.level + 1) * 1.6}em`
    span.textContent = this.label ? `${this.label}.` : '•'
    return span
  }
}

class MarkdownBlockWidget extends WidgetType {
  constructor(
    readonly block: Block,
    readonly rev: number,
    readonly docId: string,
    readonly tableKey: string,
    readonly activeCell: { row: number; col: number } | null
  ) {
    super()
  }

  eq(other: MarkdownBlockWidget): boolean {
    return (
      other.block.type === this.block.type &&
      other.block.from === this.block.from &&
      other.block.to === this.block.to &&
      other.block.text === this.block.text &&
      other.rev === this.rev &&
      other.docId === this.docId &&
      other.tableKey === this.tableKey &&
      other.activeCell?.row === this.activeCell?.row &&
      other.activeCell?.col === this.activeCell?.col
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const env: RenderEnv = { docDir: view.state.field(docDirField, false) || '' }
    const div = document.createElement('div')
    const block = this.block
    div.className = `cm-mdw cm-mdw-${block.type}`
    if (block.type === 'heading' && block.level) div.classList.add(`cm-mdw-h${block.level}`)
    div.dataset.block = block.type
    div.innerHTML = renderBlockSource(block, env)

    // Task checkboxes: enable interaction (rendered disabled by default).
    for (const cb of div.querySelectorAll<HTMLInputElement>('input.task-list-item-checkbox')) {
      cb.disabled = false
    }

    // Show a readable placeholder for images that cannot be loaded.
    attachImageHandlers(div)

    // Tables: column widths, resize handles and the active cell.
    let parsedTable: ParsedTable | null = null
    if (block.type === 'table') {
      parsedTable = enhanceTable(div, {
        docId: this.docId,
        key: this.tableKey,
        block,
        activeCell: this.activeCell
      })
    }

    // Code blocks: language dropdown (E-06).
    if (block.type === 'fence' && !block.mermaid) {
      addLanguageSelect(div, view, block)
    }

    // Remote images: offer to store them locally (E-09).
    addRemoteImageButtons(div, view, block)

    // Mermaid fences mount asynchronously.
    if (block.type === 'fence' && block.mermaid) {
      const code = extractFenceCode(block.text)
      void renderMermaid(code).then((result) => {
        if (!div.isConnected) return
        div.innerHTML = result.html
      })
    }

    div.addEventListener('mousedown', (e) =>
      handleWidgetMouseDown(e, view, div, block, parsedTable)
    )
    div.addEventListener('mouseup', (e) => handleWidgetMouseUp(e, view))
    return div
  }

  ignoreEvent(event: Event): boolean {
    // We fully own mousedown on widgets; let other events pass through.
    return event.type === 'mousedown'
  }
}

function handleWidgetMouseDown(
  e: MouseEvent,
  view: EditorView,
  div: HTMLElement,
  block: Block,
  parsedTable: ParsedTable | null
): void {
  const target = e.target as HTMLElement

  // Language dropdown of a code block: handled by the select itself.
  if (target.closest('.md-code-lang-select')) return

  // Column resize handle: the pointer handler does the dragging.
  if (target.closest('.md-col-handle')) {
    e.preventDefault()
    return
  }

  // Copy button on code blocks
  const copyBtn = target.closest('.md-copy-btn')
  if (copyBtn) {
    e.preventDefault()
    e.stopPropagation()
    const code = div.querySelector('.md-code-wrap pre code')
    void window.api.clipboardWriteText(code?.textContent ?? '')
    toast(t('ui.copied'))
    return
  }

  // Task checkbox toggling (block stays rendered, no source reveal)
  const checkbox = target.closest('input.task-list-item-checkbox') as HTMLInputElement | null
  if (checkbox) {
    if (block.task && block.task.boxFrom >= 0) {
      e.preventDefault()
      view.dispatch({
        changes: {
          from: block.task.boxFrom,
          to: block.task.boxTo,
          insert: block.task.checked ? '[ ]' : '[x]'
        },
        userEvent: 'input.toggleTask'
      })
    }
    return
  }

  // Table cells: the caret goes into the matching source cell, but only when
  // the user just clicks. A drag selects text inside the rendered cell, which
  // is used to format the selection (Ctrl+B and friends).
  if (parsedTable) {
    const cellEl = target.closest('[data-cell-row]') as HTMLElement | null
    if (cellEl) {
      const r = Number(cellEl.dataset.cellRow ?? '0')
      const c = Number(cellEl.dataset.cellCol ?? '0')
      const cell = r === 0 ? parsedTable.header[c] : parsedTable.rows[r - 1]?.[c]
      if (cell) {
        pendingCell = { from: cell.from, element: cellEl }
        return
      }
    }
  }

  // Links: Ctrl/Cmd+click opens external in the system browser (E-10)
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href') || ''
    if ((e.ctrlKey || e.metaKey) && /^https?:/i.test(href)) {
      e.preventDefault()
      e.stopPropagation()
      void window.api.openExternal(href)
      return
    }
    if (!/^(https?:|mailto:|#)/i.test(href) && /\.(md|markdown|mkd)$/i.test(href)) {
      e.preventDefault()
      e.stopPropagation()
      void openRelativeMd(href, view.state.field(docDirField, false) || '')
      return
    }
    // plain click on a link: fall through, reveal source at block start
  }

  // Default: enter this block (reveal source). The caret goes to the
  // position that was clicked, not to the start of the block.
  e.preventDefault()
  const pos =
    clickedCodePosition(e, block) ?? clickedSourcePosition(view, div, e, block.from, block.to)
  keepClickPosition(view, e, () => {
    view.dispatch({ selection: EditorSelection.cursor(pos) })
  })
  view.focus()
}

/**
 * The source position of a click inside a rendered code block. The code is
 * shown verbatim, so the offset inside the code element maps directly onto
 * the source (the toolbar of the block would shift the offset otherwise).
 */
function clickedCodePosition(e: MouseEvent, block: Block): number | null {
  const target = e.target as HTMLElement
  const code = target.closest('pre code') as HTMLElement | null
  if (!code) return null
  const hit = clickedTextPosition(code, e.clientX, e.clientY)
  if (!hit) return null
  const offset = textOffsetIn(code, hit.node, hit.offset)
  const firstNewline = block.text.indexOf('\n')
  if (firstNewline < 0) return null
  const codeStart = block.from + firstNewline + 1
  return Math.min(codeStart + Math.max(0, offset), block.to)
}

/**
 * Applies a change and keeps the clicked position stable. The block switches
 * between its rendered and its source form, which changes its height and
 * would move the text under the mouse.
 *
 * The correction runs before the next paint, because CodeMirror corrects
 * the scroll position itself when the height of the document changes.
 */
function keepClickPosition(view: EditorView, e: MouseEvent, apply: () => void): void {
  apply()
  requestAnimationFrame(() => {
    const head = view.state.selection.main.head
    const dom = view.domAtPos(head)
    const node = dom?.node
    if (!node) return
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node
    if (!(el instanceof Element)) return
    const rect = el.getBoundingClientRect()
    if (!rect.height) return
    const delta = e.clientY - (rect.top + rect.bottom) / 2
    if (!Number.isFinite(delta) || Math.abs(delta) < 1 || Math.abs(delta) > 400) return
    view.scrollDOM.scrollTop += delta
  })
}

/**
 * The source position of a click inside a rendered block. The visible text
 * of the block is mapped back to the source, so clicking in the middle of a
 * paragraph puts the caret in the middle of the paragraph.
 */
function clickedSourcePosition(
  view: EditorView,
  div: HTMLElement,
  e: MouseEvent,
  base: number,
  end: number
): number {
  const hit = clickedTextPosition(div, e.clientX, e.clientY)
  if (!hit) return base
  const source = view.state.sliceDoc(base, end)
  const options = { atomicMath: true }
  const map = buildPlainTextMap(source, options)
  const textOffset = textOffsetIn(div, hit.node, hit.offset, options)
  if (textOffset < 0 || map.sourceIndex.length === 0) return base
  // caretPositionFromPoint may return the boundary just after the last
  // character. Map that to the end of the visible text, not to the block start.
  const sourceOffset =
    textOffset >= map.sourceIndex.length
      ? map.sourceIndex[map.sourceIndex.length - 1] + 1
      : map.sourceIndex[textOffset]
  return Math.min(end, base + sourceOffset)
}

/**
 * A cell click waits for the mouse up, so that a drag can select text inside
 * the rendered cell (which is then formatted with Ctrl+B and friends).
 */
let pendingCell: { from: number; element: HTMLElement } | null = null

function handleWidgetMouseUp(e: MouseEvent, view: EditorView): void {
  const pending = pendingCell
  pendingCell = null
  if (!pending) return
  const selection = window.getSelection()
  if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
    const anchor = selection.anchorNode?.parentElement ?? selection.anchorNode
    if (anchor && pending.element.contains(anchor)) {
      // The user selected text inside the cell: remember the range so that
      // the formatting commands (Ctrl+B and friends) can use it.
      captureCellSelection(view, pending.element, selection)
      return
    }
  }
  e.preventDefault()
  const to = Number(pending.element.dataset.cellTo)
  const pos = clickedSourcePosition(
    view,
    pending.element,
    e,
    pending.from,
    Number.isFinite(to) ? to : pending.from
  )
  keepClickPosition(view, e, () => {
    view.dispatch({ selection: EditorSelection.cursor(pos) })
  })
  view.focus()
}

/** Maps the browser selection inside a cell back to the source. */
function captureCellSelection(view: EditorView, cell: HTMLElement, selection: Selection): void {
  const anchorNode = selection.anchorNode
  const focusNode = selection.focusNode
  if (!anchorNode || !focusNode) return
  const base = Number(cell.dataset.cellFrom)
  const end = Number(cell.dataset.cellTo)
  if (!Number.isFinite(base) || !Number.isFinite(end)) return
  const source = view.state.sliceDoc(base, end)
  const anchorOffset = textOffsetIn(cell, anchorNode, selection.anchorOffset)
  const focusOffset = textOffsetIn(cell, focusNode, selection.focusOffset)
  const range = sourceRangeOfTextRange(
    source,
    base,
    Math.min(anchorOffset, focusOffset),
    Math.max(anchorOffset, focusOffset)
  )
  if (!range) {
    setCellSelection(null)
    return
  }
  setCellSelection({
    from: range.from,
    to: range.to,
    text: view.state.sliceDoc(range.from, range.to)
  })
}

async function openRelativeMd(href: string, docDir: string): Promise<void> {
  if (!docDir) return
  const abs = await window.api.resolvePath(docDir, href)
  if (abs) requestOpenDoc(abs)
}

/**
 * Language dropdown for fenced code blocks (E-06). Changing the selection
 * rewrites the language token in the source.
 */
function addLanguageSelect(div: HTMLElement, view: EditorView, block: Block): void {
  const bar = div.querySelector('.md-code-bar')
  const label = div.querySelector('.md-code-lang')
  if (!bar || !label) return

  const current = fenceLanguage(block)
  const select = document.createElement('select')
  select.className = 'md-code-lang-select'
  for (const lang of CODE_LANGUAGES) {
    const option = document.createElement('option')
    option.value = lang.id
    option.textContent = lang.label
    if (lang.id === current) option.selected = true
    select.appendChild(option)
  }
  // Keep an unknown language visible instead of silently switching.
  if (current && !CODE_LANGUAGES.some((l) => l.id === current)) {
    const option = document.createElement('option')
    option.value = current
    option.textContent = current
    option.selected = true
    select.insertBefore(option, select.firstChild)
  }

  select.addEventListener('mousedown', (e) => e.stopPropagation())
  select.addEventListener('change', () => {
    const range = fenceLangRange(block)
    if (!range) return
    const next = select.value
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: next },
      userEvent: 'input.code.language'
    })
  })

  bar.replaceChild(select, label)
}

/* ------------------------------ decorations -------------------------------- */

/** A block is "active" (shows source) when the selection touches it. */
function blockIsActive(block: Block, state: EditorState): boolean {
  for (const range of state.selection.ranges) {
    if (range.from <= block.to && range.to >= block.from) return true
  }
  return false
}

/** Last computed atomic range set (mirrors the decoration set). */
let lastAtomic: DecorationSet = Decoration.none

/** Cached segmentation, keyed by document identity. */
let cachedDoc: EditorState['doc'] | null = null
let cachedBlocks: Block[] = []

function blocksFor(state: EditorState): Block[] {
  if (cachedDoc === state.doc) return cachedBlocks
  cachedDoc = state.doc
  cachedBlocks = segmentDoc(state.doc)
  return cachedBlocks
}

/**
 * Decorations for the source form of the active block: the lines get the
 * metrics of the rendered block (font size, margins, indentation) and the
 * block marker is replaced, so that switching between the rendered and the
 * source form does not move the text.
 */
function addSourceDecorations(
  doc: EditorState['doc'],
  block: Block,
  deco: Range<Decoration>[],
  atomic: Range<Decoration>[]
): void {
  const kind = markerOf(block)
  for (let ln = block.lineFrom; ln <= block.lineTo; ln++) {
    const line = doc.line(ln)
    const classes = sourceLineClasses(block, ln)
    if (classes.length) {
      deco.push(Decoration.line({ class: classes.join(' ') }).range(line.from))
    }
    if (ln !== block.lineFrom || !kind) continue
    const info = markerRange(line.text, line.from, kind)
    if (!info) continue
    const rep =
      kind === 'list'
        ? Decoration.replace({ widget: new BlockMarkerWidget(info.label, info.level) })
        : Decoration.replace({})
    deco.push(rep.range(info.from, info.to))
    // The marker is not text: the caret skips it.
    atomic.push(rep.range(info.from, info.to))
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc
  const blocks = blocksFor(state)
  const rev = state.field(liveRevField, false) ?? 0
  const mermaidRev = mermaidRenderRev()
  const docId = state.field(docIdField, false) || ''
  const head = state.selection.main.head

  const deco: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []

  const byStartLine = new Map<number, Block>()
  for (const b of blocks) byStartLine.set(b.lineFrom, b)

  let tableOrdinal = 0
  let i = 1
  while (i <= doc.lines) {
    const block = byStartLine.get(i)
    if (block) {
      const isTable = block.type === 'table'
      // Tables always stay rendered so that the resize handles remain
      // usable while the caret is inside the table.
      const active = !isTable && blockIsActive(block, state)
      if (active) {
        // The block shows its source: give the source lines the metrics of
        // the rendered block, so that the text does not jump around.
        addSourceDecorations(doc, block, deco, atomic)
      } else if (block.to > block.from) {
        let key = ''
        let activeCell: { row: number; col: number } | null = null
        if (isTable) {
          const headerText = block.text.split('\n')[0] ?? ''
          key = tableKey(headerText, tableOrdinal++)
          activeCell = activeCellFor(block, head)
        }
        const rep = Decoration.replace({
          widget: new MarkdownBlockWidget(block, rev + mermaidRev, docId, key, activeCell),
          block: true
        })
        deco.push(rep.range(block.from, block.to))
        // Tables are not atomic: the caret must be able to walk into cells.
        if (!isTable) atomic.push(rep.range(block.from, block.to))
      }
      i = block.lineTo + 1
      continue
    }
    const line = doc.line(i)
    if (line.text.trim() === '') {
      deco.push(Decoration.line({ class: 'cm-md-gap' }).range(line.from))
    }
    i++
  }

  lastAtomic = Decoration.set(atomic, true)
  return Decoration.set(deco, true)
}

/** Blocks of a state (cached by document identity). */
export function currentBlocks(state: EditorState): Block[] {
  return blocksFor(state)
}

/**
 * Identity of a table inside a document (header text + ordinal), matching
 * the key used by the live-render widget and the width store.
 */
export function tableKeyFor(state: EditorState, block: Block): string {
  const blocks = blocksFor(state)
  let ordinal = 0
  for (const b of blocks) {
    if (b.type !== 'table') continue
    if (b.from === block.from) break
    ordinal++
  }
  const headerText = block.text.split('\n')[0] ?? ''
  return tableKey(headerText, ordinal)
}

/**
 * The live-render extension. `EditorView.decorations.compute` produces a
 * *direct* decoration set, which (unlike plugin decorations) may contain
 * block widgets.
 */
export const liveRender = (): Extension => [
  liveRevField,
  EditorView.decorations.compute([docDirField, liveRevField, 'selection', 'doc'], buildDecorations),
  EditorView.atomicRanges.of(() => lastAtomic)
]
