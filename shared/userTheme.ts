/**
 * User themes (U-02): plain CSS files in the user theme folder.
 *
 * A theme file looks like this:
 *
 *   / * name: 海洋 * /        (written as a normal block comment)
 *   / * base: dark * /
 *   :root {
 *     --bg: #0b1f2e;
 *     --accent: #38bdf8;
 *   }
 *
 * - `name` is shown in the preferences (defaults to the file name).
 * - `base` is the built-in family the theme builds on (`light` or `dark`);
 *   variables that are not listed keep the values of that family.
 * - Only custom properties (`--name: value;`) inside `:root` / `html` rules are
 *   used. Values are restricted (no URLs, at-rules, escapes or markup), so a theme
 *   file can change colors and spacing but never load resources or run code.
 *
 * Pure module: shared by the main process (reads the folder), the renderer
 * (applies the CSS) and the exporters (embeds the CSS).
 */

export const USER_THEME_PREFIX = 'user:'

export type ThemeBase = 'light' | 'dark'

export interface UserThemeWarning {
  /** Short code, translated by the UI (`themeWarn.<code>`). */
  code: 'badBase' | 'badName' | 'badValue' | 'tooLarge' | 'noVars'
  /** The property the warning refers to, when there is one. */
  prop?: string
}

export interface UserTheme {
  /** File-name based identifier (`[a-z0-9_-]`), stable across reloads. */
  id: string
  name: string
  base: ThemeBase
  /** Custom property overrides, e.g. `{ '--bg': '#0b1f2e' }`. */
  vars: Record<string, string>
  warnings: UserThemeWarning[]
}

const MAX_SOURCE_LENGTH = 64 * 1024
const MAX_VARIABLES = 300
const MAX_NAME_LENGTH = 60
const MAX_VALUE_LENGTH = 300

const CUSTOM_PROPERTY = /^--[a-z][a-z0-9-]{0,63}$/i
const UNSAFE_VALUE =
  /url\s*\(|image(?:-set)?\s*\(|@|\\|[<>{};]|\/\*|\*\/|expression\s*\(|javascript:|!\s*important/i
const ROOT_SELECTORS = new Set([':root', 'html'])

/** Identifier for a theme file name: lower case, `[a-z0-9_-]`, max 40 characters. */
export function userThemeIdFromFile(fileName: string): string {
  const stem = fileName.replace(/\.css$/i, '')
  const id = stem
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return id || 'theme'
}

/** The value stored in the settings for a user theme. */
export function userThemeRef(id: string): string {
  return `${USER_THEME_PREFIX}${id}`
}

/** The theme id of a settings value, or null for built-in themes. */
export function userThemeIdOf(setting: string): string | null {
  return setting.startsWith(USER_THEME_PREFIX) ? setting.slice(USER_THEME_PREFIX.length) : null
}

/** Whether a settings value refers to a user theme. */
export function isUserThemeSetting(setting: string): setting is `user:${string}` {
  return setting.startsWith(USER_THEME_PREFIX)
}

function isRootSelector(selector: string): boolean {
  const parts = selector.split(',').map((s) => s.trim().toLowerCase())
  return parts.length > 0 && parts.every((p) => ROOT_SELECTORS.has(p))
}

/** Read a theme file. Never throws; problems are reported as warnings. */
export function parseUserTheme(fileName: string, source: string): UserTheme {
  const id = userThemeIdFromFile(fileName)
  const warnings: UserThemeWarning[] = []
  let name = id
  let base: ThemeBase = 'light'

  if (source.length > MAX_SOURCE_LENGTH) warnings.push({ code: 'tooLarge' })
  const text = source.slice(0, MAX_SOURCE_LENGTH)

  const header = /^\s*\/\*([\s\S]*?)\*\//.exec(text)
  if (header) {
    for (const line of header[1].split(/\r?\n/)) {
      const m = /^\s*\*?\s*(name|base)\s*:\s*(.+?)\s*$/i.exec(line)
      if (!m) continue
      if (m[1].toLowerCase() === 'name') {
        name = m[2].slice(0, MAX_NAME_LENGTH)
      } else {
        const value = m[2].toLowerCase()
        if (value === 'light' || value === 'dark') base = value
        else warnings.push({ code: 'badBase' })
      }
    }
  }

  const body = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const vars: Record<string, string> = {}
  const rule = /([^{}]+)\{([^{}]*)\}/g
  let match: RegExpExecArray | null
  while ((match = rule.exec(body)) !== null) {
    if (!isRootSelector(match[1].trim())) continue
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':')
      if (colon < 0) continue
      const prop = declaration.slice(0, colon).trim()
      const value = declaration.slice(colon + 1).trim()
      if (!prop.startsWith('--')) continue
      if (!CUSTOM_PROPERTY.test(prop)) {
        warnings.push({ code: 'badName', prop })
        continue
      }
      if (!value || value.length > MAX_VALUE_LENGTH || UNSAFE_VALUE.test(value)) {
        warnings.push({ code: 'badValue', prop })
        continue
      }
      if (Object.keys(vars).length >= MAX_VARIABLES) break
      vars[prop] = value
    }
  }

  if (Object.keys(vars).length === 0) warnings.push({ code: 'noVars' })
  return { id, name, base, vars, warnings }
}

/** The stylesheet that applies a user theme on top of its built-in base. */
export function userThemeCss(theme: Pick<UserTheme, 'vars'>): string {
  const lines = Object.entries(theme.vars).map(([prop, value]) => `  ${prop}: ${value};`)
  return `:root[data-theme] {\n${lines.join('\n')}\n}\n`
}

/** Example written to the theme folder by "新建示例主题". */
export const EXAMPLE_USER_THEME_FILE = 'example-ocean.css'
export const EXAMPLE_USER_THEME = `/*
 * name: 海洋（示例）
 * base: dark
 *
 * 自定义主题：每一行 --变量名: 值; 覆盖一个颜色或间距。
 * 没有写出的变量沿用 base 指定的内置主题（light 或 dark）。
 * 保存文件后，在「偏好设置 → 外观」里点击「重新加载」即可生效。
 */
:root {
  --bg: #0b1f2e;
  --bg-subtle: #0f2a3d;
  --bg-elevated: #132f44;
  --bg-tab: #09182a;
  --bg-tab-active: #132f44;
  --fg: #d7ecf5;
  --fg-muted: #8fb3c7;
  --fg-subtle: #5f8397;
  --border: #1f4257;
  --border-strong: #2c5a73;
  --accent: #38bdf8;
  --accent-soft: #123a52;
  --ed-fg: #d7ecf5;
  --ed-fg-muted: #8fb3c7;
  --ed-caret: #38bdf8;
  --ed-selection: #1d4b63;
  --ed-panel-bg: #0f2a3d;
  --ed-input-bg: #09182a;
  --ed-border: #1f4257;
  --md-h1: #7dd3fc;
  --md-h2: #7dd3fc;
  --md-h3: #67e8f9;
  --md-link: #38bdf8;
  --md-code: #f9a8d4;
  --md-code-bg: #0f2a3d;
  --md-code-border: #1f4257;
  --md-table-border: #1f4257;
  --md-table-head-bg: #132f44;
  --md-table-stripe: #0d2638;
}
`
