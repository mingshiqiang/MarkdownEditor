/**
 * Outline extraction (F-08): ATX headings with their document position.
 */
export interface OutlineItem {
  /** Heading level 1-6. */
  level: number
  text: string
  /** 1-based line number. */
  line: number
  /** Absolute document offset of the heading. */
  pos: number
}

const RE_HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/

export function parseOutline(text: string): OutlineItem[] {
  const items: OutlineItem[] = []
  let offset = 0
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = RE_HEADING.exec(line)
    if (m && m[2].trim()) {
      items.push({
        level: m[1].length,
        text: m[2].trim(),
        line: i + 1,
        pos: offset
      })
    }
    offset += line.length + 1
  }
  return items
}
