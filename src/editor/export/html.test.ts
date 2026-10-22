import { describe, expect, it } from 'vitest'
import { buildExportHtml, buildPrintHtml, renderExportHtml } from './html'

const env = { docDir: '', theme: 'light' as const, title: '测试文档' }

describe('renderExportHtml', () => {
  it('renders markdown into html', async () => {
    const html = await renderExportHtml('# 标题\n\n正文 **加粗**', env)
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain('<strong>加粗</strong>')
  })

  it('strips scripts and event handlers', async () => {
    const html = await renderExportHtml(
      '<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">',
      env
    )
    expect(html).not.toContain('<script')
    expect(html).not.toContain('onerror')
  })

  it('renders tables and task lists', async () => {
    const html = await renderExportHtml('| a | b |\n| --- | --- |\n| 1 | 2 |\n\n- [x] done', env)
    expect(html).toContain('<table>')
    expect(html).toContain('task-list-item-checkbox')
  })

  it('turns mermaid fences into a diagram block', async () => {
    const html = await renderExportHtml('```mermaid\ngraph TD;\nA-->B;\n```', env)
    expect(html).toContain('md-mermaid')
    // The fence is not exported as a code block anymore.
    expect(html).not.toContain('language-mermaid')
  })
})

describe('mermaid code encoding', () => {
  it('round-trips the diagram source', async () => {
    const { encodeMermaidCode, decodeMermaidCode } = await import('./mermaid')
    const code = 'graph TD;\n  A[开始]-->B[结束];'
    expect(decodeMermaidCode(encodeMermaidCode(code))).toBe(code)
  })
})

describe('windows image paths', () => {
  it('resolves absolute windows paths to the mdimg scheme', async () => {
    const md = await import('../markdown/render')
    const html = md.renderBlockSource(
      {
        type: 'paragraph',
        from: 0,
        to: 0,
        lineFrom: 1,
        lineTo: 1,
        text: '![img](D:\\ImageCache\\image-1.png)'
      },
      { docDir: '' }
    )
    // markdown-it percent-encodes the backslashes; they must be restored
    expect(html).toContain('mdimg://local/D%3A%2FImageCache%2Fimage-1.png')
  })

  it('resolves relative image paths against the document folder', async () => {
    const md = await import('../markdown/render')
    const html = md.renderBlockSource(
      {
        type: 'paragraph',
        from: 0,
        to: 0,
        lineFrom: 1,
        lineTo: 1,
        text: '![img](assets/pic.png)'
      },
      { docDir: 'D:/docs' }
    )
    expect(html).toContain('mdimg://local/D%3A%2Fdocs%2Fassets%2Fpic.png')
  })
})

describe('buildExportHtml', () => {
  it('creates a standalone document with the theme and title', async () => {
    const body = await renderExportHtml('# 标题', env)
    const html = buildExportHtml(body, env)
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<title>测试文档</title>')
    expect(html).toContain('data-theme="light"')
    expect(html).toContain('<style>')
    // the app theme css is inlined
    expect(html).toContain('--ed-font-family')
    expect(html).toContain('<h1>标题</h1>')
  })

  it('uses the dark theme when requested', async () => {
    const body = await renderExportHtml('# x', { ...env, theme: 'dark' })
    expect(buildExportHtml(body, { ...env, theme: 'dark' })).toContain('data-theme="dark"')
  })

  it('embeds the user theme variables (U-02)', async () => {
    const body = await renderExportHtml('# x', env)
    const html = buildExportHtml(body, {
      ...env,
      theme: 'dark',
      customCss: ':root[data-theme] {\n  --bg: #0b1f2e;\n}\n'
    })
    expect(html).toContain('--bg: #0b1f2e;')
  })
})

describe('buildPrintHtml', () => {
  it('adds page rules and print tweaks', async () => {
    const body = await renderExportHtml('# 标题', env)
    const html = buildPrintHtml(body, env, {
      pageSize: 'A4',
      landscape: true,
      margins: { top: 64, bottom: 64, left: 72, right: 72 }
    })
    expect(html).toContain('@page')
    expect(html).toContain('A4 landscape')
    expect(html).toContain('page-break-inside: avoid')
    expect(html).toContain('thead { display: table-header-group; }')
  })

  it('converts pixel margins to millimetres', async () => {
    const body = await renderExportHtml('# x', env)
    const html = buildPrintHtml(body, env, {
      pageSize: 'A4',
      landscape: false,
      margins: { top: 96, bottom: 96, left: 96, right: 96 }
    })
    expect(html).toContain('25.4mm')
  })
})
