<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    title: string
    width?: string
    dismissible?: boolean
  }>(),
  { width: '', dismissible: true }
)

const emit = defineEmits<{
  (e: 'close'): void
}>()

function onBackdrop(e: MouseEvent): void {
  if ((e.target as HTMLElement).classList.contains('modal-backdrop') && props.dismissible) {
    emit('close')
  }
}
</script>

<template>
  <teleport to="body">
    <div class="modal-backdrop" @mousedown="onBackdrop">
      <div
        class="modal-panel"
        :style="width ? { width } : undefined"
        role="dialog"
        :aria-label="title"
      >
        <div class="modal-head">
          <span class="modal-title">{{ title }}</span>
          <button type="button" class="modal-x" aria-label="close" @click="emit('close')">✕</button>
        </div>
        <div class="modal-body">
          <slot />
        </div>
      </div>
    </div>
  </teleport>
</template>
