/**
 * Height estimates for rendered block widgets.
 *
 * CodeMirror virtualizes the document and estimates the height of content
 * that has never been rendered. For a block widget it uses
 * `WidgetType.estimatedHeight`; without one it falls back to a single line
 * height. Rendered markdown blocks (headings, code blocks, tables, ...) are
 * much taller than one line, so the height map was far off. Scrolling through
 * previously unmeasured parts then corrected the map and yanked the scroll
 * position around (the scrollbar thumb jumped back towards the end).
 *
 * These estimates only need to be close: measured widgets replace them once
 * they enter the viewport.
 */
import type { Block } from './segmenter'

export interface BlockMetrics {
  /** Base editor font size in px. */
  font: number
  /** Base line height in px. */
  line: number
  /** Approximate width of the rendered content in px. */
  width: number
}

/** Font size of headings 1-6 relative to the base font. */
const HEADING_SCALE = [0, 1.9, 1.5, 1.25, 1.1, 1, 0.95]

/** CJK / full-width characters (approximately one font-size wide). */
function isWideChar(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  )
}

/** Approximate number of rendered text lines for one visual paragraph. */
function paragraphLines(text: string, width: number, font: number): number {
  let lines = 0
  for (const raw of text.split('\n')) {
    // Block markers do not take up text width.
    const line = raw.replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+[.)])\s+/, '')
    let used = 0
    let count = 1
    for (const ch of line) {
      const w = isWideChar(ch) ? font : font * 0.52
      if (used + w > width && used > 0) {
        count++
        used = w
      } else {
        used += w
      }
    }
    lines += count
  }
  return Math.max(1, lines)
}

/**
 * Estimated border-box height of the rendered block widget. The formulas
 * mirror the widget styles in `themes/index.css`; the trailing `0.9em` is the
 * widget's own bottom padding (`.cm-mdw`), which CodeMirror includes when it
 * measures a widget.
 */
export function estimateBlockHeight(block: Block, metrics: BlockMetrics): number {
  const { font, line, width } = metrics
  const pad = 0.9 * font

  switch (block.type) {
    case 'fence':
    case 'frontmatter': {
      if (block.mermaid) {
        // Diagrams mount asynchronously; a typical diagram is a few hundred
        // pixels tall regardless of the number of source lines.
        return Math.max(160, Math.min(600, block.text.split('\n').length * 40))
      }
      const codeLines = Math.max(1, block.text.split('\n').length - 2)
      // Language bar (~25px) + pre block padding/border (24px).
      return 49 + codeLines * 1.32 * font + pad
    }
    case 'heading': {
      const level = block.level ?? 1
      const size = font * HEADING_SCALE[level]
      const border = level <= 2 ? 1 : 0
      const bottomPad = level === 1 ? 0.25 * size : level === 2 ? 0.2 * size : 0
      const topMargin = 1.1 * size
      const text = block.text.replace(/^\s*#{1,6}\s+/, '')
      return paragraphLines(text, width, size) * size * 1.35 + border + bottomPad + topMargin + pad
    }
    case 'hr':
      return 1.2 * font + 0.3 * font + 1 + pad
    case 'math':
      return (
        Math.max(2, paragraphLines(block.text.replace(/^\s*\$\$|\$\$\s*$/g, ''), width, font)) *
          line +
        pad
      )
    case 'table':
      // The delimiter row is not rendered; rows are a bit taller than text.
      return Math.max(1, block.text.split('\n').length - 1) * (line + 7) + 0.8 * font + pad
    case 'blockquote':
      return paragraphLines(block.text, width - font, font) * line + 0.4 * font + pad
    case 'list-item':
      return paragraphLines(block.text, width - 1.6 * font, font) * line + pad
    default:
      // Paragraphs, HTML and footnote definitions.
      return paragraphLines(block.text, width, font) * line + pad
  }
}
