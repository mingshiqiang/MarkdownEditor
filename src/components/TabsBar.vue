<script setup lang="ts">
/**
 * TabsBar (F-04): multiple documents, click/middle-click, drag reorder,
 * per-tab dirty dot, context menu (close / close others / close right).
 */
import { useDocumentsStore } from '../stores/documents'
import { openContextMenu, type ContextMenuItem } from '../lib/contextMenu'
import { toast } from '../lib/bus'
import { t } from '../lib/i18n'

const documents = useDocumentsStore()

const emit = defineEmits<{
  (e: 'close', id: string): void
  (e: 'close-others', id: string): void
  (e: 'close-right', id: string): void
  (e: 'new-tab'): void
}>()

/* ------------------------------ drag reorder ------------------------------- */

let dragIndex = -1

function onDragStart(i: number, e: DragEvent): void {
  dragIndex = i
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(i))
  }
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
}

function onDrop(i: number, e: DragEvent): void {
  e.preventDefault()
  if (dragIndex >= 0 && dragIndex !== i) documents.reorder(dragIndex, i)
  dragIndex = -1
}

/* ------------------------------ mouse helpers ------------------------------ */

function onTabDown(id: string, e: MouseEvent): void {
  if (e.button === 1) {
    // middle click closes the tab
    e.preventDefault()
    emit('close', id)
  }
}

/* ------------------------------ context menu ------------------------------- */

function onContextMenu(id: string, e: MouseEvent): void {
  e.preventDefault()
  const tab = documents.tabs.find((x) => x.id === id)
  if (!tab) return
  const items: ContextMenuItem[] = [
    { id: 'close', label: t('ui.closeTab'), action: () => emit('close', id) },
    { id: 'close-others', label: t('ui.closeOthers'), action: () => emit('close-others', id) },
    { id: 'close-right', label: t('ui.closeRight'), action: () => emit('close-right', id) }
  ]
  if (tab.path) {
    items.push(
      { separator: true },
      {
        id: 'copy-path',
        label: t('ctx.copyPath'),
        action: () => {
          void window.api.clipboardWriteText(tab.path as string)
          toast(t('ui.copied'))
        }
      },
      {
        id: 'reveal',
        label: t('ctx.revealInExplorer'),
        action: () => window.api.showItemInFolder(tab.path as string)
      }
    )
  }
  items.push(
    { separator: true },
    { id: 'new', label: t('ui.newTab'), action: () => emit('new-tab') }
  )
  openContextMenu(e, items)
}
</script>

<template>
  <div class="tabs-bar" @dragover="onDragOver">
    <div
      v-for="(tab, i) in documents.tabs"
      :key="tab.id"
      class="tab"
      :class="{ active: tab.id === documents.activeId, dragging: dragIndex === i }"
      draggable="true"
      :title="tab.path ?? tab.name"
      @dragstart="onDragStart(i, $event)"
      @drop="onDrop(i, $event)"
      @dragend="dragIndex = -1"
      @mousedown="onTabDown(tab.id, $event)"
      @click="documents.activate(tab.id)"
      @contextmenu="onContextMenu(tab.id, $event)"
    >
      <span v-show="tab.dirty" class="tab-dot" aria-hidden="true"></span>
      <span class="tab-name">{{ tab.name }}</span>
      <span
        class="tab-close"
        role="button"
        :aria-label="t('ui.closeTab')"
        @mousedown.stop
        @click.stop="emit('close', tab.id)"
        >✕</span
      >
    </div>
    <button type="button" class="tab-new" :title="t('ui.newTab')" @click="emit('new-tab')">
      ＋
    </button>
  </div>
</template>
