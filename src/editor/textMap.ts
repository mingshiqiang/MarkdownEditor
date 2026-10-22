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

const EMPHASIS_MARKERS = ['**', '__', '~~', '==']

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

/** Builds the map between the visible text and the source. */
export function buildPlainTextMap(source: string): PlainTextMap {
  const chars: string[] = []
  const indices: number[] = []
  let i = 0

  const add = (ch: string, at: number): void => {
    chars.push(ch)
    indices.push(at)
  }

  while (i < source.length) {
    const ch = source[i]

    // Escaped character: the backslash itself is not visible.
    if (ch === '\\' && i + 1 < source.length) {
      add(source[i + 1], i + 1)
      i += 2
      continue
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
    if ((ch === '*' || ch === '_') && (i === 0 || /[\s(]/.test(source[i - 1]))) {
      i += 1
      continue
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
        const inner = buildPlainTextMap(source.slice(i + 1, close))
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

/** The number of characters of `root`'s text before the given position. */
export function textOffsetIn(root: HTMLElement, node: Node, offset: number): number {
  let count = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let current = walker.nextNode()
  while (current) {
    if (current === node) return count + offset
    // The node is an element: the text before it ends at its first child.
    if (node.contains(current)) break
    count += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  // The node is an element: count the text of its children before the offset.
  const children = node.childNodes
  let inner = 0
  for (let i = 0; i < Math.min(offset, children.length); i++) {
    inner += children[i].textContent?.length ?? 0
  }
  return count + inner
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
