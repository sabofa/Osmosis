import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import type { ResolvedMarker } from './viewerModel'
import { markerSpanInternal } from './offsetBoundary'
import { usePaintHighlights } from './highlightPainter'
import { parseBlocks, parseInline, parseInlineSegs, BLOCK_TAG, BLOCK_CLASS, type InlineRun, type MdBlock, type Seg } from './markdown'
import { renderMath } from './mathRender'
import {
  graphFenceModel,
  graphErrorSummary,
  graphFenceStyle,
  graphOptionsSignature,
  type GraphFenceOptions,
} from './graphFence'
import { dblClickExpands, restoreFocusOnCollapse } from './expandModel'
import { resolveIcon } from './iconSheet'
import type { IconSheetRef } from 'theme-core'
import type { DocumentAnchor, DocumentHighlight, RenderGraph } from './types'

// Interim lock until the graph DSL `@lock` ships: swallow every pan/zoom/reset
// gesture in the capture phase so the live plot underneath never sees it.
const LOCK_BLOCK = ['pointerdown', 'dblclick'] as const
const LOCK_SWALLOW = ['wheel', 'touchstart', 'touchmove', 'keydown'] as const

export function useGraphLock(ref: { current: HTMLElement | null }, locked: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!locked || !el) return
    // Wheel, touch and keys only stop propagation: the page must still scroll
    // and Tab/arrows must still move focus over a locked plot.
    const swallow = (e: Event) => e.stopPropagation()
    const block = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const blockMove = (e: Event) => {
      if ((e as PointerEvent).buttons) block(e)
    }
    const opts = { capture: true, passive: false } as const
    for (const t of LOCK_BLOCK) el.addEventListener(t, block, opts)
    for (const t of LOCK_SWALLOW) el.addEventListener(t, swallow, opts)
    el.addEventListener('pointermove', blockMove, opts)
    return () => {
      for (const t of LOCK_BLOCK) el.removeEventListener(t, block, opts)
      for (const t of LOCK_SWALLOW) el.removeEventListener(t, swallow, opts)
      el.removeEventListener('pointermove', blockMove, opts)
    }
  }, [ref, locked])
}

// One inline graph. Owns its error state; forwards each distinct message set
// to the viewer once. Not selectable text: no data-start anywhere inside.
//
// Expand: the SAME mounted graph element is switched to the
// `document-viewer-graph-expanded` class (position:absolute; inset:0) and so
// fills the nearest positioned ancestor, `.document-viewer` (the scroll box
// and content box are not positioned and have no transform, and an absolutely
// positioned box is not clipped by a scroll container that is not in its
// containing-block chain). Nothing is re-keyed or remounted, so the live graph
// and its layer alphas persist; the graph's own ResizeObserver re-measures.
// The slot wrapper keeps the flow height in the document while it is out.
function GraphFence({
  ordinal,
  expanded,
  onExpand,
  onActive,
  icons,
  spec,
  startOffset,
  options,
  renderGraph,
  onErrors,
  inert,
}: {
  ordinal: number
  expanded: boolean
  // Another graph is expanded: this one is not reachable.
  inert?: boolean
  // Absent: not expandable (embedded chrome) — no button, no double-click.
  onExpand?: (ordinal: number | null) => void
  onActive?: (ordinal: number) => void
  icons?: IconSheetRef
  spec: string
  startOffset: number
  options: GraphFenceOptions
  renderGraph: RenderGraph
  onErrors?: (messages: string[]) => void
}) {
  const [messages, setMessages] = useState<string[]>([])
  const lastKey = useRef('')
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const plotRef = useRef<HTMLDivElement | null>(null)
  useGraphLock(plotRef, options.lock)
  const slotRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  // Seeded with the mount value: a graph mounting already expanded must not steal focus.
  const wasExpanded = useRef(expanded)
  // Focus the collapse button on expand; on collapse hand focus back to the
  // expand button when it was in the viewer or had fallen to the body.
  useEffect(() => {
    const btn = buttonRef.current
    if (expanded && wasExpanded.current === false) btn?.focus()
    else if (!expanded && wasExpanded.current && btn) {
      const active = document.activeElement
      const viewer = btn.closest('.document-viewer')
      if (restoreFocusOnCollapse(!!viewer && !!active && viewer.contains(active), !active || active === document.body)) btn.focus()
    }
    wasExpanded.current = expanded
  }, [expanded])
  const slotHeight = useRef(0)
  // Remember the in-flow height so the slot can hold it while expanded.
  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot || expanded) return
    slotHeight.current = slot.offsetHeight
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      slotHeight.current = slot.offsetHeight
    })
    ro.observe(slot)
    return () => ro.disconnect()
  }, [expanded])
  const summary = graphErrorSummary(messages)
  const ExpandIcon = resolveIcon(expanded ? 'graph-collapse' : 'graph-expand', icons ?? { kind: 'default' })
  const { widthPct, height } = graphFenceStyle(options)
  const style: CSSProperties | undefined = expanded ? undefined : { width: `${widthPct}%`, maxWidth: '100%' }
  const plotStyle: CSSProperties | undefined =
    height !== undefined ? ({ '--graph-height': `${height}px` } as CSSProperties) : undefined
  return (
    <div
      ref={slotRef}
      className="document-viewer-graph-slot"
      inert={inert}
      style={expanded ? { height: slotHeight.current } : undefined}
    >
    <div
      className={`document-viewer-graph${options.lock ? ' document-viewer-graph-locked' : ''}${expanded ? ' document-viewer-graph-expanded' : ''}`}
      data-graph-start={startOffset}
      data-graph-locked={options.lock ? 'true' : undefined}
      data-graph-expanded={expanded ? 'true' : undefined}
      style={style}
      contentEditable={false}
      onPointerEnter={onActive ? () => onActive(ordinal) : undefined}
      onFocusCapture={onActive ? () => onActive(ordinal) : undefined}
      onDoubleClickCapture={
        onExpand
          ? (e) => {
              const inside = !!plotRef.current && plotRef.current.contains(e.target as Node)
              const onButton = !!(e.target as Element).closest?.('button')
              if (dblClickExpands(inside, options.lock, expanded, onButton)) onExpand(ordinal)
            }
          : undefined
      }
    >
      {onExpand && (
        <button
          ref={buttonRef}
          type="button"
          data-component="pill"
          className="document-viewer-graph-expand"
          aria-label={expanded ? 'Collapse graph' : 'Expand graph'}
          title={expanded ? 'Collapse graph' : 'Expand graph'}
          onClick={() => onExpand(expanded ? null : ordinal)}
        >
          <ExpandIcon size={14} />
        </button>
      )}
      <div
        ref={plotRef}
        className={`document-viewer-graph-plot${height !== undefined ? ' document-viewer-graph-plot-fixed' : ''}`}
        style={plotStyle}
      >
        {renderGraph(spec, {
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
      {summary && <div className="document-viewer-graph-error" role="alert">{summary}</div>}
    </div>
    </div>
  )
}

interface Leaf extends InlineRun {
  marker?: ResolvedMarker
}

export default function TextContent({
  text,
  anchors,
  markers,
  highlights = [],
  showOverlays = true,
  groupPrefix,
  renderGraph,
  onGraphErrors,
  expandedGraph = null,
  onExpandGraph,
  onActiveGraph,
  icons,
}: {
  expandedGraph?: number | null
  onExpandGraph?: (ordinal: number | null) => void
  onActiveGraph?: (ordinal: number) => void
  icons?: IconSheetRef
  text: string
  anchors: DocumentAnchor[]
  markers: ResolvedMarker[]
  highlights?: DocumentHighlight[]
  showOverlays?: boolean
  groupPrefix: string
  renderGraph?: RenderGraph
  onGraphErrors?: (messages: string[]) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  usePaintHighlights(rootRef, groupPrefix, anchors, highlights, showOverlays, text)

  // Anchor and highlight ranges are painted via the CSS Custom Highlight API
  // (see highlightPainter.ts) rather than wrapped in their own elements, so
  // they can never fragment a word into multiple padded/rounded pieces with
  // visible gaps between them — only markdown formatting and marker
  // boundaries split the DOM into separate elements here.
  // While a graph is expanded the rest of the document is out of reach.
  const inertOthers = expandedGraph !== null
  const markerSpans = markers
    .map((marker) => ({ marker, span: markerSpanInternal(text, marker.offset) }))
    .filter((m): m is { marker: ResolvedMarker; span: { start: number; end: number } } => m.span !== null)
    .sort((a, b) => a.span.start - b.span.start)

  function leavesFor(runs: InlineRun[]): Leaf[] {
    const leaves: Leaf[] = []
    for (const run of runs) {
      if (run.math) {
        // Rendered glyphs have no per-character mapping to the TeX source, so
        // a math run stays one atomic leaf (markers inside it are ignored).
        leaves.push({ start: run.start, end: run.end, math: true, br: run.br })
        continue
      }
      const overlapping = markerSpans.filter((m) => m.span.end > run.start && m.span.start < run.end)
      let cursor = run.start
      for (const { marker, span } of overlapping) {
        const s = Math.max(span.start, run.start)
        const e = Math.min(span.end, run.end)
        if (s < cursor) continue // overlapping marker tokens — keep the first
        if (s > cursor) leaves.push({ start: cursor, end: s, bold: run.bold, italic: run.italic, code: run.code, br: cursor === run.start ? run.br : undefined })
        leaves.push({ start: s, end: e, bold: run.bold, italic: run.italic, code: run.code, marker, br: s === run.start ? run.br : undefined })
        cursor = e
      }
      if (cursor < run.end) leaves.push({ start: cursor, end: run.end, bold: run.bold, italic: run.italic, code: run.code, br: cursor === run.start ? run.br : undefined })
    }
    return leaves
  }

  function renderMathNode(start: number, end: number, display: boolean, Wrap: 'span' | 'div'): ReactNode {
    const inertAttr = inertOthers ? { inert: true } : {}
    const result = renderMath(text.slice(start, end), display)
    const attrs = {
      'data-start': start,
      'data-math': '1',
      'data-math-end': end,
      ...inertAttr,
      className: display ? 'document-viewer-math-display' : 'document-viewer-math-inline',
    }
    if ('error' in result) return <Wrap key={start} {...attrs}><code>{result.error}</code></Wrap>
    const Inner = Wrap
    return (
      <Wrap key={start} {...attrs}>
        <Inner dangerouslySetInnerHTML={{ __html: result.html }} />
      </Wrap>
    )
  }

  function renderFence(start: number, end: number, segs?: Seg[]): ReactNode {
    // One span per source line so highlight/selection mapping (data-start on
    // text-bearing leaves) keeps working; newlines are plain text between.
    // Inside a quote the lines come from `segs` (the `>` markers are omitted).
    const lines = segs ? segs.map((sg) => text.slice(sg.start, sg.end)) : text.slice(start, end).split('\n')
    const out: ReactNode[] = []
    let pos = start
    lines.forEach((ln, idx) => {
      if (idx > 0) out.push('\n')
      if (segs) pos = segs[idx].start
      if (ln.length > 0) out.push(<span key={pos} data-start={pos}>{ln}</span>)
      if (!segs) pos += ln.length + 1
    })
    return out
  }

  function renderLeaf(leaf: Leaf): ReactNode {
    const content = text.slice(leaf.start, leaf.end)
    if (leaf.math) return renderMathNode(leaf.start, leaf.end, false, 'span')
    const marker = leaf.marker
    const shared = marker
      ? {
          'data-start': leaf.start,
          className: 'document-viewer-marker',
          role: 'button' as const,
          tabIndex: 0,
          onClick: () => marker.activate(),
          onKeyDown: (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              marker.activate()
            }
          },
        }
      : { 'data-start': leaf.start }
    if (leaf.code) return <code key={leaf.start} {...shared}>{content}</code>
    if (leaf.bold) return <strong key={leaf.start} {...shared}>{content}</strong>
    if (leaf.italic) return <em key={leaf.start} {...shared}>{content}</em>
    return <span key={leaf.start} {...shared}>{content}</span>
  }

  const blocks = parseBlocks(text)
  let graphOrdinal = 0

  function renderBlock(block: MdBlock): ReactNode {
    if (block.type === 'quote') {
      const co = block.callout
      const titled = !!co && co.titleEnd > co.titleStart
      return (
        <blockquote
          key={block.start}
          className={co ? `${BLOCK_CLASS.quote} document-viewer-md-callout` : BLOCK_CLASS.quote}
          data-callout={co ? co.kind : undefined}
          inert={inertOthers || undefined}
        >
          {co && (
            <div className="document-viewer-md-callout-label">
              {titled
                ? leavesFor([{ start: co.titleStart, end: co.titleEnd }]).map(renderLeaf)
                : co.kind.charAt(0).toUpperCase() + co.kind.slice(1)}
            </div>
          )}
          {(block.children ?? []).map(renderBlock)}
        </blockquote>
      )
    }
    if (block.type === 'math') {
      return renderMathNode(block.start, block.end, true, 'div')
    }
    if (block.type === 'fence') {
      const graph = renderGraph && !block.segs ? graphFenceModel(block, text) : null
      if (graph && renderGraph) {
        // Keyed by ordinal among graph fences (so edits elsewhere keep the
        // plot mounted) plus the spec (so a new spec remounts, which resets
        // the fence's error state without an effect racing the child's).
        const ordinal = graphOrdinal++
        const key = `graph-${ordinal}:${graphOptionsSignature(graph.options)}:${graph.spec}`
        return (
          <GraphFence
            key={key}
            ordinal={ordinal}
            expanded={expandedGraph === ordinal}
            onExpand={onExpandGraph}
            onActive={onActiveGraph}
            icons={icons}
            spec={graph.spec}
            options={graph.options}
            startOffset={graph.startOffset}
            renderGraph={renderGraph}
            onErrors={onGraphErrors}
            inert={expandedGraph !== null && expandedGraph !== ordinal ? true : undefined}
          />
        )
      }
      return (
        <pre key={block.start} className={BLOCK_CLASS.fence} data-info={block.info || undefined} inert={inertOthers || undefined}>
          {renderFence(block.start, block.end, block.segs)}
        </pre>
      )
    }
    const Tag = BLOCK_TAG[block.type] as ElementType
    const runs = block.segs ? parseInlineSegs(text, block.segs) : parseInline(text.slice(block.start, block.end), block.start)
    const out: ReactNode[] = []
    for (const leaf of leavesFor(runs)) {
      if (leaf.br) out.push(' ')
      out.push(renderLeaf(leaf))
    }
    return (
      <Tag key={block.start} className={BLOCK_CLASS[block.type] || undefined} inert={inertOthers || undefined}>
        {out}
      </Tag>
    )
  }

  return (
    <div className="document-viewer-text document-viewer-markdown" ref={rootRef}>
      {blocks.map(renderBlock)}
    </div>
  )
}
