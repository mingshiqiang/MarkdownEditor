/**
 * Image references in a markdown document (X-06): finds the images that point
 * to a local file so they can be uploaded to an image host.
 */

export interface ImageRef {
  /** Offset of the source inside the markdown source. */
  from: number
  to: number
  /** The source as written in the document. */
  src: string
}

/** Markdown image: `![alt](src "title")`. */
const IMAGE_RE = /!\[([^\]]*)\]\(\s*([^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g

/** All image references of a document, in the order they appear. */
export function findImageRefs(markdown: string): ImageRef[] {
  const refs: ImageRef[] = []
  IMAGE_RE.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = IMAGE_RE.exec(markdown)) !== null) {
    const src = match[2]
    const afterParen = match[0].indexOf('](') + 2
    const offset = match[0].indexOf(src, afterParen)
    if (offset < 0) continue
    const from = match.index + offset
    refs.push({ from, to: from + src.length, src })
  }
  return refs
}

/** Whether a reference points to a remote resource instead of a local file. */
export function isRemoteRef(src: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(src)
}
