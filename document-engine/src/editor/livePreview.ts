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
import { decideBlockWidgets, inlineMathInLine, insideBlock, touchesSel } from './liveScan'
import { documentRoles, roleKindOfNode, type BlockRole } from '../documentRoles'
import { MathWidget, blocksOf, editLocked, liveOptions, liveWidgetExtensions, rebuildLiveWidgets } from './liveWidgets'

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
      if (editLocked(view)) return
      toggleTaskAt(view, view.posAtDOM(box))
    })
    box.addEventListener('click', (e) => e.preventDefault())
    return box
  }
  ignoreEvent(): boolean { return true }
}

/** Flip `[ ]` <-> `[x]` for the task marker starting at `pos`. */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  if (editLocked(view)) return false
  const mid = view.state.sliceDoc(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(mid)) return false
  view.dispatch({
    changes: { from: pos + 1, to: pos + 2, insert: mid[1] === ' ' ? 'x' : ' ' },
    userEvent: 'input',
  })
  return true
}

// ------------------------------------------------------------ decorations

const lineDeco = (cls: string, style?: string, extra?: Record<string, string>) =>
  Decoration.line({ attributes: { class: cls, ...(style ? { style } : {}), ...extra } })

// Roles for the document's top-level blocks (title / lede / section), keyed by
// the block's first-line start, over the whole tree (the viewport may start
// mid-document but section numbers count from the top).
type RoleMap = Map<number, BlockRole & { to: number }>
const rolesCache = new WeakMap<object, RoleMap>()
function topLevelRoles(tree: ReturnType<typeof syntaxTree>): RoleMap {
  const hit = rolesCache.get(tree)
  if (hit) return hit
  const nodes: { from: number; to: number; type: string }[] = []
  for (let c = tree.topNode.firstChild; c; c = c.nextSibling) nodes.push({ from: c.from, to: c.to, type: roleKindOfNode(c.name) })
  const roles = documentRoles(nodes)
  const map = new Map<number, BlockRole & { to: number }>()
  nodes.forEach((n, i) => map.set(n.from, { ...roles[i], to: n.to }))
  rolesCache.set(tree, map)
  return map
}

const roleClass = (r: BlockRole | undefined) => (r?.role ? ` cm-lp-${r.role}` : '')

function headingExtra(m: string, role: BlockRole | undefined): Record<string, string> {
  const e: Record<string, string> = { 'data-level': m }
  if (role?.role) e['data-role'] = role.role
  if (role?.sectionIndex) e['data-section-index'] = String(role.sectionIndex)
  return e
}
const markDeco = (cls: string) => Decoration.mark({ class: cls })
const HIDE = Decoration.replace({})

const HEADING = /^ATXHeading([1-6])$/
const SETEXT = /^SetextHeading([12])$/
const SKIP_FENCE = new Set(['math', 'latex'])

const touches = touchesSel

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
  // A replace decoration from a plugin may not span a line break (CodeMirror
// throws and drops the whole plugin), so such a hide is skipped.
  const hide = (from: number, to: number) => { if (to > from && doc.lineAt(from).to >= to) push(from, to, HIDE, true) }
  // `mark` plus one following space (inside the line).
  const withSpace = (_from: number, mTo: number) => (doc.sliceString(mTo, mTo + 1) === ' ' ? mTo + 1 : mTo)

  const tree = syntaxTree(state)
  const roles = topLevelRoles(tree)
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
          const role = roles.get(nodeRef.from)
          pushLine(line.from, lineDeco(`cm-lp-h cm-lp-h${m[1]}${roleClass(role)}`, role?.sectionIndex ? `--de-section-index:${role.sectionIndex}` : undefined, headingExtra(m[1], role)))
          if (!touches(sel, line.from, line.to)) {
            const hm = childrenOf(node, 'HeaderMark')[0]
            if (hm && hm.from === nodeRef.from) hide(hm.from, withSpace(hm.from, hm.to))
          }
          return
        }
        if ((m = SETEXT.exec(name))) {
          const a = doc.lineAt(nodeRef.from), b = doc.lineAt(nodeRef.to)
          const role = roles.get(nodeRef.from)
          // Role attributes (and so the section mark) on the first line only.
          for (let n = a.number; n <= b.number; n++) {
            pushLine(doc.line(n).from, n === a.number
              ? lineDeco(`cm-lp-h cm-lp-h${m[1]}${roleClass(role)}`, role?.sectionIndex ? `--de-section-index:${role.sectionIndex}` : undefined, headingExtra(m[1], role))
              : lineDeco(`cm-lp-h cm-lp-h${m[1]}`, undefined, { 'data-level': m[1] }))
          }
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
          case 'Escape': {
            // A backslash escape: the backslash hides off-caret and shows (dimmed) when the caret touches it.
            if (!touches(sel, nodeRef.from, nodeRef.to)) hide(nodeRef.from, nodeRef.from + 1)
            else push(nodeRef.from, nodeRef.from + 1, markDeco('cm-lp-dim'))
            return false
          }
          case 'Link': {
            const marks = childrenOf(node, 'LinkMark')
            const open = marks[0]
            const close = marks.find((mk) => mk !== open && doc.sliceString(mk.from, mk.to) === ']')
            if (!open || !close) return
            // A link whose target or title wraps onto another line: the tail cannot be hidden, so show the source.
            if (touches(sel, nodeRef.from, nodeRef.to) || doc.lineAt(close.from).to < nodeRef.to) {
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

  for (const [from, r] of roles) {
    if (r.role !== 'lede') continue
    for (let n = doc.lineAt(from).number, e = doc.lineAt(r.to).number; n <= e; n++) {
      pushLine(doc.line(n).from, lineDeco('cm-lp-lede', undefined, { 'data-role': 'lede' }))
    }
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

  // Math: inline `$…$` becomes a widget off-caret; nothing else decorates inside
  // a math span or a `$$` block (its source is raw TeX).
  const blocks = blocksOf(state)
  const inlineMath: { from: number; to: number }[] = []
  for (const vp of ctx.viewport) {
    const vf = Math.max(0, vp.from), vt = Math.min(doc.length, vp.to)
    for (let n = doc.lineAt(vf).number, last = doc.lineAt(vt).number; n <= last; n++) {
      const line = doc.line(n)
      if (insideBlock(blocks, line.from, line.to)) continue
      for (const m of inlineMathInLine(line.text, line.from)) {
        inlineMath.push(m)
        if (touches(sel, m.from, m.to)) push(m.from, m.to, markDeco('cm-lp-mathsrc-inline'))
        else push(m.from, m.to, Decoration.replace({ widget: new MathWidget(m.tex, false) }), true)
      }
    }
  }
  const mathBlocks = blocks.filter((b) => b.kind === 'math')
  // A graph block drawn as a widget swallows its source lines: no code chrome on them.
  const graphOn = !!state.facet(liveOptions).renderGraph
  const widgetGraphs = decideBlockWidgets(blocks, sel, { graph: graphOn })
    .filter((d) => d.block.kind === 'graph' && !d.revealed).map((d) => d.block)
  const swallowed = [...mathBlocks, ...widgetGraphs]
  if (inlineMath.length === 0 && swallowed.length === 0) return out
  return out.filter((d) => {
    if (d.deco.spec.widget instanceof MathWidget || d.deco.spec.class === 'cm-lp-mathsrc-inline') return true
    if (swallowed.some((b) => d.from >= b.from && d.to <= b.to)) return false
    return d.to === d.from || !inlineMath.some((m) => d.from >= m.from && d.to <= m.to)
  })
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
        view.dispatch({ effects: rebuildLiveWidgets.of(null) })
      }, 0)
      return false
    },
  },
})

// Code and quote chrome is the text colour thinned over whatever the page is,
// so it keeps its contrast in light and dark (the code-bg token sits too close
// to the page in dark themes).
const INK_PILL = 'color-mix(in srgb, var(--de-text) 12%, transparent)'
const INK_BLOCK = 'color-mix(in srgb, var(--de-text) 8%, transparent)'
const INK_RULE = 'color-mix(in srgb, var(--de-text) 32%, transparent)'

// Heading sizes come from line decorations here, so the highlight style used
// with live preview carries none (see extensions.ts).
export const livePreviewTheme = EditorView.theme({
  // Numeric defaults of the typography hooks (kept out of var() fallbacks).
  '&': {
    '--de-title-size-default': '1.9em',
    '--de-title-weight-default': '600',
    '--de-title-leading-default': '1.12',
    '--de-title-tracking-default': '-0.015em',
    '--de-lede-size-default': '1.2em',
    '--de-lede-leading-default': '1.5',
    '--de-section-size-default': '1.3em',
    '--de-section-weight-default': '700',
    '--de-section-mark-gap-default': '0.5em',
    '--de-section-mark-padding-default': '0',
    '--de-section-mark-radius-default': '0',
  },
  '.cm-lp-h': { fontFamily: 'var(--de-font-display)', fontWeight: '700', lineHeight: '1.25' },
  // Word-like steps from the body size.
  '.cm-lp-h1': { fontSize: '1.9em' },
  '.cm-lp-h2': { fontSize: '1.55em' },
  // Document typography hooks (src/typography.md); defaults are the var()
  // fallbacks, so a theme sets them on any ancestor.
  '.cm-lp-title': {
    fontFamily: 'var(--de-title-font, var(--de-font-display))',
    fontSize: 'var(--de-title-size, var(--de-title-size-default))',
    fontWeight: 'var(--de-title-weight, var(--de-title-weight-default))',
    lineHeight: 'var(--de-title-leading, var(--de-title-leading-default))',
    letterSpacing: 'var(--de-title-tracking, var(--de-title-tracking-default))',
  },
  '.cm-lp-lede': {
    fontSize: 'var(--de-lede-size, var(--de-lede-size-default))',
    color: 'var(--de-lede-color, var(--de-text-muted))',
    lineHeight: 'var(--de-lede-leading, var(--de-lede-leading-default))',
  },
  '.cm-lp-section': {
    fontFamily: 'var(--de-section-font, var(--de-font-display))',
    fontSize: 'var(--de-section-size, var(--de-section-size-default))',
    fontWeight: 'var(--de-section-weight, var(--de-section-weight-default))',
    // Lines are virtualised: take the number from the line, not from a running count.
    counterSet: 'de-section var(--de-section-index)',
  },
  // Inline-block (not flex): a flex line would turn each mark span into its own
  // flex item and break the text flow. Pseudo only: never part of the text.
  '.cm-lp-section::before': {
    content: 'var(--de-section-mark, none)',
    display: 'inline-block',
    boxSizing: 'content-box',
    verticalAlign: 'middle',
    marginInlineEnd: 'var(--de-section-mark-gap, var(--de-section-mark-gap-default))',
    width: 'var(--de-section-mark-width, auto)',
    height: 'var(--de-section-mark-height, auto)',
    padding: 'var(--de-section-mark-padding, var(--de-section-mark-padding-default))',
    fontFamily: 'var(--de-section-mark-font, inherit)',
    fontSize: 'var(--de-section-mark-size, inherit)',
    fontWeight: 'var(--de-section-mark-weight, inherit)',
    lineHeight: '1.4',
    letterSpacing: 'normal',
    color: 'var(--de-section-mark-color, currentColor)',
    background: 'var(--de-section-mark-bg, transparent)',
    borderRadius: 'var(--de-section-mark-radius, var(--de-section-mark-radius-default))',
  },
  '.cm-lp-h3': { fontSize: '1.3em' },
  '.cm-lp-h4': { fontSize: '1.15em' },
  '.cm-lp-h5, .cm-lp-h6': { fontSize: '1em', color: 'var(--de-text-muted)' },
  '.cm-lp-strong': { fontWeight: '700' },
  '.cm-lp-em': { fontStyle: 'italic' },
  '.cm-lp-strike': { textDecoration: 'line-through' },
  '.cm-lp-icode': {
    fontFamily: 'var(--de-font-stack-code)', color: 'var(--de-code-text)',
    backgroundColor: INK_PILL, borderRadius: 'var(--de-radius-sm)', padding: '0.08em 0.3em',
  },
  '.cm-lp-link': { color: 'var(--de-link)', textDecoration: 'underline' },
  '.cm-lp-link-src': { textDecoration: 'none' },
  '.cm-lp-dim': { color: 'var(--de-text-muted)' },
  '.cm-lp-quote': {
    color: 'var(--de-text-muted)',
    borderInlineStart: `0.25em solid ${INK_RULE}`,
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
    backgroundColor: INK_BLOCK, paddingInline: '0.75em',
  },
  '.cm-lp-code-first': { borderStartStartRadius: 'var(--de-radius-sm)', borderStartEndRadius: 'var(--de-radius-sm)', paddingBlockStart: '0.25em' },
  '.cm-lp-code-last': { borderEndStartRadius: 'var(--de-radius-sm)', borderEndEndRadius: 'var(--de-radius-sm)', paddingBlockEnd: '0.25em' },
  '.cm-lp-fence': { color: 'var(--de-text-muted)' },
  '.cm-lp-lang': { color: 'var(--de-text-muted)' },
  '.cm-lp-math': { display: 'inline-block', verticalAlign: 'baseline', cursor: 'text', fontFamily: 'var(--de-font-stack-math)' },
  '.cm-lp-math-block': { display: 'block', textAlign: 'center', margin: '0.4em 0', overflowX: 'auto', overflowY: 'hidden' },
  '.cm-lp-math-err': { color: 'var(--de-text-muted)', fontFamily: 'var(--de-font-stack-code)', fontStyle: 'italic', textDecoration: 'underline wavy', textDecorationColor: 'var(--de-text-muted)' },
  '.cm-lp-mathsrc, .cm-lp-mathsrc-inline': { fontFamily: 'var(--de-font-stack-code)', color: 'var(--de-code-text)' },
  '.cm-lp-graph': { margin: '0.5em 0', display: 'block' },
  '.cm-lp-graph-frame': {
    position: 'relative', maxWidth: '100%', padding: '0.4em', boxSizing: 'border-box',
    backgroundColor: INK_BLOCK, borderRadius: 'var(--de-radius-sm)',
  },
  '.cm-lp-graph-host': { minWidth: '0' },
  '.cm-lp-graph-plot': { aspectRatio: '16 / 10', maxWidth: '100%', display: 'flex' },
  '.cm-lp-graph[data-fixed] .cm-lp-graph-plot': { aspectRatio: 'auto', height: 'var(--graph-height)' },
  '.cm-lp-graph-plot > *': { flex: '1', minWidth: '0' },
  '.cm-lp-graph-error': { marginTop: '0.3em', fontSize: '0.85em', color: 'var(--de-text-muted)' },
  '.cm-lp-graph-bar': {
    position: 'absolute', top: '0.5em', right: '0.5em', zIndex: '2', display: 'flex', gap: '0.25em',
    opacity: '0', transition: 'opacity 0.12s',
  },
  '.cm-lp-graph:hover .cm-lp-graph-bar, .cm-lp-graph:focus-within .cm-lp-graph-bar': { opacity: '1' },
  '.cm-lp-graph-btn': {
    font: 'inherit', fontSize: '0.75em', lineHeight: '1.4', padding: '0.1em 0.55em', cursor: 'pointer',
    color: 'var(--de-text)', backgroundColor: 'var(--de-page)', border: '1px solid var(--de-rule)',
    borderRadius: 'var(--de-radius-sm)',
  },
  '.cm-lp-graph[data-size="s"] .cm-lp-graph-btn[data-size="s"], .cm-lp-graph[data-size="m"] .cm-lp-graph-btn[data-size="m"], .cm-lp-graph[data-size="l"] .cm-lp-graph-btn[data-size="l"], .cm-lp-graph[data-size="full"] .cm-lp-graph-btn[data-size="full"]': {
    borderColor: 'var(--de-accent)', color: 'var(--de-accent)',
  },
  '.cm-lp-graph-grip': {
    position: 'absolute', right: '0.15em', bottom: '0.15em', cursor: 'ns-resize',
    zIndex: '2', touchAction: 'none', opacity: '0', transition: 'opacity 0.12s',
    borderRight: '2px solid var(--de-text-muted)', borderBottom: '2px solid var(--de-text-muted)',
    boxSizing: 'border-box', width: '0.7em', height: '0.7em',
  },
  '.cm-lp-graph:hover .cm-lp-graph-grip': { opacity: '0.8' },
})

/** The live-preview extension (plugin plus its theme). */
export function livePreview(): Extension {
  return [livePlugin, livePreviewTheme, liveWidgetExtensions()]
}
