<script setup lang="ts">
/**
 * StatusBar (U-06): words/chars/lines/reading time, cursor position,
 * mode (click cycles), theme (click toggles), encoding.
 */
import { computed } from 'vue'
import { useDocumentsStore } from '../stores/documents'
import { useSettingsStore } from '../stores/settings'
import { t, tf } from '../lib/i18n'

const documents = useDocumentsStore()
const settings = useSettingsStore()

const modeLabel = computed(() => {
  switch (settings.settings.mode) {
    case 'live':
      return t('ui.modeLive')
    case 'source':
      return t('ui.modeSource')
    default:
      return t('ui.modePreview')
  }
})

const themeLabel = computed(() => (settings.effectiveTheme === 'dark' ? 'Dark' : 'Light'))

const hasDoc = computed(() => documents.tabs.length > 0)

/** The encoding of the current document (UTF-8 for a new one). */
const encodingLabel = computed(() => {
  const tab = documents.active
  if (!tab) return 'UTF-8'
  const encoding = tab.encoding || 'utf-8'
  return encoding.toUpperCase()
})

const readTimeLabel = computed(() =>
  documents.stats.readMinutes > 0 ? tf('ui.readTime', { n: documents.stats.readMinutes }) : ''
)

const modeNext = computed<'live' | 'source' | 'preview'>(() => {
  if (settings.settings.mode === 'live') return 'source'
  if (settings.settings.mode === 'source') return 'preview'
  return 'live'
})

function cycleMode(): void {
  if (!hasDoc.value) return
  settings.setMode(modeNext.value)
}

function toggleTheme(): void {
  settings.toggleLightDark()
}
</script>

<template>
  <footer v-if="hasDoc" class="status-bar">
    <span class="sb-item sb-words"
      >{{ documents.stats.words }} {{ t('ui.words') }} · {{ documents.stats.chars }}
      {{ t('ui.chars') }} · {{ documents.stats.lines }} {{ t('ui.lines') }}</span
    >
    <span v-if="readTimeLabel" class="sb-item sb-read">{{ readTimeLabel }}</span>
    <span class="sb-spacer"></span>
    <span class="sb-item sb-cursor"
      >Ln {{ documents.cursorLn }}, Col {{ documents.cursorCol }}</span
    >
    <button type="button" class="sb-item sb-click" @click="cycleMode">{{ modeLabel }}</button>
    <button type="button" class="sb-item sb-click" @click="toggleTheme">{{ themeLabel }}</button>
    <span class="sb-item">{{ encodingLabel }}</span>
  </footer>
</template>
