/**
 * Export document builders (M4).
 *
 * - `buildExportHtml`  : self-contained HTML (theme CSS inlined, local images
 *                        embedded as data URIs) used for both the HTML export
 *                        and the PDF print document.
 * - `buildPrintHtml`    : the same document plus print specific CSS
 *                        (@page, page breaks, no interactive chrome).
 */
import MarkdownIt from 'markdown-it'
import { katex as katexPlugin } from '@mdit/plugin-katex'
import markdownItMark from 'markdown-it-mark'
import markdownItSup from 'markdown-it-sup'
import markdownItSub from 'markdown-it-sub'
import markdownItFootnote from 'markdown-it-footnote'
import markdownItTaskLists from 'markdown-it-task-lists'
import DOMPurify from 'dompurify'
import themeCss from '../../themes/index.css?inline'
import { isAbsPath, joinPath, normalizeLocalPath, toImageUri } from '../../../shared/paths'
import { renderMermaid } from '../markdown/mermaid'

export interface ExportEnv {
  /** Directory of the document (posix) — used to resolve relative images. */
  docDir: string
  /** The theme the exported document uses. */
  theme: 'light' | 'light-warm' | 'dark' | 'dark-purple'
  title: string
  /** Extra CSS (e.g. the variables of the active user theme). */
  customCss?: string
}

const md = new MarkdownIt({
  html: true,
  linkify: false,
  typographer: false,
  breaks: false
})

md.use(katexPlugin as never)
md.use(markdownItMark as never)
md.use(markdownItSup as never)
md.use(markdownItSub as never)
md.use(markdownItFootnote as never)
md.use(markdownItTaskLists as never, { enabled: false, label: false })

// Mermaid fences become placeholders; they are replaced with the rendered
// diagram after the sanitizing step (the SVG comes from mermaid itself).
// The placeholder is plain text so that it survives the sanitizing.
const defaultFence = md.renderer.rules.fence
const MERMAID_MARKER = 'mermaid-diagram-'

/** The diagram sources of the current render (index = placeholder number). */
let mermaidBlocks: string[] = []

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (token.info.trim().toLowerCase() === 'mermaid') {
    const code = token.content.replace(/\n$/, '')
    const index = mermaidBlocks.push(code) - 1
    return `<div class="md-mermaid">${MERMAID_MARKER}${index}</div>`
  }
  return defaultFence
    ? defaultFence(tokens, idx, options, env, self)
    : `<pre><code>${escapeHtml(token.content)}</code></pre>`
}

/** Resolve local image sources to absolute file paths. */
function localImagePath(src: string, docDir: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(src)) return null
  const normalized = normalizeLocalPath(src)
  if (isAbsPath(normalized)) return normalized
  if (!docDir) return null
  return joinPath(docDir, normalized)
}

/** Read a local image and return a data URI (base64). */
async function inlineImage(absPath: string, _docDir: string): Promise<string | null> {
  try {
    const res = await fetch(toImageUri(absPath))
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** Render markdown to sanitized HTML with images inlined as data URIs. */
export async function renderExportHtml(markdown: string, env: ExportEnv): Promise<string> {
  const envForMd = { docDir: env.docDir } as never
  mermaidBlocks = []
  const html = md.render(markdown, envForMd)

  // Inline local images (data URIs) so the export is self-contained.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || ''
    const abs = localImagePath(src, env.docDir)
    if (!abs) continue
    const dataUri = await inlineImage(abs, env.docDir)
    if (dataUri) img.setAttribute('src', dataUri)
  }

  const clean = DOMPurify.sanitize(doc.body.innerHTML, {
    ADD_ATTR: ['target', 'rel', 'loading'],
    ALLOW_DATA_ATTR: false
  })

  // Mermaid: the diagram SVG is inserted after the sanitizing step, because
  // sanitizing would strip the labels of the diagram.
  const out = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html')
  for (const holder of Array.from(out.querySelectorAll('.md-mermaid'))) {
    const marker = (holder.textContent || '').trim()
    if (!marker.startsWith(MERMAID_MARKER)) continue
    const index = Number(marker.slice(MERMAID_MARKER.length))
    const code = mermaidBlocks[index]
    if (code === undefined) continue
    const result = await renderMermaid(code)
    holder.innerHTML = result.ok
      ? result.html
      : `<pre class="md-mermaid-error">${escapeHtml(code)}</pre>`
  }
  return out.body.innerHTML
}

/** Base styles shared by the HTML export and the print document. */
const EXPORT_CSS = `
:root { color-scheme: light dark; }
html, body { margin: 0; padding: 0; }
body {
  font-family: 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC',
               'Source Han Sans SC', 'Hiragino Sans GB', sans-serif;
  font-size: 16px; line-height: 1.75; color: #1f2328; background: #fff;
}
.page { max-width: 820px; margin: 0 auto; padding: 40px 32px; }
h1 { font-size: 1.9em; border-bottom: 1px solid #d8dee4; padding-bottom: .25em; }
h2 { font-size: 1.5em; border-bottom: 1px solid #d8dee4; padding-bottom: .2em; }
h3 { font-size: 1.25em; } h4 { font-size: 1.1em; } h5 { font-size: 1em; } h6 { font-size: .95em; }
h1, h2, h3, h4, h5, h6 { margin: 1.1em 0 .5em; font-weight: 600; line-height: 1.35; }
p { margin: 0 0 .7em; }
a { color: #0969da; text-decoration: none; }
code { font-family: Consolas, 'Cascadia Code', monospace; font-size: .9em;
  background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 3px; padding: .1em .35em; }
pre { background: #f6f8fa; border: 1px solid #d8dee4; border-radius: 6px; padding: 12px 14px;
  overflow-x: auto; font-size: .88em; line-height: 1.5; }
pre code { background: none; border: none; padding: 0; }
blockquote { margin: 0 0 .7em; padding: .2em 1em; color: #57606a;
  border-left: 4px solid #b8c0c8; background: #f6f8fa; }
hr { border: none; border-top: 1px solid #d8dee4; margin: 1.4em 0; }
table { border-collapse: collapse; margin: 0 0 .9em; }
th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
th { background: #f6f8fa; font-weight: 600; }
img { max-width: 100%; }
.md-mermaid { display: flex; justify-content: center; margin: 0 0 .9em; }
.md-mermaid svg { max-width: 100%; height: auto; }
.mark { background: #ddf4ff; }
ul, ol { margin: 0 0 .7em; padding-left: 1.7em; }
li { margin: .15em 0; }
.hljs-comment { color: #6e7781; font-style: italic; }
.hljs-keyword { color: #cf222e; } .hljs-string { color: #0a3069; }
.hljs-number { color: #0550ae; } .hljs-title { color: #8250df; }
`

/** Standalone HTML document (X-01). */
export function buildExportHtml(body: string, env: ExportEnv): string {
  const theme = env.theme
  return `<!doctype html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(env.title)}</title>
<style>
${EXPORT_CSS}
</style>
<style>
${themeCss}
</style>
${
  env.customCss
    ? `<style>
${env.customCss}
</style>`
    : ''
}
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`
}

/** Print document used for the PDF export (X-02). */
export function buildPrintHtml(
  body: string,
  env: ExportEnv,
  options: {
    pageSize: string
    landscape: boolean
    margins: { top: number; bottom: number; left: number; right: number }
  }
): string {
  const mm = (px: number) => `${((px / 96) * 25.4).toFixed(1)}mm`
  const page = `@page { size: ${options.pageSize}${options.landscape ? ' landscape' : ''};
  margin: ${mm(options.margins.top)} ${mm(options.margins.right)} ${mm(options.margins.bottom)} ${mm(options.margins.left)}; }`
  return `<!doctype html>
<html lang="zh-CN" data-theme="light">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(env.title)}</title>
<style>
${page}
${EXPORT_CSS}
/* print tweaks */
body { background: #fff; }
.page { max-width: none; margin: 0; padding: 0; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
pre, blockquote, table, figure { break-inside: avoid; page-break-inside: avoid; }
thead { display: table-header-group; }
tr { break-inside: avoid; page-break-inside: avoid; }
img { max-width: 100%; break-inside: avoid; }
a { color: #0969da; }
</style>
</head>
<body>
<div class="page">
${body}
</div>
</body>
</html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
