<script setup lang="ts">
/**
 * Custom title bar for the frameless main window.
 *
 * The menus are native Electron popups built from the same template as the
 * application menu. Window controls use the small, whitelisted preload API;
 * close still goes through BrowserWindow.close() and its dirty-document flow.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppMenuId } from '../../shared/types'
import { useDocumentsStore } from '../stores/documents'
import { openContextMenu, type ContextMenuItem } from '../lib/contextMenu'
import { t } from '../lib/i18n'
import logoUrl from '../assets/icon.png'
import minimizeIcon from '../../resources/min.png'
// The supplied file names describe the window state they are shown in:
// `normal.png` is the single-square maximize glyph of a restored window and
// `max.png` is the two-square restore glyph of a maximized window.
import maximizeIcon from '../../resources/normal.png'
import restoreIcon from '../../resources/max.png'
import closeIcon from '../../resources/close.png'

const documents = useDocumentsStore()
const maximized = ref(false)
let unsubscribe: (() => void) | null = null

const emit = defineEmits<{
  (e: 'maximized-change', value: boolean): void
}>()

const menus: { id: AppMenuId; label: string }[] = [
  { id: 'file', label: 'menu.file' },
  { id: 'edit', label: 'menu.edit' },
  { id: 'view', label: 'menu.view' },
  { id: 'help', label: 'menu.help' }
]

const title = computed(() => {
  const tab = documents.active
  return tab ? `${tab.dirty ? '• ' : ''}${tab.name} — MarkdownEditor` : 'MarkdownEditor'
})

function setMaximized(value: boolean): void {
  maximized.value = value
  emit('maximized-change', value)
}

async function toggleMaximize(): Promise<void> {
  setMaximized(await window.api.windowToggleMaximize())
}

async function minimizeWindow(): Promise<void> {
  await window.api.windowMinimize()
}

async function closeWindow(): Promise<void> {
  await window.api.windowClose()
}

/** Windows-style system menu on the caption area. */
function onTitleContextMenu(event: MouseEvent): void {
  event.preventDefault()
  const items: ContextMenuItem[] = [
    {
      id: 'restore',
      label: maximized.value ? t('ui.restore') : t('ui.maximize'),
      action: () => toggleMaximize()
    },
    { id: 'minimize', label: t('ui.minimize'), action: () => minimizeWindow() },
    { separator: true },
    { id: 'close', label: t('ui.close'), danger: true, action: () => closeWindow() }
  ]
  openContextMenu(event, items)
}

async function openMenu(menu: AppMenuId, event: MouseEvent): Promise<void> {
  event.preventDefault()
  event.stopPropagation()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  await window.api.popupAppMenu(menu, rect.left, rect.bottom + 2)
}

onMounted(() => {
  unsubscribe = window.api.onWindowMaximized(setMaximized)
  void window.api.windowIsMaximized().then(setMaximized)
})

onBeforeUnmount(() => {
  unsubscribe?.()
  unsubscribe = null
})
</script>

<template>
  <header
    class="title-bar"
    :class="{ maximized }"
    @dblclick="toggleMaximize"
    @contextmenu.prevent="onTitleContextMenu"
  >
    <div class="title-brand">
      <img :src="logoUrl" alt="MarkdownEditor" class="title-logo" />
    </div>

    <nav class="title-menus" aria-label="MarkdownEditor" @dblclick.stop>
      <button
        v-for="menu in menus"
        :key="menu.id"
        type="button"
        class="title-menu-button"
        @click="openMenu(menu.id, $event)"
      >
        {{ t(menu.label) }}
      </button>
    </nav>

    <div class="title-drag-region">
      <span class="title-document">{{ title }}</span>
    </div>

    <div class="window-controls" @dblclick.stop>
      <button
        type="button"
        class="window-control"
        :title="t('ui.minimize')"
        :aria-label="t('ui.minimize')"
        @click="minimizeWindow"
      >
        <img :src="minimizeIcon" alt="" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="window-control"
        :title="maximized ? t('ui.restore') : t('ui.maximize')"
        :aria-label="maximized ? t('ui.restore') : t('ui.maximize')"
        @click="toggleMaximize"
      >
        <img :src="maximized ? restoreIcon : maximizeIcon" alt="" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="window-control window-close"
        :title="t('ui.close')"
        :aria-label="t('ui.close')"
        @click="closeWindow"
      >
        <img :src="closeIcon" alt="" aria-hidden="true" />
      </button>
    </div>
  </header>
</template>
