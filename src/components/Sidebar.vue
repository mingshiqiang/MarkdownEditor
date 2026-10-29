<script setup lang="ts">
/**
 * Sidebar (M3): workspace file tree, outline and search in one collapsible
 * panel with three views.
 */
import { computed, ref } from 'vue'
import type { FileTreeNode, SearchMatch } from '../../shared/types'
import { useWorkspaceStore, type SidebarView } from '../stores/workspace'
import FileTree from './FileTree.vue'
import OutlineView from './OutlineView.vue'
import SearchPanel from './SearchPanel.vue'
import { openContextMenu, type ContextMenuItem } from '../lib/contextMenu'
import { toast } from '../lib/bus'
import { t, tf } from '../lib/i18n'

const workspace = useWorkspaceStore()

const emit = defineEmits<{
  (e: 'open-file', path: string): void
  (e: 'jump', pos: number): void
  (e: 'open-result', match: SearchMatch): void
}>()

const view = ref<SidebarView>('files')

const views: { id: SidebarView; label: string }[] = [
  { id: 'files', label: 'ui.sidebarFiles' },
  { id: 'outline', label: 'ui.sidebarOutline' },
  { id: 'search', label: 'ui.sidebarSearch' }
]

const treeEmpty = computed(() => !workspace.root)

function parentDir(filePath: string): string {
  const posix = filePath.replace(/\\/g, '/')
  const idx = posix.lastIndexOf('/')
  return idx > 0 ? posix.slice(0, idx) : (workspace.root ?? '')
}

async function createIn(parent: string, type: 'file' | 'directory'): Promise<void> {
  if (!parent) return
  const name = window.prompt(
    type === 'file' ? t('ui.newFileName') : t('ui.newFolderName'),
    type === 'file' ? 'untitled.md' : 'new-folder'
  )
  if (!name) return
  const ok = await workspace.createEntry(parent, name, type)
  if (ok) workspace.expanded.add(parent)
}

async function newFile(): Promise<void> {
  await createIn(workspace.root ?? '', 'file')
}

async function newFolder(): Promise<void> {
  await createIn(workspace.root ?? '', 'directory')
}

async function removeNode(node: FileTreeNode): Promise<void> {
  const ok = window.confirm(tf('ui.deleteConfirm', { name: node.name }))
  if (!ok) return
  await workspace.deleteEntry(node.path)
}

function copyPath(path: string): void {
  void window.api.clipboardWriteText(path)
  toast(t('ui.copied'))
}

function fileTreeMenu(node: FileTreeNode): ContextMenuItem[] {
  const parent = node.type === 'directory' ? node.path : parentDir(node.path)
  return [
    {
      id: 'new-file',
      label: t('ctx.newFileHere'),
      action: () => createIn(parent, 'file')
    },
    {
      id: 'new-folder',
      label: t('ctx.newFolderHere'),
      action: () => createIn(parent, 'directory')
    },
    { separator: true },
    {
      id: 'rename',
      label: t('ui.rename'),
      action: () => workspace.startRename(node.path, node.name)
    },
    {
      id: 'delete',
      label: t('ui.delete'),
      danger: true,
      action: () => removeNode(node)
    },
    { separator: true },
    {
      id: 'copy-path',
      label: t('ctx.copyPath'),
      action: () => copyPath(node.path)
    },
    {
      id: 'reveal',
      label: t('ctx.revealInExplorer'),
      action: () => window.api.showItemInFolder(node.path)
    },
    { separator: true },
    {
      id: 'refresh',
      label: t('ctx.refresh'),
      action: () => workspace.refresh()
    }
  ]
}

function onContextMenu(payload: { event: MouseEvent; node: FileTreeNode }): void {
  openContextMenu(payload.event, fileTreeMenu(payload.node))
}

function onRootContextMenu(event: MouseEvent): void {
  event.preventDefault()
  openContextMenu(event, [
    {
      id: 'new-file',
      label: t('ctx.newFileHere'),
      action: () => newFile()
    },
    {
      id: 'new-folder',
      label: t('ctx.newFolderHere'),
      action: () => newFolder()
    },
    { separator: true },
    {
      id: 'refresh',
      label: t('ctx.refresh'),
      action: () => workspace.refresh()
    }
  ])
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-tabs">
      <button
        v-for="item in views"
        :key="item.id"
        type="button"
        class="sidebar-tab"
        :class="{ active: view === item.id }"
        @click="view = item.id"
      >
        {{ t(item.label) }}
      </button>
    </div>

    <!-- file tree -->
    <div v-if="view === 'files'" class="sidebar-body">
      <div class="sidebar-toolbar">
        <input
          v-model="workspace.filter"
          class="sidebar-filter"
          :placeholder="t('ui.filterPlaceholder')"
        />
        <button type="button" class="sb-icon" :title="t('ui.newFile')" @click="newFile">＋</button>
        <button type="button" class="sb-icon" :title="t('ui.newFolder')" @click="newFolder">
          🗀
        </button>
        <button
          type="button"
          class="sb-icon"
          :title="t('ui.refreshWorkspace')"
          @click="workspace.refresh()"
        >
          ⟳
        </button>
      </div>
      <div class="sidebar-scroll">
        <div v-if="treeEmpty" class="sidebar-empty-box">
          <p>{{ t('ui.noWorkspace') }}</p>
          <button type="button" class="btn primary" @click="workspace.openFolder()">
            {{ t('ui.openFolder') }}
          </button>
        </div>
        <template v-else>
          <div
            class="workspace-root"
            :title="workspace.root ?? ''"
            @contextmenu.prevent="onRootContextMenu"
          >
            📁 {{ workspace.rootName }}
          </div>
          <FileTree
            :nodes="workspace.filteredNodes"
            @open-file="(p) => emit('open-file', p)"
            @context-menu="onContextMenu"
          />
        </template>
      </div>
    </div>

    <!-- outline -->
    <div v-else-if="view === 'outline'" class="sidebar-body">
      <div class="sidebar-scroll">
        <OutlineView @jump="(p) => emit('jump', p)" />
      </div>
    </div>

    <!-- search -->
    <div v-else class="sidebar-body">
      <div class="sidebar-scroll">
        <SearchPanel @open-result="(m) => emit('open-result', m)" />
      </div>
    </div>
  </aside>
</template>
