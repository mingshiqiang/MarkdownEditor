/**
 * Remote image helpers (E-09): offer to download a remote image and store
 * it locally; the markdown source is rewritten to the local path.
 */
import type { EditorView } from '@codemirror/view'
import { downloadRemoteImage } from './extensions/images'
import type { Block } from './segmenter'

const REMOTE_RE = /^https?:\/\//i

/** Position of an image source inside the block source. */
export function findImageSrcRange(block: Block, src: string): { from: number; to: number } | null {
  const idx = block.text.indexOf(src)
  if (idx < 0) return null
  return { from: block.from + idx, to: block.from + idx + src.length }
}

/**
 * Add a "download" button to every remote image of a rendered block.
 */
export function addRemoteImageButtons(root: HTMLElement, view: EditorView, block: Block): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || ''
    if (!REMOTE_RE.test(src)) continue
    img.classList.add('md-img-remote')

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'md-img-download'
    button.title = '下载到本地'
    button.textContent = '⬇'
    button.addEventListener('mousedown', (e) => e.stopPropagation())
    button.addEventListener('click', async (e) => {
      e.preventDefault()
      e.stopPropagation()
      button.disabled = true
      const mdPath = await downloadRemoteImage(src)
      button.disabled = false
      if (!mdPath) return
      const range = findImageSrcRange(block, src)
      if (!range) return
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: mdPath },
        userEvent: 'input.image.localize'
      })
    })

    const wrap = document.createElement('span')
    wrap.className = 'md-img-wrap'
    img.replaceWith(wrap)
    wrap.appendChild(img)
    wrap.appendChild(button)
  }
}
