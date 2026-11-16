<script setup lang="ts">
/**
 * Sidebar (M3): outline and search in one collapsible panel with two views.
 */
import { onBeforeUnmount, ref } from 'vue'
import type { SearchMatch } from '../../shared/types'
import type { SidebarView } from '../stores/workspace'
import { useSettingsStore } from '../stores/settings'
import OutlineView from './OutlineView.vue'
import SearchPanel from './SearchPanel.vue'
import { t } from '../lib/i18n'

const settings = useSettingsStore()

const emit = defineEmits<{
  (e: 'jump', pos: number): void
  (e: 'open-result', match: SearchMatch): void
}>()

const view = ref<SidebarView>('outline')

/* ----------------------------- resize (drag) ------------------------------ */

/** Limits match `.sidebar-panel` in `themes/index.css`. */
const SIDEBAR_MIN_WIDTH = 180
const SIDEBAR_MAX_WIDTH = 460

function clampSidebarWidth(px: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(px)))
}

const sidebarWidth = ref(clampSidebarWidth(settings.settings.workspace.sidebarWidth))

/** Cancels an in-flight drag when the sidebar unmounts (e.g. focus mode). */
let stopResize: (() => void) | null = null

function startResize(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  stopResize?.()
  const handle = event.currentTarget as HTMLElement
  try {
    handle.setPointerCapture?.(event.pointerId)
  } catch {
    /* capture is optional (synthetic events) */
  }
  const startX = event.clientX
  const startWidth = sidebarWidth.value

  const onMove = (ev: PointerEvent): void => {
    sidebarWidth.value = clampSidebarWidth(startWidth + ev.clientX - startX)
  }
  const onEnd = (): void => {
    cleanup()
    settings.patch({ workspace: { sidebarWidth: sidebarWidth.value } })
  }
  const cleanup = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onEnd)
    window.removeEventListener('pointercancel', onEnd)
    document.body.classList.remove('sidebar-resizing')
    stopResize = null
  }

  stopResize = cleanup
  document.body.classList.add('sidebar-resizing')
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onEnd)
  window.addEventListener('pointercancel', onEnd)
}

onBeforeUnmount(() => stopResize?.())

const views: { id: SidebarView; label: string }[] = [
  { id: 'outline', label: 'ui.sidebarOutline' },
  { id: 'search', label: 'ui.sidebarSearch' }
]
</script>

<template>
  <div class="sidebar-panel" :style="{ width: `${sidebarWidth}px` }">
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

      <!-- outline -->
      <div v-if="view === 'outline'" class="sidebar-body">
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
    <div
      class="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      :aria-valuenow="sidebarWidth"
      :aria-valuemin="SIDEBAR_MIN_WIDTH"
      :aria-valuemax="SIDEBAR_MAX_WIDTH"
      @pointerdown="startResize"
    ></div>
  </div>
</template>
