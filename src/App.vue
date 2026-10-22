<script setup lang="ts">
/**
 * App shell: wires menus, keyboard shortcuts, drag&drop, auto save,
 * unsaved-changes confirmation, external-change prompts and the theme.
 */
import { nextTick, onBeforeUnmount, onMounted, computed, ref, watch } from 'vue'
import type { ExternalChange, MenuAction, SearchMatch, UpdateEvent } from '../shared/types'
import { useDocumentsStore } from './stores/documents'
import { useSettingsStore } from './stores/settings'
import { useWorkspaceStore } from './stores/workspace'
import { setOpenDocFn, setToastFn, toast } from './lib/bus'
import { t, tf } from './lib/i18n'
import { matchAppShortcut } from './lib/shortcuts'
import { applyUserTheme } from './lib/userTheme'
import { findImageRefs, isRemoteRef } from './editor/imageRefs'
import { plainSettings } from './stores/settings'
import { userThemeCss as buildUserThemeCss } from '../shared/userTheme'
import TabsBar from './components/TabsBar.vue'
import EditorHost from './components/EditorHost.vue'
import StatusBar from './components/StatusBar.vue'
import WelcomeScreen from './components/WelcomeScreen.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import Sidebar from './components/Sidebar.vue'
import ExportDialog from './components/ExportDialog.vue'
import Modal from './components/Modal.vue'

const documents = useDocumentsStore()
const settings = useSettingsStore()
const workspace = useWorkspaceStore()

/** CSS of the active user theme (embedded in HTML / long image exports). */
const userThemeCss = computed(() => {
  const theme = settings.activeUserTheme
  return theme ? buildUserThemeCss(theme) : ''
})

const editorHost = ref<InstanceType<typeof EditorHost> | null>(null)
const showSettings = ref(false)
const showExport = ref(false)

/* --------------------------------- toast ---------------------------------- */

const toastMsg = ref('')
let toastTimer: ReturnType<typeof setTimeout> | null = null

function showToast(message: string): void {
  toastMsg.value = message
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toastMsg.value = ''
  }, 2200)
}

/* ---------------------------- document actions ----------------------------- */

async function openDialog(): Promise<void> {
  const metas = await window.api.openFileDialog()
  for (const meta of metas) documents.openFile(meta)
  if (metas.length) {
    await nextTick()
    editorHost.value?.focus()
  }
}

async function openPath(abs: string): Promise<void> {
  const meta = await window.api.readFile(abs)
  if (!meta) return
  documents.openFile(meta)
  await nextTick()
  editorHost.value?.focus()
}

/** Open a workspace file from the file tree. */
async function openWorkspaceFile(abs: string): Promise<void> {
  const existing = documents.byPath(abs)
  if (existing) {
    documents.activate(existing.id)
    editorHost.value?.focus()
    return
  }
  await openPath(abs)
}

/** Open a search result and jump to the matching line. */
async function openSearchResult(match: SearchMatch): Promise<void> {
  await openWorkspaceFile(match.path)
  if (!match.line) return
  // Give the editor a moment to switch to the document, then jump.
  await nextTick()
  requestAnimationFrame(() => {
    editorHost.value?.jumpToLine(match.line, match.column)
  })
}

function newDoc(): void {
  documents.newDoc()
  void nextTick(() => editorHost.value?.focus())
}

async function saveActive(forceAs = false): Promise<void> {
  const tab = documents.active
  if (!tab) return
  const previousPath = tab.path
  const ok = await documents.saveDoc(tab.id, false, forceAs)
  if (ok && previousPath !== tab.path) {
    // Save-as changed the location -> relative images resolve elsewhere now.
    editorHost.value?.updateDocDir(tab.id, tab.path ?? '')
  }
}
/* --------------------------- close confirmation --------------------------- */

interface CloseRequest {
  allIds: string[]
  dirtyIds: string[]
  kind: 'tabs' | 'window'
}

const closeRequest = ref<CloseRequest | null>(null)

function requestClose(ids: string[], kind: 'tabs' | 'window'): void {
  if (ids.length === 0) {
    if (kind === 'window') void window.api.confirmClose(true)
    return
  }
  const dirtyIds = ids.filter((id) => documents.tabs.find((x) => x.id === id)?.dirty)
  if (dirtyIds.length === 0) {
    if (kind === 'window') void window.api.confirmClose(true)
    else documents.closeTabs(ids)
    return
  }
  closeRequest.value = { allIds: ids, dirtyIds, kind }
}

async function confirmSaveAndClose(): Promise<void> {
  const req = closeRequest.value
  if (!req) return
  for (const id of req.dirtyIds) {
    const ok = await documents.saveDoc(id)
    if (!ok) return // user cancelled the save dialog -> keep everything open
  }
  const kind = req.kind
  closeRequest.value = null
  if (kind === 'window') void window.api.confirmClose(true)
  else documents.closeTabs(req.allIds)
}

function confirmDiscardAndClose(): void {
  const req = closeRequest.value
  if (!req) return
  closeRequest.value = null
  if (req.kind === 'window') void window.api.confirmClose(true)
  else documents.closeTabs(req.allIds)
}

function cancelClose(): void {
  const req = closeRequest.value
  closeRequest.value = null
  if (req?.kind === 'window') void window.api.confirmClose(false)
}

function closeOthers(id: string): void {
  requestClose(
    documents.tabs.filter((x) => x.id !== id).map((x) => x.id),
    'tabs'
  )
}

function closeRight(id: string): void {
  const idx = documents.tabs.findIndex((x) => x.id === id)
  if (idx < 0) return
  requestClose(
    documents.tabs.slice(idx + 1).map((x) => x.id),
    'tabs'
  )
}

/* ---------------------------- external changes ---------------------------- */

const extRequest = ref<{ path: string; name: string } | null>(null)

async function handleExternalChange(change: ExternalChange): Promise<void> {
  const tab = documents.byPath(change.path)
  if (!tab) return
  if (change.kind === 'unlink') {
    showToast(tf('ui.extDeleted', { name: tab.name }))
    if (!tab.dirty) documents.closeTabs([tab.id])
    return
  }
  if (!tab.dirty) {
    const meta = await window.api.readFile(change.path)
    if (!meta) {
      showToast(tf('ui.extDeleted', { name: tab.name }))
      return
    }
    documents.reloadTab(tab.id, meta.content)
    editorHost.value?.reloadDoc(tab.id, meta.content)
    showToast(t('ui.reloaded'))
    return
  }
  extRequest.value = { path: change.path, name: tab.name }
}

async function extReload(): Promise<void> {
  const req = extRequest.value
  if (!req) return
  extRequest.value = null
  const tab = documents.byPath(req.path)
  const meta = await window.api.readFile(req.path)
  if (!meta || !tab) {
    showToast(tf('ui.extDeleted', { name: req.name }))
    return
  }
  documents.reloadTab(tab.id, meta.content)
  editorHost.value?.reloadDoc(tab.id, meta.content)
  showToast(t('ui.reloaded'))
}

function extKeep(): void {
  extRequest.value = null
}

/* -------------------------------- menu ------------------------------------ */

async function handleMenuAction(action: MenuAction): Promise<void> {
  switch (action.id) {
    case 'file:new':
      newDoc()
      break
    case 'file:open':
      await openDialog()
      break
    case 'file:open-recent':
      if (action.payload) await openPath(action.payload)
      break
    case 'file:clear-recent':
      await documents.clearRecent()
      break
    case 'file:save':
      await saveActive()
      break
    case 'file:save-as':
      await saveActive(true)
      break
    case 'file:export-pdf':
    case 'file:export-html':
    case 'file:export-word':
      showExport.value = true
      break
    case 'file:close-tab': {
      const active = documents.active
      if (active) requestClose([active.id], 'tabs')
      break
    }
    case 'edit:find':
    case 'edit:replace':
      editorHost.value?.openSearch()
      break
    case 'edit:copy-rich':
      await copyRichText()
      break
    case 'file:upload-images':
      await uploadDocumentImages()
      break
    case 'help:check-updates':
      await window.api.checkForUpdates()
      break
    case 'view:mode-live':
      settings.setMode('live')
      break
    case 'view:mode-source':
      settings.setMode('source')
      break
    case 'view:mode-preview':
      settings.setMode('preview')
      break
    case 'view:theme-toggle':
      settings.toggleLightDark()
      break
    case 'view:settings':
      showSettings.value = true
      break
    case 'view:cycle-mode':
      settings.cycleMode()
      break
    case 'view:next-tab':
      cycleTab(1)
      break
    case 'view:prev-tab':
      cycleTab(-1)
      break
    case 'view:toggle-sidebar':
      settings.toggleSidebar()
      break
    case 'view:toggle-focus-mode':
      settings.toggleFocusMode()
      break
    case 'view:toggle-typewriter':
      settings.toggleTypewriterMode()
      break
    case 'view:toggle-split':
      settings.toggleSplitView()
      break
    case 'file:open-folder':
      await workspace.openFolder()
      break
    default:
      break
  }
}

/** Copy the document (or the current selection) as rich text (X-05). */
async function copyRichText(): Promise<void> {
  const tab = documents.active
  if (!tab) return
  const selection = editorHost.value?.getSelectedText() ?? ''
  const markdown = selection || documents.previewText
  const { buildExportHtml, renderExportHtml } = await import('./editor/export/html')
  const env = {
    docDir: docDirOf(tab.path ?? null),
    theme: settings.effectiveTheme,
    title: tab.name,
    customCss: userThemeCss.value
  }
  const body = await renderExportHtml(markdown, env)
  await window.api.clipboardWriteHtml(buildExportHtml(body, env), markdown)
  toast(t('ui.copiedRich'))
}

/** Upload the local images of the document to the configured image host (X-06). */
async function uploadDocumentImages(): Promise<void> {
  const tab = documents.active
  if (!tab) return
  const config = settings.settings.imageHost
  if (!config.enabled || !config.url) {
    toast(t('ui.imageHostNotConfigured'))
    showSettings.value = true
    return
  }
  const refs = findImageRefs(documents.previewText).filter((ref) => !isRemoteRef(ref.src))
  if (refs.length === 0) {
    toast(t('ui.imageHostNoImages'))
    return
  }
  const docDir = docDirOf(tab.path ?? null)
  const changes: { from: number; to: number; insert: string }[] = []
  for (const ref of refs) {
    const abs = await window.api.resolvePath(docDir, ref.src)
    if (!abs) continue
    const url = await window.api.uploadImage(abs, plainSettings(settings.settings))
    if (!url) continue
    changes.push({ from: ref.from, to: ref.to, insert: url })
  }
  if (changes.length === 0) {
    toast(t('ui.imageHostFailed'))
    return
  }
  editorHost.value?.replaceRanges(changes)
  toast(tf('ui.imageHostDone', { count: changes.length }))
}

/* --------------------------------- updates --------------------------------- */

/** Shows the progress of the auto update (S-05). */
function handleUpdateEvent(event: UpdateEvent): void {
  switch (event.status) {
    case 'checking':
      showToast(t('ui.updateChecking'))
      break
    case 'available':
      showToast(tf('ui.updateAvailable', { version: event.version ?? '' }))
      break
    case 'not-available':
      showToast(t('ui.updateNotAvailable'))
      break
    case 'downloading':
      showToast(tf('ui.updateDownloading', { percent: Math.round(event.percent ?? 0) }))
      break
    case 'downloaded':
      showToast(t('ui.updateDownloaded'))
      break
    case 'unsupported':
      showToast(t('ui.updateUnsupported'))
      break
    case 'error':
      showToast(tf('ui.updateFailed', { message: event.message ?? '' }))
      break
    default:
      break
  }
}

/* ------------------------------- keyboard ---------------------------------- */

function cycleTab(dir: number): void {
  const tabs = documents.tabs
  if (tabs.length < 2) return
  const idx = tabs.findIndex((x) => x.id === documents.activeId)
  const next = (idx + dir + tabs.length) % tabs.length
  documents.activate(tabs[next].id)
}

/**
 * Shortcuts that are not consumed by the native menu (the browser preview has
 * no menu at all). The menu accelerators run the same actions in the app.
 */
function onKeydown(e: KeyboardEvent): void {
  const id = matchAppShortcut(e)
  if (!id) return
  e.preventDefault()
  e.stopPropagation()
  void handleMenuAction({ id })
}

/** Open a workspace folder (menu, CLI argument or file association). */ async function openWorkspace(
  root: string
): Promise<void> {
  workspace.root = root
  await workspace.refresh()
  for (const node of workspace.nodes) {
    if (node.type === 'directory') workspace.expanded.add(node.path)
  }
  settings.patch({ workspace: { rootPath: root } })
  console.info(`[mde] workspace opened: ${root} (${workspace.nodes.length} entries)`)
}

/* ---------------------------- crash snapshots ------------------------------ */

/**
 * Offer to restore content from a crash-recovery snapshot (F-02).
 * Snapshots are written while a document has unsaved changes and live
 * outside the document folder, so they can never damage the original file.
 */
async function checkSnapshots(): Promise<void> {
  const snapshots = await window.api.listSnapshots()
  if (!snapshots.length) return
  const snapshot = snapshots[0]
  const content = await window.api.readSnapshot(snapshot.id)
  if (content === null) return
  const restore = window.confirm(
    `检测到未保存的自动快照：\n${snapshot.name}\n（${new Date(snapshot.ts).toLocaleString()}）\n\n是否恢复该内容？`
  )
  if (!restore) {
    await window.api.clearSnapshot(snapshot.id)
    return
  }
  const meta = await window.api.readFile(snapshot.path)
  if (meta) {
    const tab = documents.openFile(meta)
    await nextTick()
    editorHost.value?.reloadDoc(tab.id, content)
    documents.markDirty(tab.id, true)
  } else {
    // The original file is gone: open the snapshot as a new document.
    const tab = documents.newDoc()
    tab.name = snapshot.name
    await nextTick()
    editorHost.value?.reloadDoc(tab.id, content)
    documents.markDirty(tab.id, true)
  }
  await window.api.clearSnapshot(snapshot.id)
}

/* ------------------------------ drag & drop ------------------------------- */

/** Directory of a document (posix), used to resolve relative images. */
function docDirOf(path: string | null): string {
  if (!path) return ''
  const posix = path.replace(/\\/g, '/')
  const idx = posix.lastIndexOf('/')
  return idx > 0 ? posix.slice(0, idx) : ''
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i

function onWindowDragOver(e: DragEvent): void {
  if (e.dataTransfer?.types?.includes('Files')) e.preventDefault()
}

function onWindowDrop(e: DragEvent): void {
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length === 0) return
  e.preventDefault() // never let the window navigate to a dropped file
  const docs = files.filter((f) => /\.(md|markdown|mkd|txt)$/i.test(f.name))
  if (docs.length > 0) {
    e.stopPropagation()
    for (const f of docs) {
      const abs = window.api.pathForFile(f)
      if (abs) void openPath(abs)
    }
    return
  }
  // Images are handled by the editor when a document is open.
  const hasImage = files.some((f) => f.type.startsWith('image/') || IMAGE_EXT.test(f.name))
  if (hasImage && (!documents.active || settings.settings.mode === 'preview')) {
    e.stopPropagation()
  }
}

/* -------------------------------- autosave --------------------------------- */

let autosaveTimer: ReturnType<typeof setInterval> | null = null

function setupAutosave(): void {
  if (autosaveTimer) {
    clearInterval(autosaveTimer)
    autosaveTimer = null
  }
  const cfg = settings.settings.autosave
  if (!cfg.enabled) return
  const ms = Math.max(5, cfg.intervalSec) * 1000
  autosaveTimer = setInterval(() => {
    void documents.autoSaveDirty()
  }, ms)
}

function onWindowBlur(): void {
  if (settings.settings.autosave.onBlur) void documents.autoSaveDirty()
}

/* ---------------------------- theme / title ------------------------------- */

watch(
  [() => settings.effectiveTheme, () => settings.locale],
  () => {
    document.documentElement.dataset.theme = settings.effectiveTheme
    document.documentElement.lang = settings.locale
  },
  { immediate: true }
)

// User theme (U-02): the variables are injected on top of the built-in theme.
watch(
  () => settings.activeUserTheme,
  (theme) => applyUserTheme(theme),
  { immediate: true }
)

watch(
  () => settings.settings.editor,
  (ed) => {
    const root = document.documentElement
    root.style.setProperty('--ed-font-size', `${ed.fontSize}px`)
    root.style.setProperty('--ed-line-height', String(ed.lineHeight))
    root.style.setProperty('--ed-font-family', ed.fontFamily)
    root.style.setProperty('--ed-mono-font-family', ed.monoFontFamily)
    root.style.setProperty('--ed-max-width', `${ed.contentMaxWidth}px`)
  },
  { immediate: true, deep: true }
)

watch(
  [() => documents.active?.name, () => documents.active?.dirty, () => documents.tabs.length],
  () => {
    const tab = documents.active
    document.title = tab ? `${tab.dirty ? '• ' : ''}${tab.name} — MarkdownEditor` : 'MarkdownEditor'
  },
  { immediate: true }
)

watch(
  () => documents.dirtyCount,
  (n) => {
    void window.api.notifyDirty(n)
  },
  { immediate: true }
)

/* -------------------------------- lifecycle -------------------------------- */

let unsubscribers: Array<() => void> = []

onMounted(() => {
  setToastFn(showToast)
  setOpenDocFn((abs) => void openPath(abs))
  setupAutosave()
  window.addEventListener('keydown', onKeydown, { capture: true })
  window.addEventListener('dragover', onWindowDragOver, { capture: true })
  window.addEventListener('drop', onWindowDrop, { capture: true })
  window.addEventListener('blur', onWindowBlur)

  // Restore the last opened workspace (M3).
  const root = settings.settings.workspace.rootPath
  if (root) {
    void openWorkspace(root)
  }

  // Offer to restore content from a crash snapshot (F-02).
  void checkSnapshots()

  unsubscribers = [
    window.api.onMenuAction((action) => void handleMenuAction(action)),
    window.api.onOpenFile((p) => void openPath(p)),
    window.api.onOpenWorkspace((p) => void openWorkspace(p)),
    window.api.onExternalChange((c) => void handleExternalChange(c)),
    window.api.onSystemTheme((theme) => settings.setSystemTheme(theme)),
    window.api.onUpdateEvent((event) => handleUpdateEvent(event)),
    window.api.onQueryClose(() =>
      requestClose(
        documents.dirtyTabs.map((x) => x.id),
        'window'
      )
    )
  ]
})

onBeforeUnmount(() => {
  for (const un of unsubscribers) un()
  unsubscribers = []
  if (autosaveTimer) clearInterval(autosaveTimer)
  if (toastTimer) clearTimeout(toastTimer)
  window.removeEventListener('keydown', onKeydown, { capture: true } as EventListenerOptions)
  window.removeEventListener('dragover', onWindowDragOver, {
    capture: true
  } as EventListenerOptions)
  window.removeEventListener('drop', onWindowDrop, { capture: true } as EventListenerOptions)
  window.removeEventListener('blur', onWindowBlur)
})
</script>

<template>
  <div class="app-shell" :class="{ 'focus-mode': settings.settings.workspace.focusMode }">
    <div class="app-top">
      <button
        type="button"
        class="sidebar-toggle"
        :title="t('ui.toggleSidebar')"
        @click="settings.toggleSidebar()"
      >
        ☰
      </button>
      <TabsBar
        v-if="documents.tabs.length"
        @close="requestClose([$event], 'tabs')"
        @close-others="closeOthers"
        @close-right="closeRight"
        @new-tab="newDoc"
      />
    </div>
    <div class="app-body">
      <Sidebar
        v-if="settings.settings.workspace.sidebarVisible && !settings.settings.workspace.focusMode"
        @open-file="openWorkspaceFile"
        @jump="(p) => editorHost?.jumpTo(p)"
        @open-result="openSearchResult"
      />
      <template v-if="documents.tabs.length">
        <div class="editor-pane" :class="{ 'split-pane': settings.settings.workspace.splitView }">
          <EditorHost ref="editorHost" />
        </div>
        <div v-if="settings.settings.workspace.splitView" class="editor-pane split-pane">
          <div class="split-header">
            <select
              class="split-select"
              :value="settings.settings.workspace.secondDocId"
              @change="settings.setSecondDoc(($event.target as HTMLSelectElement).value)"
            >
              <option value="">{{ t('ui.splitPickDoc') }}</option>
              <option
                v-for="tab in documents.tabs"
                :key="tab.id"
                :value="tab.id"
                :disabled="tab.id === documents.activeId"
              >
                {{ tab.name }}
              </option>
            </select>
            <button
              type="button"
              class="split-close"
              :title="t('ui.splitClose')"
              @click="settings.toggleSplitView()"
            >
              ✕
            </button>
          </div>
          <EditorHost
            v-if="settings.settings.workspace.secondDocId"
            :doc-id="settings.settings.workspace.secondDocId"
          />
          <div v-else class="split-empty">{{ t('ui.splitEmpty') }}</div>
        </div>
      </template>
      <WelcomeScreen
        v-else
        @new="newDoc"
        @open="openDialog"
        @open-recent="openPath"
        @clear-recent="documents.clearRecent()"
      />
    </div>
    <StatusBar />

    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <ExportDialog
      v-if="showExport"
      :doc-name="documents.active?.name ?? 'document.md'"
      :doc-dir="docDirOf(documents.active?.path ?? null)"
      :theme="settings.effectiveTheme"
      :markdown="documents.previewText"
      :custom-css="userThemeCss"
      @close="showExport = false"
      @done="
        (path) => {
          showExport = false
          toast(tf('ui.exportDone', { path }))
        }
      "
    />

    <Modal
      v-if="closeRequest"
      :title="t('ui.confirmTitle')"
      width="440px"
      :dismissible="false"
      @close="cancelClose"
    >
      <p class="modal-text">{{ t('ui.confirmMessage') }}</p>
      <ul class="dirty-list">
        <li v-for="id in closeRequest.dirtyIds" :key="id">
          {{ documents.tabs.find((x) => x.id === id)?.name }}
        </li>
      </ul>
      <div class="modal-actions">
        <button type="button" class="btn" @click="cancelClose">{{ t('ui.cancel') }}</button>
        <button type="button" class="btn danger" @click="confirmDiscardAndClose">
          {{ t('ui.discardAll') }}
        </button>
        <button type="button" class="btn primary" @click="confirmSaveAndClose">
          {{ t('ui.saveAll') }}
        </button>
      </div>
    </Modal>

    <Modal
      v-if="extRequest"
      :title="t('ui.extTitle')"
      width="420px"
      :dismissible="false"
      @close="extKeep"
    >
      <p class="modal-text">{{ tf('ui.extMessage', { name: extRequest.name }) }}</p>
      <div class="modal-actions">
        <button type="button" class="btn" @click="extKeep">{{ t('ui.extKeep') }}</button>
        <button type="button" class="btn primary" @click="extReload">
          {{ t('ui.extReload') }}
        </button>
      </div>
    </Modal>

    <transition name="toast">
      <div v-if="toastMsg" class="toast">{{ toastMsg }}</div>
    </transition>
  </div>
</template>
