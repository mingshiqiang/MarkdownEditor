<script setup lang="ts">
/**
 * Export dialog (M4): HTML / PDF / Word with PDF page options.
 */
import { computed, ref } from 'vue'
import type { ExportFormat, ImageExportOptions, PdfExportOptions } from '../../shared/types'
import type { EffectiveTheme } from '../../shared/types'
import Modal from './Modal.vue'
import { t } from '../lib/i18n'

const props = defineProps<{
  docName: string
  theme: EffectiveTheme
  docDir: string
  markdown: string
  /** Extra CSS (user theme variables) embedded in the export. */
  customCss?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'done', path: string): void
}>()

const format = ref<ExportFormat>('pdf')
const busy = ref(false)
const errorMsg = ref('')

const pdf = ref<PdfExportOptions>({
  pageSize: 'A4',
  landscape: false,
  marginType: 'custom',
  margins: { top: 64, bottom: 64, left: 72, right: 72 },
  printBackground: true,
  scale: 1,
  footer:
    '<div style="width:100%;font-size:9px;color:#888;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
})

const formats: { id: ExportFormat; label: string; hint: string }[] = [
  { id: 'pdf', label: 'ui.exportPdf', hint: 'ui.exportPdfHint' },
  { id: 'html', label: 'ui.exportHtml', hint: 'ui.exportHtmlHint' },
  { id: 'docx', label: 'ui.exportWord', hint: 'ui.exportWordHint' },
  { id: 'png', label: 'ui.exportImage', hint: 'ui.exportImageHint' }
]

const image = ref<ImageExportOptions>({ width: 820, scale: 2, background: 'light' })

const baseName = computed(
  () => props.docName.replace(/\.(md|markdown|mkd|txt)$/i, '') || 'document'
)

async function run(): Promise<void> {
  if (busy.value) return
  busy.value = true
  errorMsg.value = ''
  try {
    const { buildExportHtml, buildPrintHtml, renderExportHtml } =
      await import('../editor/export/html')
    const env = {
      docDir: props.docDir,
      theme: props.theme,
      title: props.docName,
      customCss: props.customCss
    }
    const body = await renderExportHtml(props.markdown, env)

    if (format.value === 'html') {
      const html = buildExportHtml(body, env)
      const path = await window.api.exportHtml(html, `${baseName.value}.html`)
      if (path) emit('done', path)
      return
    }
    if (format.value === 'pdf') {
      const html = buildPrintHtml(body, env, pdf.value)
      const path = await window.api.exportPdf(html, `${baseName.value}.pdf`, pdf.value)
      if (path) emit('done', path)
      return
    }
    if (format.value === 'png') {
      const html = buildExportHtml(body, env)
      const path = await window.api.exportImage(html, `${baseName.value}.png`, image.value)
      if (path) emit('done', path)
      return
    }
    const { markdownToDocx } = await import('../editor/export/docx')
    const buffer = await markdownToDocx(props.markdown, {
      title: props.docName,
      docDir: props.docDir
    })
    const path = await window.api.exportDocx(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer,
      `${baseName.value}.docx`
    )
    if (path) emit('done', path)
  } catch (err) {
    errorMsg.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function setMargin(key: 'top' | 'bottom' | 'left' | 'right', e: Event): void {
  const v = Math.max(0, Math.min(200, Number((e.target as HTMLInputElement).value) || 0))
  pdf.value.margins = { ...pdf.value.margins, [key]: v }
}
</script>

<template>
  <Modal :title="t('ui.exportTitle')" width="480px" @close="emit('close')">
    <div class="export-form">
      <div class="export-formats">
        <label
          v-for="f in formats"
          :key="f.id"
          class="export-format"
          :class="{ active: format === f.id }"
        >
          <input v-model="format" type="radio" :value="f.id" />
          <span class="export-format-label">{{ t(f.label) }}</span>
          <span class="export-format-hint">{{ t(f.hint) }}</span>
        </label>
      </div>

      <div v-if="format === 'png'" class="export-options">
        <div class="field">
          <label>{{ t('ui.exportImageWidth') }}</label>
          <input
            type="number"
            min="320"
            max="2400"
            step="10"
            :value="image.width"
            @change="
              image.width = Math.max(
                320,
                Math.min(2400, Number(($event.target as HTMLInputElement).value) || 820)
              )
            "
          />
        </div>
        <div class="field">
          <label>{{ t('ui.exportImageScale') }}</label>
          <select v-model.number="image.scale">
            <option :value="1">1x</option>
            <option :value="1.5">1.5x</option>
            <option :value="2">2x</option>
            <option :value="3">3x</option>
          </select>
        </div>
        <div class="field">
          <label>{{ t('ui.exportImageBackground') }}</label>
          <select v-model="image.background">
            <option value="light">{{ t('ui.exportBackgroundLight') }}</option>
            <option value="dark">{{ t('ui.exportBackgroundDark') }}</option>
            <option value="transparent">{{ t('ui.exportBackgroundTransparent') }}</option>
          </select>
        </div>
        <p class="export-note">{{ t('ui.exportImageNote') }}</p>
      </div>

      <div v-if="format === 'pdf'" class="export-options">
        <div class="field">
          <label>{{ t('ui.exportPageSize') }}</label>
          <select v-model="pdf.pageSize">
            <option value="A4">A4</option>
            <option value="A3">A3</option>
            <option value="Letter">Letter</option>
            <option value="Legal">Legal</option>
          </select>
        </div>
        <div class="field">
          <label class="checkbox">
            <input v-model="pdf.landscape" type="checkbox" />
            {{ t('ui.exportLandscape') }}
          </label>
        </div>
        <div class="field">
          <label>{{ t('ui.exportMargins') }} (px)</label>
          <div class="export-margins">
            <label
              >{{ t('ui.exportTop') }}
              <input
                type="number"
                min="0"
                max="200"
                :value="pdf.margins.top"
                @change="setMargin('top', $event)"
              />
            </label>
            <label
              >{{ t('ui.exportBottom') }}
              <input
                type="number"
                min="0"
                max="200"
                :value="pdf.margins.bottom"
                @change="setMargin('bottom', $event)"
              />
            </label>
            <label
              >{{ t('ui.exportLeft') }}
              <input
                type="number"
                min="0"
                max="200"
                :value="pdf.margins.left"
                @change="setMargin('left', $event)"
              />
            </label>
            <label
              >{{ t('ui.exportRight') }}
              <input
                type="number"
                min="0"
                max="200"
                :value="pdf.margins.right"
                @change="setMargin('right', $event)"
              />
            </label>
          </div>
        </div>
        <div class="field">
          <label class="checkbox">
            <input v-model="pdf.printBackground" type="checkbox" />
            {{ t('ui.exportBackground') }}
          </label>
        </div>
        <div class="field">
          <label>{{ t('ui.exportScale') }}: {{ Math.round(pdf.scale * 100) }}%</label>
          <input v-model.number="pdf.scale" type="range" min="0.5" max="2" step="0.05" />
        </div>
        <p class="export-note">{{ t('ui.exportFontNote') }}</p>
      </div>

      <p v-if="errorMsg" class="export-error">{{ errorMsg }}</p>

      <div class="export-footer">
        <button type="button" class="btn" @click="emit('close')">{{ t('ui.cancel') }}</button>
        <button type="button" class="btn primary" :disabled="busy" @click="run">
          {{ busy ? t('ui.exporting') : t('ui.exportAction') }}
        </button>
      </div>
    </div>
  </Modal>
</template>
