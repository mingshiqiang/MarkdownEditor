/**
 * Mermaid for the export pipeline (X-01..X-04).
 *
 * The editor renders diagrams into the DOM; the exports need the diagram as
 * markup: the HTML/PDF/long image exports embed the SVG, the Word export
 * embeds a rasterized PNG (Word cannot embed SVG).
 */
import { renderMermaid } from '../markdown/mermaid'

/** Base64 of the UTF-8 text (used to smuggle the code through the HTML). */
export function encodeMermaidCode(code: string): string {
  const bytes = new TextEncoder().encode(code)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The inverse of `encodeMermaidCode`. */
export function decodeMermaidCode(encoded: string): string {
  try {
    const binary = atob(encoded)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return ''
  }
}

/** The SVG markup of a mermaid diagram (null when it cannot be rendered). */
export async function mermaidSvg(code: string): Promise<string | null> {
  const result = await renderMermaid(code)
  return result.ok ? result.html : null
}

/** Rasterizes SVG markup to PNG bytes (for the Word export). */
export async function svgToPng(
  svg: string,
  targetWidth: number
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  try {
    // Mermaid renders with width="100%", so the intrinsic size has to come
    // from the viewBox.
    const viewBox = /viewBox="([^"]+)"/.exec(svg)
    let ratio = 0.6
    if (viewBox) {
      const parts = viewBox[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number)
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) ratio = parts[3] / parts[2]
    }
    const width = Math.max(1, Math.round(targetWidth))
    const height = Math.max(1, Math.round(width * ratio))
    // Give the SVG an explicit size so the browser can rasterize it.
    const sized = svg.replace(
      /<svg\b([^>]*)>/,
      (_match, attrs: string) =>
        `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${width}" height="${height}">`
    )

    const blob = new Blob([sized], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('could not load the diagram'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/png')
    URL.revokeObjectURL(url)
    const binary = atob(dataUrl.split(',')[1] ?? '')
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return { bytes, width, height }
  } catch {
    return null
  }
}
