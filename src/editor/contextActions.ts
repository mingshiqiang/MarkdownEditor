/**
 * Editor context-menu helpers (pure string/link utilities + block insertion).
 *
 * The menu itself lives in EditorHost.vue; these helpers keep the text
 * transformations testable and reusable.
 */
import type { EditorView } from '@codemirror/view'

export type InsertBlockKind = 'code' | 'math' | 'quote' | 'bullet' | 'ordered' | 'task' | 'hr'

/* ---------------------------------- links ---------------------------------- */

export interface MarkdownLinkRange {
  /** Offsets of the whole `[label](url)` construct. */
  from: number
  to: number
  labelFrom: number
  labelTo: number
  urlFrom: number
  urlTo: number
  label: string
  url: string
}

const LINK_RE = /(!?)\[([^\]\n]*)\]\(([^)\n]*)\)/g

function linkFromMatch(m: RegExpExecArray): MarkdownLinkRange {
  const from = m.index
  const labelFrom = from + 1
  const labelTo = labelFrom + m[2].length
  const urlFrom = labelTo + 2
  const urlTo = urlFrom + m[3].length
  return {
    from,
    to: from + m[0].length,
    labelFrom,
    labelTo,
    urlFrom,
    urlTo,
    label: m[2],
    url: m[3]
  }
}

/** The markdown link (not image) containing a source offset. */
export function findMarkdownLinkAt(text: string, offset: number): MarkdownLinkRange | null {
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(text))) {
    if (m[1] === '!') continue
    const link = linkFromMatch(m)
    if (offset >= link.from && offset <= link.to) return link
  }
  return null
}

function sameUrl(a: string, b: string): boolean {
  const norm = (s: string): string => {
    let out = s.trim().replace(/\\/g, '/')
    try {
      out = decodeURI(out)
    } catch {
      /* keep the raw value */
    }
    return out
  }
  return norm(a) === norm(b)
}

/** Locate a link by its destination (used when right-clicking a rendered link). */
export function findMarkdownLinkByHref(text: string, href: string): MarkdownLinkRange | null {
  LINK_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = LINK_RE.exec(text))) {
    if (m[1] === '!') continue
    if (sameUrl(m[3], href)) return linkFromMatch(m)
  }
  return null
}

/** Replace the destination of a link, keeping its label. */
export function replaceLinkUrl(text: string, link: MarkdownLinkRange, url: string): string {
  return text.slice(0, link.urlFrom) + url + text.slice(link.urlTo)
}

/** Replace a link with its label (removes the markdown syntax). */
export function removeLink(text: string, link: MarkdownLinkRange): string {
  return text.slice(0, link.from) + link.label + text.slice(link.to)
}

/* -------------------------------- formatting ------------------------------- */

const WRAPPERS: [string, string][] = [
  ['**', '**'],
  ['__', '__'],
  ['~~', '~~'],
  ['==', '=='],
  ['*', '*'],
  ['_', '_'],
  ['`', '`'],
  ['$', '$']
]

/**
 * Strip the inline markers around a selected fragment. Only complete outer
 * wrappers are removed; markers inside the text are left untouched so that a
 * mixed selection is not corrupted.
 */
export function stripInlineFormat(text: string): string {
  let out = text
  for (let guard = 0; guard < 4; guard++) {
    let changed = false
    for (const [open, close] of WRAPPERS) {
      if (!out.startsWith(open) || !out.endsWith(close)) continue
      if (out.length < open.length + close.length) continue
      const inner = out.slice(open.length, out.length - close.length)
      // Do not unwrap a mixed selection such as `*a* and *b*`: removing the
      // outer markers would corrupt the text between the two spans.
      if (inner.includes(open) || inner.includes(close)) continue
      out = inner
      changed = true
      break
    }
    const link = /^\[([^\]\n]*)\]\([^)\n]*\)$/.exec(out)
    if (link) {
      out = link[1]
      changed = true
    }
    if (!changed) break
  }
  return out
}

/* ------------------------------ block insertion ----------------------------- */

const LIST_MARKER = /^(\s*)(?:[-*+]|\d{1,9}[.)])([ \t]+)/

function prefixLine(line: string, kind: InsertBlockKind, index: number): string {
  if (!line.trim()) return kind === 'quote' ? '> ' : ''
  const m = LIST_MARKER.exec(line)
  const indent = m ? m[1] : (/^\s*/.exec(line)?.[0] ?? '')
  const body = m ? line.slice(m[0].length) : line.slice(indent.length)
  switch (kind) {
    case 'quote':
      return `> ${line}`
    case 'bullet':
      return `${indent}- ${body}`
    case 'ordered':
      return `${indent}${index + 1}. ${body}`
    case 'task':
      return `${indent}- [ ] ${body.replace(/^\[[ xX]\]\s+/, '')}`
    default:
      return line
  }
}

/**
 * Insert a block-level construct at the selection:
 * code/math fences, quotes, lists, task lists or a horizontal rule.
 */
export function insertBlock(view: EditorView, kind: InsertBlockKind): boolean {
  const state = view.state
  const sel = state.selection.main
  const first = state.doc.lineAt(sel.from)
  const last = state.doc.lineAt(sel.to)
  const selectedLines = state.sliceDoc(first.from, last.to)

  if (kind === 'hr') {
    if (first.from === last.from && first.text.trim() === '') {
      view.dispatch({
        changes: { from: first.from, to: first.to, insert: '---' },
        selection: { anchor: first.from + 3 },
        userEvent: 'input.insert.hr'
      })
    } else {
      const at = last.to
      view.dispatch({
        changes: { from: at, insert: '\n\n---\n\n' },
        selection: { anchor: at + 5 },
        userEvent: 'input.insert.hr'
      })
    }
    return true
  }

  if (kind === 'quote' || kind === 'bullet' || kind === 'ordered' || kind === 'task') {
    const insert = selectedLines
      .split('\n')
      .map((line, i) => prefixLine(line, kind, i))
      .join('\n')
    view.dispatch({
      changes: { from: first.from, to: last.to, insert },
      selection: { anchor: first.from + insert.length },
      userEvent: `input.insert.${kind}`
    })
    return true
  }

  const open = kind === 'code' ? '```' : '$$'
  const close = open
  const body = state.sliceDoc(sel.from, sel.to)
  const block = `${open}\n${body}\n${close}`
  const cursor = open.length + 1 + body.length
  if (!sel.empty) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: block },
      selection: { anchor: sel.from + cursor },
      userEvent: `input.insert.${kind}`
    })
    return true
  }
  if (first.from === last.from && first.text.trim() === '') {
    view.dispatch({
      changes: { from: first.from, to: first.to, insert: block },
      selection: { anchor: first.from + cursor },
      userEvent: `input.insert.${kind}`
    })
  } else {
    const at = last.to
    view.dispatch({
      changes: { from: at, insert: `\n\n${block}` },
      selection: { anchor: at + 2 + cursor },
      userEvent: `input.insert.${kind}`
    })
  }
  return true
}
