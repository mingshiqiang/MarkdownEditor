<script setup lang="ts">
/**
 * Themed context menu with nested submenus.
 *
 * One instance is mounted by App.vue and reads the global context-menu state.
 * Submenus reuse the same component recursively and are positioned next to
 * their parent item (flipping left/up near the viewport edges).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { closeContextMenu, runContextMenuAction, type ContextMenuItem } from '../lib/contextMenu'

defineOptions({ name: 'ContextMenu' })

interface MenuAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

const props = withDefaults(
  defineProps<{
    items: ContextMenuItem[]
    x?: number
    y?: number
    anchor?: MenuAnchor | null
    /** True for a nested panel (closes itself instead of the whole menu). */
    submenu?: boolean
  }>(),
  { x: 0, y: 0, anchor: null, submenu: false }
)

const emit = defineEmits<{
  (e: 'action', item: ContextMenuItem): void
  (e: 'back'): void
  (e: 'close'): void
}>()

const panel = ref<HTMLElement | null>(null)
const left = ref(props.x)
const top = ref(props.y)
const active = ref(-1)
const openSub = ref<{ index: number; anchor: MenuAnchor } | null>(null)
/** Reserve the check column only in menus that contain checkable items. */
const hasChecks = computed(() => props.items.some((item) => item.checked !== undefined))

const MARGIN = 6

function isRoot(): boolean {
  return !props.submenu
}

function itemElement(index: number): HTMLElement | null {
  return panel.value?.querySelector<HTMLElement>(`.ctx-item[data-index="${index}"]`) ?? null
}

function place(): void {
  const el = panel.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  if (props.submenu && props.anchor) {
    let x = props.anchor.right - 2
    if (x + rect.width > vw - MARGIN) x = props.anchor.left - rect.width + 2
    let y = props.anchor.top - 4
    if (y + rect.height > vh - MARGIN) y = props.anchor.bottom - rect.height + 4
    left.value = Math.max(MARGIN, Math.min(x, vw - rect.width - MARGIN))
    top.value = Math.max(MARGIN, Math.min(y, vh - rect.height - MARGIN))
  } else {
    left.value = Math.max(MARGIN, Math.min(props.x, vw - rect.width - MARGIN))
    top.value = Math.max(MARGIN, Math.min(props.y, vh - rect.height - MARGIN))
  }
}

/* ------------------------------- actions ---------------------------------- */

function handleAction(item: ContextMenuItem): void {
  if (isRoot()) void runContextMenuAction(item)
  else emit('action', item)
}

function closeAll(): void {
  if (isRoot()) closeContextMenu()
  else emit('close')
}

function back(): void {
  if (isRoot()) closeAll()
  else emit('back')
}

function activate(index: number): void {
  const item = props.items[index]
  if (!item || item.disabled || item.separator) return
  active.value = index
  if (item.submenu?.length) {
    openSubmenu(index)
    return
  }
  if (item.action) handleAction(item)
}

/* ------------------------------- submenus --------------------------------- */

function openSubmenu(index: number): void {
  const el = itemElement(index)
  const item = props.items[index]
  if (!el || !item?.submenu?.length) return
  const r = el.getBoundingClientRect()
  openSub.value = {
    index,
    anchor: { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }
}

function closeSubmenu(refocus = true): void {
  if (!openSub.value) return
  openSub.value = null
  if (refocus) {
    void nextTick(() => panel.value?.focus({ preventScroll: true }))
  }
}

function onHover(index: number): void {
  const item = props.items[index]
  if (!item || item.disabled || item.separator) return
  active.value = index
  if (item.submenu?.length) {
    if (openSub.value?.index !== index) openSubmenu(index)
  } else if (openSub.value) {
    closeSubmenu(false)
  }
}

/* ------------------------------- keyboard --------------------------------- */

function enabledIndices(): number[] {
  const out: number[] = []
  props.items.forEach((item, i) => {
    if (!item.separator && !item.disabled) out.push(i)
  })
  return out
}

function moveActive(delta: 1 | -1): void {
  const indices = enabledIndices()
  if (!indices.length) return
  const current = indices.indexOf(active.value)
  const next =
    current < 0
      ? delta > 0
        ? 0
        : indices.length - 1
      : (current + delta + indices.length) % indices.length
  active.value = indices[next]
  void nextTick(() => {
    itemElement(active.value)?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e: KeyboardEvent): void {
  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      e.stopPropagation()
      back()
      break
    case 'ArrowDown':
      e.preventDefault()
      e.stopPropagation()
      moveActive(1)
      break
    case 'ArrowUp':
      e.preventDefault()
      e.stopPropagation()
      moveActive(-1)
      break
    case 'Home':
      e.preventDefault()
      active.value = enabledIndices()[0] ?? -1
      break
    case 'End': {
      e.preventDefault()
      const indices = enabledIndices()
      active.value = indices[indices.length - 1] ?? -1
      break
    }
    case 'ArrowRight': {
      const item = props.items[active.value]
      if (item?.submenu?.length) {
        e.preventDefault()
        e.stopPropagation()
        openSubmenu(active.value)
      }
      break
    }
    case 'ArrowLeft':
      if (props.submenu) {
        e.preventDefault()
        e.stopPropagation()
        back()
      }
      break
    case 'Enter':
    case ' ':
      if (active.value >= 0) {
        e.preventDefault()
        e.stopPropagation()
        activate(active.value)
      }
      break
    case 'Tab':
      e.preventDefault()
      break
    default:
      break
  }
}

/* --------------------------- lifecycle & outside --------------------------- */

function onWindowMouseDown(e: MouseEvent): void {
  const target = e.target
  if (target instanceof Node && panel.value?.contains(target)) return
  closeAll()
}

function onWindowBlur(): void {
  closeAll()
}

function onWindowResize(): void {
  closeAll()
}

function onWindowScroll(e: Event): void {
  const target = e.target
  if (target instanceof Node && panel.value?.contains(target)) return
  closeAll()
}

onMounted(async () => {
  await nextTick()
  place()
  // No item is highlighted until the pointer/keyboard selects one.
  active.value = -1
  panel.value?.focus({ preventScroll: true })
  if (isRoot()) {
    window.addEventListener('mousedown', onWindowMouseDown, true)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('resize', onWindowResize)
    window.addEventListener('scroll', onWindowScroll, true)
  }
})

onBeforeUnmount(() => {
  if (!isRoot()) return
  window.removeEventListener('mousedown', onWindowMouseDown, true)
  window.removeEventListener('blur', onWindowBlur)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('scroll', onWindowScroll, true)
})
</script>

<template>
  <div
    ref="panel"
    class="ctx-panel"
    :class="{ 'ctx-panel-sub': submenu }"
    :style="{ left: left + 'px', top: top + 'px' }"
    role="menu"
    tabindex="-1"
    @keydown="onKeydown"
    @contextmenu.prevent
    @mousedown.stop
  >
    <template v-for="(item, index) in items" :key="item.id ?? index">
      <div v-if="item.separator" class="ctx-sep" role="separator"></div>
      <div v-else class="ctx-entry">
        <button
          type="button"
          class="ctx-item"
          :class="{
            active: active === index,
            danger: item.danger,
            'has-sub': !!item.submenu?.length
          }"
          :disabled="item.disabled"
          :data-index="index"
          role="menuitem"
          :aria-checked="item.checked === undefined ? undefined : item.checked"
          @mouseenter="onHover(index)"
          @click="activate(index)"
        >
          <span v-if="hasChecks" class="ctx-check" aria-hidden="true">{{
            item.checked ? '✓' : ''
          }}</span>
          <span class="ctx-label">{{ item.label }}</span>
          <span v-if="item.shortcut" class="ctx-shortcut">{{ item.shortcut }}</span>
          <span v-if="item.submenu?.length" class="ctx-arrow" aria-hidden="true">›</span>
        </button>
        <ContextMenu
          v-if="item.submenu?.length && openSub?.index === index"
          :items="item.submenu"
          :anchor="openSub.anchor"
          submenu
          @action="handleAction"
          @back="closeSubmenu"
          @close="closeAll"
        />
      </div>
    </template>
  </div>
</template>
