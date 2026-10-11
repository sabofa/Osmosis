// Live preview for the CodeMirror markdown editor (Obsidian-style): markdown
// renders in place and the raw marks are revealed only where the caret or a
// selection is. The document text never changes (copy yields the markdown
// source); marks are hidden with Decoration.replace, which keeps them in the
// DOM text model. Every colour, font and size is a var(--de-*) reference or a
// relative unit.
import { type EditorState, type Extension, type ChangeDesc } from '@codemirror/state'
import {
  Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'

export interface LiveSpan { from: number; to: number }

export interface LiveContext {
  selection: readonly LiveSpan[]
  composing: boolean
  viewport: readonly LiveSpan[]
  // What the builder returns unchanged while composing (the IME contract).
  previous?: readonly DecoSpec[]
}

export interface DecoSpec {
  from: number
  to: number
  deco: Decoration
  // Replace decorations that hide marks: the cursor skips them (atomic).
  hidden?: boolean
}

// ---------------------------------------------------------------- widgets

class BulletWidget extends WidgetType {
  readonly depth: number
  constructor(depth: number) { super(); this.depth = depth }
  eq(o: BulletWidget): boolean { return o.depth === this.depth }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.setAttribute('aria-hidden', 'true')
    s.textContent = this.depth % 3 === 0 ? '•' : this.depth % 3 === 1 ? '◦' : '▪'
    return s
  }
  ignoreEvent(): boolean { return false }
}

class CheckboxWidget extends WidgetType {
  readonly checked: boolean
  constructor(checked: boolean) { super(); this.checked = checked }
  eq(o: CheckboxWidget): boolean { return o.checked === this.checked }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-check'
    box.checked = this.checked
    box.tabIndex = -1
    // Keep the caret where it is; the toggle is a plain source edit.
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleTaskAt(view, view.posAtDOM(box))
    })
    box.addEventListener('click', (e) => e.preventDefault())
    return box
  }
  ignoreEvent(): boolean { return true }
}

/** Flip `[ ]` <-> `[x]` for the task marker starting at `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  const mid = view.state.sliceDoc(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(mid)) return false
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: mid[1] === ' ' ? 'x' : ' ' },
    userEvent: 'input',
  })
  return true
}

// ------------------------------------------------------------ decorations

const lineDeco = (cls: string, style?: string) =>
  Decoration.line({ attributes: style ? { class: cls, style } : { class: cls } })
const markDeco = (cls: string) => Decoration.mark({ class: cls })
const HIDE = Decoration.replace({})

const HEADING = /^ATXHeading([1-6])$/
const SETEXT = /^SetextHeading([12])$/
const SKIP_FENCE = new Set(['math', 'graph', 'latex'])

const touches = (sel: readonly LiveSpan[], from: number, to: number): boolean =>
  sel.some((r) => r.from <= to && r.to >= from)

function childrenOf(n: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
  return out
}

function listDepth(n: SyntaxNode): number {
  let d = 0
  for (let p = n.parent; p; p = p.parent) if (p.name === 'ListItem') d++
  return d
}

/**
 * Pure: the decorations live preview wants for `state`, as flat specs. While
 * composing it returns ctx.previous untouched (the plugin maps it instead).
 */
export function buildLiveDecos(state: EditorState, ctx: LiveContext): DecoSpec[] {
  if (ctx.composing) return ctx.previous ? [...ctx.previous] : []
  const out: DecoSpec[] = []
  const seen = new Set<string>()
  const doc = state.doc
  const sel = ctx.selection
  const push = (from: number, to: number, deco: Decoration, hidden = false, key?: string) => {
    if (to <= from && key === undefined) return
    const k = key ?? `${from}:${to}:${hidden ? 'h' : 'm'}:${String(deco.spec.class ?? deco.spec.attributes?.class ?? deco.spec.widget?.constructor?.name ?? '')}`
    if (seen.has(k)) return
    seen.add(k)
    out.push({ from, to, deco, hidden })
  }
  const pushLine = (lineFrom: number, deco: Decoration) => push(lineFrom, lineFrom, deco, false, `L${lineFrom}:${deco.spec.attributes.class}`)
  const hide = (from: number, to: number) => { if (to > from) push(from, to, HIDE, true) }
  // `mark` plus one following space (inside the line).
  const withSpace = (_from: number, mTo: number) => (doc.sliceString(mTo, mTo + 1) === ' ' ? mTo + 1 : mTo)

  const tree = syntaxTree(state)
  const lineItems = new Map<number, { depth: number; first: boolean }>()
  const quoteLines = new Set<number>()

  for (const vp of ctx.viewport) {
    const vf = Math.max(0, vp.from), vt = Math.min(doc.length, vp.to)
    tree.iterate({
      from: vf, to: vt,
      enter: (nodeRef) => {
        const name = nodeRef.name
        const node = nodeRef.node
        let m: RegExpExecArray | null

        if ((m = HEADING.exec(name))) {
          const line = doc.lineAt(nodeRef.from)
          pushLine(line.from, lineDeco(`cm-lp-h cm-lp-h${m[1]}`))
          if (!touches(sel, line.from, line.to)) {
            const hm = childrenOf(node, 'HeaderMark')[0]
            if (hm && hm.from === nodeRef.from) hide(hm.from, withSpace(hm.from, hm.to))
          }
          return
        }
        if ((m = SETEXT.exec(name))) {
          const a = doc.lineAt(nodeRef.from), b = doc.lineAt(nodeRef.to)
          for (let n = a.number; n <= b.number; n++) pushLine(doc.line(n).from, lineDeco(`cm-lp-h cm-lp-h${m[1]}`))
          return
        }
        switch (name) {
          case 'StrongEmphasis':
          case 'Emphasis':
          case 'Strikethrough':
          case 'InlineCode': {
            const cls = name === 'StrongEmphasis' ? 'cm-lp-strong' : name === 'Emphasis' ? 'cm-lp-em'
              : name === 'Strikethrough' ? 'cm-lp-strike' : 'cm-lp-icode'
            push(nodeRef.from, nodeRef.to, markDeco(cls))
            if (!touches(sel, nodeRef.from, nodeRef.to)) {
              const markName = name === 'InlineCode' ? 'CodeMark' : name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
              for (const mk of childrenOf(node, markName)) hide(mk.from, mk.to)
            }
            return
          }
          case 'Link': {
            const marks = childrenOf(node, 'LinkMark')
            const open = marks[0]
            const close = marks.find((mk) => mk !== open && doc.sliceString(mk.from, mk.to) === ']')
            if (!open || !close) return
            if (touches(sel, nodeRef.from, nodeRef.to)) {
              push(nodeRef.from, nodeRef.to, markDeco('cm-lp-link cm-lp-link-src'))
            } else {
              push(open.to, close.from, markDeco('cm-lp-link'))
              hide(open.from, open.to)
              hide(close.from, nodeRef.to)
            }
            return
          }
          case 'Blockquote': {
            const a = doc.lineAt(Math.max(nodeRef.from, vf)), b = doc.lineAt(Math.min(nodeRef.to, vt))
            for (let n = a.number; n <= b.number; n++) quoteLines.add(doc.line(n).from)
            return
          }
          case 'QuoteMark': {
            const line = doc.lineAt(nodeRef.from)
            if (!touches(sel, line.from, line.to)) hide(nodeRef.from, withSpace(nodeRef.from, nodeRef.to))
            return
          }
          case 'ListItem': {
            const depth = listDepth(node)
            const a = doc.lineAt(Math.max(nodeRef.from, vf)), b = doc.lineAt(Math.min(nodeRef.to, vt))
            const firstLine = doc.lineAt(nodeRef.from).number
            for (let n = a.number; n <= b.number; n++) {
              lineItems.set(doc.line(n).from, { depth, first: n === firstLine })
            }
            return
          }
          case 'ListMark': {
            const line = doc.lineAt(nodeRef.from)
            const par = node.parent?.parent
            const ordered = par?.name === 'OrderedList'
            const item = node.parent
            const isTask = !!item && childrenOf(item, 'Task').length > 0
            const hideRaw = !touches(sel, line.from, line.to)
            const end = withSpace(nodeRef.from, nodeRef.to)
            if (ordered) {
              push(nodeRef.from, end, markDeco('cm-lp-olmark'))
            } else if (isTask) {
              if (hideRaw) hide(nodeRef.from, end)
            } else if (hideRaw) {
              push(nodeRef.from, end, Decoration.replace({ widget: new BulletWidget(listDepth(node) - 1) }), true)
            } else {
              push(nodeRef.from, end, markDeco('cm-lp-bullet-raw'))
            }
            return
          }
          case 'TaskMarker': {
            const txt = doc.sliceString(nodeRef.from, nodeRef.to)
            if (!touches(sel, nodeRef.from, nodeRef.to)) {
              const checked = /x/i.test(txt)
              push(nodeRef.from, withSpace(nodeRef.from, nodeRef.to),
                Decoration.replace({ widget: new CheckboxWidget(checked) }), true)
              if (checked) {
                const line = doc.lineAt(nodeRef.from)
                push(withSpace(nodeRef.from, nodeRef.to), line.to, markDeco('cm-lp-done'))
              }
            }
            return
          }
          case 'HorizontalRule': {
            const line = doc.lineAt(nodeRef.from)
            if (!touches(sel, line.from, line.to)) {
              pushLine(line.from, lineDeco('cm-lp-hr'))
              hide(nodeRef.from, nodeRef.to)
            } else {
              push(nodeRef.from, nodeRef.to, markDeco('cm-lp-dim'))
            }
            return
          }
          case 'FencedCode': {
            const info = childrenOf(node, 'CodeInfo')[0]
            const lang = info ? doc.sliceString(info.from, info.to).trim().split(/\s+/)[0] : ''
            if (SKIP_FENCE.has(lang)) return false
            const marks = childrenOf(node, 'CodeMark')
            const first = doc.lineAt(nodeRef.from).number
            const last = doc.lineAt(nodeRef.to).number
            const closes = marks.length >= 2 ? doc.lineAt(marks[marks.length - 1].from).number : -1
            const inside = touches(sel, nodeRef.from, nodeRef.to)
            const a = Math.max(first, doc.lineAt(Math.max(nodeRef.from, vf)).number)
            const b = Math.min(last, doc.lineAt(Math.min(nodeRef.to, vt)).number)
            for (let n = a; n <= b; n++) {
              const isFence = n === first || n === closes
              let cls = 'cm-lp-code'
              if (n === first) cls += ' cm-lp-code-first'
              if (n === last) cls += ' cm-lp-code-last'
              if (isFence && !inside) cls += ' cm-lp-fence'
              pushLine(doc.line(n).from, lineDeco(cls))
            }
            if (info) push(info.from, info.to, markDeco('cm-lp-lang'))
            return false
          }
          case 'Table':
            return false
        }
      },
    })
  }

  for (const from of quoteLines) pushLine(from, lineDeco('cm-lp-quote'))
  for (const [from, { depth, first }] of lineItems) {
    const pad = (depth + 1) * 1.5
    pushLine(from, lineDeco(first ? 'cm-lp-li cm-lp-li-first' : 'cm-lp-li',
      first ? `padding-inline-start:${pad}em;text-indent:-${pad}em` : `padding-inline-start:${pad}em`))
    // Leading source indent keeps a constant width (no jump when revealed).
    const line = doc.lineAt(from)
    const text = line.text
    const ws = /^[ \t]*/.exec(text)![0].length
    if (ws > 0) {
      // Quote marks sit before the indent on `> ` lines; only plain lines.
      push(from, from + ws, Decoration.mark({
        attributes: { class: 'cm-lp-indent', style: `width:${first ? depth * 1.5 : 0}em` },
      }))
    }
  }
  return out
}

/** Flat specs to a sorted DecorationSet. */
export function specsToSet(specs: readonly DecoSpec[]): DecorationSet {
  return Decoration.set(specs.map((s) => s.deco.range(s.from, s.to)), true)
}
export function specsToHidden(specs: readonly DecoSpec[]): DecorationSet {
  return Decoration.set(specs.filter((s) => s.hidden && s.to > s.from).map((s) => s.deco.range(s.from, s.to)), true)
}

// ----------------------------------------------------------------- planner

export type UpdatePlan = 'keep' | 'map' | 'rebuild'

/**
 * What an update must do to the decorations. While composing nothing is
 * rebuilt (changes only map the existing set); the plugin forces a rebuild
 * after compositionend.
 */
export function planUpdate(f: {
  docChanged: boolean; selectionSet: boolean; viewportChanged: boolean
  treeChanged: boolean; composing: boolean; forced: boolean
}): UpdatePlan {
  if (f.composing) return f.docChanged ? 'map' : 'keep'
  if (f.forced || f.docChanged || f.selectionSet || f.viewportChanged || f.treeChanged) return 'rebuild'
  return 'keep'
}

const MARGIN = 2000

/** The ranges to decorate: view.visibleRanges plus a margin, merged. */
export function viewportSpans(ranges: readonly LiveSpan[], docLength: number): LiveSpan[] {
  const out: LiveSpan[] = []
  for (const r of ranges) {
    const from = Math.max(0, r.from - MARGIN), to = Math.min(docLength, r.to + MARGIN)
    const last = out[out.length - 1]
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else out.push({ from, to })
  }
  return out
}

class LivePlugin {
  specs: DecoSpec[] = []
  decorations: DecorationSet = Decoration.none
  hidden: DecorationSet = Decoration.none
  forced = false
  constructor(view: EditorView) { this.rebuild(view) }
  rebuild(view: EditorView) {
    const sel = view.state.selection.ranges.map((r) => ({ from: r.from, to: r.to }))
    this.specs = buildLiveDecos(view.state, {
      selection: sel, composing: false,
      viewport: viewportSpans(view.visibleRanges, view.state.doc.length),
    })
    this.decorations = specsToSet(this.specs)
    this.hidden = specsToHidden(this.specs)
    this.forced = false
  }
  update(u: ViewUpdate) {
    const plan = planUpdate({
      docChanged: u.docChanged, selectionSet: u.selectionSet, viewportChanged: u.viewportChanged,
      treeChanged: syntaxTree(u.startState) !== syntaxTree(u.state),
      composing: u.view.composing || u.view.compositionStarted, forced: this.forced,
    })
    if (plan === 'rebuild') this.rebuild(u.view)
    else if (plan === 'map') this.map(u.changes)
  }
  map(changes: ChangeDesc) {
    this.decorations = this.decorations.map(changes)
    this.hidden = this.hidden.map(changes)
  }
}

const livePlugin = ViewPlugin.fromClass(LivePlugin, {
  decorations: (v) => v.decorations,
  provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.hidden ?? Decoration.none),
  eventHandlers: {
    compositionend(_e, view) {
      // After CodeMirror has settled the composition, rebuild once.
      setTimeout(() => {
        const pl = view.plugin(livePlugin)
        if (!pl || view.composing) return
        pl.forced = true
        view.dispatch({})
      }, 0)
      return false
    },
  },
})

// Heading sizes come from line decorations here, so the highlight style used
// with live preview carries none (see extensions.ts).
export const livePreviewTheme = EditorView.theme({
  '.cm-lp-h': { fontFamily: 'var(--de-font-display)', fontWeight: '700', lineHeight: '1.25' },
  '.cm-lp-h1': { fontSize: 'calc(1em * var(--de-scale-ratio) * var(--de-scale-ratio) * var(--de-scale-ratio))' },
  '.cm-lp-h2': { fontSize: 'calc(1em * var(--de-scale-ratio) * var(--de-scale-ratio))' },
  '.cm-lp-h3': { fontSize: 'calc(1em * var(--de-scale-ratio))' },
  '.cm-lp-h4, .cm-lp-h5, .cm-lp-h6': { fontSize: '1em' },
  '.cm-lp-h5, .cm-lp-h6': { color: 'var(--de-text-muted)' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-icode': {
    fontFamily: 'var(--de-font-stack-code)', color: 'var(--de-code-text)',
    backgroundColor: 'var(--de-surface)', borderRadius: 'var(--de-radius-sm)', padding: '0 0.2em',
  },
  '.cm-lp-link': { color: 'var(--de-link)', textDecoration: 'underline' },
  '.cm-lp-link-src': { textDecoration: 'none' },
  '.cm-lp-dim': { color: 'var(--de-text-muted)' },
  '.cm-lp-quote': {
    color: 'var(--de-text-muted)',
    borderInlineStart: '0.25em solid var(--de-rule)',
    paddingInlineStart: '0.75em',
  },
  '.cm-lp-indent': { display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', whiteSpace: 'pre' },
  '.cm-lp-bullet, .cm-lp-bullet-raw, .cm-lp-olmark': {
    display: 'inline-block', minWidth: '1.5em', textIndent: '0',
  },
  '.cm-lp-bullet': { color: 'var(--de-text-muted)' },
  '.cm-lp-bullet-raw, .cm-lp-olmark': { color: 'var(--de-text-muted)', whiteSpace: 'pre' },
  '.cm-lp-check': {
    appearance: 'auto', accentColor: 'var(--de-accent)', margin: '0 0.5em 0 0',
    width: '1em', height: '1em', verticalAlign: '-0.1em', cursor: 'pointer',
  },
  '.cm-lp-done': { color: 'var(--de-text-muted)', textDecoration: 'line-through' },
  '.cm-lp-hr': { borderBlockEnd: '1px solid var(--de-rule)', lineHeight: '1' },
  '.cm-lp-code': {
    fontFamily: 'var(--de-font-stack-code)', color: 'var(--de-code-text)',
    backgroundColor: 'var(--de-surface)', paddingInline: '0.75em',
  },
  '.cm-lp-code-first': { borderStartStartRadius: 'var(--de-radius-sm)', borderStartEndRadius: 'var(--de-radius-sm)', paddingBlockStart: '0.25em' },
  '.cm-lp-code-last': { borderEndStartRadius: 'var(--de-radius-sm)', borderEndEndRadius: 'var(--de-radius-sm)', paddingBlockEnd: '0.25em' },
  '.cm-lp-fence': { color: 'var(--de-text-muted)' },
  '.cm-lp-lang': { color: 'var(--de-text-muted)' },
})

/** The live-preview extension (plugin plus its theme). */
export function livePreview(): Extension {
  return [livePlugin, livePreviewTheme]
}
