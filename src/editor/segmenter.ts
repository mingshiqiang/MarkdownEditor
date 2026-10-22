/**
 * Block segmenter: splits a CodeMirror document into top-level markdown
 * blocks for the live-render (Typora-style) mode. Pure logic, unit-tested.
 *
 * Design notes:
 * - Lists are segmented per *top-level item* (marker line + indented
 *   continuation lines, including nested lists) so entering one item keeps
 *   the rest of the list rendered (checkbox clicks work per item).
 * - Blank lines never belong to blocks; the live renderer collapses them
 *   into thin gaps.
 * - Fence/math/table/quote detection follows CommonMark closely enough for
 *   the 80% common syntax; unusual constructs degrade to paragraphs.
 */
import type { Text } from '@codemirror/state'

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'blockquote'
  | 'fence'
  | 'math'
  | 'table'
  | 'hr'
  | 'footnote'
  | 'html'
  | 'frontmatter'

export interface BlockTaskMeta {
  checked: boolean
  /** Absolute doc offsets of the `[ ]` / `[x]` marker. */
  boxFrom: number
  boxTo: number
}

export interface Block {
  type: BlockType
  from: number
  to: number
  lineFrom: number
  lineTo: number
  text: string
  level?: number
  ordered?: boolean
  task?: BlockTaskMeta
  lang?: string
  mermaid?: boolean
}

/** Block description before absolute document offsets are resolved. */
export interface RawBlock {
  type: BlockType
  lineFrom: number
  lineTo: number
  level?: number
  ordered?: boolean
  task?: BlockTaskMeta
  lang?: string
  mermaid?: boolean
}

/* --------------------------------- regexes -------------------------------- */

const RE_HEADING = /^( {0,3})(#{1,6})([ \t]|$)/
const RE_HR = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*(.*)$/
const RE_QUOTE = /^ {0,3}>/
const RE_MATH_OPEN = /^ {0,3}\$\$/
const RE_MATH_INLINE = /^ {0,3}\$\$.+\$\$[ \t]*$/
const RE_LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+|$)/
const RE_TASK = /^(\s*)([-*+]|\d{1,9}[.)])([ \t]+)\[([ xX])\]([ \t]+|$)/
const RE_FOOTNOTE = /^ {0,3}\[\^[^\]\s]+\]:/
const RE_HTML = /^ {0,3}<[a-zA-Z][^>]*>/
const RE_DELIM_ROW = /^ {0,3}\|?[ \t]*:?-{1,}:?[ \t]*(\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$/

/* --------------------------------- helpers -------------------------------- */

function indentWidth(s: string): number {
  let w = 0
  for (const ch of s) {
    if (ch === ' ') w += 1
    else if (ch === '\t') w += 4
    else break
  }
  return w
}

function matchHeading(line: string): { level: number; prefixLen: number } | null {
  const m = RE_HEADING.exec(line)
  if (!m) return null
  return {
    level: m[2].length,
    prefixLen: m[1].length + m[2].length + (m[3] === '' ? 0 : m[3] === undefined ? 0 : 1)
  }
}

function isHr(line: string): boolean {
  return RE_HR.test(line)
}

function fenceInfo(line: string): { marker: string; lang: string } | null {
  const m = RE_FENCE.exec(line)
  if (!m) return null
  const lang = m[2].trim().split(/\s+/)[0] ?? ''
  return { marker: m[1], lang }
}

function isFenceClose(line: string, marker: string): boolean {
  const m = RE_FENCE.exec(line)
  if (!m) return false
  return m[1][0] === marker[0] && m[1].length >= marker.length && m[2].trim() === ''
}

function isTableStart(lines: string[], i: number): boolean {
  const header = lines[i]
  if (!header.includes('|')) return false
  const delim = lines[i + 1]
  if (delim === undefined) return false
  return RE_DELIM_ROW.test(delim)
}

function isBlockStart(line: string, lines: string[], i: number): boolean {
  if (RE_HEADING.test(line)) return true
  if (isHr(line)) return true
  if (RE_FENCE.test(line)) return true
  if (RE_QUOTE.test(line)) return true
  if (RE_MATH_OPEN.test(line)) return true
  if (RE_LIST_ITEM.test(line)) return true
  if (RE_FOOTNOTE.test(line)) return true
  if (RE_HTML.test(line)) return true
  if (isTableStart(lines, i)) return true
  return false
}

/* ------------------------------- segmenter -------------------------------- */

/**
 * Segment a document into blocks. `docLines` are the raw line texts; the
 * caller (live renderer) supplies offsets from the CM Text.
 */
export function segmentLines(lines: string[]): RawBlock[] {
  const blocks: RawBlock[] = []
  const n = lines.length
  let i = 0

  while (i < n) {
    const raw = lines[i]
    const line = raw.replace(/\s+$/, '') // trailing ws irrelevant
    if (line.trim() === '') {
      i++
      continue
    }

    // Frontmatter (--- ... ---) at document start only.
    if (i === 0 && /^---[ \t]*$/.test(line)) {
      let j = i + 1
      while (j < n && !/^(---|\.\.\.)[ \t]*$/.test(lines[j].replace(/\s+$/, ''))) j++
      if (j >= n) {
        // Unclosed: treat the opening line as a thematic break.
        blocks.push({ type: 'hr', lineFrom: i, lineTo: i })
        i++
        continue
      }
      blocks.push({ type: 'frontmatter', lineFrom: i, lineTo: j, lang: 'yaml' })
      i = j + 1
      continue
    }

    // ATX heading
    const h = matchHeading(line)
    if (h) {
      blocks.push({ type: 'heading', lineFrom: i, lineTo: i, level: h.level })
      i++
      continue
    }

    // Thematic break
    if (isHr(line)) {
      blocks.push({ type: 'hr', lineFrom: i, lineTo: i })
      i++
      continue
    }

    // Fenced code
    const fence = fenceInfo(line)
    if (fence) {
      let j = i + 1
      while (j < n && !isFenceClose(lines[j], fence.marker)) j++
      const end = Math.min(j, n - 1)
      blocks.push({
        type: 'fence',
        lineFrom: i,
        lineTo: end,
        lang: fence.lang,
        mermaid: fence.lang.toLowerCase() === 'mermaid'
      })
      i = end + 1
      continue
    }

    // Math block ($$ ... $$)
    if (RE_MATH_OPEN.test(line)) {
      if (RE_MATH_INLINE.test(line) && line.replace(/^ {0,3}\$\$/, '').includes('$$')) {
        blocks.push({ type: 'math', lineFrom: i, lineTo: i })
        i++
        continue
      }
      let j = i + 1
      while (j < n) {
        const l = lines[j].trim()
        if (l === '$$') break
        if (l.endsWith('$$') && l.length > 2) break
        j++
      }
      const end = Math.min(j, n - 1)
      blocks.push({ type: 'math', lineFrom: i, lineTo: end })
      i = end + 1
      continue
    }

    // Table (header + delimiter row + rows)
    if (isTableStart(lines, i)) {
      let j = i + 1
      while (j < n && lines[j].includes('|') && lines[j].trim() !== '') j++
      const end = j - 1
      blocks.push({ type: 'table', lineFrom: i, lineTo: end })
      i = end + 1
      continue
    }

    // Blockquote (incl. lazy paragraph continuation)
    if (RE_QUOTE.test(line)) {
      let j = i + 1
      while (j < n) {
        const l = lines[j]
        if (l.trim() === '') break
        if (RE_QUOTE.test(l)) {
          j++
          continue
        }
        if (isBlockStart(l, lines, j)) break
        j++ // lazy continuation line
      }
      const end = j - 1
      blocks.push({ type: 'blockquote', lineFrom: i, lineTo: end })
      i = end + 1
      continue
    }

    // List item (marker line + indented continuations incl. nested lists)
    const item = RE_LIST_ITEM.exec(line)
    if (item) {
      const ordered = /\d/.test(item[2][0])
      const contentCol =
        indentWidth(item[1]) + item[2].length + (item[3] === '' ? 1 : item[3].length)
      let j = i + 1
      let last = i
      while (j < n) {
        const l = lines[j]
        if (l.trim() === '') {
          // blank line: part of the item only if the next line is indented
          const next = lines[j + 1]
          if (next !== undefined && next.trim() !== '' && indentWidth(next) >= contentCol) {
            j++
            continue
          }
          break
        }
        if (indentWidth(l) >= contentCol) {
          last = j
          j++
          continue
        }
        break
      }
      const taskMatch = RE_TASK.exec(line)
      const block: RawBlock = {
        type: 'list-item',
        lineFrom: i,
        lineTo: last,
        ordered
      }
      if (taskMatch) {
        // offsets are filled by the caller (needs absolute positions)
        block.task = {
          checked: taskMatch[4].toLowerCase() === 'x',
          boxFrom: -1,
          boxTo: -1
        }
      }
      blocks.push(block)
      i = last + 1
      continue
    }

    // Footnote definition
    if (RE_FOOTNOTE.test(line)) {
      let j = i + 1
      while (j < n && lines[j].trim() !== '' && !isBlockStart(lines[j], lines, j)) j++
      const end = j - 1
      blocks.push({ type: 'footnote', lineFrom: i, lineTo: end })
      i = end + 1
      continue
    }

    // HTML block (until blank line)
    if (RE_HTML.test(line)) {
      let j = i + 1
      while (j < n && lines[j].trim() !== '') j++
      const end = j - 1
      blocks.push({ type: 'html', lineFrom: i, lineTo: end })
      i = end + 1
      continue
    }

    // Paragraph: until blank line or next block start
    {
      let j = i + 1
      while (j < n && lines[j].trim() !== '' && !isBlockStart(lines[j], lines, j)) j++
      const end = j - 1
      blocks.push({ type: 'paragraph', lineFrom: i, lineTo: end })
      i = end + 1
    }
  }

  return blocks
}

/** Segment a CM document into blocks (with absolute offsets & task box ranges). */
export function segmentDoc(doc: Text): Block[] {
  const total = doc.lines
  const lineTexts: string[] = []
  const lineStarts: number[] = []
  for (let i = 1; i <= total; i++) {
    const line = doc.line(i)
    lineTexts.push(line.text)
    lineStarts.push(line.from)
  }
  const raw = segmentLines(lineTexts)
  const blocks: Block[] = []
  for (const b of raw) {
    const from = lineStarts[b.lineFrom]
    const lastLine = doc.line(b.lineTo + 1)
    const block: Block = {
      ...b,
      from,
      to: lastLine.to,
      lineFrom: b.lineFrom + 1,
      lineTo: b.lineTo + 1,
      text: doc.sliceString(from, lastLine.to)
    }
    if (block.task && block.task.boxFrom === -1) {
      const firstLineText = doc.line(block.lineFrom).text
      const m = RE_TASK.exec(firstLineText)
      if (m) {
        const boxOff = from + m[1].length + m[2].length + m[3].length
        block.task = { checked: m[4].toLowerCase() === 'x', boxFrom: boxOff, boxTo: boxOff + 3 }
      } else {
        block.task = undefined
      }
    }
    blocks.push(block)
  }
  return blocks
}

export { RE_TASK }
