/**
 * CodeMirror theme & highlight style. Colors are wired through CSS variables
 * (themes/index.css), so switching app themes never rebuilds the editor.
 */
import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxTree } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--ed-fg)',
    fontSize: 'var(--ed-font-size)',
    backgroundColor: 'transparent'
  },
  '.cm-scroller': {
    fontFamily: 'var(--ed-font-family)',
    lineHeight: 'var(--ed-line-height)',
    overflowY: 'auto',
    overflowX: 'hidden'
  },
  '.cm-content': {
    maxWidth: 'var(--ed-max-width)',
    margin: '0 auto',
    padding: '24px 24px 40vh 24px',
    caretColor: 'var(--ed-caret)',
    width: '100%'
  },
  '.cm-line': { padding: '0 2px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': {
    borderLeft: '2px solid var(--ed-caret)',
    borderRight: 'none',
    marginLeft: '-1px'
  },
  '&.cm-focused .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--ed-selection)'
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--ed-selection-match)' },
  // search panel
  '.cm-panels': {
    backgroundColor: 'var(--ed-panel-bg)',
    color: 'var(--ed-fg)',
    borderColor: 'var(--ed-border)'
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    backgroundColor: 'var(--ed-input-bg)',
    color: 'var(--ed-fg)',
    borderColor: 'var(--ed-border)',
    borderRadius: '4px',
    fontFamily: 'inherit'
  },
  '.cm-panel.cm-search label': { color: 'var(--ed-fg-muted)' },
  '.cm-searchMatch': { backgroundColor: 'var(--ed-search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--ed-search-match-selected)' },
  // markdown source-mode styles (live mode hides them via widgets)
  '.cm-md-h1': { color: 'var(--md-h1)', fontSize: '1.35em', fontWeight: '600' },
  '.cm-md-h2': { color: 'var(--md-h2)', fontSize: '1.25em', fontWeight: '600' },
  '.cm-md-h3': { color: 'var(--md-h3)', fontSize: '1.15em', fontWeight: '600' },
  '.cm-md-h4': { color: 'var(--md-h4)', fontWeight: '600' },
  '.cm-md-h5': { color: 'var(--md-h5)', fontWeight: '600' },
  '.cm-md-h6': { color: 'var(--md-h6)', fontWeight: '600' },
  '.cm-md-heading': { color: 'var(--md-heading)', fontWeight: '600' },
  '.cm-md-em': { fontStyle: 'italic' },
  '.cm-md-strong': { fontWeight: '700' },
  '.cm-md-strike': { textDecoration: 'line-through' },
  '.cm-md-code': { fontFamily: 'var(--ed-mono-font-family)', color: 'var(--md-code)' },
  '.cm-md-link': { color: 'var(--md-link)' },
  '.cm-md-url': { color: 'var(--md-link)', textDecoration: 'underline' },
  '.cm-md-quote': { color: 'var(--md-quote)' },
  '.cm-md-marker': { color: 'var(--md-marker)' },
  '.cm-md-hr': { color: 'var(--md-marker)' },
  '.cm-tok-keyword': { color: 'var(--tok-keyword)' },
  '.cm-tok-string': { color: 'var(--tok-string)' },
  '.cm-tok-number': { color: 'var(--tok-number)' },
  '.cm-tok-comment': { color: 'var(--tok-comment)', fontStyle: 'italic' },
  '.cm-tok-func': { color: 'var(--tok-func)' },
  '.cm-tok-var': { color: 'var(--tok-var)' },
  '.cm-tok-type': { color: 'var(--tok-type)' }
})

export const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-md-h1' },
  { tag: t.heading2, class: 'cm-md-h2' },
  { tag: t.heading3, class: 'cm-md-h3' },
  { tag: t.heading4, class: 'cm-md-h4' },
  { tag: t.heading5, class: 'cm-md-h5' },
  { tag: t.heading6, class: 'cm-md-h6' },
  { tag: t.heading, class: 'cm-md-heading' },
  { tag: t.emphasis, class: 'cm-md-em' },
  { tag: t.strong, class: 'cm-md-strong' },
  { tag: t.strikethrough, class: 'cm-md-strike' },
  { tag: t.link, class: 'cm-md-link' },
  { tag: t.url, class: 'cm-md-url' },
  { tag: t.monospace, class: 'cm-md-code' },
  { tag: t.quote, class: 'cm-md-quote' },
  { tag: t.processingInstruction, class: 'cm-md-marker' },
  { tag: t.contentSeparator, class: 'cm-md-hr' },
  // generic code tokens (fenced code in source mode)
  { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], class: 'cm-tok-keyword' },
  { tag: [t.string, t.special(t.string)], class: 'cm-tok-string' },
  { tag: [t.number, t.bool, t.null], class: 'cm-tok-number' },
  { tag: [t.comment, t.lineComment, t.blockComment], class: 'cm-tok-comment' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'cm-tok-func' },
  { tag: t.variableName, class: 'cm-tok-var' },
  { tag: [t.typeName, t.className, t.namespace], class: 'cm-tok-type' }
])

/** Resolve a lezer tree node name at a position (used for hover helpers). */
export function nodeAt(view: EditorView, pos: number): string | null {
  const node = syntaxTree(view.state).resolveInner(pos, -1)
  return node?.name ?? null
}
