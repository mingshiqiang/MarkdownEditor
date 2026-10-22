/**
 * Applies the active user theme (U-02) to the document. The stylesheet is
 * injected after the built-in theme, so the user variables win.
 */
import { userThemeCss, type UserTheme } from '../../shared/userTheme'

const STYLE_ID = 'mde-user-theme'

export function applyUserTheme(theme: UserTheme | null): void {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!theme) {
    el?.remove()
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = userThemeCss(theme)
}
