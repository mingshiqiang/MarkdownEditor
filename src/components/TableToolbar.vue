<script setup lang="ts">
/**
 * Floating table toolbar (E-05): shown while the caret is inside a table.
 * Row/column operations, alignment (written back to the `:---:` markers)
 * and a column-width reset.
 */
import { computed } from 'vue'
import type { TableOp } from '../editor/tableOps'
import type { Align } from '../editor/tables'
import { t } from '../lib/i18n'

const props = defineProps<{
  /** Active cell: row 0 = header, 1..n = body rows. */
  cell: { row: number; col: number }
  columns: number
  rows: number
  align: Align
}>()

const emit = defineEmits<{ (e: 'op', op: TableOp): void }>()

const inHeader = computed(() => props.cell.row === 0)

function op(next: TableOp): void {
  emit('op', next)
}
</script>

<template>
  <div class="table-toolbar" role="toolbar" @mousedown.prevent>
    <button
      type="button"
      :title="t('ui.tableAddRow')"
      @click="op({ kind: 'row-add', where: 'above' })"
    >
      ＋<span class="tt-sub">行↑</span>
    </button>
    <button
      type="button"
      :title="t('ui.tableAddRow')"
      @click="op({ kind: 'row-add', where: 'below' })"
    >
      ＋<span class="tt-sub">行↓</span>
    </button>
    <button
      type="button"
      :title="t('ui.tableDelRow')"
      :disabled="inHeader || rows === 0"
      @click="op({ kind: 'row-remove' })"
    >
      －<span class="tt-sub">行</span>
    </button>
    <span class="tt-sep"></span>
    <button
      type="button"
      :title="t('ui.tableAddCol')"
      @click="op({ kind: 'col-add', where: 'left' })"
    >
      ＋<span class="tt-sub">列←</span>
    </button>
    <button
      type="button"
      :title="t('ui.tableAddCol')"
      @click="op({ kind: 'col-add', where: 'right' })"
    >
      ＋<span class="tt-sub">列→</span>
    </button>
    <button
      type="button"
      :title="t('ui.tableDelCol')"
      :disabled="columns <= 1"
      @click="op({ kind: 'col-remove' })"
    >
      －<span class="tt-sub">列</span>
    </button>
    <span class="tt-sep"></span>
    <button
      type="button"
      :title="t('ui.tableMoveRowUp')"
      :disabled="inHeader"
      @click="op({ kind: 'row-move', dir: -1 })"
    >
      ↑
    </button>
    <button
      type="button"
      :title="t('ui.tableMoveRowDown')"
      :disabled="inHeader"
      @click="op({ kind: 'row-move', dir: 1 })"
    >
      ↓
    </button>
    <button
      type="button"
      :title="t('ui.tableMoveColLeft')"
      :disabled="cell.col <= 0"
      @click="op({ kind: 'col-move', dir: -1 })"
    >
      ←
    </button>
    <button
      type="button"
      :title="t('ui.tableMoveColRight')"
      :disabled="cell.col >= columns - 1"
      @click="op({ kind: 'col-move', dir: 1 })"
    >
      →
    </button>
    <span class="tt-sep"></span>
    <button
      type="button"
      :title="t('ui.tableAlignLeft')"
      :class="{ active: align === 'left' }"
      @click="op({ kind: 'align', align: 'left' })"
    >
      ≡
    </button>
    <button
      type="button"
      :title="t('ui.tableAlignCenter')"
      :class="{ active: align === 'center' }"
      @click="op({ kind: 'align', align: 'center' })"
    >
      ≡
    </button>
    <button
      type="button"
      :title="t('ui.tableAlignRight')"
      :class="{ active: align === 'right' }"
      @click="op({ kind: 'align', align: 'right' })"
    >
      ≡
    </button>
    <span class="tt-sep"></span>
    <button type="button" :title="t('ui.tableResetWidth')" @click="op({ kind: 'reset-widths' })">
      ↺
    </button>
  </div>
</template>
