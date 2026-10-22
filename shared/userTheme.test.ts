import { describe, expect, it } from 'vitest'
import {
  EXAMPLE_USER_THEME,
  parseUserTheme,
  userThemeCss,
  userThemeIdFromFile,
  userThemeIdOf,
  userThemeRef
} from './userTheme'

describe('parseUserTheme', () => {
  it('reads the name and base from the header comment', () => {
    const theme = parseUserTheme(
      'ocean.css',
      '/*\n * name: 海洋\n * base: dark\n */\n:root { --bg: #000; }'
    )
    expect(theme.id).toBe('ocean')
    expect(theme.name).toBe('海洋')
    expect(theme.base).toBe('dark')
    expect(theme.vars).toEqual({ '--bg': '#000' })
    expect(theme.warnings).toEqual([])
  })

  it('defaults to the light base and the file name', () => {
    const theme = parseUserTheme('My Theme (2).css', ':root { --accent: red; }')
    expect(theme.id).toBe('my-theme-2')
    expect(theme.name).toBe('my-theme-2')
    expect(theme.base).toBe('light')
  })

  it('warns about an unknown base but keeps the theme', () => {
    const theme = parseUserTheme('x.css', '/* base: neon */\n:root { --bg: #111; }')
    expect(theme.base).toBe('light')
    expect(theme.warnings).toContainEqual({ code: 'badBase' })
    expect(theme.vars).toEqual({ '--bg': '#111' })
  })

  it('only uses declarations from :root and html rules', () => {
    const theme = parseUserTheme(
      'scoped.css',
      ':root { --bg: #111; }\n.cm-editor { --accent: red; }\nhtml, :root { --fg: #eee; }\n@media (prefers-color-scheme: dark) { :root { --border: #222; } }'
    )
    expect(theme.vars).toEqual({ '--bg': '#111', '--fg': '#eee', '--border': '#222' })
  })

  it('ignores ordinary properties silently', () => {
    const theme = parseUserTheme('plain.css', ':root { color: red; --bg: #111; }')
    expect(theme.vars).toEqual({ '--bg': '#111' })
    expect(theme.warnings).toEqual([])
  })

  it('keeps unsafe values out of the generated stylesheet', () => {
    const unsafe = [
      'url(https://evil.test/x.png)',
      'image-set("a.png" 1x)',
      '"x" @import',
      'expression(alert(1))',
      'red; body { display: none }',
      'red</style><script>',
      '\\72 ed',
      'red !important',
      'javascript:alert(1)'
    ]
    for (const value of unsafe) {
      const theme = parseUserTheme('bad.css', `:root { --bg: ${value}; }`)
      expect(theme.vars, value).not.toHaveProperty('--bg')
      expect(userThemeCss(theme), value).not.toMatch(
        /url\(|@import|expression\(|<\/?style|<script|body \{/i
      )
    }
  })

  it('reports unsafe values that are otherwise well formed', () => {
    const theme = parseUserTheme('bad.css', ':root { --bg: url(x.png); --fg: red !important; }')
    expect(theme.vars).toEqual({})
    expect(theme.warnings.filter((w) => w.code === 'badValue').map((w) => w.prop)).toEqual([
      '--bg',
      '--fg'
    ])
  })

  it('reports invalid custom property names', () => {
    const theme = parseUserTheme('names.css', ':root { --1bad: red; --ok-name: blue; }')
    expect(theme.vars).toEqual({ '--ok-name': 'blue' })
    expect(theme.warnings).toContainEqual({ code: 'badName', prop: '--1bad' })
  })

  it('handles a file without any usable variable', () => {
    const theme = parseUserTheme('empty.css', '/* name: nothing */')
    expect(theme.vars).toEqual({})
    expect(theme.warnings).toContainEqual({ code: 'noVars' })
  })

  it('never throws on arbitrary input', () => {
    expect(() => parseUserTheme('junk.css', '{{{ } ;;; /* unterminated')).not.toThrow()
    expect(() => parseUserTheme('empty.css', '')).not.toThrow()
  })

  it('parses the bundled example without warnings', () => {
    const theme = parseUserTheme('example-ocean.css', EXAMPLE_USER_THEME)
    expect(theme.name).toBe('海洋（示例）')
    expect(theme.base).toBe('dark')
    expect(Object.keys(theme.vars).length).toBeGreaterThan(10)
    expect(theme.warnings).toEqual([])
  })
})

describe('userThemeCss', () => {
  it('scopes the variables to the root element', () => {
    const css = userThemeCss({ vars: { '--bg': '#0b1f2e', '--accent': '#38bdf8' } })
    expect(css).toContain(':root[data-theme] {')
    expect(css).toContain('--bg: #0b1f2e;')
    expect(css).toContain('--accent: #38bdf8;')
  })
})

describe('theme references', () => {
  it('round-trips ids through the settings value', () => {
    expect(userThemeRef('ocean')).toBe('user:ocean')
    expect(userThemeIdOf('user:ocean')).toBe('ocean')
    expect(userThemeIdOf('dark')).toBeNull()
  })

  it('derives stable ids from file names', () => {
    expect(userThemeIdFromFile('Ocean_Deep.CSS')).toBe('ocean_deep')
    expect(userThemeIdFromFile('!!!.css')).toBe('theme')
  })
})
