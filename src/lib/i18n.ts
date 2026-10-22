import { ref } from 'vue'
import { dictionaries, fmt, resolveLocale } from '../../shared/i18n'
import type { Locale } from '../../shared/types'

/**
 * Reactive i18n for the renderer. Works without Pinia (plain module state),
 * so editor modules and unit tests can call `t()` freely.
 */
const locale = ref<Locale>('zh-CN')

export function setI18nLocale(next: Locale): void {
  locale.value = next
}

export function currentLocale(): Locale {
  return locale.value
}

export function t(key: string): string {
  const dict = dictionaries[locale.value] as unknown as Record<string, unknown>
  const parts = key.split('.')
  let node: unknown = dict
  for (const part of parts) {
    if (typeof node !== 'object' || node === null) return key
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : key
}

export function tf(key: string, params: Record<string, string | number>): string {
  return fmt(t(key), params)
}

/** Resolve the locale setting (auto -> navigator.language, fallback zh-CN). */
export function resolveNavigatorLocale(setting: 'auto' | 'zh-CN' | 'en'): Locale {
  return resolveLocale(setting, navigator.language)
}
