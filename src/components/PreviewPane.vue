<script setup lang="ts">
/**
 * Pure preview mode (E-02): full-document markdown render with debounced
 * re-render, sanitized HTML, copy buttons, external & relative link clicks.
 */
import { ref, watch } from 'vue'
import { renderDoc, type RenderEnv } from '../editor/markdown/render'
import { attachImageHandlers } from '../editor/markdown/images'
import { requestOpenDoc, toast } from '../lib/bus'
import { t } from '../lib/i18n'

const props = defineProps<{
  text: string
  docDir: string
}>()

const html = ref('')
let timer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.text,
  (text) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      const env: RenderEnv = { docDir: props.docDir }
      html.value = renderDoc(text, env)
      requestAnimationFrame(() => {
        const root = document.querySelector('.preview-content') as HTMLElement | null
        if (root) attachImageHandlers(root)
      })
    }, 250)
  },
  { immediate: true }
)

function onClick(e: MouseEvent): void {
  const target = e.target as HTMLElement

  const copyBtn = target.closest('.md-copy-btn')
  if (copyBtn) {
    e.preventDefault()
    const code = copyBtn.closest('.md-code-wrap')?.querySelector('pre code')
    void window.api.clipboardWriteText(code?.textContent ?? '')
    toast(t('ui.copied'))
    return
  }

  const anchor = target.closest('a[href]') as HTMLAnchorElement | null
  if (anchor) {
    const href = anchor.getAttribute('href') || ''
    if ((e.ctrlKey || e.metaKey) && /^https?:/i.test(href)) {
      e.preventDefault()
      void window.api.openExternal(href)
    } else if (!/^(https?:|mailto:|#)/i.test(href) && /\.(md|markdown|mkd)$/i.test(href)) {
      e.preventDefault()
      if (props.docDir) {
        void window.api.resolvePath(props.docDir, href).then((abs) => {
          if (abs) requestOpenDoc(abs)
        })
      }
    } else {
      e.preventDefault() // never navigate inside the app
    }
  }
}
</script>

<template>
  <div class="preview-pane" @click="onClick">
    <!-- eslint-disable-next-line vue/no-v-html -- html is sanitized by DOMPurify in render.ts -->
    <div class="preview-content" v-html="html"></div>
  </div>
</template>
