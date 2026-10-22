<script setup lang="ts">
/**
 * WelcomeScreen (U-07): shown when no document is open —
 * new / open actions + recent files list.
 */
import { onMounted } from 'vue'
import logoUrl from '../assets/icon.png'
import { useDocumentsStore } from '../stores/documents'
import { t } from '../lib/i18n'

const documents = useDocumentsStore()

const emit = defineEmits<{
  (e: 'new'): void
  (e: 'open'): void
  (e: 'open-recent', path: string): void
  (e: 'clear-recent'): void
}>()

onMounted(() => {
  void documents.refreshRecent()
})

function fmtTime(ts: number): string {
  try {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch {
    return ''
  }
}
</script>

<template>
  <div class="welcome">
    <div class="welcome-card">
      <img class="welcome-logo" :src="logoUrl" alt="MarkdownEditor" />
      <h1 class="welcome-title">MarkdownEditor</h1>
      <p class="welcome-sub">{{ t('ui.welcomeSubtitle') }}</p>
      <div class="welcome-actions">
        <button type="button" class="btn primary" @click="emit('new')">
          {{ t('ui.welcomeNew') }} <span class="kbd">Ctrl N</span>
        </button>
        <button type="button" class="btn" @click="emit('open')">
          {{ t('ui.welcomeOpen') }} <span class="kbd">Ctrl O</span>
        </button>
      </div>
      <div v-if="documents.recent.length" class="welcome-recent">
        <div class="welcome-recent-head">
          <span>{{ t('ui.welcomeRecent') }}</span>
          <button type="button" class="link-btn" @click="emit('clear-recent')">
            {{ t('ui.welcomeClear') }}
          </button>
        </div>
        <ul class="recent-list">
          <li v-for="r in documents.recent" :key="r.path">
            <button type="button" class="recent-item" @click="emit('open-recent', r.path)">
              <span class="recent-name">{{ r.name }}</span>
              <span class="recent-path">{{ r.path }}</span>
              <span class="recent-time">{{ fmtTime(r.ts) }}</span>
            </button>
          </li>
        </ul>
      </div>
      <p v-else class="welcome-empty">{{ t('ui.welcomeNoRecent') }}</p>
    </div>
  </div>
</template>
