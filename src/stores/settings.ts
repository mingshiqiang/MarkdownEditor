import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { AppSettings, EffectiveTheme, EditorMode, ThemeSetting } from '../../shared/types'
import { assignShortcut, defaultKeymap, type KeyActionId } from '../../shared/keymap'
import { isUserThemeSetting, userThemeIdOf, type UserTheme } from '../../shared/userTheme'
import { resolveNavigatorLocale, setI18nLocale } from '../lib/i18n'
import { applyKeymap } from '../lib/shortcuts'

let persistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Make sure every setting group exists: the persisted settings file may
 * come from an older version (or a partially initialized main process).
 */
function normalizeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const base = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as AppSettings
  if (!raw) return base
  return {
    ...base,
    ...raw,
    autosave: { ...base.autosave, ...(raw.autosave ?? {}) },
    imageStore: { ...base.imageStore, ...(raw.imageStore ?? {}) },
    imageHost: { ...base.imageHost, ...(raw.imageHost ?? {}) },
    editor: { ...base.editor, ...(raw.editor ?? {}) },
    workspace: { ...base.workspace, ...(raw.workspace ?? {}) },
    tray: { ...base.tray, ...(raw.tray ?? {}) },
    updates: { ...base.updates, ...(raw.updates ?? {}) },
    keymap: { ...(raw.keymap ?? {}) }
  }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { ...DEFAULT_SETTINGS } as AppSettings,
    systemTheme: 'light' as EffectiveTheme,
    loaded: false,
    /** Themes found in the user theme folder (U-02). */
    userThemes: [] as UserTheme[]
  }),

  getters: {
    /** The user theme selected in the settings, if it still exists. */
    activeUserTheme(state): UserTheme | null {
      if (!isUserThemeSetting(state.settings.theme)) return null
      const id = userThemeIdOf(state.settings.theme)
      return state.userThemes.find((t) => t.id === id) ?? null
    },
    effectiveTheme(state): EffectiveTheme {
      // "Follow system" uses the light/dark variant; the warm/purple themes
      // are picked explicitly; a user theme uses its base family.
      const theme = state.settings.theme
      if (theme === 'auto') return state.systemTheme
      if (isUserThemeSetting(theme)) {
        const found = state.userThemes.find((t) => t.id === userThemeIdOf(theme))
        return found ? found.base : state.systemTheme
      }
      return theme
    },
    locale(): 'zh-CN' | 'en' {
      return resolveNavigatorLocale(this.settings.locale)
    }
  },

  actions: {
    async init(): Promise<void> {
      if (this.loaded) return
      try {
        const s = await window.api.getSettings()
        this.settings = normalizeSettings(s)
      } catch {
        this.settings = normalizeSettings(null)
      }
      this.systemTheme = await window.api.getSystemTheme()
      window.api.setNativeTheme(this.settings.theme)
      applyKeymap(this.settings.keymap)
      setI18nLocale(this.locale)
      await this.loadUserThemes()
      this.loaded = true
    },

    /** Re-read the user theme folder (U-02). */
    async loadUserThemes(): Promise<void> {
      try {
        this.userThemes = await window.api.listUserThemes()
      } catch {
        this.userThemes = []
      }
    },

    /** Deep-ish patch + debounced persistence. */
    patch(partial: {
      theme?: ThemeSetting
      mode?: EditorMode
      locale?: AppSettings['locale']
      autosave?: Partial<AppSettings['autosave']>
      imageStore?: Partial<AppSettings['imageStore']>
      imageHost?: Partial<AppSettings['imageHost']>
      editor?: Partial<AppSettings['editor']>
      workspace?: Partial<AppSettings['workspace']>
      tray?: Partial<AppSettings['tray']>
      updates?: Partial<AppSettings['updates']>
      keymap?: AppSettings['keymap']
    }): void {
      if (partial.theme) {
        this.settings.theme = partial.theme
        void window.api.setNativeTheme(partial.theme)
      }
      if (partial.mode) this.settings.mode = partial.mode
      if (partial.locale) {
        this.settings.locale = partial.locale
        setI18nLocale(this.locale)
      }
      if (partial.autosave) Object.assign(this.settings.autosave, partial.autosave)
      if (partial.imageStore) Object.assign(this.settings.imageStore, partial.imageStore)
      if (partial.imageHost) Object.assign(this.settings.imageHost, partial.imageHost)
      if (partial.editor) Object.assign(this.settings.editor, partial.editor)
      if (partial.workspace) Object.assign(this.settings.workspace, partial.workspace)
      if (partial.tray) Object.assign(this.settings.tray, partial.tray)
      if (partial.updates) Object.assign(this.settings.updates, partial.updates)
      if (partial.keymap) {
        this.settings.keymap = { ...partial.keymap }
        applyKeymap(this.settings.keymap)
      }
      this.schedulePersist()
    },

    /**
     * Bind `accel` to an action ('' unbinds). If another action owns the key,
     * the two swap keys. Returns the action that was swapped, if any.
     */
    setShortcut(id: KeyActionId, accel: string): KeyActionId | null {
      const result = assignShortcut(this.settings.keymap, id, accel)
      this.patch({ keymap: result.overrides })
      return result.swapped
    },

    /** Restore an action's default key (swapping if another action holds it). */
    resetShortcut(id: KeyActionId): KeyActionId | null {
      return this.setShortcut(id, defaultKeymap()[id])
    },

    resetShortcuts(): void {
      this.patch({ keymap: {} })
    },

    toggleSidebar(): void {
      this.patch({ workspace: { sidebarVisible: !this.settings.workspace.sidebarVisible } })
    },

    toggleFocusMode(): void {
      this.patch({ workspace: { focusMode: !this.settings.workspace.focusMode } })
    },

    toggleTypewriterMode(): void {
      this.patch({ workspace: { typewriterMode: !this.settings.workspace.typewriterMode } })
    },

    toggleSplitView(): void {
      this.patch({ workspace: { splitView: !this.settings.workspace.splitView } })
    },

    setSecondDoc(id: string): void {
      this.patch({ workspace: { secondDocId: id } })
    },

    setSystemTheme(theme: EffectiveTheme): void {
      this.systemTheme = theme
    },

    setMode(mode: EditorMode): void {
      if (this.settings.mode === mode) return
      this.patch({ mode })
    },

    cycleMode(): EditorMode {
      const order: EditorMode[] = ['live', 'source', 'preview']
      const next = order[(order.indexOf(this.settings.mode) + 1) % order.length]
      this.setMode(next)
      return next
    },

    toggleLightDark(): void {
      this.patch({ theme: this.effectiveTheme === 'dark' ? 'light' : 'dark' })
    },

    schedulePersist(): void {
      if (persistTimer) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => {
        persistTimer = null
        // The store state is a reactive Proxy, which cannot be structured-cloned
        // for IPC -> send a plain copy.
        void window.api.setSettings(plainSettings(this.settings)).then((s: AppSettings) => {
          // Adopt server-normalized values (e.g. default global dir).
          this.settings = normalizeSettings(s)
        })
      }, 400)
    }
  }
})

/** Plain (non-reactive) copy of the settings, safe for IPC. */
export function plainSettings(settings: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(settings)) as AppSettings
}
