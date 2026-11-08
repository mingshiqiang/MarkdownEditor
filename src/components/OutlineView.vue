<script setup lang="ts">
/**
 * Outline view (F-08): heading tree of the active document, click to jump,
 * the heading at the caret is highlighted. Headings with sub-headings can be
 * collapsed and expanded.
 */
import { computed, ref, watch } from 'vue'
import { useDocumentsStore } from '../stores/documents'
import { outlineRows, type OutlineItem } from '../editor/outline'
import { t } from '../lib/i18n'

const documents = useDocumentsStore()

const emit = defineEmits<{
  (e: 'jump', pos: number): void
}>()

const items = computed(() => documents.outline)

/** Folded headings per document; survives switching sidebar views. */
const collapsedByDoc = new Map<string, Set<string>>()

const collapsed = ref<ReadonlySet<string>>(new Set())

watch(
  () => documents.activeId,
  (id) => {
    collapsed.value = id ? (collapsedByDoc.get(id) ?? new Set()) : new Set()
  },
  { immediate: true }
)

const rows = computed(() => outlineRows(items.value, collapsed.value))

/** Index of the visible heading that is active for the caret position. */
const activeIndex = computed(() => {
  let active = -1
  for (const row of rows.value) {
    if (row.item.pos <= documents.cursorPos) active = row.index
  }
  return active
})

function toggleFold(key: string): void {
  const next = new Set(collapsed.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  collapsed.value = next
  const id = documents.activeId
  if (id) collapsedByDoc.set(id, next)
}

function onClick(item: OutlineItem): void {
  emit('jump', item.pos)
}
</script>

<template>
  <div class="outline">
    <p v-if="!items.length" class="sidebar-empty">{{ t('ui.outlineEmpty') }}</p>
    <ul class="outline-list">
      <li
        v-for="row in rows"
        :key="row.key"
        class="outline-item"
        :class="[`level-${row.item.level}`, { active: row.index === activeIndex }]"
        @click="onClick(row.item)"
      >
        <button
          v-if="row.hasChildren"
          type="button"
          class="outline-toggle"
          :title="row.collapsed ? t('ui.outlineExpand') : t('ui.outlineCollapse')"
          :aria-expanded="!row.collapsed"
          @click.stop="toggleFold(row.key)"
        >
          {{ row.collapsed ? '▸' : '▾' }}
        </button>
        <span v-else class="outline-toggle-spacer" aria-hidden="true"></span>
        <span class="outline-text">{{ row.item.text }}</span>
        <span class="outline-line">{{ row.item.line }}</span>
      </li>
    </ul>
  </div>
</template>
