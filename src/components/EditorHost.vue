<script setup lang="ts">
/**
 * EditorHost: the single CodeMirror view. Tab switches swap EditorStates
 * (undo history + selection preserved, scroll restored), the mode
 * compartment reconfigures live/source/preview in place.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView } from '@codemirror/view'
import type { Command, ViewUpdate } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import type { ImageInsertRequest } from '../../shared/types'
import { displayAccelerator, resolveKeymap, type KeyActionId } from '../../shared/keymap'
import { userThemeCss as buildUserThemeCss } from '../../shared/userTheme'
import { useDocumentsStore } from '../stores/documents'
import { useSettingsStore, plainSettings } from '../stores/settings'
import { editorBus } from '../editor/bus'
import {
  insertImageAtCursor,
  insertPastedText,
  setImageInsertFn,
  setDownloadImageFn
} from '../editor/extensions/images'
import {
  applyMode,
  ensureState,
  getScroll,
  peekStateText,
  replaceDocText,
  setDocDirFor,
  setScroll,
  updateState
} from '../editor/statePool'
import { spellcheckCompartment } from '../editor/config'
import {
  captureRenderedSelection,
  currentBlocks,
  dispatchLiveRefresh,
  sourcePositionAt,
  tableKeyFor
} from '../editor/extensions/liveRender'
import { activeCellFor } from '../editor/tableWidget'
import { onLayoutChanged, setDocumentLayout } from '../editor/tableLayout'
import { applyTableOp, type TableContext, type TableOp } from '../editor/tableOps'
import { parseTable, type Align } from '../editor/tables'
import { setMermaidTheme } from '../editor/markdown/mermaid'
import { computeStats } from '../editor/wordcount'
import { parseOutline } from '../editor/outline'
import {
  findMarkdownLinkAt,
  findMarkdownLinkByHref,
  insertBlock,
  removeLink,
  replaceLinkUrl,
  stripInlineFormat,
  type InsertBlockKind,
  type MarkdownLinkRange
} from '../editor/contextActions'
import {
  insertLinkCommand,
  insertTableCommand,
  setHeadingCommand,
  toggleWrapCommand
} from '../editor/extensions/keymaps'
import { docIdField } from '../editor/docFields'
import { requestOpenDoc, toast } from '../lib/bus'
import { openContextMenu, type ContextMenuItem } from '../lib/contextMenu'
import { IS_MAC } from '../lib/shortcuts'
import { t, tf } from '../lib/i18n'
import PreviewPane from './PreviewPane.vue'
import TableToolbar from './TableToolbar.vue'

const props = defineProps<{
  /**
   * Bind the editor to a specific document. When omitted the editor follows
   * the globally active document (single pane). Split view uses one pane per
   * document.
   */
  docId?: string | null
}>()

const documents = useDocumentsStore()
const settings = useSettingsStore()

const rootEl = ref<HTMLElement | null>(null)
const hostEl = ref<HTMLElement | null>(null)
const mode = ref<'live' | 'source' | 'preview'>(settings.settings.mode)

let view: EditorView | null = null
let currentId = ''

/** The document this editor shows (bound doc or the active one). */
const boundId = computed<string | null>(() => props.docId ?? documents.activeId)

function dirOf(path: string | null): string {
  if (!path) return ''
  const posix = path.replace(/\\/g, '/')
  const idx = posix.lastIndexOf('/')
  return idx > 0 ? posix.slice(0, idx) : ''
}

/* ------------------------------- lifecycle -------------------------------- */

onMounted(() => {
  if (!hostEl.value) return
  // A split pane shows its bound document; the main pane follows the active one.
  const tabId = boundId.value
  const tab = documents.tabs.find((x) => x.id === tabId) ?? documents.active
  if (tab) {
    const st = ensureState(tab.id, tab.initialContent, mode.value, dirOf(tab.path))
    view = new EditorView({ state: st, parent: hostEl.value })
    currentId = tab.id
    view.scrollDOM.scrollTop = getScroll(tab.id)
    refreshDocMeta(tab.id)
  } else {
    view = new EditorView({ parent: hostEl.value })
  }

  editorBus.onDocChanged.add(handleDocChanged)
  editorBus.onCursorMoved.add(handleCursorMoved)
  editorBus.onFocusChanged.add(handleFocusChanged)
  setImageInsertFn(handleInsertImage)
  setDownloadImageFn(handleDownloadImage)

  // In split view each pane owns one document. The main pane (not bound to a
  // specific document) follows the active document; a bound pane keeps its
  // own document and never steals the active one.
  const onFocus = (): void => {
    if (props.docId) return
    const id = boundId.value
    if (id && documents.activeId !== id) documents.activate(id)
  }
  view.contentDOM.addEventListener('focus', onFocus)
  // Clicking inside a pane activates it as well (independent of the window
  // focus state).
  const onMouseDown = (): void => {
    if (props.docId) return
    const id = boundId.value
    if (id && documents.activeId !== id) documents.activate(id)
  }
  view.dom.addEventListener('mousedown', onMouseDown)
  rootEl.value?.addEventListener('contextmenu', onContextMenu)

  // Dev-only debug handle (never enabled in packaged builds).
  if (import.meta.env.DEV) {
    const dbg = window as unknown as {
      __mdeView?: EditorView
      __mdeViews?: EditorView[]
      __mdeTableDebug?: () => unknown
    }
    dbg.__mdeView = view
    dbg.__mdeViews = [...(dbg.__mdeViews ?? []), view]
    dbg.__mdeTableDebug = () => {
      if (!view) return null
      const state = view.state
      const head = state.selection.main.head
      const blocks = currentBlocks(state)
      const block = blocks.find((b) => b.type === 'table' && head >= b.from && head <= b.to)
      const parsed = block ? parseTable(block) : null
      return {
        head,
        block: block ? { from: block.from, to: block.to, text: block.text } : null,
        parsed: parsed
          ? {
              columns: parsed.columns,
              header: parsed.header.map((c) => c.text),
              align: parsed.align,
              rows: parsed.rows.map((r) => r.map((c) => c.text))
            }
          : null,
        allBlocks: blocks.map((b) => ({ type: b.type, from: b.from, to: b.to }))
      }
    }
  }
})

onBeforeUnmount(() => {
  rootEl.value?.removeEventListener('contextmenu', onContextMenu)
  editorBus.onDocChanged.delete(handleDocChanged)
  editorBus.onCursorMoved.delete(handleCursorMoved)
  editorBus.onFocusChanged.delete(handleFocusChanged)
  stopLayoutListener?.()
  stopLayoutListener = null
  if (view && currentId) setScroll(currentId, view.scrollDOM.scrollTop)
  view?.destroy()
  view = null
})
/* ------------------------------- tab switch -------------------------------- */

/** Restores the persisted column widths of a document. */
async function loadTableLayout(docId: string, path: string | null): Promise<void> {
  if (!path) return
  try {
    const layout = await window.api.getTableLayout(path)
    if (Object.keys(layout).length) setDocumentLayout(docId, layout)
  } catch {
    /* the layout is optional */
  }
}

watch(
  () => boundId.value,
  (id) => {
    if (!view || !id || id === currentId) return
    if (currentId) setScroll(currentId, view.scrollDOM.scrollTop)
    const tab = documents.tabs.find((x) => x.id === id)
    if (!tab) return
    const st = ensureState(tab.id, tab.initialContent, mode.value, dirOf(tab.path))
    view.setState(st)
    currentId = id
    applyMode(mode.value, view) // states may carry an older mode compartment
    requestAnimationFrame(() => {
      if (view) view.scrollDOM.scrollTop = getScroll(id)
    })
    refreshDocMeta(id)
    void loadTableLayout(id, tab.path)
    view.focus()
  }
)

/* --------------------------- table column widths --------------------------- */

// The column widths are display state; they are stored per document so that
// the layout survives a restart.
let stopLayoutListener: (() => void) | null = null

onMounted(() => {
  stopLayoutListener = onLayoutChanged((docId, layout) => {
    const tab = documents.tabs.find((x) => x.id === docId)
    if (!tab?.path) return
    void window.api.setTableLayout(tab.path, layout)
  })
  const tab = documents.tabs.find((x) => x.id === currentId)
  if (tab) void loadTableLayout(tab.id, tab.path)
})

/* ------------------------------- mode/theme -------------------------------- */

watch(
  () => settings.settings.mode,
  (m) => {
    mode.value = m
    if (view) applyMode(m, view)
  }
)

watch(
  () => settings.effectiveTheme,
  (theme) => {
    void setMermaidTheme(theme)
    if (view && mode.value === 'live') dispatchLiveRefresh(view)
  },
  { immediate: true }
)

/** Spell checking can be switched at runtime (E-15). */
watch(
  () => settings.settings.editor.spellcheck,
  (enabled) => {
    if (!view) return
    view.dispatch({
      effects: spellcheckCompartment.reconfigure(
        enabled ? EditorView.contentAttributes.of({ spellcheck: 'true' }) : []
      )
    })
  }
)

/* -------------------------------- bus sinks -------------------------------- */

let dirtyTimer: ReturnType<typeof setTimeout> | null = null
let statsTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Refresh the derived document data (statistics, outline, preview text).
 * Must run whenever the active document changes - not only when the text
 * changes, otherwise a freshly opened document would have no outline and
 * the preview pane would still show the previous document.
 */
function refreshDocMeta(docId: string, text?: string): void {
  // A split pane keeps its own document; the outline/statistics/preview
  // follow the main pane.
  if (props.docId) return
  const content = text ?? peekStateText(docId) ?? ''
  documents.setStats(computeStats(content))
  documents.setOutline(parseOutline(content))
  documents.setPreviewText(content)
}

function handleDocChanged(docId: string, u: ViewUpdate): void {
  // Only the editor that owns this view reacts to it.
  if (u.view && view && u.view !== view) return
  // Keep the state pool in sync so saving/statistics see the current text.
  if (view) updateState(docId, view.state)

  if (dirtyTimer) clearTimeout(dirtyTimer)
  dirtyTimer = setTimeout(() => {
    dirtyTimer = null
    const tab = documents.tabs.find((x) => x.id === docId)
    if (!tab) return
    const text = peekStateText(docId)
    documents.markDirty(docId, text !== null && text !== tab.lastSavedText)
  }, 250)

  if (statsTimer) clearTimeout(statsTimer)
  statsTimer = setTimeout(() => {
    statsTimer = null
    if (documents.activeId !== docId) return
    refreshDocMeta(docId, u.state.doc.toString())
  }, 300)

  // Crash recovery snapshot for documents that have a path on disk.
  const tab = documents.tabs.find((x) => x.id === docId)
  if (tab?.path) {
    scheduleSnapshot(tab.path, u.state.doc.toString())
  }
}

function handleFocusChanged(docId: string, u: ViewUpdate): void {
  // The focused pane owns the active document (split view). A pane bound to
  // a specific document keeps it and does not steal the active document.
  if (u.view && view && u.view !== view) return
  if (!u.view?.hasFocus) return
  if (props.docId) return
  const bound = boundId.value
  if (bound && documents.activeId !== bound) documents.activate(bound)
  void docId
}

function handleCursorMoved(docId: string, u: ViewUpdate): void {
  if (u.view && view && u.view !== view) return
  if (view) updateState(docId, view.state)
  if (documents.activeId !== docId) return
  const head = u.state.selection.main.head
  const line = u.state.doc.lineAt(head)
  documents.setCursor(line.number, head - line.from + 1, head)
  updateTableContext(u.state)

  // Typewriter mode: keep the caret vertically centred (U-01).
  if (settings.settings.workspace.typewriterMode && view) {
    view.dispatch({
      effects: EditorView.scrollIntoView(head, { y: 'center' })
    })
  }
}

/* ------------------------------ table toolbar ------------------------------ */

const TOOLBAR_HEIGHT = 34

interface TableContextState {
  block: import('../editor/segmenter').Block
  cell: { row: number; col: number }
  key: string
  columns: number
  rows: number
  align: Align
  top: number
  left: number
}

const tableState = ref<TableContextState | null>(null)

function updateTableContext(state: EditorState): void {
  if (!view) {
    tableState.value = null
    return
  }
  const head = state.selection.main.head
  const blocks = currentBlocks(state)
  const block = blocks.find((b) => b.type === 'table' && head >= b.from && head <= b.to)
  if (!block) {
    tableState.value = null
    return
  }
  const parsed = parseTable(block)
  if (!parsed) {
    tableState.value = null
    return
  }
  const cell = activeCellFor(block, head) ?? { row: 0, col: 0 }
  const scroller = view.scrollDOM
  const rect = scroller.getBoundingClientRect()
  const coords = view.coordsAtPos(block.from)
  const top = coords ? coords.top - rect.top + scroller.scrollTop - TOOLBAR_HEIGHT : 0
  const left = coords ? coords.left - rect.left + scroller.scrollLeft : 0
  tableState.value = {
    block,
    cell,
    key: tableKeyFor(state, block),
    columns: parsed.columns,
    rows: parsed.rows.length,
    align: parsed.align[cell.col] ?? null,
    top,
    left
  }
}

function onTableOp(op: TableOp): void {
  if (!view) return
  // Re-derive the table from the *current* document state: the previous
  // operation may have changed the table, making a cached block stale.
  const state = view.state
  const head = state.selection.main.head
  const blocks = currentBlocks(state)
  const block = blocks.find((b) => b.type === 'table' && head >= b.from && head <= b.to)
  if (!block) return
  const parsed = parseTable(block)
  if (!parsed) return
  const cell = activeCellFor(block, head) ?? { row: 0, col: 0 }
  const applied = applyTableOp(
    view,
    {
      block,
      table: parsed,
      cell,
      key: tableKeyFor(state, block),
      docId: documents.activeId ?? ''
    },
    op
  )
  if (applied) {
    // Refresh the toolbar state (row/column counts may have changed).
    requestAnimationFrame(() => {
      if (view) updateTableContext(view.state)
    })
  }
}

/* ------------------------------ context menu ------------------------------- */

interface LinkMenuContext {
  href: string
  /** Link source range relative to `base` (null when it cannot be located). */
  range: MarkdownLinkRange | null
  base: number
}

interface ImageMenuContext {
  src: string
  absPath: string | null
  remote: boolean
}

interface EditorMenuContext {
  table: TableContext | null
  link: LinkMenuContext | null
  image: ImageMenuContext | null
  code: string | null
}

function modShortcut(key: string): string {
  return IS_MAC ? `⌘${key}` : `Ctrl+${key}`
}

function keyHint(id: KeyActionId): string | undefined {
  const accel = resolveKeymap(settings.settings.keymap)[id]
  return accel ? displayAccelerator(accel, IS_MAC) || undefined : undefined
}

function onContextMenu(event: MouseEvent): void {
  if (!view) return
  const target = event.target as HTMLElement | null
  if (!target) return
  if (target.closest('.table-toolbar')) return
  event.preventDefault()
  event.stopPropagation()
  if (mode.value === 'preview') {
    openPreviewMenu(event, target)
    return
  }
  const table = tableContextAt(target)
  const link = linkContextAt(target, event)
  const image = imageContextAt(target)
  const code = codeContextAt(target)

  // A rendered block is source-less until the user clicks it. Map a rendered
  // selection (or place a caret at the right-click) so paragraph/format
  // commands operate on the block under the pointer.
  if (!table && !link && !image && !code) {
    const widget = target.closest('.cm-mdw') as HTMLElement | null
    if (widget) {
      const mapped = captureRenderedSelection(view, event)
      if (!mapped) {
        const pos = sourcePositionAt(view, event)
        if (pos !== null) view.dispatch({ selection: { anchor: pos } })
      }
    }
  }

  const items = buildEditorMenu({ table, link, image, code })
  openContextMenu(event, items, () => view?.focus())
}

function tableContextAt(target: HTMLElement): TableContext | null {
  if (!view) return null
  const cellEl = target.closest('[data-cell-row]') as HTMLElement | null
  if (!cellEl) return null
  const row = Number(cellEl.dataset.cellRow)
  const col = Number(cellEl.dataset.cellCol)
  const cellFrom = Number(cellEl.dataset.cellFrom)
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null
  const block = currentBlocks(view.state).find(
    (b) => b.type === 'table' && Number.isFinite(cellFrom) && cellFrom >= b.from && cellFrom <= b.to
  )
  if (!block) return null
  const table = parseTable(block)
  if (!table) return null
  const docId = view.state.field(docIdField, false) || documents.activeId || ''
  return {
    block,
    table,
    cell: { row, col },
    key: tableKeyFor(view.state, block),
    docId
  }
}

function linkContextAt(target: HTMLElement, event: MouseEvent): LinkMenuContext | null {
  if (!view) return null
  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (!anchor) return null
  const href = anchor.getAttribute('href') || ''
  if (!href) return null
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos !== null) {
    const block = currentBlocks(view.state).find((b) => pos >= b.from && pos <= b.to)
    if (block) {
      const range =
        findMarkdownLinkByHref(block.text, href) ??
        findMarkdownLinkAt(block.text, Math.max(0, pos - block.from))
      if (range) return { href, range, base: block.from }
    }
    const line = view.state.doc.lineAt(pos)
    const range =
      findMarkdownLinkByHref(line.text, href) ??
      findMarkdownLinkAt(line.text, Math.max(0, pos - line.from))
    if (range) return { href, range, base: line.from }
  }
  return { href, range: null, base: 0 }
}

function imageContextAt(target: HTMLElement): ImageMenuContext | null {
  const img = target.closest('img') as HTMLImageElement | null
  if (!img) return null
  const src = img.getAttribute('src') || ''
  if (!src) return null
  let absPath: string | null = null
  if (src.startsWith('mdimg://local/')) {
    try {
      absPath = decodeURIComponent(src.slice('mdimg://local/'.length))
    } catch {
      absPath = null
    }
  }
  return { src, absPath, remote: /^https?:/i.test(src) }
}

function codeContextAt(target: HTMLElement): string | null {
  const code = target.closest('.md-code-wrap')?.querySelector('pre code')
  return code?.textContent ?? null
}

/* ---------------------------------- menu ----------------------------------- */

function buildEditorMenu(ctx: EditorMenuContext): ContextMenuItem[] {
  if (!view) return []
  const state = view.state
  const selected = selectionText()
  const sourceSelection = !state.selection.main.empty
  const items: ContextMenuItem[] = []

  if (ctx.link) items.push(...linkItems(ctx.link, true), { separator: true })
  if (ctx.image) items.push(...imageItems(ctx.image), { separator: true })
  if (ctx.code) {
    items.push(
      { id: 'copy-code', label: t('ctx.copyCode'), action: () => copyText(ctx.code ?? '') },
      { separator: true }
    )
  }

  items.push(
    {
      id: 'undo',
      label: t('menu.undo'),
      shortcut: modShortcut('Z'),
      disabled: undoDepth(state) === 0,
      action: () => runCommand(undo)
    },
    {
      id: 'redo',
      label: t('menu.redo'),
      shortcut: IS_MAC ? '⇧⌘Z' : 'Ctrl+Y',
      disabled: redoDepth(state) === 0,
      action: () => runCommand(redo)
    },
    { separator: true },
    {
      id: 'cut',
      label: t('menu.cut'),
      shortcut: modShortcut('X'),
      disabled: !sourceSelection,
      action: () => cutSelection()
    },
    {
      id: 'copy',
      label: t('menu.copy'),
      shortcut: modShortcut('C'),
      disabled: !selected,
      action: () => copyText(selected)
    },
    {
      id: 'paste',
      label: t('menu.paste'),
      shortcut: modShortcut('V'),
      action: () => pasteClipboard()
    },
    {
      id: 'paste-plain',
      label: t('ctx.pastePlain'),
      action: () => pastePlainText()
    },
    { separator: true },
    { id: 'insert', label: t('ctx.insert'), submenu: insertItems() },
    { id: 'paragraph', label: t('ctx.paragraph'), submenu: paragraphItems() },
    { id: 'format', label: t('ctx.format'), submenu: formatItems(sourceSelection) }
  )

  if (ctx.table) {
    items.push({ id: 'table', label: t('ctx.table'), submenu: tableItems(ctx.table) })
  }

  items.push(
    { separator: true },
    { id: 'copy-markdown', label: t('ctx.copyMarkdown'), action: () => copyMarkdown() },
    { id: 'copy-html', label: t('ctx.copyHtml'), action: () => copyAsHtml() },
    { separator: true },
    {
      id: 'select-all',
      label: t('menu.selectAll'),
      shortcut: modShortcut('A'),
      action: () => runCommand(selectAll)
    },
    {
      id: 'find',
      label: t('menu.find'),
      shortcut: keyHint('edit:find'),
      action: () => {
        if (!view) return
        view.focus()
        openSearchPanel(view)
      }
    }
  )
  return items
}

function insertItems(): ContextMenuItem[] {
  return [
    {
      id: 'insert-image',
      label: t('ctx.insertImage'),
      action: () => insertImageFromPicker()
    },
    {
      id: 'insert-table',
      label: t('shortcuts.markdown:table'),
      shortcut: keyHint('markdown:table'),
      action: () => runCommand(insertTableCommand)
    },
    { separator: true },
    { id: 'insert-code', label: t('ctx.codeBlock'), action: () => runInsertBlock('code') },
    { id: 'insert-math', label: t('ctx.mathBlock'), action: () => runInsertBlock('math') },
    { id: 'insert-quote', label: t('ctx.quote'), action: () => runInsertBlock('quote') },
    { separator: true },
    { id: 'insert-bullet', label: t('ctx.bulletList'), action: () => runInsertBlock('bullet') },
    { id: 'insert-ordered', label: t('ctx.orderedList'), action: () => runInsertBlock('ordered') },
    { id: 'insert-task', label: t('ctx.taskList'), action: () => runInsertBlock('task') },
    { separator: true },
    { id: 'insert-hr', label: t('ctx.horizontalRule'), action: () => runInsertBlock('hr') }
  ]
}

function paragraphItems(): ContextMenuItem[] {
  const current = headingLevelAtCursor()
  const items: ContextMenuItem[] = [
    {
      id: 'paragraph',
      label: t('ctx.paragraphText'),
      checked: current === 0,
      action: () => runHeading(0)
    },
    { separator: true }
  ]
  for (let level = 1; level <= 6; level++) {
    const id = `markdown:heading-${level}` as KeyActionId
    items.push({
      id: `heading-${level}`,
      label: tf('ctx.heading', { level }),
      shortcut: keyHint(id),
      checked: current === level,
      action: () => runHeading(level)
    })
  }
  return items
}

function formatItems(hasSelection: boolean): ContextMenuItem[] {
  return [
    {
      id: 'bold',
      label: t('shortcuts.markdown:bold'),
      shortcut: keyHint('markdown:bold'),
      action: () => runCommand(toggleWrapCommand('**'))
    },
    {
      id: 'italic',
      label: t('shortcuts.markdown:italic'),
      shortcut: keyHint('markdown:italic'),
      action: () => runCommand(toggleWrapCommand('*'))
    },
    {
      id: 'strike',
      label: t('shortcuts.markdown:strike'),
      shortcut: keyHint('markdown:strike'),
      action: () => runCommand(toggleWrapCommand('~~'))
    },
    {
      id: 'highlight',
      label: t('shortcuts.markdown:highlight'),
      shortcut: keyHint('markdown:highlight'),
      action: () => runCommand(toggleWrapCommand('=='))
    },
    {
      id: 'code',
      label: t('shortcuts.markdown:code'),
      shortcut: keyHint('markdown:code'),
      action: () => runCommand(toggleWrapCommand('`'))
    },
    {
      id: 'math',
      label: t('shortcuts.markdown:math'),
      shortcut: keyHint('markdown:math'),
      action: () => runCommand(toggleWrapCommand('$'))
    },
    {
      id: 'link',
      label: t('shortcuts.markdown:link'),
      shortcut: keyHint('markdown:link'),
      action: () => runCommand(insertLinkCommand)
    },
    { separator: true },
    {
      id: 'clear-format',
      label: t('ctx.clearFormat'),
      disabled: !hasSelection,
      action: () => clearFormat()
    }
  ]
}

function tableItems(ctx: TableContext): ContextMenuItem[] {
  const align = ctx.table.align[ctx.cell.col] ?? null
  return [
    {
      id: 'row-above',
      label: t('ctx.tableRowAbove'),
      action: () => runTableOp(ctx, { kind: 'row-add', where: 'above' })
    },
    {
      id: 'row-below',
      label: t('ctx.tableRowBelow'),
      action: () => runTableOp(ctx, { kind: 'row-add', where: 'below' })
    },
    {
      id: 'row-delete',
      label: t('ctx.tableRowDelete'),
      disabled: ctx.cell.row === 0 || ctx.table.rows.length === 0,
      action: () => runTableOp(ctx, { kind: 'row-remove' })
    },
    { separator: true },
    {
      id: 'col-left',
      label: t('ctx.tableColLeft'),
      action: () => runTableOp(ctx, { kind: 'col-add', where: 'left' })
    },
    {
      id: 'col-right',
      label: t('ctx.tableColRight'),
      action: () => runTableOp(ctx, { kind: 'col-add', where: 'right' })
    },
    {
      id: 'col-delete',
      label: t('ctx.tableColDelete'),
      disabled: ctx.table.columns <= 1,
      action: () => runTableOp(ctx, { kind: 'col-remove' })
    },
    { separator: true },
    {
      id: 'align-left',
      label: t('ctx.tableAlignLeft'),
      checked: align === 'left',
      action: () => runTableOp(ctx, { kind: 'align', align: 'left' })
    },
    {
      id: 'align-center',
      label: t('ctx.tableAlignCenter'),
      checked: align === 'center',
      action: () => runTableOp(ctx, { kind: 'align', align: 'center' })
    },
    {
      id: 'align-right',
      label: t('ctx.tableAlignRight'),
      checked: align === 'right',
      action: () => runTableOp(ctx, { kind: 'align', align: 'right' })
    },
    { separator: true },
    {
      id: 'reset-width',
      label: t('ctx.tableResetWidth'),
      action: () => runTableOp(ctx, { kind: 'reset-widths' })
    },
    {
      id: 'table-delete',
      label: t('ctx.tableDelete'),
      danger: true,
      action: () => runTableOp(ctx, { kind: 'table-remove' })
    }
  ]
}

function linkItems(ctx: LinkMenuContext, includeSourceActions: boolean): ContextMenuItem[] {
  const items: ContextMenuItem[] = []
  if (isOpenableLink(ctx.href)) {
    items.push({ id: 'open-link', label: t('ctx.openLink'), action: () => openLink(ctx.href) })
  }
  items.push({ id: 'copy-link', label: t('ctx.copyLink'), action: () => copyText(ctx.href) })
  if (includeSourceActions && ctx.range) {
    items.push(
      { separator: true },
      { id: 'edit-link', label: t('ctx.editLink'), action: () => editLink(ctx) },
      { id: 'remove-link', label: t('ctx.removeLink'), action: () => removeLinkAt(ctx) }
    )
  }
  return items
}

function imageItems(ctx: ImageMenuContext): ContextMenuItem[] {
  const source = ctx.absPath ?? ctx.src
  const items: ContextMenuItem[] = [
    {
      id: 'copy-image-file',
      label: t('ctx.copyImageFile'),
      action: () => copyImageToClipboard(source)
    },
    {
      id: 'save-image',
      label: t('ctx.saveImage'),
      action: () => saveImageAs(source)
    },
    { separator: true },
    {
      id: 'copy-image',
      label: t('ctx.copyImage'),
      action: () => copyText(source)
    }
  ]
  if (ctx.absPath) {
    items.push({
      id: 'reveal-image',
      label: t('ctx.revealImage'),
      action: () => window.api.showItemInFolder(ctx.absPath as string)
    })
  }
  if (ctx.remote) {
    items.push({
      id: 'open-image',
      label: t('ctx.openImage'),
      action: () => window.api.openExternal(ctx.src)
    })
  }
  return items
}

async function copyImageToClipboard(source: string): Promise<void> {
  const ok = await window.api.copyImage(source)
  toast(ok ? t('ui.imageCopied') : t('ui.imageCopyFailed'))
}

async function saveImageAs(source: string): Promise<void> {
  const result = await window.api.saveImageAs(source)
  if (result.path) toast(tf('ui.imageSaved', { path: result.path }))
  else if (result.error) toast(t('ui.imageSaveFailed'))
}

/* --------------------------------- actions --------------------------------- */

function runCommand(command: Command): void {
  if (!view) return
  view.focus()
  command(view)
}

function runInsertBlock(kind: InsertBlockKind): void {
  if (!view) return
  view.focus()
  insertBlock(view, kind)
}

function runHeading(level: number): void {
  runCommand(setHeadingCommand(level))
}

function headingLevelAtCursor(): number {
  if (!view) return 0
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const m = /^( {0,3})(#{1,6})([ \t]|$)/.exec(line.text)
  return m ? m[2].length : 0
}

function domSelectionText(): string {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return ''
  const node = sel.anchorNode
  if (!node || !rootEl.value?.contains(node)) return ''
  return sel.toString()
}

function selectionText(): string {
  if (!view) return ''
  const { from, to } = view.state.selection.main
  if (from !== to) return view.state.sliceDoc(from, to)
  return domSelectionText()
}

async function copyText(text: string): Promise<void> {
  if (!text) return
  await window.api.clipboardWriteText(text)
  toast(t('ui.copied'))
}

async function cutSelection(): Promise<void> {
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return
  const text = view.state.sliceDoc(from, to)
  await window.api.clipboardWriteText(text)
  view.focus()
  view.dispatch({
    changes: { from, to, insert: '' },
    selection: { anchor: from },
    userEvent: 'delete.cut'
  })
}

function insertPlainText(text: string): void {
  if (!view) return
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: 'input.paste'
  })
}

async function pasteClipboard(): Promise<void> {
  if (!view) return
  view.focus()
  // Electron: let Chromium paste into the focused editor so images, HTML and
  // the editor's own TSV/URL handling all work like Ctrl+V.
  if (await window.api.editPaste()) return
  // Browser preview fallback (no webContents.paste).
  const text = (await window.api.clipboardReadText()).replace(/\r\n?/g, '\n')
  if (!text) return
  if (insertPastedText(view, text)) return
  insertPlainText(text)
}

async function pastePlainText(): Promise<void> {
  if (!view) return
  const text = (await window.api.clipboardReadText()).replace(/\r\n?/g, '\n')
  if (!text) return
  view.focus()
  insertPlainText(text)
}

async function copyMarkdown(): Promise<void> {
  if (!view) return
  await copyText(selectionText() || view.state.doc.toString())
}

async function copyAsHtml(): Promise<void> {
  if (!view) return
  const markdown = selectionText() || view.state.doc.toString()
  const tabId = props.docId ?? documents.activeId
  const tab = documents.tabs.find((x) => x.id === tabId) ?? documents.active
  const { buildExportHtml, renderExportHtml } = await import('../editor/export/html')
  const env = {
    docDir: dirOf(tab?.path ?? null),
    theme: settings.effectiveTheme,
    title: tab?.name ?? 'Markdown',
    customCss: settings.activeUserTheme ? buildUserThemeCss(settings.activeUserTheme) : ''
  }
  const body = await renderExportHtml(markdown, env)
  await window.api.clipboardWriteHtml(buildExportHtml(body, env), markdown)
  toast(t('ui.copiedRich'))
}

function clearFormat(): void {
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return
  const current = view.state.sliceDoc(from, to)
  const next = stripInlineFormat(current)
  if (next === current) return
  view.dispatch({
    changes: { from, to, insert: next },
    selection: { anchor: from, head: from + next.length },
    userEvent: 'input.format.clear'
  })
  view.focus()
}

async function insertImageFromPicker(): Promise<void> {
  if (!view) return
  const absPath = await window.api.pickImage()
  if (!absPath) return
  await insertImageAtCursor(view, { kind: 'file', absPath })
}

function runTableOp(ctx: TableContext, op: TableOp): void {
  if (!view) return
  const applied = applyTableOp(view, ctx, op)
  if (applied) {
    requestAnimationFrame(() => {
      if (view) updateTableContext(view.state)
    })
  }
  view.focus()
}

function isOpenableLink(href: string): boolean {
  return (
    /^https?:/i.test(href) || href.startsWith('#') || /\.(md|markdown|mkd)(?:#.*)?$/i.test(href)
  )
}

async function openLink(href: string): Promise<void> {
  if (/^https?:/i.test(href)) {
    await window.api.openExternal(href)
    return
  }
  if (href.startsWith('#')) {
    jumpToAnchor(href.slice(1))
    return
  }
  if (/\.(md|markdown|mkd)(?:#.*)?$/i.test(href)) {
    const tab = documents.active
    const dir = dirOf(tab?.path ?? null)
    const abs = await window.api.resolvePath(dir, href.split('#')[0])
    if (abs) requestOpenDoc(abs)
  }
}

function jumpToAnchor(id: string): void {
  if (!view || !id) return
  let decoded = id
  try {
    decoded = decodeURIComponent(id)
  } catch {
    /* keep the raw value */
  }
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
  const wanted = norm(decoded)
  const target = parseOutline(view.state.doc.toString()).find(
    (h) => norm(h.text) === wanted || norm(h.text) === norm(id)
  )
  if (!target) return
  view.dispatch({
    selection: { anchor: target.pos },
    effects: EditorView.scrollIntoView(target.pos, { y: 'center' })
  })
  view.focus()
}

function editLink(ctx: LinkMenuContext): void {
  if (!view || !ctx.range) return
  const next = window.prompt(t('ctx.linkUrl'), ctx.range.url)
  if (next === null) return
  const url = next.trim()
  if (!url) return
  const source = view.state.sliceDoc(ctx.base, ctx.base + ctx.range.to)
  const updated = replaceLinkUrl(source, ctx.range, url)
  view.dispatch({
    changes: { from: ctx.base, to: ctx.base + ctx.range.to, insert: updated },
    userEvent: 'input.link.edit'
  })
  view.focus()
}

function removeLinkAt(ctx: LinkMenuContext): void {
  if (!view || !ctx.range) return
  const source = view.state.sliceDoc(ctx.base, ctx.base + ctx.range.to)
  const updated = removeLink(source, ctx.range)
  view.dispatch({
    changes: { from: ctx.base, to: ctx.base + ctx.range.to, insert: updated },
    userEvent: 'input.link.remove'
  })
  view.focus()
}

/* ------------------------------- preview menu ------------------------------- */

function previewSelectionText(): string {
  return domSelectionText()
}

function selectPreview(): void {
  const el = rootEl.value?.querySelector('.preview-content')
  if (!el) return
  const range = document.createRange()
  range.selectNodeContents(el)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

async function copyPreviewHtml(): Promise<void> {
  const root = rootEl.value?.querySelector('.preview-content')
  let html = root?.innerHTML ?? ''
  let text = root?.textContent ?? ''
  const sel = window.getSelection()
  if (sel && !sel.isCollapsed && sel.rangeCount > 0 && root?.contains(sel.anchorNode)) {
    const holder = document.createElement('div')
    holder.appendChild(sel.getRangeAt(0).cloneContents())
    html = holder.innerHTML
    text = sel.toString()
  }
  if (!html) return
  await window.api.clipboardWriteHtml(html, text)
  toast(t('ui.copiedRich'))
}

function openPreviewMenu(event: MouseEvent, target: HTMLElement): void {
  const link = linkContextAt(target, event)
  const image = imageContextAt(target)
  const code = codeContextAt(target)
  const selected = previewSelectionText()
  const items: ContextMenuItem[] = []

  if (link) {
    items.push(...linkItems({ ...link, range: null }, false), { separator: true })
  }
  if (image) {
    items.push(...imageItems(image), { separator: true })
  }
  if (code) {
    items.push(
      { id: 'copy-code', label: t('ctx.copyCode'), action: () => copyText(code) },
      { separator: true }
    )
  }
  items.push(
    {
      id: 'copy',
      label: t('menu.copy'),
      shortcut: modShortcut('C'),
      disabled: !selected,
      action: () => copyText(selected)
    },
    {
      id: 'select-all',
      label: t('menu.selectAll'),
      shortcut: modShortcut('A'),
      action: () => selectPreview()
    },
    { separator: true },
    {
      id: 'copy-markdown',
      label: t('ctx.copyMarkdown'),
      action: () => copyText(documents.previewText)
    },
    { id: 'copy-html', label: t('ctx.copyHtml'), action: () => copyPreviewHtml() }
  )
  openContextMenu(event, items)
}

/* ------------------------------ snapshots ---------------------------------- */

/** Crash recovery snapshots (F-02). */
let snapshotTimer: ReturnType<typeof setTimeout> | null = null

function scheduleSnapshot(path: string, text: string): void {
  if (snapshotTimer) clearTimeout(snapshotTimer)
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null
    void window.api.writeSnapshot(path, text, 0)
  }, 4000)
}

/* --------------------------------- images ---------------------------------- */

async function handleInsertImage(
  v: EditorView,
  source:
    | { kind: 'buffer'; bytes: ArrayBuffer; mime: string; name: string }
    | { kind: 'file'; absPath: string }
): Promise<void> {
  const tab =
    documents.tabs.find((x) => x.id === (props.docId ?? documents.activeId)) ?? documents.active
  if (!tab) {
    toast(t('ui.imageFailed'))
    return
  }
  const req: ImageInsertRequest = {
    source:
      source.kind === 'buffer'
        ? { kind: 'buffer', bytes: source.bytes, mime: source.mime, name: source.name }
        : { kind: 'file', absPath: source.absPath },
    docPath: tab.path,
    // The store state is a reactive Proxy: send a plain copy over IPC.
    settings: plainSettings(settings.settings)
  }
  const res = await window.api.insertImage(req)
  if (!res) {
    toast(t('ui.imageFailed'))
    return
  }
  const pos = v.state.selection.main.to
  v.dispatch({
    changes: { from: pos, insert: `![](${res.mdPath})` },
    selection: { anchor: pos + 2 },
    userEvent: 'input.insert.image'
  })
  toast(t('ui.imageInserted'))
}

/** Download a remote image and store it locally (E-09). */
async function handleDownloadImage(url: string): Promise<string | null> {
  const tab =
    documents.tabs.find((x) => x.id === (props.docId ?? documents.activeId)) ?? documents.active
  const res = await window.api.downloadImage(
    url,
    tab?.path ?? null,
    plainSettings(settings.settings)
  )
  if (!res) {
    toast(t('ui.imageFailed'))
    return null
  }
  toast(t('ui.imageLocalized'))
  return res.mdPath
}

/* ---------------------------------- expose ---------------------------------- */

defineExpose({
  reloadDoc(id: string, text: string): void {
    replaceDocText(view, id, text)
  },
  updateDocDir(id: string, path: string): void {
    setDocDirFor(view, id, dirOf(path))
  },
  openSearch(): void {
    if (view) openSearchPanel(view)
  },
  /** The current selection (empty when the caret is collapsed). */
  getSelectedText(): string {
    if (!view) return ''
    const { from, to } = view.state.selection.main
    return from === to ? '' : view.state.sliceDoc(from, to)
  },
  /** Replace several ranges in one transaction (image host upload). */
  replaceRanges(changes: { from: number; to: number; insert: string }[]): void {
    if (!view || changes.length === 0) return
    view.dispatch({ changes, userEvent: 'input.image.upload' })
  },
  focus(): void {
    view?.focus()
  },
  /** Jump to an absolute document position (outline). */
  jumpTo(pos: number): void {
    if (!view) return
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
    view.focus()
  },
  /** Jump to a 1-based line/column (search results). */
  jumpToLine(line: number, column = 1): void {
    if (!view) return
    const doc = view.state.doc
    const clamped = Math.max(1, Math.min(line, doc.lines))
    const docLine = doc.line(clamped)
    const pos = Math.min(docLine.to, docLine.from + Math.max(0, column - 1))
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' })
    })
    view.focus()
  }
})
</script>

<template>
  <div ref="rootEl" class="editor-host">
    <div v-show="mode !== 'preview'" ref="hostEl" class="cm-host"></div>
    <TableToolbar
      v-if="tableState && mode === 'live'"
      :cell="tableState.cell"
      :columns="tableState.columns"
      :rows="tableState.rows"
      :align="tableState.align"
      :style="{ top: tableState.top + 'px', left: tableState.left + 'px' }"
      @op="onTableOp"
    />
    <PreviewPane
      v-if="mode === 'preview'"
      :text="documents.previewText"
      :doc-dir="dirOf(documents.active?.path ?? null)"
    />
  </div>
</template>
