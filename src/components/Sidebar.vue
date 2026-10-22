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
import { t, tf } from '../lib/i18n'

const workspace = useWorkspaceStore()

const emit = defineEmits<{
  (e: 'open-file', path: string): void
  (e: 'jump', pos: number): void
  (e: 'open-result', match: SearchMatch): void
}>()

const view = ref<SidebarView>('files')
const menu = ref<{ x: number; y: number; node: FileTreeNode | null } | null>(null)

const views: { id: SidebarView; label: string }[] = [
  { id: 'files', label: 'ui.sidebarFiles' },
  { id: 'outline', label: 'ui.sidebarOutline' },
  { id: 'search', label: 'ui.sidebarSearch' }
]

const treeEmpty = computed(() => !workspace.root)

function onContextMenu(payload: { event: MouseEvent; node: FileTreeNode }): void {
  menu.value = { x: payload.event.clientX, y: payload.event.clientY, node: payload.node }
}

function closeMenu(): void {
  menu.value = null
}

function renameFromMenu(): void {
  closeMenu()
  startRename()
}

function deleteFromMenu(): void {
  closeMenu()
  void remove()
}

async function newFile(): Promise<void> {
  const parent = workspace.root
  if (!parent) return
  const name = window.prompt(t('ui.newFileName'), 'untitled.md')
  if (!name) return
  await workspace.createEntry(parent, name, 'file')
}

async function newFolder(): Promise<void> {
  const parent = workspace.root
  if (!parent) return
  const name = window.prompt(t('ui.newFolderName'), 'new-folder')
  if (!name) return
  await workspace.createEntry(parent, name, 'directory')
}

function startRename(): void {
  const node = menu.value?.node
  if (!node) return
  closeMenu()
  workspace.startRename(node.path, node.name)
}

async function remove(): Promise<void> {
  const node = menu.value?.node
  closeMenu()
  if (!node) return
  const ok = window.confirm(tf('ui.deleteConfirm', { name: node.name }))
  if (!ok) return
  await workspace.deleteEntry(node.path)
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
          <div class="workspace-root" :title="workspace.root ?? ''">
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

    <teleport to="body">
      <div
        v-if="menu"
        class="ctx-menu"
        :style="{ left: menu.x + 'px', top: menu.y + 'px' }"
        @mousedown.stop
      >
        <button type="button" @click="renameFromMenu">
          {{ t('ui.rename') }}
        </button>
        <button type="button" @click="deleteFromMenu">
          {{ t('ui.delete') }}
        </button>
      </div>
    </teleport>
  </aside>
</template>
