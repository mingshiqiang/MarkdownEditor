import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Buffer } from 'buffer'
import App from './App.vue'
import { useSettingsStore } from './stores/settings'
import { useDocumentsStore } from './stores/documents'
import { useWorkspaceStore } from './stores/workspace'
import { ensureApi } from './lib/mockApi'
import './themes/index.css'
import 'katex/dist/katex.min.css'

declare global {
  var Buffer: typeof import('buffer').Buffer
}

// The Word export (docx -> jszip) needs Node's Buffer. The renderer is
// sandboxed and has no Node globals, so a polyfill is installed here.
if (!globalThis.Buffer) globalThis.Buffer = Buffer

async function boot(): Promise<void> {
  // In Electron the preload script provides window.api; in a plain browser
  // (UI preview) we fall back to a mock so the app still renders.
  ensureApi()

  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)

  // Load persisted settings (theme/mode/locale/...) before first paint.
  const settings = useSettingsStore()
  await settings.init()

  // Dev-only handle for debugging / automated UI checks.
  if (import.meta.env.DEV) {
    ;(window as unknown as { __mdeStores?: unknown }).__mdeStores = {
      settings: useSettingsStore(),
      documents: useDocumentsStore(),
      workspace: useWorkspaceStore()
    }
  }

  app.mount('#app')
  void window.api.appReady()
}

void boot()
