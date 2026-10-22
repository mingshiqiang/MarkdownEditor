/**
 * Word (.docx) export (X-03).
 *
 * The markdown source is parsed with markdown-it and the resulting token
 * stream is mapped onto Word structures (headings, paragraphs, runs with
 * bold/italic/strike/code, hyperlinks, lists, quotes, code blocks, tables).
 * Building the document ourselves keeps the app free of an external Pandoc
 * dependency (PRD allows "built-in or external Pandoc").
 */
import MarkdownIt from 'markdown-it'
import type { Token } from 'markdown-it'
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { ParagraphChild } from 'docx'
import { mermaidSvg, svgToPng } from './mermaid'

const md = new MarkdownIt({ html: false, linkify: false, breaks: false })

const HEADING_LEVELS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6
}

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
}

/**
 * Walk the (flat) markdown-it inline token stream and build Word runs.
 * markdown-it emits `strong_open` / `text` / `strong_close` as siblings, so
 * the styles have to be tracked with a stack instead of by recursion.
 */
function makeRuns(children: Token[] | null, style: RunStyle = {}): ParagraphChild[] {
  const runs: ParagraphChild[] = []
  const stack: RunStyle[] = []
  let current: RunStyle = { ...style }
  let linkHref: string | null = null
  let linkRuns: TextRun[] = []

  const flushLink = (): void => {
    if (linkHref && linkRuns.length) {
      runs.push(new ExternalHyperlink({ link: linkHref, children: linkRuns }))
    } else {
      runs.push(...linkRuns)
    }
    linkRuns = []
  }

  for (const child of children ?? []) {
    switch (child.type) {
      case 'strong_open':
        stack.push({ ...current })
        current = { ...current, bold: true }
        break
      case 'strong_close':
        current = stack.pop() ?? current
        break
      case 'em_open':
        stack.push({ ...current })
        current = { ...current, italics: true }
        break
      case 'em_close':
        current = stack.pop() ?? current
        break
      case 's_open':
        stack.push({ ...current })
        current = { ...current, strike: true }
        break
      case 's_close':
        current = stack.pop() ?? current
        break
      case 'link_open':
        linkHref = String(child.attrGet('href') ?? '')
        linkRuns = []
        break
      case 'link_close':
        flushLink()
        linkHref = null
        break
      case 'code_inline':
        linkRuns.push(new TextRun({ text: child.content, font: 'Consolas', color: '953800' }))
        break
      case 'text':
        linkRuns.push(
          new TextRun({
            text: child.content,
            bold: current.bold,
            italics: current.italics,
            strike: current.strike
          })
        )
        break
      case 'image': {
        const alt = child.content || String(child.attrGet('alt') ?? '')
        linkRuns.push(new TextRun({ text: alt, italics: true, color: '656d76' }))
        break
      }
      case 'softbreak':
        linkRuns.push(new TextRun({ text: ' ' }))
        break
      case 'hardbreak':
        linkRuns.push(new TextRun({ break: 1 }))
        break
      default:
        break
    }
  }
  flushLink()
  return runs
}

function alignFromToken(
  token: Token
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  const style = String(token.attrGet('style') ?? '')
  if (/text-align:\s*center/i.test(style)) return AlignmentType.CENTER
  if (/text-align:\s*right/i.test(style)) return AlignmentType.RIGHT
  if (/text-align:\s*left/i.test(style)) return AlignmentType.LEFT
  return undefined
}

function paragraphFromInline(
  token: Token,
  options?: { align?: (typeof AlignmentType)[keyof typeof AlignmentType] }
): Paragraph {
  return new Paragraph({
    children: makeRuns(token.children),
    spacing: { after: 120 },
    alignment: options?.align
  })
}

/** Convert a markdown document into a .docx buffer. */
export async function markdownToDocx(
  markdown: string,
  options: { title: string; docDir?: string }
): Promise<Uint8Array> {
  const env = { docDir: options.docDir ?? '' } as never
  const tokens = md.parse(markdown, env)
  const children: (Paragraph | Table)[] = []

  const numbering = {
    config: [
      {
        reference: 'mde-bullets',
        levels: [
          {
            level: 0,
            format: 'bullet' as const,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          },
          {
            level: 1,
            format: 'bullet' as const,
            text: '◦',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } }
          }
        ]
      },
      {
        reference: 'mde-ordered',
        levels: [
          {
            level: 0,
            format: 'decimal' as const,
            text: '%1.',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } }
          },
          {
            level: 1,
            format: 'lowerLetter' as const,
            text: '%2)',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 1440, hanging: 360 } } }
          }
        ]
      }
    ]
  }

  let listType: 'ul' | 'ol' = 'ul'
  let listLevel = 0
  let i = 0

  while (i < tokens.length) {
    const token = tokens[i]

    switch (token.type) {
      case 'heading_open': {
        const level = Number(token.tag.slice(1))
        const inline = tokens[i + 1]
        children.push(
          new Paragraph({
            children: makeRuns(inline?.children),
            heading: HEADING_LEVELS[level] ?? HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 120 }
          })
        )
        i += 3
        continue
      }
      case 'paragraph_open': {
        const inline = tokens[i + 1]
        if (inline?.type === 'inline' && inline.content.trim() === '') {
          i += 3
          continue
        }
        children.push(paragraphFromInline(inline ?? token, { align: alignFromToken(token) }))
        i += 3
        continue
      }
      case 'fence':
      case 'code_block': {
        if (token.type === 'fence' && token.info.trim().toLowerCase() === 'mermaid') {
          const code = token.content.replace(/\n$/, '')
          const svg = await mermaidSvg(code)
          const png = svg ? await svgToPng(svg, 520) : null
          if (png) {
            children.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    type: 'png',
                    data: png.bytes,
                    transformation: { width: png.width, height: png.height }
                  })
                ],
                spacing: { after: 120 }
              })
            )
            i += 1
            continue
          }
        }
        const lines = token.content.replace(/\n$/, '').split('\n')
        for (const line of lines) {
          children.push(
            new Paragraph({
              children: [new TextRun({ text: line, font: 'Consolas', size: 19, color: '953800' })],
              shading: { type: ShadingType.CLEAR, fill: 'F6F8FA' },
              spacing: { after: 0 }
            })
          )
        }
        children.push(new Paragraph({ children: [], spacing: { after: 120 } }))
        i += 1
        continue
      }
      case 'blockquote_open': {
        const quoted: Token[] = []
        let depth = 1
        i += 1
        while (i < tokens.length && depth > 0) {
          if (tokens[i].type === 'blockquote_open') depth++
          else if (tokens[i].type === 'blockquote_close') {
            depth--
            if (depth === 0) break
          } else quoted.push(tokens[i])
          i += 1
        }
        for (const q of quoted) {
          if (q.type === 'inline') {
            children.push(
              new Paragraph({
                children: makeRuns(q.children),
                indent: { left: 480 },
                border: {
                  left: { style: BorderStyle.SINGLE, size: 18, color: 'B8C0C8', space: 8 }
                },
                spacing: { after: 100 }
              })
            )
          }
        }
        i += 1
        continue
      }
      case 'bullet_list_open':
        listType = 'ul'
        listLevel = 0
        i += 1
        continue
      case 'ordered_list_open':
        listType = 'ol'
        listLevel = 0
        i += 1
        continue
      case 'bullet_list_close':
      case 'ordered_list_close':
        i += 1
        continue
      case 'list_item_open': {
        const inline = tokens[i + 1]
        children.push(
          new Paragraph({
            children: makeRuns(inline?.children),
            numbering: {
              reference: listType === 'ul' ? 'mde-bullets' : 'mde-ordered',
              level: Math.min(listLevel, 1),
              instance: 0
            },
            spacing: { after: 60 }
          })
        )
        i += 2
        if (tokens[i]?.type === 'paragraph_close') i += 1
        continue
      }
      case 'hr': {
        children.push(
          new Paragraph({
            children: [new TextRun({ text: '─'.repeat(40), color: 'D8DEE4' })],
            spacing: { before: 120, after: 120 }
          })
        )
        i += 1
        continue
      }
      case 'table_open': {
        const rows: Token[][] = []
        let currentRow: Token[] = []
        i += 1
        while (i < tokens.length && tokens[i].type !== 'table_close') {
          if (tokens[i].type === 'tr_open') {
            currentRow = []
          } else if (tokens[i].type === 'td_open' || tokens[i].type === 'th_open') {
            currentRow.push(tokens[i + 1] ?? tokens[i])
          } else if (tokens[i].type === 'tr_close') {
            rows.push(currentRow)
          }
          i += 1
        }
        i += 1
        if (rows.length > 0) {
          const columnCount = Math.max(...rows.map((r) => r.length))
          const tableRows = rows.map(
            (row, rowIndex) =>
              new TableRow({
                children: Array.from({ length: columnCount }, (_, c) => {
                  const cell = row[c]
                  return new TableCell({
                    children: [
                      new Paragraph({
                        children: cell ? makeRuns(cell.children) : [],
                        spacing: { after: 0 }
                      })
                    ],
                    shading:
                      rowIndex === 0 ? { type: ShadingType.CLEAR, fill: 'F6F8FA' } : undefined
                  })
                })
              })
          )
          children.push(
            new Table({
              rows: tableRows,
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: {
                top: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' },
                left: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' },
                right: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' },
                insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'D0D7DE' }
              }
            })
          )
          children.push(new Paragraph({ children: [], spacing: { after: 120 } }))
        }
        continue
      }
      default:
        i += 1
        continue
    }
  }

  const doc = new Document({
    creator: 'MarkdownEditor',
    title: options.title,
    description: 'Exported from MarkdownEditor',
    numbering,
    sections: [
      {
        properties: {},
        children: children.length ? children : [new Paragraph({ children: [] })]
      }
    ]
  })

  return Packer.toBuffer(doc)
}
