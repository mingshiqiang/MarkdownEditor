<script setup lang="ts">
/**
 * Workspace search (F-09): search by file name or by content; clicking a
 * result opens the document (and jumps to the matching line for content
 * matches).
 */
import { computed, watch } from 'vue'
import type { SearchMatch } from '../../shared/types'
import { useWorkspaceStore } from '../stores/workspace'
import { t } from '../lib/i18n'

const workspace = useWorkspaceStore()

const emit = defineEmits<{
  (e: 'open-result', match: SearchMatch): void
}>()

let debounce: ReturnType<typeof setTimeout> | null = null

watch(
  () => workspace.searchQuery,
  () => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      void workspace.runSearch()
    }, 250)
  }
)

const resultLabel = computed(() =>
  workspace.searchMode === 'content'
    ? `${workspace.searchResults.length} ${t('ui.searchMatches')}`
    : `${workspace.searchResults.length} ${t('ui.searchFiles')}`
)

function setMode(mode: 'name' | 'content'): void {
  workspace.searchMode = mode
  void workspace.runSearch()
}
</script>

<template>
  <div class="search-panel">
    <div class="search-row">
      <input
        v-model="workspace.searchQuery"
        class="search-input"
        :placeholder="t('ui.searchPlaceholder')"
        @keydown.esc="workspace.clearSearch()"
      />
      <div class="search-modes">
        <button
          type="button"
          :class="{ active: workspace.searchMode === 'name' }"
          @click="setMode('name')"
        >
          {{ t('ui.searchByName') }}
        </button>
        <button
          type="button"
          :class="{ active: workspace.searchMode === 'content' }"
          @click="setMode('content')"
        >
          {{ t('ui.searchByContent') }}
        </button>
      </div>
    </div>
    <div v-if="workspace.searchQuery" class="search-status">
      {{ workspace.searching ? t('ui.searching') : resultLabel }}
    </div>
    <ul v-if="workspace.searchResults.length" class="search-results">
      <li
        v-for="(match, index) in workspace.searchResults"
        :key="match.path + ':' + match.line + ':' + index"
        class="search-result"
        @click="emit('open-result', match)"
      >
        <span class="search-file">{{ match.name }}</span>
        <span v-if="match.line" class="search-line">{{ match.line }}</span>
        <span class="search-preview">{{ match.preview }}</span>
      </li>
    </ul>
    <p v-else-if="workspace.searchQuery && !workspace.searching" class="sidebar-empty">
      {{ t('ui.searchEmpty') }}
    </p>
  </div>
</template>
