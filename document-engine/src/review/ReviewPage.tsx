import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolve, toDocumentTokens, builtinById, DEFAULT_THEME_ID } from 'theme-core'
import type { DocumentTokens } from 'theme-core'
import { EditorView } from '@codemirror/view'
import { setLivePreview } from '../editor/extensions'
import { graphCounters } from '../editor/liveWidgets'
import DocumentViewer from '../DocumentViewer'
import Ribbon from '../ribbon/Ribbon'
import { buildRibbon, DEFAULT_RICH_STATE, type RichState, type RibbonValueId, type RibbonValue } from '../ribbon/ribbonModel'
import { tokensToCssVars } from '../tokenVars'
import type { BlockStyle } from '../editor/editorCommands'
import type { CSSProperties } from 'react'
import type { ZoomMode } from '../zoomModel'
import type { DocumentHighlight, DocumentHost, DocumentLayer, RenderGraph } from '../types'

// ?typo=clean|retro: emulates the two example workspace themes of
// src/typography.md by setting the document-typography hooks on the sheet.
const TYPO: Record<string, Record<string, string>> = {
  clean: {
    '--de-title-font': 'Georgia, serif', '--de-title-size': '2.5em', '--de-title-weight': '600',
    '--de-title-leading': '1.08', '--de-title-tracking': '-0.018em', '--de-lede-size': '1.19em',
    '--de-section-mark': '""', '--de-section-mark-width': '14px', '--de-section-mark-height': '2px',
    '--de-section-mark-bg': 'var(--de-accent)',
  },
  retro: {
    '--de-title-size': '1.8em', '--de-lede-size': '1.1em', '--de-section-size': '1em',
    '--de-section-mark': 'counter(de-section, decimal-leading-zero)',
    '--de-section-mark-font': 'var(--de-font-mono)', '--de-section-mark-size': '0.7em',
    '--de-section-mark-padding': '0.15em 0.45em', '--de-section-mark-bg': 'var(--de-accent)',
    '--de-section-mark-color': 'var(--de-page)', '--de-section-mark-radius': 'var(--de-radius-sm)',
  },
}

import type { OutlineHeading } from '../outline'
// Dev-only harness: the viewer over a gaudy blurred scene, inside a "sheet"
// whose opacity comes from the URL (?opacity=55&mode=dark&case=normal).

const MD = [
  '# Review sheet',
  '',
  'English prose: the quick brown fox jumps over the lazy dog, then reads *emphasis* and **strong** text for a while so wrapping is visible.',
  '',
  'Greek and operators: α β γ ∫ ∑ ≤ ∞. Japanese: 日本語の文章です。 Emoji: 😀 after the smiley.',
  '',
  'Inline math $x^{n+1}$ sits in a line, and prices read $5 and $6 without turning into math.',
  '',
  String.raw`$$\int_0^1 x^2\,dx$$`,
  '',
  'Highlight after the math: this sentence is highlighted.',
  '',
  '- first list item',
  '- second list item with `inline code`',
  '',
  '1. numbered one',
  '2. numbered two',
  '',
  '```python',
  'def f(x):',
  '    return x ** 2  # square',
  '```',
  '',
  '```graph',
  'y = x^2',
  'x in [-3, 3]',
  '```',
  '',
  '> A quoted line with **bold** text that wraps',
  '> onto a second source line.',
  '>',
  '> > Nested quote highlight target.',
  '',
  '> [!note] Callout title',
  '> callout body text',
  '',
  'Closing paragraph with the author anchor on this phrase and a marker here.',
  '',
  '## First section',
  '',
  'Section text one with a selectable phrase.',
  '',
  '## Second section',
  '',
  'Section text two.',
].join('\n')

const cp = (s: string) => [...s].length
function range(needle: string): { start: number; end: number; quote: string } {
  const i = MD.indexOf(needle)
  if (i < 0) throw new Error('needle missing: ' + needle)
  const start = cp(MD.slice(0, i))
  return { start, end: start + cp(needle), quote: needle }
}

const HIGHLIGHTS: DocumentHighlight[] = [
  { id: 'h1', color: 'yellow', ...range('Emoji: 😀 after the smiley') },
  { id: 'h2', color: 'green', ...range('this sentence is highlighted') },
  { id: 'h3', color: 'blue', ...range('onto a second source line') },
  { id: 'h4', color: 'pink', ...range('Nested quote highlight') },
]

const LAYER: DocumentLayer = {
  anchor: { ...range('author anchor on this phrase'), label: 'Anchor' },
  markers: [
    { id: 'm1', offset: range('Inline math').start },
    { id: 'm2', offset: range('a marker here').start },
  ],
}

const stubGraph: RenderGraph = (spec) => (
  <div style={{ border: '2px solid currentColor', padding: '1.5rem', textAlign: 'center' }}>
    graph stub: {spec.split('\n')[0]}
  </div>
)

// ?case=graphs: several graph fences with options and an instrumented stub.
// window.__graphMounts = {mounts, unmounts}; window.__graphGestures = events
// that reached a stub (wheel/pointerdown/dblclick, with the stub's index);
// window.__graphCtx[i] = the ctx the stub at index i last received.
// Live regression (headless, real input): a double-click at the centre of the
// locked 4th graph's plot expands it ([data-graph-expanded]) and
// __graphGestures stays empty (the frame's capture handler runs before the
// plot's lock block).
const GRAPHS_MD = [
  '# Graph embeds',
  '',
  'Intro paragraph before the graphs, long enough to be a real paragraph of prose for the document.',
  '',
  '```graph',
  'y = x^2',
  '```',
  '',
  'Between one and two.',
  '',
  '```graph size=s',
  'y = x',
  '```',
  '',
  'Between two and three.',
  '',
  '```graph size=l height=220',
  'y = sin(x)',
  '```',
  '',
  'Between three and four.',
  '',
  '```graph view=x:-5..5,y:-3..3 lock',
  'y = cos(x)',
  '```',
  '',
  'Closing paragraph after the graphs.',
].join('\n')

type GraphGlobals = {
  __graphMounts: { mounts: number; unmounts: number }
  __graphGestures: { type: string; index: number }[]
  __graphCtx: Record<number, { view?: unknown; bounds?: string; lock?: boolean }>
}
const gg = (): GraphGlobals => window as unknown as GraphGlobals
if (typeof window !== 'undefined') {
  const w = gg()
  w.__graphMounts ??= { mounts: 0, unmounts: 0 }
  w.__graphGestures ??= []
  w.__graphCtx ??= {}
}

function InstrumentedGraph({ index, spec, ctx }: { index: number; spec: string; ctx: Parameters<RenderGraph>[1] }): ReactNode {
  useEffect(() => {
    gg().__graphMounts.mounts++
    return () => { gg().__graphMounts.unmounts++ }
  }, [])
  gg().__graphCtx[index] = { view: ctx.view, bounds: ctx.bounds, lock: ctx.lock }
  const note = (type: string) => () => { gg().__graphGestures.push({ type, index }) }
  return (
    <div
      data-testid={`graph-stub-${index}`}
      onWheel={note('wheel')}
      onPointerDown={note('pointerdown')}
      onDoubleClick={note('dblclick')}
      style={{ border: '2px solid currentColor', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}
    >
      graph stub {index}: {spec.split('\n')[0]}
    </div>
  )
}

// Index = order of first render per spec text (specs are distinct in GRAPHS_MD).
const graphIndexBySpec = new Map<string, number>()
const instrumentedGraph: RenderGraph = (spec, ctx) => {
  if (!graphIndexBySpec.has(spec)) graphIndexBySpec.set(spec, graphIndexBySpec.size)
  return <InstrumentedGraph index={graphIndexBySpec.get(spec)!} spec={spec} ctx={ctx} />
}

// ?case=editor: DocumentViewer interaction="edit" over a controlled markdown
// text asset. window.__doc = {text, changes} (latest onTextChange value and
// the count of calls); window.__setDoc(s) replaces the controlled value from
// outside (the IME-during-composition check); window.__hl = current highlight
// ranges (codepoints, from onHighlightsChange); window.__view() = the live
// CodeMirror EditorView; window.__comp = composition DOM events seen;
// window.__keys = keydown events that reached the wrapper in the bubble phase
// and a capture-phase Mod-s probe on the wrapper (mimics web's handler).
// ?host=1 publishes the editor commands to the stub strip (window.__hostCmds);
// without it the unhosted viewer draws the Ribbon in place.
const EDITOR_MD = [
  '# Edit sheet',
  '',
  'Intro line with a few words.',
  '',
  '- item one',
  '- item two',
  '',
  '- [ ] task one',
  '',
  '> quote line',
  '',
  '```js',
  'const a = 1',
  '```',
  '',
  'a 😀 b',
  '',
  'Final line of text.',
].join('\n')

type EditorGlobals = {
  __doc: { text: string; changes: number }
  __setDoc: (s: string) => void
  __hl: { id: string; start: number; end: number; quote?: string }[]
  __view: () => EditorView | null
  __comp: string[]
  __keys: string[]
  __capKeys: string[]
  '',
  '## Math and graphs',
  '',
  String.raw`Inline $x^2 + y^2 = z^2$ then a broken $\frac{1$ and a price $5.`,
  '',
  '$$',
  String.raw`\int_0^1 x^2\,dx = \tfrac{1}{3}`,
  '$$',
  '',
  '```graph size=m',
  'y = x^2',
  '```',
  '',
  'Marked text after the graph.',
  // Set true to make the parent ignore onTextChange (state stays at the last
  // __setDoc value) so a queued external value can be seen applying.
  __hold: boolean
}
const eg = (): EditorGlobals => window as unknown as EditorGlobals
if (typeof window !== 'undefined') {
  const w = eg()
  w.__comp ??= []
  w.__keys ??= []
  w.__capKeys ??= []
  w.__view = () => {
    const el = document.querySelector<HTMLElement>('.cm-editor')
    return el ? EditorView.findFromDOM(el.parentElement ?? el) : null
  }
}

function edRange(needle: string, text: string): { start: number; end: number; quote: string } {
  ;(w as unknown as { __lpGraph: typeof graphCounters }).__lpGraph = graphCounters
  const i = text.indexOf(needle)
  if (i < 0) throw new Error('needle missing: ' + needle)
  const start = cp(text.slice(0, i))
  return { start, end: start + cp(needle), quote: needle }
}

function EditorCase({ tokens, host }: { tokens: DocumentTokens; host: DocumentHost | undefined }): ReactNode {
  const [text, setText] = useState(EDITOR_MD)
  const [hl, setHl] = useState<DocumentHighlight[]>(() => [
    { id: 'above', color: 'yellow', ...edRange('Intro line', EDITOR_MD) },
    { id: 'below', color: 'green', ...edRange('Final line', EDITOR_MD) },
  ])
  const w = eg()
  w.__doc = { text, changes: (w.__doc?.changes ?? 0) }
  w.__hl = hl.map((h) => ({ id: h.id, start: h.start, end: h.end, quote: h.quote }))
  w.__setDoc = (s: string) => setText(s)
  // ?lp=0 mounts the raw (non-live-preview) editor for comparison.
  const lpOff = new URLSearchParams(location.search).get('lp') === '0'
  useEffect(() => {
    if (!lpOff) return
    let raf = 0
    { id: 'tail', color: 'pink', ...edRange('Marked text after', EDITOR_MD) },
    { id: 'emoji', color: 'blue', ...edRange('a 😀 b', EDITOR_MD) },
    const tryOff = () => { const v = eg().__view(); if (v) setLivePreview(v, false); else raf = requestAnimationFrame(tryOff) }
    tryOff()
    return () => cancelAnimationFrame(raf)
  }, [lpOff])
  return (
    <div
      data-testid="editor-wrapper"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
      onKeyDownCapture={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') eg().__capKeys.push('Mod-s:' + e.defaultPrevented) }}
      onKeyDown={(e) => { eg().__keys.push(e.key + ':' + e.defaultPrevented) }}
      onCompositionStart={() => eg().__comp.push('start')}
      onCompositionEnd={() => eg().__comp.push('end')}
    >
      <DocumentViewer
        host={host}
        asset={{ type: 'text', mime: 'text/markdown', content: text }}
        tokens={tokens}
        // ?ro=1 shows the same text in the read-only (annotate) viewer.
        interaction={new URLSearchParams(location.search).has('ro') ? 'annotate' : 'edit'}
        chrome="full"
        layers={[]}
        highlights={hl}
        onHighlightsChange={setHl}
        onTextChange={(t) => { eg().__doc.changes++; eg().__doc.text = t; if (!eg().__hold) setText(t) }}
        renderGraph={instrumentedGraph}
      />
    </div>
  )
}

// ?case=ribbon: the ribbon alone in rich mode with fake handlers (the engine
// has no rich editor yet). window.__ribbonLog records every handler call.
function RibbonCase({ tokens }: { tokens: DocumentTokens }): ReactNode {
  const [rich, setRich] = useState<RichState>({ ...DEFAULT_RICH_STATE })
  const [style, setStyle] = useState<BlockStyle>('h2')
  const [bold, setBold] = useState(true)
  const [log, setLog] = useState<string[]>([])
  const cssVars = useMemo(() => tokensToCssVars(tokens), [tokens])
  const note = (m: string) => { setLog((l) => [...l.slice(-6), m]); (window as unknown as { __ribbonLog: string[] }).__ribbonLog = [...((window as unknown as { __ribbonLog?: string[] }).__ribbonLog ?? []), m] }
  const ribbon = buildRibbon({
    mode: 'rich',
    state: {
      marks: { bold, italic: false, strike: false, code: false, heading: false, bullet: false, numbered: false, task: false, quote: false },
      blockStyle: style, selectionEmpty: false, undoDepth: 2, redoDepth: 0, readOnly: false, clipboard: true, rich,
    },
    handlers: {
      command: (id) => { note('command ' + id); if (id === 'bold') setBold((b) => !b) },
      blockStyle: (st) => { note('style ' + st); setStyle(st) },
      setValue: (id: RibbonValueId, v: RibbonValue) => { note(`set ${id}=${v}`); if (id === 'font-family') setRich((r) => ({ ...r, fontFamily: String(v) })); if (id === 'font-size') setRich((r) => ({ ...r, fontSize: Number(v) })); if (id === 'text-color') setRich((r) => ({ ...r, color: v as string | null })) },
    },
  })
  return (
    <div className="document-viewer" style={cssVars as CSSProperties} data-mode={tokens.mode}>
      <Ribbon ribbon={ribbon} icons={{ kind: 'default' }} onDone={() => note('done')} />
      <pre data-testid="ribbon-log" style={{ padding: 12, fontSize: 12 }}>{log.join(' | ')}</pre>
    </div>
  )
}

function tokensFor(mode: 'light' | 'dark'): DocumentTokens {
  const m = builtinById(DEFAULT_THEME_ID)
  if (!m) throw new Error('default theme missing')
  return toDocumentTokens(resolve(m), m, mode)
}

// ?alphas=surface,callout,media (each 0..1) overrides tokens.alphas.
function withAlphas(t: DocumentTokens, param: string | null): DocumentTokens {
  if (!param) return t
  const [surface, callout, media] = param.split(',').map(Number)
  const ok = (n: number | undefined, d: number) => (n === undefined || Number.isNaN(n) ? d : Math.min(1, Math.max(0, n)))
  return { ...t, alphas: { ...t.alphas, surface: ok(surface, t.alphas.surface), callout: ok(callout, t.alphas.callout), media: ok(media, t.alphas.media) } }
}

type Published = { cmds: { id: string; enabled: boolean; active: boolean }[]; layers: string[] }

// ?host=1: stub DocumentHost that records what the viewer publishes.
function makeHost(onChange: (p: Published) => void): DocumentHost {
// ?case=hosted&im=view|annotate|edit: the viewer under a stub host. No floating
// zoom/settings controls; the stub strip lists what the viewer published (each
// a button that calls its run()), and an outline list built from onOutline
// scrolls the viewer (scrollToHeadingId). window.__outline = latest headings,
// window.__outlineCalls = number of onOutline calls, window.__runCmd(id).
const HOSTED_MD = (() => {
  const filler = (n: number) =>
    Array.from({ length: n }, (_, i) => `Filler paragraph ${i + 1}: the quick brown fox jumps over the lazy dog, again and again, to give the page height.`).join('\n\n')
  return [
    '# Alpha',
    '',
    filler(8),
    '',
    '## Notes',
    '',
    filler(8),
    '',
    '```md',
    '# not a heading',
    '```',
    '',
    '### Beta **bold** `code` \u{1F600}',
    '',
    filler(8),
    '',
    'Setext title',
    '------------',
    '',
    filler(8),
    '',
    '## Notes',
    '',
    filler(10),
    '',
    '# Omega',
    '',
    filler(3),
  ].join('\n')
})()

type HostedGlobals = { __outline: OutlineHeading[]; __outlineCalls: number; __runCmd: (id: string) => boolean }
const hg = (): HostedGlobals => window as unknown as HostedGlobals

function HostedCase({ tokens, host, published }: { tokens: DocumentTokens; host: DocumentHost | undefined; published: Published | null }): ReactNode {
  const im = new URLSearchParams(location.search).get('im')
  const interaction = im === 'view' || im === 'edit' ? im : 'annotate'
  const [text, setText] = useState(HOSTED_MD)
  const [outline, setOutline] = useState<OutlineHeading[]>([])
  const [target, setTarget] = useState<{ id: string; nonce: number } | null>(null)
  const w = hg()
  w.__outlineCalls ??= 0
  w.__runCmd = (id: string) => {
    const c = (window as unknown as { __hostCmds?: { id: string; run: () => void }[] }).__hostCmds?.find((x) => x.id === id)
    c?.run()
    return !!c
  }
  const row = { display: 'flex', flexWrap: 'wrap', gap: 4, padding: '4px 10px', fontSize: 12 } as const
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div data-testid="host-buttons" style={row}>
        {(published?.cmds ?? []).map((c) => (
          <button key={c.id} type="button" disabled={!c.enabled} onClick={() => w.__runCmd(c.id)}>{c.id}</button>
        ))}
      </div>
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <ol data-testid="outline" style={{ margin: 0, padding: '4px 10px', listStyle: 'none', fontSize: 12, width: 220, overflow: 'auto', borderRight: '1px solid currentColor' }}>
          {outline.map((h) => (
            <li key={h.id} style={{ paddingLeft: (h.level - 1) * 10 }}>
              <button type="button" data-heading={h.id} onClick={() => setTarget((t) => ({ id: h.id, nonce: (t?.nonce ?? 0) + 1 }))}>{h.text || '(empty)'}</button>
            </li>
          ))}
        </ol>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <DocumentViewer
            host={host}
            asset={{ type: 'text', mime: 'text/markdown', content: text }}
            tokens={tokens}
            interaction={interaction}
            chrome="full"
            layers={[]}
            onTextChange={interaction === 'edit' ? setText : undefined}
            onOutline={(h) => { setOutline(h); w.__outline = h; w.__outlineCalls++ }}
            scrollToHeadingId={target}
          />
        </div>
      </div>
    </div>
  )
}

  const state: Published = { cmds: [], layers: [] }
  return {
    icons: { kind: 'default' },
    toolbar: {
      publishCommands: (cmds) => { (window as unknown as { __hostCmds: unknown }).__hostCmds = cmds; state.cmds = cmds.map((c) => ({ id: c.id, enabled: c.enabled, active: c.active })); onChange({ ...state }) },
      clear: () => { state.cmds = []; onChange({ ...state }) },
    },
    layers: (list) => { state.layers = list.map((l) => l.id); onChange({ ...state }) },
  }
}

const SCENE = `
  repeating-linear-gradient(45deg, #ff2d95 0 40px, #ffe600 40px 80px, #00e5ff 80px 120px, #7cff3a 120px 160px)`

export default function ReviewPage(): ReactNode {
  const q = useMemo(() => new URLSearchParams(location.search), [])
  const opacity = Math.min(100, Math.max(0, Number(q.get('opacity') ?? 100))) / 100
  const mode = q.get('mode') === 'dark' ? 'dark' : 'light'
  const kase = q.get('case') ?? 'normal'
  const alphasParam = q.get('alphas')
  const tokens = useMemo(() => withAlphas(tokensFor(mode), alphasParam), [mode, alphasParam])
  const [published, setPublished] = useState<Published | null>(null)
  const host = useMemo(() => (q.get('host') === '1' || q.get('case') === 'hosted' ? makeHost(setPublished) : undefined), [q])
  const hlQuote = q.get('hl')
  const [hl, setHl] = useState<DocumentHighlight[]>(hlQuote ? [{ id: 'pq', color: 'yellow', start: 0, end: [...hlQuote].length, quote: hlQuote }] : HIGHLIGHTS)
  // ?case=pdf&pdf=/review-shots/sample.pdf&zoom=fit-page|0.25|5&steps=in,in,out&bench=1
  const pdf = kase === 'pdf'
  const zoomParam = q.get('zoom')
  const initialZoom: ZoomMode | undefined = !zoomParam ? undefined : zoomParam.startsWith('fit-') ? (zoomParam as ZoomMode) : Number(zoomParam)
  useEffect(() => {
    if (!pdf) return
    const steps = (q.get('steps') ?? '').split(',').filter(Boolean)
    const bench = q.has('bench')
    const click = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.click()
    const timers: ReturnType<typeof setTimeout>[] = []
    steps.forEach((s, i) => timers.push(setTimeout(() => click(s === 'in' ? 'Zoom in' : 'Zoom out'), 2500 + i * 1500)))
    if (bench) {
      // Cost of a zoom step as the reader feels it: click -> next two frames
      // (layout + paint of the stretched pages), then click -> sharp redraw.
      timers.push(
        setTimeout(async () => {
          const out: string[] = []
          const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
          for (let i = 0; i < 6; i++) {
            const t0 = performance.now()
            click(i % 2 === 0 ? 'Zoom in' : 'Zoom out')
            const tSync = performance.now() - t0
            await frames()
            out.push(`step${i}: sync=${tSync.toFixed(1)}ms frames=${(performance.now() - t0).toFixed(1)}ms`)
            await new Promise((r) => setTimeout(r, 700))
          }
          const pre = document.createElement('pre')
          pre.id = 'bench'
          pre.textContent = 'BENCH ' + out.join(' | ') + ` | pages=${document.querySelectorAll('.document-viewer-pdf-page').length} canvases=${document.querySelectorAll('.document-viewer-pdf-page canvas').length}`
          document.body.appendChild(pre)
        }, 3000)
      )
    }
    return () => timers.forEach(clearTimeout)
  }, [pdf, q])
  // ?hlSpans=3-9 highlights text-layer spans 3..9 of page 1 (multi-line when
  // they span lines); ?selSpans=3-9 sets a native selection over them;
  // ?dump=1 lists page-1 spans (index, top, text) in #dump.
  useEffect(() => {
    if (!pdf) return
    let done = false
    const t = setInterval(() => {
      if (done) return
      const spans = Array.from(document.querySelectorAll<HTMLElement>('.document-viewer-pdf-page[data-page="1"] .document-viewer-pdf-text-layer [data-start]')).filter(
        (s) => s.firstChild instanceof Text
      )
      if (spans.length === 0) return
      done = true
      const parse = (k: string): [number, number] | null => {
        const v = q.get(k)
        if (!v) return null
        const [a, b] = v.split('-').map(Number)
        return spans[a] && spans[b] ? [a, b] : null
      }
      const hs = parse('hlSpans')
      if (hs) {
        const start = Number(spans[hs[0]].dataset.start)
        const end = Number(spans[hs[1]].dataset.start) + (spans[hs[1]].firstChild as Text).length
        setHl([{ id: 'hs', color: q.get('hlColor') ?? 'yellow', start, end }])
      }
      const ss = parse('selSpans')
      if (ss) {
        const r = document.createRange()
        r.setStart(spans[ss[0]].firstChild as Text, 0)
        r.setEnd(spans[ss[1]].firstChild as Text, (spans[ss[1]].firstChild as Text).length)
        const sel = document.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
      }
      if (q.has('dump')) {
        const pre = document.createElement('pre')
        pre.id = 'dump'
        pre.textContent = spans.map((s, i) => `${i}\t${Math.round(s.getBoundingClientRect().top)}\t${s.textContent}`).join('\n')
        document.body.appendChild(pre)
      }
    }, 500)
    return () => clearInterval(t)
  }, [pdf, q])
  // ?trace=1 records every change of page-1's rendered width (scale proxy),
  // the scroller's client height and any horizontal scrollbar in
  // window.__scaleTrace; ?frames=1 records requestAnimationFrame deltas in
  // window.__frameDeltas (read by the pacing script).
  useEffect(() => {
    if (!q.has('trace')) return
    const trace: { t: number; pageW: number; clientH: number; hbar: boolean }[] = []
    ;(window as unknown as { __scaleTrace: typeof trace }).__scaleTrace = trace
    let raf = 0
    const t0 = performance.now()
    const tick = () => {
      const page = document.querySelector<HTMLElement>('.document-viewer-pdf-page')
      const sc = document.querySelector<HTMLElement>('.document-viewer-scroll')
      if (page && sc) {
        const pageW = Math.round(page.getBoundingClientRect().width * 100) / 100
        const last = trace[trace.length - 1]
        const hbar = sc.scrollWidth > sc.clientWidth
        if (!last || last.pageW !== pageW || last.clientH !== sc.clientHeight || last.hbar !== hbar) trace.push({ t: Math.round(performance.now() - t0), pageW, clientH: sc.clientHeight, hbar })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [q])
  useEffect(() => {
    if (!q.has('frames')) return
    const deltas: number[] = []
    ;(window as unknown as { __frameDeltas: number[] }).__frameDeltas = deltas
    let last = performance.now()
    let raf = 0
    const tick = (now: number) => {
      deltas.push(now - last)
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [q])
  useEffect(() => { document.body.style.margin = '0' }, [])
  // ?typo=: set the hooks inline on every viewer root (where --de-accent etc. resolve).
  useEffect(() => {
    const vars = TYPO[q.get('typo') ?? '']
    if (!vars) return
    for (const r of document.querySelectorAll<HTMLElement>('.document-viewer')) {
      for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v)
    }
  })
  const sheetBg = `color-mix(in srgb, ${tokens.colors.page} ${opacity * 100}%, transparent)`

  return (
    <div style={{ minHeight: '100vh', background: SCENE, padding: 24, boxSizing: 'border-box' }}>
      <div
        data-testid="sheet"
        style={{
          background: sheetBg,
          backdropFilter: 'blur(14px)',
          color: tokens.colors.text,
          height: 'calc(100vh - 48px)',
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {host && (
          <pre data-testid="host-strip" style={{ margin: 0, padding: '6px 10px', fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', borderBottom: '1px solid currentColor' }}>
            {published
              ? 'commands: ' + (published.cmds.map((c) => c.id + (c.enabled ? '' : ' [disabled]') + (c.active ? ' [active]' : '')).join(', ') || '(none)') + '\nlayers: ' + (published.layers.join(', ') || '(none)')
              : 'host: nothing published'}
          </pre>
        )}
        {kase === 'ribbon' ? (
          <RibbonCase tokens={tokens} />
        ) : kase === 'editor' ? (
          <EditorCase tokens={tokens} host={host} />
        ) : (
        <DocumentViewer
          host={host}
          asset={pdf ? { type: 'file', mime: 'application/pdf', url: q.get('pdf') ?? '/review-shots/sample.pdf' } : { type: 'text', mime: 'text/markdown', content: kase === 'graphs' ? GRAPHS_MD : MD, extractedText: kase === 'graphs' ? GRAPHS_MD : MD }}
          initialZoom={initialZoom}
          tokens={tokens}
          interaction={kase === 'edit' ? 'edit' : 'annotate'}
          chrome={kase === 'embedded' ? 'embedded' : 'full'}
          gated={kase === 'gated'}
          layers={kase === 'graphs' ? [] : [LAYER]}
          highlights={kase === 'graphs' ? [] : hl}
          onHighlightsChange={setHl}
          renderGraph={kase === 'graphs' ? instrumentedGraph : stubGraph}
        />
        )}
      </div>
        ) : kase === 'hosted' ? (
          <HostedCase tokens={tokens} host={host} published={published} />
    </div>
  )
}
