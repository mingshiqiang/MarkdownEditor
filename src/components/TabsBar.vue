<script setup lang="ts">
/**
 * TabsBar (F-04): multiple documents, click/middle-click, drag reorder,
 * per-tab dirty dot, context menu (close / close others / close right).
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useDocumentsStore } from '../stores/documents'
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

const ctx = ref<{ x: number; y: number; id: string } | null>(null)

function onContextMenu(id: string, e: MouseEvent): void {
  e.preventDefault()
  ctx.value = { x: e.clientX, y: e.clientY, id }
}

function closeCtx(): void {
  ctx.value = null
}

function ctxAction(action: 'close' | 'close-others' | 'close-right' | 'new'): void {
  const c = ctx.value
  ctx.value = null
  if (!c) return
  if (action === 'close') emit('close', c.id)
  else if (action === 'close-others') emit('close-others', c.id)
  else if (action === 'close-right') emit('close-right', c.id)
  else emit('new-tab')
}

onMounted(() => {
  window.addEventListener('mousedown', closeCtx, { capture: true })
})
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', closeCtx, { capture: true } as EventListenerOptions)
})
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

    <teleport to="body">
      <div
        v-if="ctx"
        class="ctx-menu"
        :style="{ left: ctx.x + 'px', top: ctx.y + 'px' }"
        @mousedown.stop
      >
        <button type="button" @click="ctxAction('close')">{{ t('ui.closeTab') }}</button>
        <button type="button" @click="ctxAction('close-others')">{{ t('ui.closeOthers') }}</button>
        <button type="button" @click="ctxAction('close-right')">{{ t('ui.closeRight') }}</button>
        <button type="button" @click="ctxAction('new')">{{ t('ui.newTab') }}</button>
      </div>
    </teleport>
  </div>
</template>
