// Word-style autocorrect for typing in the Markdown editor: smart quotes,
// dashes, ellipsis and (c) (r) (tm). It runs off EditorView.inputHandler so it
// sees user typing only (never paste, programmatic edits or IME composition),
// and never inside code, math, URLs or HTML.
//
// Undo feel, like Word: the typed character and the correction are two
// separate history events, so Mod-z undoes only the correction; and a
// Backspace straight after a correction restores what was typed.
import {
  EditorState, StateEffect, StateField, Prec, Compartment, Transaction, type Extension,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { isolateHistory, undo } from '@codemirror/commands'
import { syntaxTree, ensureSyntaxTree } from '@codemirror/language'
import { inlineMathInLine } from './liveScan'
import { composingNow } from './compositionGuard'

// ------------------------------------------------------------------- zones

// Inside these (strictly between from and to) nothing is corrected.
const STRICT_ZONES = new Set(['InlineCode', 'LinkTitle', 'HTMLTag', 'Comment', 'CommentBlock', 'ProcessingInstruction'])
// Inside these, edges included (a caret at the end of a URL is still in it).
const EDGE_ZONES = new Set(['FencedCode', 'CodeBlock', 'CodeText', 'CodeInfo', 'URL', 'Autolink', 'HTMLBlock', 'Table'])

/** True when `pos` is somewhere typing must stay literal: code, math, URLs, HTML. */
export function inLiteralZone(state: EditorState, pos: number): boolean {
  const line = state.doc.lineAt(pos)
  const before = state.doc.sliceString(line.from, pos)

  if (inFrontMatter(state, line.number)) return true

  // an unclosed backtick on this line (the code span is not in the tree yet)
  if ((before.match(/(?<!\\)`/g)?.length ?? 0) % 2 === 1) return true

  // a bare URL / address being typed
  const token = /\S*$/.exec(before)![0]
  if (/^[(<[]?(?:https?:\/\/|ftp:\/\/|www\.|mailto:)/i.test(token) || token.includes('://')) return true

  // inline math, closed or still open
  if (before.indexOf('$') !== -1 || line.text.indexOf('$') !== -1) {
    for (const m of inlineMathInLine(line.text, line.from)) if (pos > m.from && pos < m.to) return true
    const last = before.lastIndexOf('$')
    if (last !== -1 && before[last - 1] !== '$' && before[last - 1] !== '\\' && !/[\p{L}\p{N}]/u.test(before[last - 1] ?? '')) {
      const next = before[last + 1]
      // `$5` is a price, `$ ` is not math; `$x^2` is math in progress, but only
      // when a closing `$` follows on this line (`$HOME` or `US$` is just text).
      if (next !== undefined && !/[\s\d]/.test(next) && closingDollarAhead(before, line.text.slice(pos - line.from))) return true
    }
  }
  // block math: an odd number of `$$` opener lines above (single-line $$x$$ pairs cancel)
  if (state.doc.length > 1 && line.number > 1) {
    const above = state.doc.sliceString(0, line.from)
    if (above.indexOf('$$') !== -1) {
      let open = false
      for (const l of above.split('\n')) {
        const t = l.trim()
        if (!t.startsWith('$$')) continue
        if (open) { if (t === '$$' || t.endsWith('$$')) open = false } else if (t === '$$' || t.indexOf('$$', 2) === -1) open = true
      }
      if (open) return true
    }
  }
  if (line.text.trim().startsWith('$$') && line.text.trim().indexOf('$$', 2) === -1 && pos > line.from + line.text.indexOf('$$')) return true

  // the syntax tree: fences, code spans, links' URLs, HTML
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 25) ?? syntaxTree(state)
  for (const side of [-1, 1] as const) {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, side); n; n = n.parent) {
      if (STRICT_ZONES.has(n.name) && n.from < pos && pos < n.to) return true
      if (EDGE_ZONES.has(n.name) && n.from <= pos && pos <= n.to) return true
    }
  }
  return false
}

/** A `$` ahead on the line whose left neighbour is not a space (a math closer). */
function closingDollarAhead(before: string, after: string): boolean {
  for (let j = after.indexOf('$'); j !== -1; j = after.indexOf('$', j + 1)) {
    const left = j === 0 ? before.slice(-1) : after[j - 1]
    if (left && !/\s/.test(left) && left !== '\\') return true
  }
  return false
}

/** Is line `lineNo` inside a leading YAML front matter block (`---` ... `---`)? */
function inFrontMatter(state: EditorState, lineNo: number): boolean {
  const doc = state.doc
  if (doc.line(1).text.trimEnd() !== '---') return false
  const cap = Math.min(doc.lines, 300)
  for (let n = 2; n <= cap; n++) {
    const t = doc.line(n).text.trimEnd()
    if (t === '---' || t === '...') return lineNo <= n
  }
  return false
}

// -------------------------------------------------------------------- plan

export interface AutocorrectPlan {
  // The typed edit; null when the typed character steps over an existing one.
  typed: { from: number; to: number; insert: string } | null
  // The correction, in coordinates of the document after the typed edit.
  fix: { from: number; to: number; insert: string }
  // What the correction replaced.
  original: string
  // True when the caret sits right after the correction (Backspace can revert it).
  caretAtEnd: boolean
}

const OPENING_BEFORE = /[\s([{<“‘—–*_~|>]/
const L = '\\p{L}\\p{N}'
const EM_RE = new RegExp(`([${L}])--([${L}][${L}'’]*)$`, 'u')
const EN_RE = /[^\s-]\s--\s[^\s-]+$/
const TRIGGER = /^[\s"'.,;:!?)]$/
const DELIMITER = /^[\s.,;:!?)]$/
const MARK_RE = new RegExp(`(^|[^${L}])\\((c|r|tm)$`, 'iu')
const MARKS: Record<string, string> = { c: '©', r: '®', tm: '™' }

/**
 * What typing `text` over [from, to) should turn into, or null for plain
 * typing. Pure: reads the state, changes nothing.
 */
export function planAutocorrect(state: EditorState, from: number, to: number, text: string): AutocorrectPlan | null {
  // Fast exit: almost every keystroke is a plain letter.
  if (!TRIGGER.test(text)) return null
  const line = state.doc.lineAt(from)
  const before = state.doc.sliceString(line.from, from)
  const typed = { from, to, insert: text }
  const prev = before.slice(-1)

  let plan: AutocorrectPlan | null = null

  if (text === '"' || text === "'") {
    if (prev === '\\' || prev === '`') return null
    // `**"Quoted"**` and `|"cell"|`: emphasis marks do not count as the previous character
    const ctx = before.replace(/[*_~]+$/, '')
    // a second quote right after an opening one is the closing half of an empty pair
    const emptyPair = (text === '"' && prev === '“') || (text === "'" && prev === '‘')
    const opening = !emptyPair && (ctx === '' || OPENING_BEFORE.test(ctx.slice(-1)))
    const insert = text === '"' ? (opening ? '“' : '”') : (opening ? '‘' : '’')
    plan = { typed, fix: { from, to: from + 1, insert }, original: text, caretAtEnd: true }
  } else if (text === '.' && before.endsWith('..') && !before.endsWith('...')) {
    plan = { typed, fix: { from: from - 2, to: from + 1, insert: '…' }, original: '...', caretAtEnd: true }
  } else if (text === ')') {
    const m = MARK_RE.exec(before)
    // `(c)` / `(r)` opening a line is a list enumeration, not a symbol
    if (m && before.slice(0, before.length - m[2].length - 1).trim() !== '') {
      const len = m[2].length + 1
      const stepOver = from === to && state.doc.sliceString(to, to + 1) === ')'
      plan = {
        typed: stepOver ? null : typed,
        fix: { from: from - len, to: from + 1, insert: MARKS[m[2].toLowerCase()] },
        original: before.slice(-len) + ')',
        caretAtEnd: true,
      }
    }
  }
  if (!plan && DELIMITER.test(text) && before.includes('--')) {
    const em = EM_RE.exec(before)
    if (em) {
      const at = line.from + before.length - em[0].length + em[1].length
      const range = /\d/.test(em[1]) && /^\d/.test(em[2]) // 1--2 is a range
      plan = { typed, fix: { from: at, to: at + 2, insert: range ? '–' : '—' }, original: '--', caretAtEnd: false }
    } else {
      const en = EN_RE.exec(before)
      if (en) {
        const at = line.from + before.length - en[0].length + en[0].indexOf('--')
        plan = { typed, fix: { from: at, to: at + 2, insert: '–' }, original: '--', caretAtEnd: false }
      }
    }
  }
  if (!plan) return null
  if (inLiteralZone(state, from)) return null
  return plan
}

// ------------------------------------------------------------------- state

export interface AutocorrectRecord {
  // Range of the correction as it now stands.
  from: number
  to: number
  replacement: string
  original: string
  // Caret offset at which Backspace reverts it; null when it only undoes.
  revertAt: number | null
}

const setRecord = StateEffect.define<AutocorrectRecord>()

/** The last autocorrect, kept only until the next edit or caret move. */
export const lastAutocorrect = StateField.define<AutocorrectRecord | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRecord)) return e.value
    return tr.docChanged || tr.selection ? null : v
  },
})

/** The transactions that apply a plan: the typed edit, then the isolated correction. */
export function autocorrectTransactions(state: EditorState, plan: AutocorrectPlan): Transaction[] {
  const out: Transaction[] = []
  let st = state
  let head: number
  if (plan.typed) {
    const tr1 = st.update({
      changes: plan.typed,
      selection: { anchor: plan.typed.from + plan.typed.insert.length },
      userEvent: 'input.type',
      scrollIntoView: true,
    })
    out.push(tr1)
    st = tr1.state
    head = plan.typed.from + plan.typed.insert.length
  } else {
    head = plan.fix.to
  }
  const mapped = st.changes(plan.fix).mapPos(head, 1)
  const end = plan.fix.from + plan.fix.insert.length
  out.push(st.update({
    changes: plan.fix,
    selection: { anchor: mapped },
    userEvent: 'input.autocorrect',
    annotations: isolateHistory.of('full'),
    effects: setRecord.of({
      from: plan.fix.from, to: end, replacement: plan.fix.insert, original: plan.original,
      revertAt: plan.caretAtEnd ? end : null,
    }),
    scrollIntoView: true,
  }))
  return out
}

type CmdView = Pick<EditorView, 'state' | 'dispatch'>

/** Backspace straight after an autocorrect puts back what was typed. */
export function revertAutocorrect(view: CmdView): boolean {
  const rec = view.state.field(lastAutocorrect, false)
  if (!rec || rec.revertAt === null) return false
  const sel = view.state.selection.main
  if (!sel.empty || sel.head !== rec.revertAt) return false
  if (view.state.sliceDoc(rec.from, rec.to) !== rec.replacement) return false
  // Prefer history: it restores exactly the typed state and leaves redo usable.
  if (undo(view as EditorView)) return true
  view.dispatch({
    changes: { from: rec.from, to: rec.to, insert: rec.original },
    selection: { anchor: rec.from + rec.original.length },
    userEvent: 'delete.autocorrect',
  })
  return true
}

const inputExtension = EditorView.inputHandler.of((view, from, to, text) => {
  if (composingNow(view) || view.state.readOnly) return false
  if (view.state.selection.ranges.length > 1) return false
  const plan = planAutocorrect(view.state, from, to, text)
  if (!plan) return false
  view.dispatch(autocorrectTransactions(view.state, plan))
  return true
})

/** The autocorrect extension (input handler, undo state, Backspace revert). */
export function autocorrectExtension(): Extension {
  return [
    lastAutocorrect,
    Prec.high(inputExtension),
    Prec.highest(keymap.of([{ key: 'Backspace', run: (v) => revertAutocorrect(v) }])),
  ]
}

const acCompartment = new Compartment()
/** The compartment slot for the editor's extension list. */
export function autocorrectSlot(on: boolean): Extension {
  return acCompartment.of(on ? autocorrectExtension() : [])
}
/** Turn autocorrect on or off for a mounted view. */
export function setAutocorrect(view: EditorView, on: boolean): void {
  view.dispatch({ effects: acCompartment.reconfigure(on ? autocorrectExtension() : []) })
}
