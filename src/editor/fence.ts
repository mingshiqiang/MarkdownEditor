/**
 * Fenced code block helpers (E-06): locate the language token inside the
 * fence info string so the language can be switched from the rendered block.
 */
import type { Block } from './segmenter'

export interface LangRange {
  /** Absolute document offsets of the language token. */
  from: number
  to: number
}

/** Languages offered in the code block dropdown. */
export const CODE_LANGUAGES: { id: string; label: string }[] = [
  { id: '', label: '纯文本' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'jsx', label: 'JSX' },
  { id: 'tsx', label: 'TSX' },
  { id: 'vue', label: 'Vue' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'scss', label: 'SCSS' },
  { id: 'less', label: 'Less' },
  { id: 'json', label: 'JSON' },
  { id: 'yaml', label: 'YAML' },
  { id: 'xml', label: 'XML' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'kotlin', label: 'Kotlin' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'csharp', label: 'C#' },
  { id: 'go', label: 'Go' },
  { id: 'rust', label: 'Rust' },
  { id: 'php', label: 'PHP' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'swift', label: 'Swift' },
  { id: 'shell', label: 'Shell' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'sql', label: 'SQL' },
  { id: 'dockerfile', label: 'Dockerfile' },
  { id: 'ini', label: 'INI / TOML' },
  { id: 'diff', label: 'Diff' },
  { id: 'mermaid', label: 'Mermaid' }
]

/**
 * Position of the language token in the first line of a fence block.
 * When no language is present, the range is empty and positioned right
 * after the fence marker (so a language can be inserted).
 */
export function fenceLangRange(block: Block): LangRange | null {
  if (block.type !== 'fence') return null
  const firstLine = block.text.split('\n')[0] ?? ''
  const m = /^(\s*)(`{3,}|~{3,})([ \t]*)(.*)$/.exec(firstLine)
  if (!m) return null
  const infoStart = m[1].length + m[2].length + m[3].length
  const info = m[4] ?? ''
  const langMatch = /^[^\s]+/.exec(info)
  if (!langMatch) {
    return { from: block.from + infoStart, to: block.from + infoStart }
  }
  return {
    from: block.from + infoStart,
    to: block.from + infoStart + langMatch[0].length
  }
}

/** The language currently used by a fence block. */
export function fenceLanguage(block: Block): string {
  const range = fenceLangRange(block)
  if (!range) return ''
  return block.text.slice(range.from - block.from, range.to - block.from)
}
