import { defineStore } from 'pinia'
import type { FileTreeNode, SearchMatch, SearchMode } from '../../shared/types'
import { toast } from '../lib/bus'
import { t } from '../lib/i18n'
import { useSettingsStore } from './settings'

export type SidebarView = 'files' | 'outline' | 'search'

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    root: null as string | null,
    nodes: [] as FileTreeNode[],
    expanded: new Set<string>(),
    /** Name filter for the file tree. */
    filter: '',
    selectedPath: null as string | null,
    /** Path of the entry that is being renamed inline. */
    renamingPath: null as string | null,
    renameValue: '',
    loading: false,
    // search
    searchQuery: '',
    searchMode: 'name' as SearchMode,
    searchResults: [] as SearchMatch[],
    searching: false
  }),

  getters: {
    /** Nodes with the name filter applied (directories kept if a child matches). */
    filteredNodes(state): FileTreeNode[] {
      const q = state.filter.trim().toLowerCase()
      if (!q) return state.nodes
      return filterNodes(state.nodes, q)
    },
    rootName(state): string {
      if (!state.root) return ''
      const parts = state.root.split(/[\\/]/).filter(Boolean)
      return parts[parts.length - 1] ?? state.root
    }
  },

  actions: {
    async openFolder(): Promise<void> {
      const dir = await window.api.openFolder()
      if (!dir) return
      this.root = dir
      this.nodes = []
      this.expanded.clear()
      await this.refresh()
      // expand the root level
      for (const node of this.nodes) {
        if (node.type === 'directory') this.expanded.add(node.path)
      }
      // remember the workspace for the next start
      useSettingsStore().patch({ workspace: { rootPath: dir } })
    },

    async refresh(): Promise<void> {
      if (!this.root) return
      this.loading = true
      try {
        this.nodes = await window.api.readWorkspaceTree(this.root)
      } finally {
        this.loading = false
      }
    },

    toggle(path: string): void {
      if (this.expanded.has(path)) this.expanded.delete(path)
      else this.expanded.add(path)
    },

    isExpanded(path: string): boolean {
      return this.expanded.has(path)
    },

    startRename(path: string, currentName: string): void {
      this.renamingPath = path
      this.renameValue = currentName
    },

    cancelRename(): void {
      this.renamingPath = null
      this.renameValue = ''
    },

    async commitRename(): Promise<void> {
      const target = this.renamingPath
      const value = this.renameValue.trim()
      this.cancelRename()
      if (!target || !value) return
      await this.renameEntry(target, value)
    },

    async createEntry(parent: string, name: string, type: 'file' | 'directory'): Promise<boolean> {
      const ok = await window.api.createWorkspaceEntry(parent, name, type)
      if (!ok) {
        toast(t('ui.workspaceOpFailed'))
        return false
      }
      await this.refresh()
      return true
    },

    async renameEntry(target: string, newName: string): Promise<boolean> {
      const ok = await window.api.renameWorkspaceEntry(target, newName)
      if (!ok) {
        toast(t('ui.workspaceOpFailed'))
        return false
      }
      await this.refresh()
      return true
    },

    async deleteEntry(target: string): Promise<boolean> {
      const ok = await window.api.deleteWorkspaceEntry(target)
      if (!ok) {
        toast(t('ui.workspaceOpFailed'))
        return false
      }
      if (this.selectedPath === target) this.selectedPath = null
      await this.refresh()
      return true
    },

    async moveEntry(from: string, toDir: string): Promise<boolean> {
      const ok = await window.api.moveWorkspaceEntry(from, toDir)
      if (!ok) {
        toast(t('ui.workspaceOpFailed'))
        return false
      }
      await this.refresh()
      return true
    },

    async runSearch(): Promise<void> {
      if (!this.root || !this.searchQuery.trim()) {
        this.searchResults = []
        return
      }
      this.searching = true
      try {
        this.searchResults = await window.api.searchWorkspace(
          this.root,
          this.searchQuery,
          this.searchMode
        )
      } finally {
        this.searching = false
      }
    },

    clearSearch(): void {
      this.searchQuery = ''
      this.searchResults = []
    }
  }
})

/** Keep directories whose descendants match the filter. */
function filterNodes(nodes: FileTreeNode[], query: string): FileTreeNode[] {
  const out: FileTreeNode[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      if (node.name.toLowerCase().includes(query)) out.push(node)
      continue
    }
    const children = node.children ? filterNodes(node.children, query) : []
    if (node.name.toLowerCase().includes(query) || children.length > 0) {
      out.push({ ...node, children })
    }
  }
  return out
}
