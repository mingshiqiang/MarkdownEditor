/**
 * Export services (M4 / X-01..X-04).
 *
 * - HTML: the renderer produces a self-contained document, we just write it.
 * - PDF:  a hidden window renders the print document and Chromium prints it
 *   to PDF. Chromium embeds (and subsets) the fonts that are actually used,
 *   so Chinese text stays selectable and self-contained in the PDF.
 * - Word: the renderer builds a .docx buffer, we write the bytes.
 * - Image: a hidden window renders the document, is captured tile by tile
 *   and the tiles are stitched into one long PNG (X-04).
 */
import { app, BrowserWindow, dialog, type BrowserWindow as BW } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import type { ImageExportOptions } from '../../shared/types'

export interface PdfOptions {
  pageSize: 'A4' | 'Letter' | 'A3' | 'Legal'
  landscape: boolean
  marginType: 'default' | 'none' | 'custom'
  margins: { top: number; bottom: number; left: number; right: number }
  printBackground: boolean
  scale: number
  /** Page number footer, e.g. "第 <page>/<pages> 页" */
  footer: string
}

export const DEFAULT_PDF_OPTIONS: PdfOptions = {
  pageSize: 'A4',
  landscape: false,
  marginType: 'custom',
  margins: { top: 64, bottom: 64, left: 72, right: 72 },
  printBackground: true,
  scale: 1,
  footer:
    '<div style="width:100%;font-size:9px;color:#888;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
}

async function saveWithDialog(
  win: BW | null,
  suggestedName: string,
  extensions: string[],
  write: (target: string) => void
): Promise<string | null> {
  const res = win
    ? await dialog.showSaveDialog(win, {
        defaultPath: suggestedName,
        filters: [{ name: extensions.join(' / ').toUpperCase(), extensions }]
      })
    : await dialog.showSaveDialog({
        defaultPath: suggestedName,
        filters: [{ name: extensions.join(' / ').toUpperCase(), extensions }]
      })
  if (res.canceled || !res.filePath) return null
  try {
    write(res.filePath)
    return res.filePath
  } catch {
    return null
  }
}

/** X-01: standalone HTML file. */
export async function exportHtml(
  win: BW | null,
  html: string,
  suggestedName: string
): Promise<string | null> {
  return saveWithDialog(win, suggestedName, ['html', 'htm'], (target) => {
    fs.writeFileSync(target, html, 'utf-8')
  })
}

/** X-02: PDF via Chromium printing. */
export async function exportPdf(
  win: BW | null,
  html: string,
  suggestedName: string,
  options: PdfOptions
): Promise<string | null> {
  // A hidden window is used so the print job is not tied to the main window
  // (the user may keep working while the PDF is produced).
  const printer = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true
    }
  })

  try {
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await printer.loadURL(dataUrl)
    // Give webfonts / images a moment to settle before printing.
    await new Promise((resolve) => setTimeout(resolve, 350))
    const pdf = await printer.webContents.printToPDF({
      pageSize: options.pageSize,
      landscape: options.landscape,
      printBackground: options.printBackground,
      scale: options.scale,
      // Electron expects the margins in INCHES (the dialog works in px).
      margins:
        options.marginType === 'none'
          ? { top: 0, bottom: 0, left: 0, right: 0 }
          : options.marginType === 'default'
            ? undefined
            : {
                top: pxToInches(options.margins.top),
                bottom: pxToInches(options.margins.bottom),
                left: pxToInches(options.margins.left),
                right: pxToInches(options.margins.right)
              },
      displayHeaderFooter: Boolean(options.footer),
      headerTemplate: '<div></div>',
      footerTemplate: options.footer,
      preferCSSPageSize: true
    })

    return await saveWithDialog(win, suggestedName, ['pdf'], (target) => {
      fs.writeFileSync(target, pdf)
    })
  } finally {
    if (!printer.isDestroyed()) printer.destroy()
  }
}

/** X-03: Word document produced by the renderer. */
export async function exportDocx(
  win: BW | null,
  bytes: ArrayBuffer | Uint8Array,
  suggestedName: string
): Promise<string | null> {
  const buffer = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  return saveWithDialog(win, suggestedName, ['docx'], (target) => {
    fs.writeFileSync(target, buffer)
  })
}

/** CSS pixels -> inches (Electron's printToPDF expects inches). */
function pxToInches(px: number): number {
  return Math.round((px / 96) * 1000) / 1000
}

/* --------------------------------- image ---------------------------------- */

export const DEFAULT_IMAGE_OPTIONS: ImageExportOptions = {
  width: 820,
  scale: 2,
  background: 'light'
}

/** Viewport height (CSS px) used while capturing the tiles. */
const CAPTURE_VIEWPORT = 900
/** Chromium cannot allocate a canvas taller than this. */
const MAX_CANVAS_HEIGHT = 16000

interface Tile {
  /** Offset of the tile inside the stitched image (device pixels). */
  y: number
  /** Width of the tile (device pixels). */
  width: number
  /** Height of the tile (device pixels). */
  height: number
  /** PNG data (base64). */
  data: string
}

/** Injects the background, the width and hides the scrollbar of the capture document. */
function imageExportHtml(
  html: string,
  background: ImageExportOptions['background'],
  width: number
): string {
  const bg =
    background === 'transparent' ? 'transparent' : background === 'dark' ? '#1f2227' : '#ffffff'
  const style = `<style>html,body{background:${bg} !important;margin:0}
.page{max-width:${width}px !important}
html{scrollbar-width:none}
::-webkit-scrollbar{display:none !important}</style>`
  return html.replace('</head>', `${style}</head>`)
}

/** Draws the tiles into one canvas and returns the PNG data URL. */
async function stitchTiles(
  shot: BrowserWindow,
  tiles: Tile[],
  width: number,
  height: number,
  background: ImageExportOptions['background']
): Promise<string> {
  return shot.webContents.executeJavaScript(
    `(async (payload) => {
      const canvas = document.createElement('canvas')
      canvas.width = payload.width
      canvas.height = payload.height
      const ctx = canvas.getContext('2d')
      if (payload.background !== 'transparent') {
        ctx.fillStyle = payload.background
        ctx.fillRect(0, 0, payload.width, payload.height)
      }
      for (const tile of payload.tiles) {
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = resolve
          img.onerror = reject
          img.src = 'data:image/png;base64,' + tile.data
        })
        ctx.drawImage(img, 0, tile.y)
      }
      return canvas.toDataURL('image/png')
    })(${JSON.stringify({ tiles, width, height, background })})`
  )
}

/** X-04: long image (PNG) of the whole document. */
export async function exportImage(
  win: BW | null,
  html: string,
  suggestedName: string,
  options: ImageExportOptions
): Promise<string | null> {
  const tmpDir = path.join(app.getPath('userData'), 'tmp')
  fs.mkdirSync(tmpDir, { recursive: true })
  const tmpFile = path.join(tmpDir, `export-${Date.now()}.html`)
  fs.writeFileSync(tmpFile, imageExportHtml(html, options.background, options.width), 'utf-8')

  // The window is `scale` times larger than the document layout and the zoom
  // factor is `scale` as well: the page therefore keeps its layout (the CSS
  // viewport stays `width` pixels wide) and is rendered at `scale` times the
  // display resolution.
  const scale = Math.max(1, Math.min(4, options.scale || 1))
  const shot = new BrowserWindow({
    show: false,
    width: options.width * scale,
    height: CAPTURE_VIEWPORT * scale,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  try {
    shot.setContentSize(options.width * scale, CAPTURE_VIEWPORT * scale)
    await shot.loadFile(tmpFile)
    shot.webContents.setZoomFactor(scale)
    // Let webfonts and images settle before measuring.
    await new Promise((resolve) => setTimeout(resolve, 500))
    await shot.webContents
      .executeJavaScript('document.fonts && document.fonts.ready')
      .catch(() => undefined)

    const metrics = await shot.webContents.executeJavaScript(
      '({ height: document.documentElement.scrollHeight })'
    )
    const totalHeight = Math.max(1, Math.ceil(Number(metrics?.height) || 1))

    const tiles: Tile[] = []
    const maxScroll = Math.max(0, totalHeight - CAPTURE_VIEWPORT)
    const tileCount = Math.ceil(totalHeight / CAPTURE_VIEWPORT)
    let offset = 0
    for (let index = 0; index < tileCount; index++) {
      const y = index * CAPTURE_VIEWPORT
      const remaining = Math.min(CAPTURE_VIEWPORT, totalHeight - y)
      // The last tile may be scrolled past the end of the document; it is
      // cropped to the part that is still content.
      const scroll = Math.min(y, maxScroll)
      await shot.webContents.executeJavaScript(`window.scrollTo(0, ${scroll})`)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const image = await shot.webContents.capturePage()
      const size = image.getSize()
      let tile = image
      if (remaining < CAPTURE_VIEWPORT) {
        const fromTop = scroll === y
        tile = image.crop({
          x: 0,
          y: fromTop ? 0 : size.height - remaining,
          width: size.width,
          height: remaining
        })
      }
      const tileSize = tile.getSize()
      tiles.push({
        y: offset,
        width: tileSize.width,
        height: tileSize.height,
        data: tile.toPNG().toString('base64')
      })
      offset += tileSize.height
    }
    if (tiles.length === 0) return null

    // Stitch the tiles; very long documents are split into several files
    // because Chromium cannot allocate a canvas taller than 16000 pixels.
    await shot.loadURL('about:blank')
    const parts: string[] = []
    let group: Tile[] = []
    let groupHeight = 0
    const flush = async (): Promise<void> => {
      if (group.length === 0) return
      const baseY = group[0]?.y ?? 0
      const data = await stitchTiles(
        shot,
        group.map((t) => ({ ...t, y: t.y - baseY })),
        group[0]?.width ?? 0,
        groupHeight,
        options.background
      )
      parts.push(data)
      group = []
      groupHeight = 0
    }
    for (const tile of tiles) {
      if (groupHeight + tile.height > MAX_CANVAS_HEIGHT) await flush()
      group.push(tile)
      groupHeight += tile.height
    }
    await flush()

    return await saveWithDialog(win, suggestedName, ['png'], (target) => {
      parts.forEach((data, index) => {
        const file = index === 0 ? target : target.replace(/\.png$/i, `-part${index + 1}.png`)
        fs.writeFileSync(file, Buffer.from(data.split(',')[1] ?? '', 'base64'))
      })
    })
  } finally {
    if (!shot.isDestroyed()) shot.destroy()
    try {
      fs.unlinkSync(tmpFile)
    } catch {
      /* ignore */
    }
  }
}

/** Suggested file name for an export (based on the document name). */
export function exportFileName(docName: string, ext: string): string {
  const base = path.basename(docName).replace(/\.(md|markdown|mkd|txt)$/i, '')
  return `${base || 'document'}.${ext}`
}
