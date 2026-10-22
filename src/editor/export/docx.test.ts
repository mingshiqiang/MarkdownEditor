import { describe, expect, it } from 'vitest'
import { markdownToDocx } from './docx'

/** Minimal zip reader good enough to inspect the generated document.xml. */
async function readDocxParts(
  buffer: Uint8Array
): Promise<{ names: string[]; documentXml: string }> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  return { names, documentXml: documentXml ?? '' }
}

describe('markdownToDocx', () => {
  it('produces a valid docx package', async () => {
    const buffer = await markdownToDocx('# 标题\n\n正文', { title: 't' })
    // zip magic
    expect(buffer[0]).toBe(0x50)
    expect(buffer[1]).toBe(0x4b)
    const { names } = await readDocxParts(buffer)
    expect(names).toContain('word/document.xml')
    expect(names).toContain('[Content_Types].xml')
  })

  it('keeps the text content', async () => {
    const buffer = await markdownToDocx('# 中文标题\n\n这是一段正文。', { title: 't' })
    const { documentXml } = await readDocxParts(buffer)
    expect(documentXml).toContain('中文标题')
    expect(documentXml).toContain('这是一段正文')
  })

  it('maps headings to heading styles', async () => {
    const buffer = await markdownToDocx('# H1\n\n## H2', { title: 't' })
    const { documentXml } = await readDocxParts(buffer)
    expect(documentXml).toContain('Heading1')
    expect(documentXml).toContain('Heading2')
  })

  it('renders bold and italic runs', async () => {
    const buffer = await markdownToDocx('**粗体** 和 *斜体*', { title: 't' })
    const { documentXml } = await readDocxParts(buffer)
    expect(documentXml).toContain('<w:b/>')
    expect(documentXml).toContain('<w:i/>')
  })

  it('renders lists, quotes, code and tables', async () => {
    const buffer = await markdownToDocx(
      [
        '- 项目一',
        '',
        '> 引用',
        '',
        '```js',
        'const a = 1',
        '```',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |'
      ].join('\n'),
      { title: 't' }
    )
    const { documentXml } = await readDocxParts(buffer)
    expect(documentXml).toContain('w:numPr') // list numbering
    expect(documentXml).toContain('w:tbl') // table
    expect(documentXml).toContain('Consolas') // code font
  })
})
