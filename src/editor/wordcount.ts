/**
 * CJK-aware word/char counting (E-14).
 * - chars: non-whitespace characters
 * - words: latin words + CJK characters counted individually
 * - lines: line count
 * - readMinutes: CJK ~300 chars/min, latin ~200 words/min (rough blend)
 */
export interface DocStats {
  chars: number
  words: number
  lines: number
  readMinutes: number
}

const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g
const LATIN_WORD_RE = /[A-Za-z0-9][A-Za-z0-9'’\-_]*/g

export function computeStats(text: string): DocStats {
  const chars = text.replace(/\s+/g, '').length
  const cjkMatches = text.match(CJK_RE)
  const cjk = cjkMatches ? cjkMatches.length : 0
  const latinMatches = text.match(LATIN_WORD_RE)
  const latinWords = latinMatches ? latinMatches.length : 0
  const words = cjk + latinWords
  const lines = text.length === 0 ? 0 : text.split('\n').length
  const units = cjk + latinWords * 1.5
  const readMinutes = units === 0 ? 0 : Math.max(1, Math.ceil(units / 300))
  return { chars, words, lines, readMinutes }
}
