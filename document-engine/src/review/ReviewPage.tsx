import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolve, toDocumentTokens, builtinById, DEFAULT_THEME_ID } from 'theme-core'
import type { DocumentTokens } from 'theme-core'
import DocumentViewer from '../DocumentViewer'
import type { ZoomMode } from '../zoomModel'
import type { DocumentHighlight, DocumentLayer, RenderGraph } from '../types'

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
  'Closing paragraph with the author anchor on this phrase and a marker here.',
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

function tokensFor(mode: 'light' | 'dark'): DocumentTokens {
  const m = builtinById(DEFAULT_THEME_ID)
  if (!m) throw new Error('default theme missing')
  return toDocumentTokens(resolve(m), m, mode)
}

const SCENE = `
  repeating-linear-gradient(45deg, #ff2d95 0 40px, #ffe600 40px 80px, #00e5ff 80px 120px, #7cff3a 120px 160px)`

export default function ReviewPage(): ReactNode {
  const q = useMemo(() => new URLSearchParams(location.search), [])
  const opacity = Math.min(100, Math.max(0, Number(q.get('opacity') ?? 100))) / 100
  const mode = q.get('mode') === 'dark' ? 'dark' : 'light'
  const kase = q.get('case') ?? 'normal'
  const tokens = useMemo(() => tokensFor(mode), [mode])
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
  useEffect(() => { document.body.style.margin = '0' }, [])
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
        <DocumentViewer
          asset={pdf ? { type: 'file', mime: 'application/pdf', url: q.get('pdf') ?? '/review-shots/sample.pdf' } : { type: 'text', mime: 'text/markdown', content: MD, extractedText: MD }}
          initialZoom={initialZoom}
          tokens={tokens}
          interaction={kase === 'edit' ? 'edit' : 'annotate'}
          chrome={kase === 'embedded' ? 'embedded' : 'full'}
          gated={kase === 'gated'}
          layers={[LAYER]}
          highlights={hl}
          onHighlightsChange={setHl}
          renderGraph={stubGraph}
        />
      </div>
    </div>
  )
}
