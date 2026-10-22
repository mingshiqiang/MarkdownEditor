/**
 * Source-mode styling for the active block (live preview).
 *
 * When the caret enters a rendered block, the block switches to its source
 * form. If the source form had different metrics than the rendered form,
 * the text around it would jump around (the block above changes its height,
 * the heading shrinks, the list loses its indentation, ...).
 *
 * To avoid that, the source lines get the metrics of the rendered block:
 * the same font size, line height, margins and indentation. The block
 * markers (`# `, `- `, `> `) are replaced as well, so the text starts at
 * the same position as in the rendered form.
 */
import type { Block } from './segmenter'

/** The kind of block marker that can be replaced. */
export type MarkerKind = 'heading' | 'list' | 'quote'

/** The marker of a block, or null when the block has none. */
export function markerOf(block: Block): MarkerKind | null {
  switch (block.type) {
    case 'heading':
      return 'heading'
    case 'list-item':
      return 'list'
    case 'blockquote':
      return 'quote'
    default:
      return null
  }
}

/**
 * The CSS classes of a source line inside an active block. The classes carry
 * the metrics of the rendered block (see `themes/index.css`).
 */
export function sourceLineClasses(block: Block, line: number): string[] {
  const classes: string[] = []
  switch (block.type) {
    case 'heading':
      classes.push(`cm-md-src-h${block.level ?? 1}`)
      break
    case 'paragraph':
      classes.push('cm-md-src-p')
      break
    case 'list-item':
      classes.push('cm-md-src-li')
      break
    case 'blockquote':
      classes.push('cm-md-src-quote')
      break
    case 'fence':
      classes.push('cm-md-src-code')
      break
    default:
      return []
  }
  if (line === block.lineFrom) classes.push('cm-md-src-first')
  if (line === block.lineTo) classes.push('cm-md-src-last')
  return classes
}

/** The information about a block marker in the source. */
export interface MarkerInfo {
  /** Source range of the marker (including the trailing space). */
  from: number
  to: number
  /** The number of an ordered list item (empty for unordered items). */
  label: string
  /** The nesting level of a list item (0 for the outermost one). */
  level: number
}

/**
 * The marker of the first line of a block. The marker is replaced in the
 * source view, so the text keeps the position it has in the rendered form.
 */
export function markerRange(
  lineText: string,
  lineFrom: number,
  kind: MarkerKind
): MarkerInfo | null {
  if (kind === 'heading') {
    const m = /^(#{1,6}[ \t]+)/.exec(lineText)
    if (!m) return null
    return { from: lineFrom, to: lineFrom + m[1].length, label: '', level: 0 }
  }
  if (kind === 'list') {
    const m = /^([ \t]*)([-*+]|\d+[.)])([ \t]+)/.exec(lineText)
    if (!m) return null
    const indent = m[1].replace(/\t/g, '  ').length
    return {
      from: lineFrom,
      to: lineFrom + m[0].length,
      label: /^\d/.test(m[2]) ? m[2].replace(/[.)]$/, '') : '',
      level: Math.floor(indent / 2)
    }
  }
  const m = /^(>[ \t]?)/.exec(lineText)
  if (!m) return null
  return { from: lineFrom, to: lineFrom + m[1].length, label: '', level: 0 }
}
