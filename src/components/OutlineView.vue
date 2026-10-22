<script setup lang="ts">
/**
 * Outline view (F-08): heading tree of the active document, click to jump,
 * the heading at the caret is highlighted.
 */
import { computed } from 'vue'
import { useDocumentsStore } from '../stores/documents'
import { t } from '../lib/i18n'

const documents = useDocumentsStore()

const emit = defineEmits<{
  (e: 'jump', pos: number): void
}>()

const items = computed(() => documents.outline)

/** Index of the heading that is active for the current caret position. */
const activeIndex = computed(() => {
  let active = -1
  items.value.forEach((item, index) => {
    if (item.pos <= documents.cursorPos) active = index
  })
  return active
})

function onClick(item: { pos: number }): void {
  emit('jump', item.pos)
}
</script>

<template>
  <div class="outline">
    <p v-if="!items.length" class="sidebar-empty">{{ t('ui.outlineEmpty') }}</p>
    <ul class="outline-list">
      <li
        v-for="(item, index) in items"
        :key="item.pos"
        class="outline-item"
        :class="[`level-${item.level}`, { active: index === activeIndex }]"
        @click="onClick(item)"
      >
        <span class="outline-text">{{ item.text }}</span>
        <span class="outline-line">{{ item.line }}</span>
      </li>
    </ul>
  </div>
</template>
