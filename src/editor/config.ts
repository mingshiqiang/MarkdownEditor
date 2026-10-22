/**
 * Extension assembly: builds EditorStates per document with a mode compartment
 * (live / source / preview) so switching modes reconfigures in place.
 */
import { Compartment, EditorState, Prec } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { indentUnit, syntaxHighlighting } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import type { EditorMode } from '../../shared/types'
import { editorShortcutExtension } from './extensions/keymaps'
import { liveRender } from './extensions/liveRender'
import { editorDomHandlers } from './extensions/images'
import { editorTheme, mdHighlight } from './theme'
import { docIdField, docDirField } from './docFields'
import { editorBus } from './bus'

export const modeCompartment = new Compartment()
/** Spell checking is toggled at runtime (E-15). */
export const spellcheckCompartment = new Compartment()

const mdLanguage = markdown({ codeLanguages: languages, base: markdownLanguage })

export function modeExtensions(mode: EditorMode): Extension[] {
  // 'preview' hides the whole editor; 'source' shows raw markdown with
  // syntax highlighting; 'live' adds the widget decorations.
  return mode === 'live' ? [liveRender()] : []
}

const updateListener = EditorView.updateListener.of((u) => {
  const docId = u.state.field(docIdField, false) || ''
  if (u.docChanged) for (const h of editorBus.onDocChanged) h(docId, u)
  if (u.selectionSet || u.docChanged) for (const h of editorBus.onCursorMoved) h(docId, u)
  if (u.focusChanged) for (const h of editorBus.onFocusChanged) h(docId, u)
})

export function buildEditorState(opts: {
  content: string
  mode: EditorMode
  docId: string
  docDir: string
  spellcheck?: boolean
}): EditorState {
  return EditorState.create({
    doc: opts.content,
    extensions: [
      EditorView.lineWrapping,
      history(),
      drawSelection(),
      dropCursor(),
      indentUnit.of('  '),
      closeBrackets(),
      editorShortcutExtension,
      Prec.highest(keymap.of(searchKeymap)),
      keymap.of(defaultKeymap),
      keymap.of(historyKeymap),
      keymap.of(closeBracketsKeymap),
      search({ top: true }),
      mdLanguage,
      syntaxHighlighting(mdHighlight),
      editorTheme,
      EditorView.domEventHandlers(editorDomHandlers),
      updateListener,
      docIdField.init(() => opts.docId),
      docDirField.init(() => opts.docDir),
      spellcheckCompartment.of(
        opts.spellcheck ? EditorView.contentAttributes.of({ spellcheck: 'true' }) : []
      ),
      modeCompartment.of(modeExtensions(opts.mode))
    ],
    selection: { anchor: Math.min(opts.content.length, 0) }
  })
}
