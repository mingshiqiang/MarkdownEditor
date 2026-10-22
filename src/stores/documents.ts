import { defineStore } from 'pinia'
import type { FileMeta, RecentFile } from '../../shared/types'
import { t } from '../lib/i18n'
import { toast } from '../lib/bus'
import { dropState, peekStateText } from '../editor/statePool'
import type { OutlineItem } from '../editor/outline'

export interface DocTab {
  id: string
  path: string | null
  name: string
  dirty: boolean
  /** Content when the tab was created / last saved; live text lives in the CM state pool. */
  lastSavedText: string
  /** Initial content used to create the CM state lazily. */
  initialContent: string
  savedMtimeMs: number | null
  scrollTop: number
  /** The encoding the file was read with (shown in the status bar). */
  encoding: string
}

let nextId = 1
let untitledSeq = 1

export const useDocumentsStore = defineStore('documents', {
  state: () => ({
    tabs: [] as DocTab[],
    activeId: null as string | null,
    recent: [] as RecentFile[],
    /** Debounced stats/cursor for the active document (updated by EditorHost). */
    stats: { chars: 0, words: 0, lines: 0, readMinutes: 0 },
    cursorLn: 1,
    cursorCol: 1,
    cursorPos: 0,
    /** Headings of the active document (outline view). */
    outline: [] as OutlineItem[],
    previewText: ''
  }),

  getters: {
    active(state): DocTab | null {
      return state.tabs.find((x) => x.id === state.activeId) ?? null
    },
    dirtyTabs(state): DocTab[] {
      return state.tabs.filter((x) => x.dirty)
    },
    dirtyCount(state): number {
      return state.tabs.filter((x) => x.dirty).length
    },
    openPaths(state): string[] {
      return state.tabs.filter((x) => x.path !== null).map((x) => x.path as string)
    },
    byPath(state): (path: string) => DocTab | null {
      return (path) => state.tabs.find((x) => x.path === path) ?? null
    }
  },

  actions: {
    /* --------------------------------- tabs -------------------------------- */

    newDoc(): DocTab {
      const id = `doc-${nextId++}`
      const tab: DocTab = {
        id,
        path: null,
        name: `${t('ui.untitled')}-${untitledSeq++}`,
        dirty: false,
        lastSavedText: '',
        initialContent: '',
        savedMtimeMs: null,
        scrollTop: 0,
        encoding: 'utf-8'
      }
      this.tabs.push(tab)
      this.activate(id)
      this.syncWatcher()
      return tab
    },

    openFile(meta: FileMeta): DocTab {
      const existing = this.byPath(meta.path)
      if (existing) {
        // Already open: just focus it (keep user edits; external changes are
        // handled by the watcher flow).
        this.activate(existing.id)
        return existing
      }
      const id = `doc-${nextId++}`
      const tab: DocTab = {
        id,
        path: meta.path,
        name: meta.name,
        dirty: false,
        lastSavedText: meta.content,
        initialContent: meta.content,
        savedMtimeMs: meta.mtimeMs,
        scrollTop: 0,
        encoding: meta.encoding || 'utf-8'
      }
      this.tabs.push(tab)
      this.activate(id)
      this.syncWatcher()
      void this.refreshRecent()
      return tab
    },

    activate(id: string): void {
      if (!this.tabs.some((x) => x.id === id)) return
      this.activeId = id
    },

    markDirty(id: string, dirty: boolean): void {
      const tab = this.tabs.find((x) => x.id === id)
      if (tab && tab.dirty !== dirty) tab.dirty = dirty
    },

    /** All text of a tab (live CM state, falling back to last saved). */
    textOf(id: string): string {
      return peekStateText(id) ?? this.tabs.find((x) => x.id === id)?.lastSavedText ?? ''
    },

    closeTabs(ids: string[]): void {
      const set = new Set(ids)
      this.tabs = this.tabs.filter((x) => !set.has(x.id))
      for (const id of ids) dropState(id)
      if (!this.tabs.some((x) => x.id === this.activeId)) {
        this.activeId = this.tabs.length ? this.tabs[this.tabs.length - 1].id : null
      }
      this.syncWatcher()
      if (this.tabs.length === 0) this.previewText = ''
    },

    reorder(from: number, to: number): void {
      if (from === to || from < 0 || to < 0 || from >= this.tabs.length || to >= this.tabs.length)
        return
      const [tab] = this.tabs.splice(from, 1)
      this.tabs.splice(to, 0, tab)
    },

    /* -------------------------------- saving ------------------------------- */

    async saveDoc(id: string, silent = false, forceAs = false): Promise<boolean> {
      const tab = this.tabs.find((x) => x.id === id)
      if (!tab) return false
      const text = this.textOf(id)
      let path = tab.path
      if (!path || forceAs) {
        const suggested = tab.name.endsWith('.md') ? tab.name : `${tab.name}.md`
        path = await window.api.saveAsDialog(suggested)
        if (!path) return false
      }
      const result = await window.api.writeFile(path, text)
      if (!result) {
        toast(t('ui.saveFailed'))
        return false
      }
      this.applySaveResult(id, result, text)
      void this.refreshRecent()
      if (!silent) toast(t('ui.saved'))
      return true
    },

    applySaveResult(
      id: string,
      result: { path: string; name: string; mtimeMs: number },
      text: string
    ): void {
      const tab = this.tabs.find((x) => x.id === id)
      if (!tab) return
      tab.path = result.path
      tab.name = result.name
      tab.lastSavedText = text
      tab.dirty = false
      tab.savedMtimeMs = result.mtimeMs
      tab.initialContent = text
      this.syncWatcher()
      // The document is saved: its crash-recovery snapshot is obsolete.
      void this.clearSnapshotFor(id, result.path)
    },

    async clearSnapshotFor(docId: string, filePath: string): Promise<void> {
      try {
        const snapshots = await window.api.listSnapshots()
        const match = snapshots.find((s) => s.path === filePath)
        if (match) await window.api.clearSnapshot(match.id)
      } catch {
        /* best-effort */
      }
      void docId
    },

    /** Auto-save (F-02): only tabs that already have a file path. */
    async autoSaveDirty(): Promise<void> {
      const ids = this.tabs.filter((x) => x.dirty && x.path).map((x) => x.id)
      for (const id of ids) {
        await this.saveDoc(id, true)
      }
    },

    /* ------------------------------ reload / io ----------------------------- */

    reloadTab(id: string, content: string): void {
      const tab = this.tabs.find((x) => x.id === id)
      if (!tab) return
      tab.lastSavedText = content
      tab.initialContent = content
      tab.dirty = false
    },

    async refreshRecent(): Promise<void> {
      this.recent = await window.api.getRecent()
    },

    async clearRecent(): Promise<void> {
      this.recent = await window.api.clearRecent()
    },

    syncWatcher(): void {
      void window.api.syncWatch(this.openPaths)
      void window.api.notifyDirty(this.dirtyCount)
    },

    /* ------------------------- status (from EditorHost) -------------------- */

    setStats(stats: { chars: number; words: number; lines: number; readMinutes: number }): void {
      this.stats = stats
    },

    setCursor(ln: number, col: number, pos = 0): void {
      this.cursorLn = ln
      this.cursorCol = col
      this.cursorPos = pos
    },

    setOutline(items: OutlineItem[]): void {
      this.outline = items
    },

    setPreviewText(text: string): void {
      this.previewText = text
    }
  }
})
