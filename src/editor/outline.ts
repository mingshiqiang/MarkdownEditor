/**
 * Outline extraction (F-08): ATX headings with their document position.
 * The block segmenter is the same one the live renderer uses, so headings
 * inside fenced code blocks (e.g. `# 或` in a shell script), frontmatter or
 * HTML blocks never leak into the outline.
 */
import { segmentLines } from './segmenter'

export interface OutlineItem {
  /** Heading level 1-6. */
  level: number
  text: string
  /** 1-based line number. */
  line: number
  /** Absolute document offset of the heading. */
  pos: number
}

const RE_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*$/

export function parseOutline(text: string): OutlineItem[] {
  const lines = text.split('\n')
  const lineStarts: number[] = []
  let offset = 0
  for (const line of lines) {
    lineStarts.push(offset)
    offset += line.length + 1
  }

  const items: OutlineItem[] = []
  for (const block of segmentLines(lines)) {
    if (block.type !== 'heading') continue
    const m = RE_HEADING.exec(lines[block.lineFrom])
    if (!m || !m[2].trim()) continue
    items.push({
      level: block.level ?? m[1].length,
      text: m[2].trim(),
      line: block.lineFrom + 1,
      pos: lineStarts[block.lineFrom]
    })
  }
  return items
}

/**
 * A stable key for a heading's fold state. It is built from the heading text
 * and its occurrence among identical headings, so typing elsewhere in the
 * document (which shifts offsets and line numbers) does not lose the folds.
 */
export function outlineKey(item: OutlineItem, occurrence = 0): string {
  return `${item.level}\u0000${item.text}\u0000${occurrence}`
}

/** A heading row shown in the outline, after collapsed sections are hidden. */
export interface OutlineRow {
  item: OutlineItem
  /** Index in the source outline array. */
  index: number
  /** Stable fold key (see {@link outlineKey}). */
  key: string
  hasChildren: boolean
  collapsed: boolean
}

/**
 * The visible outline rows. Headings below a collapsed heading are omitted;
 * `collapsedKeys` holds keys from {@link outlineKey}.
 */
export function outlineRows(
  items: OutlineItem[],
  collapsedKeys: ReadonlySet<string>
): OutlineRow[] {
  const rows: OutlineRow[] = []
  const occurrences = new Map<string, number>()
  /** Levels of the collapsed ancestors that currently hide their children. */
  const hiddenBy: number[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const base = `${item.level}\u0000${item.text}`
    const occurrence = occurrences.get(base) ?? 0
    occurrences.set(base, occurrence + 1)
    const key = outlineKey(item, occurrence)

    // A heading at the same or a higher level ends the collapsed section.
    while (hiddenBy.length && item.level <= hiddenBy[hiddenBy.length - 1]) hiddenBy.pop()
    if (hiddenBy.length) continue

    const hasChildren = i + 1 < items.length && items[i + 1].level > item.level
    const collapsed = collapsedKeys.has(key)
    rows.push({ item, index: i, key, hasChildren, collapsed })
    if (hasChildren && collapsed) hiddenBy.push(item.level)
  }
  return rows
}
