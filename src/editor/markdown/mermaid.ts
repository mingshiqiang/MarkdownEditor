/**
 * Mermaid manager: lazy-loads the (large) mermaid bundle on first use,
 * caches rendered SVG per code + theme, and re-renders on theme change.
 * securityLevel 'strict' (default) keeps mermaid's own sanitization on.
 */
type MermaidModule = (typeof import('mermaid'))['default']

let mermaidApi: MermaidModule | null = null
let loadPromise: Promise<MermaidModule> | null = null
let theme: 'default' | 'dark' = 'default'
let renderRev = 0
let counter = 0

/**
 * Mermaid is initialized with SVG text labels instead of HTML labels: the
 * HTML variant renders the labels inside a <foreignObject>, which taints the
 * canvas and would make the Word export (PNG) impossible.
 */
const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  htmlLabels: false,
  theme
}

/** Bumped on theme change so widgets can rebuild (WidgetType.eq). */
export function mermaidRenderRev(): number {
  return renderRev
}

export async function setMermaidTheme(next: string): Promise<void> {
  const nextTheme = next === 'dark' || next === 'dark-purple' ? 'dark' : 'default'
  if (nextTheme === theme) return
  theme = nextTheme
  renderRev++
  if (mermaidApi) {
    mermaidApi.initialize({ ...MERMAID_CONFIG, theme })
  }
}

async function loadMermaid(): Promise<MermaidModule> {
  if (mermaidApi) return mermaidApi
  if (!loadPromise) {
    loadPromise = import('mermaid').then((m) => {
      const api = m.default
      api.initialize({ ...MERMAID_CONFIG, theme })
      mermaidApi = api
      return api
    })
  }
  return loadPromise
}

export interface MermaidRenderResult {
  ok: boolean
  html: string
}

const cache = new Map<string, MermaidRenderResult>()

export async function renderMermaid(code: string): Promise<MermaidRenderResult> {
  const key = `${theme}\u0000${code}`
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const api = await loadMermaid()
    const id = `mde-mermaid-${++counter}`
    const { svg } = await api.render(id, code)
    const result: MermaidRenderResult = { ok: true, html: svg }
    cache.set(key, result)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const result: MermaidRenderResult = {
      ok: false,
      html: `<pre class="md-mermaid-error">${escapeHtml(message)}</pre>`
    }
    cache.set(key, result)
    return result
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Cache size guard for very large documents. */
export function pruneMermaidCache(limit = 200): void {
  if (cache.size > limit) {
    const excess = cache.size - limit
    let dropped = 0
    for (const key of cache.keys()) {
      if (dropped >= excess) break
      cache.delete(key)
      dropped++
    }
  }
}
