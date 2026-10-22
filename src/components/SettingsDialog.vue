<script setup lang="ts">
/**
 * Preferences dialog: appearance, editor typography, image storage, keyboard
 * shortcuts and auto save. Changes are applied and persisted immediately.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { DEFAULT_SETTINGS } from '../../shared/types'
import type { AppSettings, ThemeSetting } from '../../shared/types'
import {
  acceleratorFromEvent,
  displayAccelerator,
  KEY_ACTIONS,
  resolveKeymap,
  type KeyActionId
} from '../../shared/keymap'
import { isUserThemeSetting } from '../../shared/userTheme'
import { useSettingsStore } from '../stores/settings'
import { requestOpenDoc, toast } from '../lib/bus'
import { t, tf } from '../lib/i18n'
import { IS_MAC, setShortcutsSuspended } from '../lib/shortcuts'
import Modal from './Modal.vue'

const settings = useSettingsStore()
const emit = defineEmits<{ (e: 'close'): void }>()

type TabId = 'appearance' | 'editor' | 'images' | 'shortcuts' | 'system'
const tabs: { id: TabId; label: string }[] = [
  { id: 'appearance', label: 'ui.tabAppearance' },
  { id: 'editor', label: 'ui.tabEditor' },
  { id: 'images', label: 'ui.tabImages' },
  { id: 'shortcuts', label: 'ui.tabShortcuts' },
  { id: 'system', label: 'ui.tabSystem' }
]
const tab = ref<TabId>('appearance')

const theme = ref<string>(settings.settings.theme)
const locale = ref(settings.settings.locale)
const imageMode = ref(settings.settings.imageStore.mode)
const autosaveEnabled = ref(settings.settings.autosave.enabled)
const autosaveInterval = ref(settings.settings.autosave.intervalSec)
const autosaveOnBlur = ref(settings.settings.autosave.onBlur)
const fontFamily = ref(settings.settings.editor.fontFamily)
const monoFontFamily = ref(settings.settings.editor.monoFontFamily)
const fontSize = ref(settings.settings.editor.fontSize)
const lineHeight = ref(settings.settings.editor.lineHeight)
const contentMaxWidth = ref(settings.settings.editor.contentMaxWidth)
const spellcheck = ref(settings.settings.editor.spellcheck)
const spellcheckLang = ref(settings.settings.editor.spellcheckLang)
const picking = ref(false)

const imageDir = computed(() => settings.settings.imageStore.globalDir)
const imageHostEnabled = ref(settings.settings.imageHost.enabled)
const imageHostUrl = ref(settings.settings.imageHost.url)
const imageHostField = ref(settings.settings.imageHost.field)
const imageHostHeaders = ref(settings.settings.imageHost.headers)
const imageHostResponsePath = ref(settings.settings.imageHost.responsePath)
const trayEnabled = ref(settings.settings.tray.enabled)
const trayCloseToTray = ref(settings.settings.tray.closeToTray)
const updateAutoCheck = ref(settings.settings.updates.autoCheck)
const updateFeedUrl = ref(settings.settings.updates.feedUrl)

function setTray(patch: Partial<AppSettings['tray']>): void {
  if (patch.enabled !== undefined) trayEnabled.value = patch.enabled
  if (patch.closeToTray !== undefined) trayCloseToTray.value = patch.closeToTray
  settings.patch({ tray: patch })
}

function setUpdates(patch: Partial<AppSettings['updates']>): void {
  if (patch.autoCheck !== undefined) updateAutoCheck.value = patch.autoCheck
  if (patch.feedUrl !== undefined) updateFeedUrl.value = patch.feedUrl
  settings.patch({ updates: patch })
}

async function checkUpdates(): Promise<void> {
  await window.api.checkForUpdates()
}

function setImageHost(patch: Partial<AppSettings['imageHost']>): void {
  if (patch.enabled !== undefined) imageHostEnabled.value = patch.enabled
  if (patch.url !== undefined) imageHostUrl.value = patch.url
  if (patch.field !== undefined) imageHostField.value = patch.field
  if (patch.headers !== undefined) imageHostHeaders.value = patch.headers
  if (patch.responsePath !== undefined) imageHostResponsePath.value = patch.responsePath
  settings.patch({ imageHost: patch })
}
const userThemes = computed(() => settings.userThemes)

onMounted(() => {
  // Pick up themes that were added or edited since the last visit.
  void settings.loadUserThemes()
  void fixDialogHeight()
})

const settingsBody = ref<HTMLElement | null>(null)
/** Fixed height of the tab area. */
const bodyHeight = ref<number | null>(null)
const bodyStyle = computed(() =>
  bodyHeight.value ? { height: `${bodyHeight.value}px` } : undefined
)

/**
 * The dialog keeps the same height on every tab. The shortcut table is the
 * tallest one, so it defines the height of the (scrollable) tab area.
 */
async function fixDialogHeight(): Promise<void> {
  const previous = tab.value
  tab.value = 'shortcuts'
  await nextTick()
  // The body holds nothing but the section, so its scroll height is the
  // exact height of the tallest tab (margins included).
  const body = settingsBody.value
  if (body && body.scrollHeight > 0) bodyHeight.value = body.scrollHeight
  tab.value = previous
}

async function pickGlobalDir(): Promise<void> {
  if (picking.value) return
  picking.value = true
  try {
    const dir = await window.api.pickDirectory()
    if (dir) settings.patch({ imageStore: { globalDir: dir } })
  } finally {
    picking.value = false
  }
}

const BUILTIN_THEMES = ['auto', 'light', 'light-warm', 'dark', 'dark-purple']

function setTheme(next: string): void {
  if (!BUILTIN_THEMES.includes(next) && !isUserThemeSetting(next)) return
  theme.value = next
  settings.patch({ theme: next as ThemeSetting })
}

async function openThemeFolder(): Promise<void> {
  await window.api.openUserThemesFolder()
}

async function createExampleTheme(): Promise<void> {
  const file = await window.api.createExampleUserTheme()
  if (!file) {
    toast(t('ui.themeExampleFailed'))
    return
  }
  await settings.loadUserThemes()
  toast(t('ui.themeExampleCreated'))
  requestOpenDoc(file)
}

async function reloadThemes(): Promise<void> {
  await settings.loadUserThemes()
  toast(t('ui.themeReloaded'))
}

function setLocale(next: 'auto' | 'zh-CN' | 'en'): void {
  locale.value = next
  settings.patch({ locale: next })
}

function setImageMode(next: 'assets' | 'global' | 'none'): void {
  imageMode.value = next
  settings.patch({ imageStore: { mode: next } })
}

function setAutosaveEnabled(v: boolean): void {
  autosaveEnabled.value = v
  settings.patch({ autosave: { enabled: v } })
}

function setAutosaveOnBlur(v: boolean): void {
  autosaveOnBlur.value = v
  settings.patch({ autosave: { onBlur: v } })
}

function onIntervalInput(e: Event): void {
  const v = Math.max(5, Math.min(600, Number((e.target as HTMLInputElement).value) || 30))
  autosaveInterval.value = v
  ;(e.target as HTMLInputElement).value = String(v)
  settings.patch({ autosave: { intervalSec: v } })
}

function onFontFamilyInput(e: Event): void {
  fontFamily.value = (e.target as HTMLInputElement).value
  settings.patch({ editor: { fontFamily: fontFamily.value } })
}

function onMonoFontFamilyInput(e: Event): void {
  monoFontFamily.value = (e.target as HTMLInputElement).value
  settings.patch({ editor: { monoFontFamily: monoFontFamily.value } })
}

function onFontSizeInput(e: Event): void {
  const v = Math.max(10, Math.min(40, Number((e.target as HTMLInputElement).value) || 16))
  fontSize.value = v
  settings.patch({ editor: { fontSize: v } })
}

function onLineHeightInput(e: Event): void {
  const v = Math.max(1, Math.min(3, Number((e.target as HTMLInputElement).value) || 1.7))
  lineHeight.value = v
  settings.patch({ editor: { lineHeight: v } })
}

function onMaxWidthInput(e: Event): void {
  const v = Math.max(400, Math.min(2000, Number((e.target as HTMLInputElement).value) || 820))
  contentMaxWidth.value = v
  settings.patch({ editor: { contentMaxWidth: v } })
}

function setSpellcheck(v: boolean): void {
  spellcheck.value = v
  settings.patch({ editor: { spellcheck: v } })
}

function setSpellcheckLang(v: string): void {
  spellcheckLang.value = v
  settings.patch({ editor: { spellcheckLang: v } })
}

function resetDefaults(): void {
  theme.value = DEFAULT_SETTINGS.theme
  locale.value = DEFAULT_SETTINGS.locale
  imageMode.value = DEFAULT_SETTINGS.imageStore.mode
  autosaveEnabled.value = DEFAULT_SETTINGS.autosave.enabled
  autosaveInterval.value = DEFAULT_SETTINGS.autosave.intervalSec
  autosaveOnBlur.value = DEFAULT_SETTINGS.autosave.onBlur
  fontFamily.value = DEFAULT_SETTINGS.editor.fontFamily
  monoFontFamily.value = DEFAULT_SETTINGS.editor.monoFontFamily
  fontSize.value = DEFAULT_SETTINGS.editor.fontSize
  lineHeight.value = DEFAULT_SETTINGS.editor.lineHeight
  contentMaxWidth.value = DEFAULT_SETTINGS.editor.contentMaxWidth
  spellcheck.value = DEFAULT_SETTINGS.editor.spellcheck
  spellcheckLang.value = DEFAULT_SETTINGS.editor.spellcheckLang
  settings.patch({
    theme: DEFAULT_SETTINGS.theme,
    locale: DEFAULT_SETTINGS.locale,
    autosave: { ...DEFAULT_SETTINGS.autosave },
    imageStore: { mode: DEFAULT_SETTINGS.imageStore.mode },
    editor: { ...DEFAULT_SETTINGS.editor }
  })
  toast(t('ui.settingsApplied'))
}

/* ------------------------------- shortcuts -------------------------------- */

const shortcutGroups = ['file', 'edit', 'view', 'markdown'] as const
const resolved = computed(() => resolveKeymap(settings.settings.keymap))
const rowsByGroup = computed(() =>
  shortcutGroups.map((group) => ({
    group,
    rows: KEY_ACTIONS.filter((d) => d.group === group).map((d) => ({
      id: d.id as KeyActionId,
      accel: resolved.value[d.id as KeyActionId]
    }))
  }))
)

const recordingId = ref<KeyActionId | null>(null)
const recordHint = ref('')

function label(id: KeyActionId): string {
  return t(`shortcuts.${id}`)
}

function isOverridden(id: KeyActionId): boolean {
  return Object.prototype.hasOwnProperty.call(settings.settings.keymap, id)
}

function startRecording(id: KeyActionId): void {
  if (recordingId.value) stopRecording()
  recordingId.value = id
  recordHint.value = t('ui.shortcutHint')
  // Menu accelerators are removed while recording so the combination reaches us.
  setShortcutsSuspended(true)
  void window.api.setAcceleratorsSuspended(true)
  window.addEventListener('keydown', onRecordKey, { capture: true })
}

function stopRecording(): void {
  window.removeEventListener('keydown', onRecordKey, { capture: true } as EventListenerOptions)
  recordingId.value = null
  recordHint.value = ''
  setShortcutsSuspended(false)
  void window.api.setAcceleratorsSuspended(false)
}

function onRecordKey(e: KeyboardEvent): void {
  const id = recordingId.value
  if (!id) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    stopRecording()
    return
  }
  if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    settings.setShortcut(id, '')
    stopRecording()
    return
  }
  const accel = acceleratorFromEvent(e, IS_MAC)
  if (!accel) {
    recordHint.value = t('ui.shortcutInvalid')
    return
  }
  const swapped = settings.setShortcut(id, accel)
  if (swapped) toast(tf('ui.shortcutSwapped', { name: label(swapped) }))
  stopRecording()
}

function clearShortcut(id: KeyActionId): void {
  settings.setShortcut(id, '')
}

function resetShortcut(id: KeyActionId): void {
  settings.resetShortcut(id)
}

function resetAllShortcuts(): void {
  settings.resetShortcuts()
  toast(t('ui.settingsApplied'))
}

function shortcutText(accel: string): string {
  return accel ? displayAccelerator(accel, IS_MAC) : t('ui.shortcutNone')
}

onBeforeUnmount(() => {
  if (recordingId.value) stopRecording()
})
</script>

<template>
  <Modal :title="t('ui.preferencesTitle')" width="620px" @close="emit('close')">
    <div class="settings-form">
      <nav class="settings-tabs" role="tablist">
        <button
          v-for="item in tabs"
          :key="item.id"
          type="button"
          role="tab"
          class="settings-tab"
          :class="{ active: tab === item.id }"
          :aria-selected="tab === item.id"
          @click="tab = item.id"
        >
          {{ t(item.label) }}
        </button>
      </nav>

      <div ref="settingsBody" class="settings-body" :style="bodyStyle">
        <section v-if="tab === 'appearance'">
          <div class="field">
            <label>{{ t('ui.theme') }}</label>
            <select :value="theme" @change="setTheme(($event.target as HTMLSelectElement).value)">
              <option value="auto">{{ t('ui.themeAuto') }}</option>
              <option value="light">{{ t('ui.themeLight') }}</option>
              <option value="light-warm">{{ t('ui.themeLightWarm') }}</option>
              <option value="dark">{{ t('ui.themeDark') }}</option>
              <option value="dark-purple">{{ t('ui.themeDarkPurple') }}</option>
              <optgroup v-if="userThemes.length" :label="t('ui.themeUserGroup')">
                <option v-for="ut in userThemes" :key="ut.id" :value="`user:${ut.id}`">
                  {{ ut.name }}{{ ut.warnings.length ? ` (${ut.warnings.length})` : '' }}
                </option>
              </optgroup>
            </select>
            <div class="theme-actions">
              <button type="button" class="btn sm" @click="openThemeFolder">
                {{ t('ui.themeOpenFolder') }}
              </button>
              <button type="button" class="btn sm" @click="createExampleTheme">
                {{ t('ui.themeCreateExample') }}
              </button>
              <button type="button" class="btn sm" @click="reloadThemes">
                {{ t('ui.themeReload') }}
              </button>
            </div>
            <p class="field-hint">{{ t('ui.themeUserHint') }}</p>
          </div>
          <div class="field">
            <label>{{ t('ui.language') }}</label>
            <div class="radio-row">
              <label class="radio"
                ><input type="radio" :checked="locale === 'auto'" @change="setLocale('auto')" />{{
                  t('ui.languageAuto')
                }}</label
              >
              <label class="radio"
                ><input
                  type="radio"
                  :checked="locale === 'zh-CN'"
                  @change="setLocale('zh-CN')"
                />简体中文</label
              >
              <label class="radio"
                ><input
                  type="radio"
                  :checked="locale === 'en'"
                  @change="setLocale('en')"
                />English</label
              >
            </div>
          </div>
        </section>

        <section v-if="tab === 'editor'">
          <div class="field">
            <label>{{ t('ui.fontSize') }}</label>
            <div class="size-row">
              <input
                type="range"
                min="10"
                max="40"
                step="1"
                :value="fontSize"
                @input="onFontSizeInput"
              />
              <input type="number" min="10" max="40" :value="fontSize" @change="onFontSizeInput" />
              <span class="size-preview" :style="{ fontSize: fontSize + 'px' }">Aa</span>
            </div>
          </div>
          <div class="field">
            <label>{{ t('ui.fontFamily') }}</label>
            <input type="text" :value="fontFamily" @change="onFontFamilyInput" />
          </div>
          <div class="field">
            <label>{{ t('ui.monoFontFamily') }}</label>
            <input type="text" :value="monoFontFamily" @change="onMonoFontFamilyInput" />
          </div>
          <div class="field-grid">
            <div class="field">
              <label>{{ t('ui.lineHeight') }}</label>
              <input
                type="number"
                min="1"
                max="3"
                step="0.1"
                :value="lineHeight"
                @change="onLineHeightInput"
              />
            </div>
            <div class="field">
              <label>{{ t('ui.contentMaxWidth') }}</label>
              <input
                type="number"
                min="400"
                max="2000"
                step="20"
                :value="contentMaxWidth"
                @change="onMaxWidthInput"
              />
            </div>
          </div>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="spellcheck"
                @change="setSpellcheck(($event.target as HTMLInputElement).checked)"
              />
              {{ t('ui.spellcheck') }}
            </label>
            <div v-if="spellcheck" class="field-grid">
              <div class="field">
                <label>{{ t('ui.spellcheckLang') }}</label>
                <select
                  :value="spellcheckLang"
                  @change="setSpellcheckLang(($event.target as HTMLSelectElement).value)"
                >
                  <option value="en-US">English (US)</option>
                  <option value="en-GB">English (UK)</option>
                  <option value="en-CA">English (Canada)</option>
                  <option value="en-AU">English (Australia)</option>
                </select>
              </div>
            </div>
            <p class="field-hint">{{ t('ui.spellcheckHint') }}</p>
          </div>

          <h3 class="settings-subhead">{{ t('ui.autoSave') }}</h3>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="autosaveEnabled"
                @change="setAutosaveEnabled(($event.target as HTMLInputElement).checked)"
              />
              {{ t('ui.autoSaveEnabled') }}
            </label>
          </div>
          <div class="field">
            <label>{{ t('ui.autoSaveInterval') }}</label>
            <input
              type="number"
              min="5"
              max="600"
              :value="autosaveInterval"
              @change="onIntervalInput"
            />
          </div>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="autosaveOnBlur"
                @change="setAutosaveOnBlur(($event.target as HTMLInputElement).checked)"
              />
              {{ t('ui.autoSaveOnBlur') }}
            </label>
          </div>
        </section>

        <section v-if="tab === 'images'">
          <div class="field">
            <label>{{ t('ui.imageMode') }}</label>
            <div class="radio-col">
              <label class="radio"
                ><input
                  type="radio"
                  :checked="imageMode === 'assets'"
                  @change="setImageMode('assets')"
                />{{ t('ui.imageAssets') }}</label
              >
              <label class="radio"
                ><input
                  type="radio"
                  :checked="imageMode === 'global'"
                  @change="setImageMode('global')"
                />{{ t('ui.imageGlobal') }}</label
              >
              <label class="radio"
                ><input
                  type="radio"
                  :checked="imageMode === 'none'"
                  @change="setImageMode('none')"
                />{{ t('ui.imageNone') }}</label
              >
            </div>
          </div>
          <div class="field">
            <label>{{ t('ui.imageGlobalDir') }}</label>
            <div class="dir-row">
              <input type="text" :value="imageDir" readonly />
              <button type="button" class="btn sm" :disabled="picking" @click="pickGlobalDir">
                {{ t('ui.pickDir') }}
              </button>
            </div>
            <p class="field-hint">{{ t('ui.imageDirHint') }}</p>
          </div>

          <h3 class="settings-subhead">{{ t('ui.imageHost') }}</h3>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="imageHostEnabled"
                @change="setImageHost({ enabled: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('ui.imageHostEnabled') }}
            </label>
          </div>
          <div class="field">
            <label>{{ t('ui.imageHostUrl') }}</label>
            <input
              type="text"
              :value="imageHostUrl"
              placeholder="https://example.com/upload"
              @change="setImageHost({ url: ($event.target as HTMLInputElement).value })"
            />
          </div>
          <div class="field-grid">
            <div class="field">
              <label>{{ t('ui.imageHostField') }}</label>
              <input
                type="text"
                :value="imageHostField"
                @change="setImageHost({ field: ($event.target as HTMLInputElement).value })"
              />
            </div>
            <div class="field">
              <label>{{ t('ui.imageHostResponsePath') }}</label>
              <input
                type="text"
                :value="imageHostResponsePath"
                @change="setImageHost({ responsePath: ($event.target as HTMLInputElement).value })"
              />
            </div>
          </div>
          <div class="field">
            <label>{{ t('ui.imageHostHeaders') }}</label>
            <textarea
              rows="2"
              :value="imageHostHeaders"
              @change="setImageHost({ headers: ($event.target as HTMLTextAreaElement).value })"
            ></textarea>
          </div>
          <p class="field-hint">{{ t('ui.imageHostHint') }}</p>
        </section>

        <section v-if="tab === 'shortcuts'" class="shortcut-section">
          <p class="field-hint">{{ t('ui.shortcutsIntro') }}</p>
          <div class="kb-table-wrap">
            <table class="kb-table">
              <tbody v-for="block in rowsByGroup" :key="block.group">
                <tr class="kb-group-row">
                  <th colspan="3">{{ t(`ui.shortcutGroup.${block.group}`) }}</th>
                </tr>
                <tr v-for="row in block.rows" :key="row.id">
                  <td class="kb-label">{{ label(row.id) }}</td>
                  <td class="kb-keys">
                    <span v-if="recordingId === row.id" class="kb-recording">{{ recordHint }}</span>
                    <kbd v-else class="kbd" :class="{ 'kb-empty': !row.accel }">{{
                      shortcutText(row.accel)
                    }}</kbd>
                  </td>
                  <td class="kb-actions">
                    <button type="button" class="btn sm" @click="startRecording(row.id)">
                      {{ t('ui.shortcutChange') }}
                    </button>
                    <button
                      type="button"
                      class="btn sm"
                      :disabled="!row.accel"
                      @click="clearShortcut(row.id)"
                    >
                      {{ t('ui.shortcutClear') }}
                    </button>
                    <button
                      type="button"
                      class="btn sm"
                      :disabled="!isOverridden(row.id)"
                      @click="resetShortcut(row.id)"
                    >
                      {{ t('ui.shortcutReset') }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="shortcut-footer">
            <button type="button" class="btn" @click="resetAllShortcuts">
              {{ t('ui.shortcutResetAll') }}
            </button>
          </div>
        </section>

        <section v-if="tab === 'system'">
          <h3 class="settings-subhead">{{ t('ui.tray') }}</h3>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="trayEnabled"
                @change="setTray({ enabled: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('ui.trayEnabled') }}
            </label>
          </div>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="trayCloseToTray"
                @change="setTray({ closeToTray: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('ui.trayCloseToTray') }}
            </label>
          </div>

          <h3 class="settings-subhead">{{ t('ui.updates') }}</h3>
          <div class="field">
            <label class="checkbox">
              <input
                type="checkbox"
                :checked="updateAutoCheck"
                @change="setUpdates({ autoCheck: ($event.target as HTMLInputElement).checked })"
              />
              {{ t('ui.updateAutoCheck') }}
            </label>
          </div>
          <div class="field">
            <label>{{ t('ui.updateFeedUrl') }}</label>
            <input
              type="text"
              :value="updateFeedUrl"
              placeholder="https://example.com/updates/"
              @change="setUpdates({ feedUrl: ($event.target as HTMLInputElement).value })"
            />
            <p class="field-hint">{{ t('ui.updateFeedHint') }}</p>
          </div>
          <div class="field">
            <button type="button" class="btn" @click="checkUpdates">
              {{ t('menu.checkUpdates') }}
            </button>
          </div>
        </section>
      </div>

      <div class="settings-footer">
        <button type="button" class="btn" @click="resetDefaults">
          {{ t('ui.resetDefaults') }}
        </button>
        <button type="button" class="btn primary" @click="emit('close')">{{ t('ui.done') }}</button>
      </div>
    </div>
  </Modal>
</template>
