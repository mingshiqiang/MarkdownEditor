/**
 * Maps a position in the *rendered* text of a markdown block back to the
 * source. The rendered text is the source without the markdown markers, so
 * the module builds a map from the visible characters to their source
 * offsets.
 *
 * Used for the table cells (formatting a selection inside a rendered cell)
 * and for placing the caret where the user clicked.
 */

export interface PlainTextMap {
  /** The visible text. */
  text: string
  /** `sourceIndex[i]` is the source offset of the i-th visible character. */
  sourceIndex: number[]
}

export interface TextMapOptions {
  /**
   * Count a rendered formula as one atomic character. KaTeX creates several
   * text copies (MathML and HTML), and commands such as `\alpha` do not have
   * the same text as their source, so character-by-character mapping cannot
   * work inside a formula.
   */
  atomicMath?: boolean
}

const EMPHASIS_MARKERS = ['**', '__', '~~', '==']
const MATH_PLACEHOLDER = '\uFFFC'

function findClosingBracket(source: string, start: number): number {
  let depth = 0
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    if (ch === '\\') {
      i++
      continue
    }
    if (ch === '[') depth++
    else if (ch === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** The end of an inline formula, or -1 when the dollar is literal text. */
function inlineMathEnd(source: string, start: number): number {
  const delimiter = source.startsWith('$$', start) ? '$$' : '$'
  const contentStart = start + delimiter.length
  if (contentStart >= source.length || /\s/.test(source[contentStart])) return -1
  for (let i = contentStart; i < source.length; i++) {
    if (source[i] === '\\') {
      i++
      continue
    }
    if (source.startsWith(delimiter, i) && !/\s/.test(source[i - 1])) {
      return i + delimiter.length
    }
  }
  return -1
}

/** Decodes one HTML entity. The input is restricted by the caller. */
function decodeEntity(entity: string): string | null {
  if (typeof document === 'undefined') return null
  const textarea = document.createElement('textarea')
  textarea.innerHTML = entity
  return textarea.value === entity ? null : textarea.value
}

/** Skips Markdown block markers that are not present in the rendered text. */
function blockMarkerEnd(source: string, start: number): number {
  let i = start
  while (source[i] === '>') {
    i++
    if (source[i] === ' ' || source[i] === '\t') i++
  }
  const rest = source.slice(i)
  const heading = /^(#{1,6}[ \t]+)/.exec(rest)
  if (heading) return i + heading[1].length
  // Keep the space after a task checkbox: markdown-it leaves it in the same
  // text node as the task label, so it participates in DOM hit-testing.
  const list = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\])?)/.exec(rest)
  if (list) return i + list[1].length
  return i
}

/** Builds the map between the visible text and the source. */
export function buildPlainTextMap(source: string, options: TextMapOptions = {}): PlainTextMap {
  const chars: string[] = []
  const indices: number[] = []
  let i = 0

  const add = (ch: string, at: number): void => {
    chars.push(ch)
    indices.push(at)
  }

  while (i < source.length) {
    const ch = source[i]

    // Block markers are not text in the rendered widget.
    if (i === 0 || source[i - 1] === '\n') {
      const end = blockMarkerEnd(source, i)
      if (end > i) {
        i = end
        continue
      }
    }

    // Escaped character: the backslash itself is not visible.
    if (ch === '\\' && i + 1 < source.length) {
      add(source[i + 1], i + 1)
      i += 2
      continue
    }

    // A formula is one atomic unit for hit-testing: its rendered text is not
    // a one-to-one representation of its source (and may contain duplicates).
    if (ch === '$' && options.atomicMath) {
      const end = inlineMathEnd(source, i)
      if (end > i) {
        add(MATH_PLACEHOLDER, i)
        i = end
        continue
      }
    }

    // Code and math delimiters are not visible.
    if (ch === '`' || ch === '$') {
      i += 1
      continue
    }

    // Emphasis markers (**bold**, ~~strike~~, ==highlight==, *italic*).
    const marker = EMPHASIS_MARKERS.find((m) => source.startsWith(m, i))
    if (marker) {
      i += marker.length
      continue
    }
    if (ch === '*' || ch === '_') {
      const prev = source[i - 1] ?? ''
      const next = source[i + 1] ?? ''
      const opening = (i === 0 || /[\s([{]/.test(prev)) && next !== '' && !/\s/.test(next)
      const closing =
        prev !== '' && !/\s/.test(prev) && (next === '' || /[\s)\]},.!?;:]/.test(next))
      if (opening || closing) {
        i += 1
        continue
      }
    }

    // Entities occupy several source characters but one rendered character.
    if (ch === '&') {
      const entity = /^&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.exec(source.slice(i))?.[0]
      const decoded = entity ? decodeEntity(entity) : null
      if (entity && decoded) {
        for (const visible of decoded) add(visible, i)
        i += entity.length
        continue
      }
    }

    // Raw HTML tags are markup, not visible text. Autolinks such as
    // <https://example.com> deliberately do not match the tag expression.
    if (ch === '<') {
      if (source.startsWith('<!--', i)) {
        const end = source.indexOf('-->', i + 4)
        if (end >= 0) {
          i = end + 3
          continue
        }
      }
      const tag = /^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*?)?\/?>/.exec(source.slice(i))
      if (tag) {
        i += tag[0].length
        continue
      }
    }

    // Images are not rendered as text.
    if (ch === '!' && source[i + 1] === '[') {
      const close = source.indexOf(']', i + 1)
      const paren = close > 0 ? source.indexOf(')', close) : -1
      if (paren > 0) {
        i = paren + 1
        continue
      }
    }

    // Links: the text is visible, the target is not.
    if (ch === '[') {
      const close = findClosingBracket(source, i)
      if (close > 0) {
        const inner = buildPlainTextMap(source.slice(i + 1, close), options)
        for (let k = 0; k < inner.text.length; k++) {
          add(inner.text[k], i + 1 + inner.sourceIndex[k])
        }
        i = close + 1
        if (source[i] === '(') {
          const end = source.indexOf(')', i)
          if (end > 0) i = end + 1
        }
        continue
      }
    }

    add(ch, i)
    i += 1
  }

  return { text: chars.join(''), sourceIndex: indices }
}

/**
 * The number of rendered-text units of `root` before the given DOM position.
 * UI controls and the hidden MathML copy of formulas are not document text.
 * With `atomicMath`, the whole visible formula counts as one unit as well.
 */
export function textOffsetIn(
  root: HTMLElement,
  node: Node,
  offset: number,
  options: TextMapOptions = {}
): number {
  let count = 0

  // Returns true when the target boundary has been reached.
  const visit = (current: Node): boolean => {
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.textContent ?? ''
      // markdown-it pretty-prints block containers with newlines between
      // tags. They are formatting whitespace, not source characters.
      const formattingWhitespace =
        text.trim() === '' &&
        current.parentElement?.matches(
          'ul, ol, blockquote, table, thead, tbody, tfoot, tr, dl, .cm-mdw'
        )
      if (!formattingWhitespace) {
        count += current === node ? Math.min(offset, text.length) : text.length
      }
      return current === node
    }

    if (current.nodeType === Node.ELEMENT_NODE && current !== root) {
      const element = current as HTMLElement
      const containsTarget = element === node || element.contains(node)
      if (options.atomicMath && element.classList.contains('katex')) {
        if (!containsTarget) count += 1
        return containsTarget
      }
      if (element.matches('button, select, script, style, .katex-mathml, .md-code-bar')) {
        return containsTarget
      }
    }

    const children = current.childNodes
    const limit = current === node ? Math.min(offset, children.length) : children.length
    for (let i = 0; i < limit; i++) {
      if (visit(children[i])) return true
    }
    return current === node
  }

  visit(root)
  return count
}

/** The text position of a mouse click inside an element. */
export function clickedTextPosition(
  root: HTMLElement,
  x: number,
  y: number
): { node: Node; offset: number } | null {
  const doc = root.ownerDocument
  const caret = doc.caretPositionFromPoint?.(x, y)
  if (caret) return { node: caret.offsetNode, offset: caret.offset }
  const range = doc.caretRangeFromPoint?.(x, y)
  if (range) return { node: range.startContainer, offset: range.startOffset }
  return null
}

/** Maps a range of the visible text back to the source. */
export function sourceRangeOfTextRange(
  source: string,
  base: number,
  from: number,
  to: number
): { from: number; to: number } | null {
  const map = buildPlainTextMap(source)
  const start = Math.max(0, Math.min(map.text.length, from))
  const end = Math.max(0, Math.min(map.text.length, to))
  if (end <= start) return null
  return {
    from: base + map.sourceIndex[start],
    to: base + map.sourceIndex[end - 1] + 1
  }
}
