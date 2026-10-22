/**
 * Manual verification helper (not part of the app):
 * prints a small Chinese document to PDF so the result can be inspected
 * (text extraction + embedded fonts).
 *
 *   npx electron scripts/print-check.cjs <output.pdf>
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>中文测试</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: 'Segoe UI','Microsoft YaHei','PingFang SC','Noto Sans CJK SC',sans-serif;
         font-size: 16px; line-height: 1.75; color: #1f2328; }
  h1 { font-size: 1.9em; } h2 { font-size: 1.4em; }
  code { font-family: Consolas, monospace; }
  table { border-collapse: collapse; } th, td { border: 1px solid #d0d7de; padding: 6px 12px; }
</style></head>
<body>
  <h1>中文导出测试</h1>
  <p>这是一段用于验证 PDF 字体嵌入的中文文本，包含标点符号：你好，世界！（测试）</p>
  <p>混排 English 与中文，数字 12345。</p>
  <h2>二级标题</h2>
  <ul><li>列表项一</li><li>列表项二</li></ul>
  <blockquote>引用块：中文引用内容。</blockquote>
  <table><tr><th>名称</th><th>说明</th></tr><tr><td>实时渲染</td><td>Typora 式</td></tr></table>
  <pre><code>const 中文 = "代码块";</code></pre>
</body></html>`

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true }
  })
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(HTML)}`)
  await new Promise((r) => setTimeout(r, 600))
  const pdf = await win.webContents.printToPDF({
    pageSize: 'A4',
    printBackground: true,
    margins: { top: 0.75, bottom: 0.75, left: 0.8, right: 0.8 },
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      '<div style="width:100%;font-size:9px;color:#888;text-align:center;font-family:sans-serif;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'
  })
  const out = path.resolve(process.argv[2] || 'print-check.pdf')
  fs.writeFileSync(out, pdf)
  console.log(`PDF written: ${out} (${(pdf.length / 1024).toFixed(1)} KB)`)
  win.destroy()
  app.quit()
})
