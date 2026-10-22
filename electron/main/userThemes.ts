/**
 * User theme folder (U-02): `<userData>/themes/*.css`.
 *
 * The renderer receives the parsed themes and applies them on top of a built-in
 * theme; the main process only reads the folder and maps a theme to the native
 * theme family (title bar, window background).
 */
import { app, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import {
  EXAMPLE_USER_THEME,
  EXAMPLE_USER_THEME_FILE,
  parseUserTheme,
  userThemeIdOf,
  type UserTheme
} from '../../shared/userTheme'

const MAX_THEME_FILES = 50
const MAX_THEME_FILE_BYTES = 256 * 1024

export function userThemesDir(): string {
  return path.join(app.getPath('userData'), 'themes')
}

function ensureThemesDir(): string {
  const dir = userThemesDir()
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function listUserThemes(): UserTheme[] {
  const dir = ensureThemesDir()
  let names: string[]
  try {
    names = fs
      .readdirSync(dir)
      .filter((n) => /\.css$/i.test(n))
      .sort()
      .slice(0, MAX_THEME_FILES)
  } catch {
    return []
  }
  const themes: UserTheme[] = []
  const seen = new Set<string>()
  for (const name of names) {
    try {
      const file = path.join(dir, name)
      const st = fs.statSync(file)
      if (!st.isFile() || st.size > MAX_THEME_FILE_BYTES) continue
      const source = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '')
      const theme = parseUserTheme(name, source)
      if (seen.has(theme.id)) continue
      seen.add(theme.id)
      themes.push(theme)
    } catch {
      /* unreadable file: skip it */
    }
  }
  return themes
}

/** Native theme family for a theme setting ('system' follows the OS). */
export function nativeThemeSourceFor(theme: string | undefined): 'system' | 'light' | 'dark' {
  if (!theme || theme === 'auto') return 'system'
  const id = userThemeIdOf(theme)
  if (id !== null) {
    const found = listUserThemes().find((t) => t.id === id)
    return found ? found.base : 'system'
  }
  return theme === 'light' || theme === 'light-warm' ? 'light' : 'dark'
}

export async function openUserThemesFolder(): Promise<void> {
  await shell.openPath(ensureThemesDir())
}

/** Writes the example theme unless a file with that name exists already. */
export function writeExampleUserTheme(): string | null {
  try {
    const file = path.join(ensureThemesDir(), EXAMPLE_USER_THEME_FILE)
    if (!fs.existsSync(file)) fs.writeFileSync(file, EXAMPLE_USER_THEME, 'utf-8')
    return file
  } catch {
    return null
  }
}
