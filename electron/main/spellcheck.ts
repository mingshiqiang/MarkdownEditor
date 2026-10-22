/**
 * Spell checking support (E-15).
 *
 * Chromium's spell checker is used; it ships English dictionaries (Chinese
 * is not supported by Chromium, so CJK text is simply not marked).
 */
import { session } from 'electron'
import type { AppSettings } from '../../shared/types'

export function applySpellChecker(settings: AppSettings): void {
  try {
    const enabled = Boolean(settings.editor.spellcheck)
    const lang = settings.editor.spellcheckLang || 'en-US'
    session.defaultSession.setSpellCheckerLanguages(enabled ? [lang] : [])
  } catch {
    /* spell checker not available on this platform */
  }
}
