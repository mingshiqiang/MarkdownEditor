/**
 * Manual verification helper: checks that a local image referenced with a
 * Windows path in markdown can actually be loaded through the mdimg://
 * protocol (same handler as the app).
 *
 *   npx electron scripts/img-check
 */
const { app, BrowserWindow, protocol } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const SCHEME = 'mdimg'
const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

// Must be called before the app is ready (like in electron/main/protocol.ts).
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { secure: true, supportFetchAPI: true, stream: true } }
])

app.whenReady().then(async () => {
  protocol.handle(SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'local') return new Response('Not Found', { status: 404 })
      const decoded = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const abs = path.normalize(decoded)
      if (!path.isAbsolute(abs)) return new Response('Not Found', { status: 404 })
      const ext = path.extname(abs).toLowerCase()
      if (!MIME[ext]) return new Response('Not Found', { status: 404 })
      const data = fs.readFileSync(abs)
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })

  const target = process.argv[2] || 'D:\\ImageCache\\image-20261010004254788.png'
  const uri = `${SCHEME}://local/${encodeURIComponent(target.replace(/\\/g, '/'))}`
  console.log('requesting:', uri)

  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const html = `<!doctype html><html><body><img id="i" src="${uri}"></body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 1200))
  const result = await win.webContents.executeJavaScript(
    `(() => { const i = document.getElementById('i'); return { complete: i.complete, w: i.naturalWidth, h: i.naturalHeight }; })()`
  )
  console.log('image loaded:', JSON.stringify(result), result.w > 0 ? '✓' : '✗')
  win.destroy()
  app.quit()
})
