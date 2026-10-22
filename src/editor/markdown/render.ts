/**
 * Markdown rendering pipeline for widgets (live mode) and preview mode.
 * markdown-it + plugins (KaTeX / task lists / footnote / sup / sub / mark)
 * + highlight.js for fenced code + DOMPurify sanitization (XSS, PRD §4)
 * + local image src rewriting through the mdimg:// scheme (E-09).
 */
import MarkdownIt from 'markdown-it'
import markdownItMark from 'markdown-it-mark'
import markdownItSup from 'markdown-it-sup'
import markdownItSub from 'markdown-it-sub'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import { katex as katexPlugin } from '@mdit/plugin-katex'
import hljs from 'highlight.js'
import DOMPurify from 'dompurify'
import { isAbsPath, joinPath, normalizeLocalPath, toImageUri } from '../../../shared/paths'
import { t } from '../../lib/i18n'
import type { Block } from '../segmenter'

/**
 * markdown-it v15 ships its types as `export =` (constructor + interface +
 * namespace), so the namespace members are not importable by name.
 */
type MdInstance = InstanceType<typeof MarkdownIt>
type PluginSimple = (md: MdInstance) => void
type PluginWithOptions<T = unknown> = (md: MdInstance, options?: T) => void

export interface RenderEnv {
  /** Directory of the current markdown document (posix, '' if untitled). */
  docDir: string
  [key: string]: unknown
  [key: symbol]: unknown
}

/* ------------------------------- markdown-it ------------------------------- */

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false
})

md.use(katexPlugin as PluginSimple)
md.use(markdownItMark as PluginSimple)
md.use(markdownItSup as PluginSimple)
md.use(markdownItSub as PluginSimple)
md.use(markdownItFootnote as PluginSimple)
md.use(markdownItTaskLists as PluginWithOptions, { enabled: false, label: false })

/* ------------------------------ image handling ----------------------------- */

const EXTERNAL_SRC = /^(https?:|data:|blob:|mdimg:)/i

const defaultImage = md.renderer.rules.image
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const raw = String(token.attrGet('src') || '')
  // markdown-it percent-encodes backslashes -> restore Windows paths.
  const src = normalizeLocalPath(raw)
  if (src !== raw) token.attrSet('src', src)
  if (src && !EXTERNAL_SRC.test(src)) {
    const base = (env as unknown as RenderEnv).docDir ?? ''
    const abs = isAbsPath(src) ? src : base ? joinPath(base, src) : src
    if (isAbsPath(abs)) {
      token.attrSet('src', toImageUri(abs))
    }
    token.attrSet('loading', 'lazy') // E-09 lazy load
  }
  return defaultImage
    ? defaultImage(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

/* --------------------------------- links ----------------------------------- */

const defaultLink = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  const raw = String(token.attrGet('href') || '')
  const href = normalizeLocalPath(raw)
  if (href !== raw) token.attrSet('href', href)
  token.attrSet('rel', 'noopener noreferrer')
  return defaultLink
    ? defaultLink(tokens, idx, options, env, self)
    : self.renderToken(tokens, idx, options)
}

/* ------------------------------- code blocks -------------------------------- */

const escapeHtml = md.utils.escapeHtml

function renderFence(code: string, lang: string): string {
  let highlighted: string
  try {
    highlighted =
      lang && hljs.getLanguage(lang)
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : escapeHtml(code)
  } catch {
    highlighted = escapeHtml(code)
  }
  const langLabel = lang
    ? `<span class="md-code-lang">${escapeHtml(lang)}</span>`
    : '<span class="md-code-lang"></span>'
  const cls = lang ? ` class="hljs language-${escapeHtml(lang)}"` : ' class="hljs"'
  return (
    `<div class="md-code-wrap">` +
    `<div class="md-code-bar">${langLabel}` +
    `<button type="button" class="md-copy-btn" title="${escapeHtml(t('ui.copyCode'))}">${escapeHtml(t('ui.copyCode'))}</button>` +
    `</div>` +
    `<pre><code${cls}>${highlighted}</code></pre>` +
    `</div>`
  )
}

md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  const info = (token.info || '').trim().split(/\s+/)[0] ?? ''
  return renderFence(token.content, info)
}

md.renderer.rules.code_block = (tokens, idx) => renderFence(tokens[idx].content, '')

/* -------------------------------- sanitizing -------------------------------- */

/**
 * DOMPurify's default URI regexp only allows a few schemes; extend it with
 * our own `mdimg://` scheme (local images) and blob: (object URLs).
 */
const ALLOWED_URI_REGEXP =
  /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|mdimg|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.:-]|$))/i

export function sanitizeHtml(html: string): string {
  // Note: inline `style` attributes are kept on purpose — KaTeX positioning
  // spans and Mermaid SVG markup rely on them. DOMPurify strips scripts,
  // event handlers and other active content by default.
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['target', 'rel', 'loading'],
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP
  })
}

/* --------------------------------- rendering -------------------------------- */

/** Render a full markdown document (preview mode). */
export function renderDoc(text: string, env: RenderEnv): string {
  if (!text.trim()) return ''
  return sanitizeHtml(md.render(text, env))
}

/** Render one block's source text into sanitized HTML (live-mode widgets). */
export function renderBlockSource(block: Block, env: RenderEnv): string {
  switch (block.type) {
    case 'frontmatter': {
      return renderFence(
        block.text.replace(/^---[^\n]*\n?/, '').replace(/\n?(---|\.\.\.)[^\n]*$/, ''),
        'yaml'
      )
    }
    case 'hr':
      return '<hr class="md-hr" />'
    case 'fence': {
      if (block.mermaid) {
        // Mermaid mounts asynchronously into this container.
        return '<div class="md-mermaid" data-mermaid-src="1"></div>'
      }
      return renderFence(extractFenceCode(block.text), block.lang ?? '')
    }
    default:
      return sanitizeHtml(md.render(block.text, env))
  }
}

/** Strip the fence lines from raw fence block text. */
export function extractFenceCode(text: string): string {
  const lines = text.split('\n')
  if (lines.length <= 1) return ''
  let end = lines.length - 1
  if (/^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(lines[end])) end--
  return lines.slice(1, end + 1).join('\n')
}

export default md
