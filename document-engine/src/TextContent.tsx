import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from 'react'
import type { ResolvedMarker } from './viewerModel'
import { markerSpanInternal } from './offsetBoundary'
import { usePaintHighlights } from './highlightPainter'
import { parseBlocks, parseInline, BLOCK_TAG, BLOCK_CLASS, type InlineRun } from './markdown'
import { renderMath } from './mathRender'
import {
  graphFenceModel,
  graphErrorSummary,
  graphFenceStyle,
  graphOptionsSignature,
  type GraphFenceOptions,
} from './graphFence'
import type { DocumentAnchor, DocumentHighlight, RenderGraph } from './types'

// Interim lock until the graph DSL `@lock` ships: swallow every pan/zoom/reset
// gesture in the capture phase so the live plot underneath never sees it.
const LOCK_EVENTS = ['pointerdown', 'wheel', 'touchstart', 'touchmove', 'dblclick', 'keydown'] as const

function useGraphLock(ref: { current: HTMLElement | null }, locked: boolean) {
  useEffect(() => {
    const el = ref.current
    if (!locked || !el) return
    const block = (e: Event) => {
      e.preventDefault()
      e.stopPropagation()
    }
    const blockMove = (e: Event) => {
      if ((e as PointerEvent).buttons) block(e)
    }
    const opts = { capture: true, passive: false } as const
    for (const t of LOCK_EVENTS) el.addEventListener(t, block, opts)
    el.addEventListener('pointermove', blockMove, opts)
    return () => {
      for (const t of LOCK_EVENTS) el.removeEventListener(t, block, opts)
      el.removeEventListener('pointermove', blockMove, opts)
    }
  }, [ref, locked])
}

// One inline graph. Owns its error state; forwards each distinct message set
// to the viewer once. Not selectable text: no data-start anywhere inside.
function GraphFence({
  spec,
  startOffset,
  options,
  renderGraph,
  onErrors,
}: {
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
  const summary = graphErrorSummary(messages)
  const { widthPct, height } = graphFenceStyle(options)
  const style: CSSProperties = { width: `${widthPct}%`, maxWidth: '100%' }
  const plotStyle: CSSProperties | undefined =
    height !== undefined ? ({ '--graph-height': `${height}px` } as CSSProperties) : undefined
  return (
    <div
      className={`document-viewer-graph${options.lock ? ' document-viewer-graph-locked' : ''}`}
      data-graph-start={startOffset}
      data-graph-locked={options.lock ? 'true' : undefined}
      style={style}
      contentEditable={false}
    >
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
}: {
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
        leaves.push({ start: run.start, end: run.end, math: true })
        continue
      }
      const overlapping = markerSpans.filter((m) => m.span.end > run.start && m.span.start < run.end)
      let cursor = run.start
      for (const { marker, span } of overlapping) {
        const s = Math.max(span.start, run.start)
        const e = Math.min(span.end, run.end)
        if (s < cursor) continue // overlapping marker tokens — keep the first
        if (s > cursor) leaves.push({ start: cursor, end: s, bold: run.bold, italic: run.italic, code: run.code })
        leaves.push({ start: s, end: e, bold: run.bold, italic: run.italic, code: run.code, marker })
        cursor = e
      }
      if (cursor < run.end) leaves.push({ start: cursor, end: run.end, bold: run.bold, italic: run.italic, code: run.code })
    }
    return leaves
  }

  function renderMathNode(start: number, end: number, display: boolean, Wrap: 'span' | 'div'): ReactNode {
    const result = renderMath(text.slice(start, end), display)
    const attrs = {
      'data-start': start,
      'data-math': '1',
      'data-math-end': end,
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

  function renderFence(start: number, end: number): ReactNode {
    // One span per source line so highlight/selection mapping (data-start on
    // text-bearing leaves) keeps working; newlines are plain text between.
    const lines = text.slice(start, end).split('\n')
    const out: ReactNode[] = []
    let pos = start
    lines.forEach((ln, idx) => {
      if (idx > 0) out.push('\n')
      if (ln.length > 0) out.push(<span key={pos} data-start={pos}>{ln}</span>)
      pos += ln.length + 1
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

  return (
    <div className="document-viewer-text document-viewer-markdown" ref={rootRef}>
      {blocks.map((block) => {
        if (block.type === 'math') {
          return renderMathNode(block.start, block.end, true, 'div')
        }
        if (block.type === 'fence') {
          const graph = renderGraph ? graphFenceModel(block, text) : null
          if (graph && renderGraph) {
            // Keyed by ordinal among graph fences (so edits elsewhere keep the
            // plot mounted) plus the spec (so a new spec remounts, which resets
            // the fence's error state without an effect racing the child's).
            const key = `graph-${graphOrdinal++}:${graphOptionsSignature(graph.options)}:${graph.spec}`
            return (
              <GraphFence
                key={key}
                spec={graph.spec}
                options={graph.options}
                startOffset={graph.startOffset}
                renderGraph={renderGraph}
                onErrors={onGraphErrors}
              />
            )
          }
          return (
            <pre key={block.start} className={BLOCK_CLASS.fence} data-info={block.info || undefined}>
              {renderFence(block.start, block.end)}
            </pre>
          )
        }
        const Tag = BLOCK_TAG[block.type] as ElementType
        const runs = parseInline(text.slice(block.start, block.end), block.start)
        return (
          <Tag key={block.start} className={BLOCK_CLASS[block.type] || undefined}>
            {leavesFor(runs).map(renderLeaf)}
          </Tag>
        )
      })}
    </div>
  )
}
