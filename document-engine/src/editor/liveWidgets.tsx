// Widgets for live preview: KaTeX math (inline and block) and the live graph
// fence. Everything here replaces source ranges with Decoration.replace, so
// the document text never changes and copy still yields markdown. Colours,
// fonts and sizes are var(--de-*) references or relative units.
import { createRoot, type Root } from 'react-dom/client'
import { useRef, useState, type ReactNode } from 'react'
import {
  EditorState, Facet, StateEffect, StateField, type Extension, type Range,
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { renderMath } from '../mathRender'
import {
  parseGraphInfo, graphFenceStyle, graphErrorSummary, setGraphOption,
  type GraphFenceOptions, type GraphSize, type GraphOptionEdit,
} from '../graphFence'
import { useGraphLock } from '../TextContent'
import type { RenderGraph } from '../types'
import { scanLiveBlocks, decideBlockWidgets, type LiveBlock } from './liveScan'

// ----------------------------------------------------------------- config

export interface LiveOptions {
  // Read at render time, so a host re-render never remounts a graph.
  renderGraph?: () => RenderGraph | undefined
  // Forwarded every time a graph reports errors.
  onGraphErrors?: (messages: string[]) => void
}

export const liveOptions = Facet.define<LiveOptions, LiveOptions>({
  combine: (v) => Object.assign({}, ...v) as LiveOptions,
})

export const rebuildLiveWidgets = StateEffect.define<null>()

// ------------------------------------------------------------------- math

export type MathView = { kind: 'html'; html: string } | { kind: 'error' }

/** Pure: KaTeX output, or `error` when the source cannot be typeset. */
export function mathView(tex: string, display: boolean): MathView {
  if (tex.trim().length === 0) return { kind: 'error' }
  const r = renderMath(tex, display)
  if ('error' in r || r.html.includes('katex-error')) return { kind: 'error' }
  return { kind: 'html', html: r.html }
}

function placeCaretAtStart(view: EditorView, dom: HTMLElement) {
  let pos: number
  try { pos = view.posAtDOM(dom) } catch { return }
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
  view.focus()
}

export class MathWidget extends WidgetType {
  readonly tex: string
  readonly display: boolean
  constructor(tex: string, display: boolean) { super(); this.tex = tex; this.display = display }
  eq(o: MathWidget): boolean { return o.tex === this.tex && o.display === this.display }
  get estimatedHeight(): number { return this.display ? 48 : -1 }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-lp-math cm-lp-math-block' : 'cm-lp-math'
    el.setAttribute('role', 'math')
    const v = mathView(this.tex, this.display)
    if (v.kind === 'html') el.innerHTML = v.html
    else {
      el.classList.add('cm-lp-math-err')
      const d = this.display ? '$$' : '$'
      el.textContent = d + this.tex + d
    }
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      placeCaretAtStart(view, el)
    })
    return el
  }
  ignoreEvent(): boolean { return true }
}

// ------------------------------------------------------------------ graph

const SIZES: { id: GraphSize; label: string }[] = [
  { id: 's', label: 'S' }, { id: 'm', label: 'M' }, { id: 'l', label: 'L' }, { id: 'full', label: 'Full' },
]

function LiveGraph({ spec, options, render, onErrors }: {
  spec: string
  options: GraphFenceOptions
  render: RenderGraph
  onErrors?: (m: string[]) => void
}): ReactNode {
  const [messages, setMessages] = useState<string[]>([])
  const lastKey = useRef('')
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const plotRef = useRef<HTMLDivElement | null>(null)
  useGraphLock(plotRef, options.lock)
  const summary = graphErrorSummary(messages)
  return (
    <>
      <div ref={plotRef} className="cm-lp-graph-plot">
        {render(spec, {
          view: options.view,
          bounds: options.bounds,
          lock: options.lock || undefined,
          onErrors(msgs) {
            const key = msgs.join('\u0000')
            if (key === lastKey.current) return
            lastKey.current = key
            setMessages(msgs)
            if (msgs.length > 0) onErrorsRef.current?.(msgs)
          },
        })}
      </div>
      {summary && <div className="cm-lp-graph-error" role="alert">{summary}</div>}
    </>
  )
}

const mounted = new WeakMap<HTMLElement, Root>()
// Live counters for the review harness: mounts - unmounts = graphs on screen.
export const graphCounters = { mounts: 0, unmounts: 0 }

/** Rewrite the fence info line of the graph that starts at `pos`. One transaction. */
export function rewriteGraphInfo(view: EditorView, pos: number, edit: GraphOptionEdit): boolean {
  const line = view.state.doc.lineAt(pos)
  const m = /^(\s*```\s*)(.*)$/.exec(line.text)
  if (!m || !/^graph(\s|$)/.test(m[2])) return false
  const next = setGraphOption(m[2], edit)
  if (next === m[2].trim()) return false
  view.dispatch({
    changes: { from: line.from + m[1].length, to: line.to, insert: next },
    userEvent: 'input.graph.resize',
  })
  return true
}

export class GraphWidget extends WidgetType {
  readonly options: GraphFenceOptions
  readonly spec: string
  readonly info: string
  constructor(spec: string, info: string) {
    super()
    this.spec = spec
    this.info = info
    this.options = parseGraphInfo(info)
  }
  eq(o: GraphWidget): boolean { return o.spec === this.spec && o.info === this.info }
  get estimatedHeight(): number { return this.options.height ?? 300 }

  private applyStyle(dom: HTMLElement) {
    const { widthPct, height } = graphFenceStyle(this.options)
    const frame = dom.firstElementChild as HTMLElement
    frame.style.width = `${widthPct}%`
    if (height !== undefined) {
      frame.style.setProperty('--graph-height', `${height}px`)
      dom.dataset.fixed = 'true'
    } else {
      frame.style.removeProperty('--graph-height')
      delete dom.dataset.fixed
    }
    dom.dataset.size = this.options.size ?? ''
  }

  private render(view: EditorView, root: Root) {
    const cfg = view.state.facet(liveOptions)
    const render = cfg.renderGraph?.()
    if (!render) { root.render(null); return }
    root.render(<LiveGraph spec={this.spec} options={this.options} render={render} onErrors={cfg.onGraphErrors} />)
  }

  toDOM(view: EditorView): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-lp-graph'
    const frame = document.createElement('div')
    frame.className = 'cm-lp-graph-frame'
    const bar = document.createElement('div')
    bar.className = 'cm-lp-graph-bar'
    const host = document.createElement('div')
    host.className = 'cm-lp-graph-host'
    const grip = document.createElement('div')
    grip.className = 'cm-lp-graph-grip'
    grip.title = 'Drag to resize'
    grip.setAttribute('role', 'separator')
    grip.setAttribute('aria-label', 'Resize graph')
    frame.append(bar, host, grip)
    dom.append(frame)

    const here = () => view.posAtDOM(dom)
    for (const s of SIZES) {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'cm-lp-graph-btn'
      b.dataset.size = s.id
      b.textContent = s.label
      b.title = `Graph size ${s.label}`
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => { e.preventDefault(); rewriteGraphInfo(view, here(), { size: s.id }) })
      bar.append(b)
    }
    const src = document.createElement('button')
    src.type = 'button'
    src.className = 'cm-lp-graph-btn cm-lp-graph-src'
    src.textContent = 'Source'
    src.title = 'Edit the graph source'
    src.addEventListener('mousedown', (e) => e.preventDefault())
    src.addEventListener('click', (e) => { e.preventDefault(); placeCaretAtStart(view, dom) })
    bar.append(src)

    let startY = 0
    let startH = 0
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      grip.setPointerCapture(e.pointerId)
      startY = e.clientY
      startH = host.getBoundingClientRect().height
    })
    grip.addEventListener('pointermove', (e) => {
      if (!grip.hasPointerCapture(e.pointerId)) return
      const h = Math.max(80, Math.round(startH + e.clientY - startY))
      frame.style.setProperty('--graph-height', `${h}px`)
      dom.dataset.fixed = 'true'
    })
    grip.addEventListener('pointerup', (e) => {
      if (!grip.hasPointerCapture(e.pointerId)) return
      grip.releasePointerCapture(e.pointerId)
      if (Math.abs(e.clientY - startY) < 2) return
      rewriteGraphInfo(view, here(), { height: startH + e.clientY - startY })
    })
    grip.addEventListener('pointercancel', (e) => {
      if (grip.hasPointerCapture(e.pointerId)) grip.releasePointerCapture(e.pointerId)
      this.applyStyle(dom)
    })

    this.applyStyle(dom)
    const root = createRoot(host)
    graphCounters.mounts++
    mounted.set(dom, root)
    this.render(view, root)
    return dom
  }

  // Same fence restyled or moved: keep the live plot, only re-style / re-render.
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const root = mounted.get(dom)
    if (!root) return false
    this.applyStyle(dom)
    this.render(view, root)
    return true
  }

  destroy(dom: HTMLElement): void {
    const root = mounted.get(dom)
    if (!root) return
    mounted.delete(dom)
    graphCounters.unmounts++
    // Never unmount a root synchronously: React may be mid-render.
    queueMicrotask(() => root.unmount())
  }
  ignoreEvent(): boolean { return true }
}

// ------------------------------------------------------------ block field

export interface BlockState {
  blocks: LiveBlock[]
  decos: DecorationSet
  // Only the replace ranges (what the caret must skip).
  atomic: DecorationSet
  graph: boolean
}

const mathSrcLine = Decoration.line({ attributes: { class: 'cm-lp-mathsrc' } })

/** Pure: the widget and source-line decorations for `blocks` and a selection. */
export function blockDecorations(
  state: EditorState, blocks: readonly LiveBlock[], graph: boolean,
): { decos: DecorationSet; atomic: DecorationSet } {
  const sel = state.selection.ranges.map((r) => ({ from: r.from, to: r.to }))
  const all: Range<Decoration>[] = []
  const rep: Range<Decoration>[] = []
  for (const { block, revealed } of decideBlockWidgets(blocks, sel, { graph })) {
    if (!revealed) {
      const widget = block.kind === 'math' ? new MathWidget(block.body, true) : new GraphWidget(block.body, block.info)
      const r = Decoration.replace({ widget, block: true }).range(block.from, block.to)
      all.push(r)
      rep.push(r)
    } else if (block.kind === 'math') {
      const a = state.doc.lineAt(block.from).number
      const b = state.doc.lineAt(block.to).number
      for (let n = a; n <= b; n++) all.push(mathSrcLine.range(state.doc.line(n).from))
    }
  }
  return { decos: Decoration.set(all, true), atomic: Decoration.set(rep, true) }
}

export const blockField = StateField.define<BlockState>({
  create(state) {
    const graph = !!state.facet(liveOptions).renderGraph
    const blocks = scanLiveBlocks(state.doc.toString())
    return { blocks, graph, ...blockDecorations(state, blocks, graph) }
  },
  update(v, tr) {
    const graph = !!tr.state.facet(liveOptions).renderGraph
    const forced = tr.effects.some((e) => e.is(rebuildLiveWidgets))
    const compose = tr.docChanged && tr.isUserEvent('input.type.compose')
    if (!tr.docChanged && !tr.selection && !forced && graph === v.graph) return v
    const blocks = tr.docChanged ? scanLiveBlocks(tr.newDoc.toString()) : v.blocks
    if (compose && !forced) {
      // Composing: only map (the IME owns the text); rebuilt after compositionend.
      return { blocks, graph: v.graph, decos: v.decos.map(tr.changes), atomic: v.atomic.map(tr.changes) }
    }
    return { blocks, graph, ...blockDecorations(tr.state, blocks, graph) }
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.decos),
    EditorView.atomicRanges.of((view) => view.state.field(f).atomic),
  ],
})

/** The math and fence blocks for `state`, from the field when present. */
export function blocksOf(state: EditorState): readonly LiveBlock[] {
  return state.field(blockField, false)?.blocks ?? scanLiveBlocks(state.doc.toString())
}

export function liveWidgetExtensions(): Extension {
  return [blockField]
}
