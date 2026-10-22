<script setup lang="ts">
/**
 * EditorHost: the single CodeMirror view. Tab switches swap EditorStates
 * (undo history + selection preserved, scroll restored), the mode
 * compartment reconfigures live/source/preview in place.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorView } from '@codemirror/view'
import type { ViewUpdate } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { openSearchPanel } from '@codemirror/search'
import type { ImageInsertRequest } from '../../shared/types'
import { useDocumentsStore } from '../stores/documents'
import { useSettingsStore, plainSettings } from '../stores/settings'
import { editorBus } from '../editor/bus'
import { setImageInsertFn, setDownloadImageFn } from '../editor/extensions/images'
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
import { dispatchLiveRefresh, currentBlocks, tableKeyFor } from '../editor/extensions/liveRender'
import { activeCellFor } from '../editor/tableWidget'
import { onLayoutChanged, setDocumentLayout } from '../editor/tableLayout'
import { applyTableOp, type TableOp } from '../editor/tableOps'
import { parseTable, type Align } from '../editor/tables'
import { setMermaidTheme } from '../editor/markdown/mermaid'
import { computeStats } from '../editor/wordcount'
import { parseOutline } from '../editor/outline'
import { toast } from '../lib/bus'
import { t } from '../lib/i18n'
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
  const tab = documents.active
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
  const tab = documents.active
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
  <div class="editor-host">
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
