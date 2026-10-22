<script setup lang="ts">
/**
 * Recursive file tree (F-06): expand/collapse, open documents, create /
 * rename / delete, drag & drop moving and a right-click menu.
 */
import { ref } from 'vue'
import type { FileTreeNode } from '../../shared/types'
import { useWorkspaceStore } from '../stores/workspace'

defineProps<{
  nodes: FileTreeNode[]
  depth?: number
}>()

const emit = defineEmits<{
  (e: 'open-file', path: string): void
  (e: 'context-menu', payload: { event: MouseEvent; node: FileTreeNode }): void
}>()

const workspace = useWorkspaceStore()
const dragOverPath = ref<string | null>(null)

function iconFor(node: FileTreeNode): string {
  if (node.type === 'directory') return workspace.isExpanded(node.path) ? '▾' : '▸'
  if (node.image) return '🖼'
  if (node.markdown) return 'M'
  return '·'
}

function onClick(node: FileTreeNode): void {
  if (node.type === 'directory') {
    workspace.toggle(node.path)
    return
  }
  workspace.selectedPath = node.path
  emit('open-file', node.path)
}

function onDragStart(node: FileTreeNode, e: DragEvent): void {
  e.dataTransfer?.setData('application/x-mde-path', node.path)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(node: FileTreeNode, e: DragEvent): void {
  if (node.type !== 'directory') return
  e.preventDefault()
  dragOverPath.value = node.path
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

async function onDrop(node: FileTreeNode, e: DragEvent): Promise<void> {
  dragOverPath.value = null
  if (node.type !== 'directory') return
  const from = e.dataTransfer?.getData('application/x-mde-path')
  if (!from) return
  e.preventDefault()
  e.stopPropagation()
  await workspace.moveEntry(from, node.path)
}
</script>

<template>
  <ul class="tree" :style="{ paddingLeft: depth ? '12px' : '0' }">
    <li v-for="node in nodes" :key="node.path" class="tree-item">
      <div
        class="tree-row"
        :class="{
          selected: workspace.selectedPath === node.path,
          'drag-over': dragOverPath === node.path
        }"
        draggable="true"
        @click="onClick(node)"
        @contextmenu.prevent="emit('context-menu', { event: $event, node })"
        @dragstart="onDragStart(node, $event)"
        @dragover="onDragOver(node, $event)"
        @dragleave="dragOverPath = null"
        @drop="onDrop(node, $event)"
      >
        <span class="tree-icon">{{ iconFor(node) }}</span>
        <input
          v-if="workspace.renamingPath === node.path"
          v-model="workspace.renameValue"
          class="tree-rename"
          @click.stop
          @keydown.enter.prevent="workspace.commitRename()"
          @keydown.esc.prevent="workspace.cancelRename()"
          @blur="workspace.commitRename()"
        />
        <span v-else class="tree-name" :title="node.path">{{ node.name }}</span>
      </div>
      <FileTree
        v-if="node.type === 'directory' && workspace.isExpanded(node.path) && node.children?.length"
        :nodes="node.children"
        :depth="(depth ?? 0) + 1"
        @open-file="(p) => emit('open-file', p)"
        @context-menu="(p) => emit('context-menu', p)"
      />
    </li>
  </ul>
</template>
