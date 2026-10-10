import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TextLayer, type PDFPageProxy, type RenderTask } from 'pdfjs-dist'
import { loadPdf, PAGE_JOIN, type TextItemLike } from './pdfSetup'
import { markerSpanInternal } from './offsetBoundary'
import { paintPdfHighlights, paintPdfSelection } from './pdfOverlays'
import { RESCALE_DEBOUNCE_MS, canvasPlan, cssStretch, planRender, sameScale } from './pdfRenderModel'
import type { ResolvedMarker } from './viewerModel'
import type { DocumentAnchor, DocumentHighlight, DocumentRenderError } from './types'

type TextContentT = Awaited<ReturnType<PDFPageProxy['getTextContent']>>
interface Size {
  w: number
  h: number
}

// Everything the engine knows about one page. The DOM it owns (the "inner"
// wrapper with canvas + text layer) is created and removed imperatively
// inside the React-owned host div, so React never reconciles pdfjs nodes.
interface PageState {
  n: number
  proxy: PDFPageProxy
  size: Size // at scale 1 (one PDF point per CSS px)
  content: TextContentT | null
  itemStarts: number[] | null // global text offset of each text item
  host: HTMLDivElement | null
  inner: HTMLDivElement | null
  textDiv: HTMLDivElement | null
  renderedScale: number | null // scale `inner` was drawn at
  wantScale: number | null // scale rendered or in flight; null = nothing
  gen: number // bumped to invalidate in-flight work
  task: RenderTask | null
  textBuilding: boolean
}

interface Engine {
  setHost: (n: number, el: HTMLDivElement | null) => void
  setScale: (scale: number) => void
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'RenderingCancelledException'
}

export default function PdfLayer({
  url,
  anchors,
  markers,
  highlights,
  showOverlays,
  onErrors,
  onText,
  scale = 1,
  onPageSizes,
}: {
  url: string
  anchors: DocumentAnchor[]
  markers: ResolvedMarker[]
  highlights: DocumentHighlight[]
  showOverlays: boolean
  groupPrefix: string
  onErrors?: (errors: DocumentRenderError[]) => void
  // The pdfjs full text the highlights are painted against; the viewer
  // converts and resolves offsets against this, not the asset's own text.
  onText?: (text: string | null) => void
  // Numeric zoom: 1 = pdfjs viewport scale 1 (one PDF point per CSS px).
  scale?: number
  // Page sizes at scale 1, reported once they are known (drives fit modes).
  onPageSizes?: (sizes: Size[]) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const engineRef = useRef<Engine | null>(null)
  const [sizes, setSizes] = useState<Size[]>([])
  const [fullText, setFullText] = useState('')
  // Bumped (coalesced) whenever a page's text layer is (re)built or freed, so
  // marker wiring and highlight painting re-run against the live DOM.
  const [tick, setTick] = useState(0)
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const onTextRef = useRef(onText)
  onTextRef.current = onText
  const onPageSizesRef = useRef(onPageSizes)
  onPageSizesRef.current = onPageSizes
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  // Latest overlay inputs, so a freshly swapped-in page can repaint its
  // highlight/selection bars in the same task as the swap (no bar-less frame).
  const paintRef = useRef({ anchors, highlights, showOverlays })
  paintRef.current = { anchors, highlights, showOverlays }

  useEffect(() => {
    let disposed = false
    setSizes([])
    setFullText('')
    onTextRef.current?.(null)
    const loadingTask = loadPdf(url)

    const states = new Map<number, PageState>()
    const visible = new Set<number>()
    let numPages = 0
    let target = scaleRef.current
    let debouncing = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let bumpTimer: ReturnType<typeof setTimeout> | null = null
    let io: IntersectionObserver | null = null

    const bump = () => {
      if (bumpTimer !== null) return
      bumpTimer = setTimeout(() => {
        bumpTimer = null
        if (!disposed) setTick((t) => t + 1)
      }, 30)
    }

    const applyStretch = (st: PageState) => {
      if (!st.inner || st.renderedScale === null) return
      const f = cssStretch(st.renderedScale, target)
      st.inner.style.transform = f === 1 ? '' : `scale(${f})`
    }

    const cancelTask = (st: PageState) => {
      st.gen += 1
      if (st.task) {
        try {
          st.task.cancel()
        } catch {
          /* already finished */
        }
        st.task = null
      }
    }

    const dropInner = (inner: HTMLDivElement) => {
      // Release the backing store now rather than waiting for GC.
      inner.querySelectorAll('canvas').forEach((c) => {
        c.width = 0
        c.height = 0
      })
      inner.remove()
    }

    const freePage = (st: PageState) => {
      cancelTask(st)
      st.wantScale = null
      if (st.inner) {
        const hadText = !!st.textDiv
        dropInner(st.inner)
        st.inner = null
        st.textDiv = null
        st.renderedScale = null
        if (hadText) bump()
      }
    }

    async function buildTextLayer(st: PageState, scale: number): Promise<HTMLDivElement | null> {
      if (!st.content || !st.itemStarts) return null
      const starts = st.itemStarts
      const viewport = st.proxy.getViewport({ scale })
      const div = document.createElement('div')
      div.className = 'document-viewer-pdf-text-layer'
      // pdfjs's TextLayer computes each div's position/size via CSS custom
      // properties (--scale-factor, --total-scale-factor, --scale-round-x/y)
      // that its full-viewer stylesheet normally sets on an ancestor `.page`
      // element. TextLayer is used standalone here, so set them explicitly,
      // mirroring what pdf_viewer.mjs sets on its page container.
      div.style.setProperty('--scale-factor', String(viewport.scale))
      // pdfjs PageViewport multiplies its width/height by userUnit but keeps
      // `.scale` as given (pdfjs-dist build/pdf.mjs, class PageViewport), so
      // the text layer needs the page's real UserUnit here, as pdf_viewer does.
      div.style.setProperty('--user-unit', String(viewport.userUnit || 1))
      div.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))')
      div.style.setProperty('--scale-round-x', '1px')
      div.style.setProperty('--scale-round-y', '1px')
      const textLayer = new TextLayer({ textContentSource: st.content, container: div, viewport })
      await textLayer.render()
      // textDivs is parallel to `items` (pdfjs guarantees this order), so the
      // running offsets computed at extraction line up with each div here.
      textLayer.textDivs.forEach((d, i) => {
        const start = starts[i]
        if (start !== undefined) d.dataset.start = String(start)
      })
      return div
    }

    // A page that is drawn but has no text layer yet (text extraction was not
    // done when it rendered) gets one as soon as the text is available.
    async function ensureText(st: PageState) {
      if (disposed || !st.inner || st.textDiv || st.textBuilding || !st.itemStarts) return
      st.textBuilding = true
      const inner = st.inner
      try {
        const div = await buildTextLayer(st, st.renderedScale ?? target)
        if (disposed || st.inner !== inner || st.textDiv || !div) return
        inner.appendChild(div)
        st.textDiv = div
        bump()
      } catch (err) {
        if (!disposed) onErrorsRef.current?.([{ message: err instanceof Error ? err.message : String(err) }])
      } finally {
        st.textBuilding = false
        // A rescale swapIn that landed mid-build bailed (textBuilding) and the
        // build above discarded itself; the new inner still needs its text.
        // Only when the inner CHANGED, so a persistent error cannot loop.
        if (!disposed && st.inner && st.inner !== inner && !st.textDiv) void ensureText(st)
      }
    }

    function swapIn(st: PageState, canvas: HTMLCanvasElement, textDiv: HTMLDivElement | null, scale: number) {
      const inner = document.createElement('div')
      inner.className = 'document-viewer-pdf-inner'
      inner.style.width = `${st.size.w * scale}px`
      inner.style.height = `${st.size.h * scale}px`
      inner.appendChild(canvas)
      if (textDiv) inner.appendChild(textDiv)
      const old = st.inner
      const hadText = !!st.textDiv
      if (st.host) st.host.appendChild(inner)
      if (old) dropInner(old)
      st.inner = inner
      st.textDiv = textDiv
      st.renderedScale = scale
      applyStretch(st)
      // Old and new inner swap in this one task (the new canvas was drawn
      // off-screen), so the page never shows blank or half-drawn. Repaint the
      // overlay bars now too, rather than 30 ms later via the tick.
      if (textDiv && st.host) {
        const p = paintRef.current
        paintPdfHighlights(st.host, p.anchors, p.highlights, p.showOverlays)
        paintPdfSelection(st.host)
      }
      if (textDiv || hadText) bump()
      else void ensureText(st)
    }

    function renderPage(st: PageState, scale: number) {
      cancelTask(st)
      st.wantScale = scale
      const gen = st.gen
      const cssW = st.size.w * scale
      const cssH = st.size.h * scale
      const plan = canvasPlan(cssW, cssH, window.devicePixelRatio || 1)
      const canvas = document.createElement('canvas')
      canvas.width = plan.width
      canvas.height = plan.height
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        st.wantScale = st.inner ? st.renderedScale : null
        return
      }
      const task = st.proxy.render({
        canvasContext: ctx,
        viewport: st.proxy.getViewport({ scale }),
        canvas,
        transform: plan.outputScale !== 1 ? [plan.outputScale, 0, 0, plan.outputScale, 0, 0] : undefined,
      })
      st.task = task
      task.promise
        .then(async () => {
          if (disposed || st.gen !== gen) return
          st.task = null
          const textDiv = await buildTextLayer(st, scale)
          if (disposed || st.gen !== gen) {
            canvas.width = 0
            canvas.height = 0
            return
          }
          swapIn(st, canvas, textDiv, scale)
        })
        .catch((err) => {
          canvas.width = 0
          canvas.height = 0
          if (disposed || st.gen !== gen || isCancelled(err)) return
          st.task = null
          st.wantScale = st.inner ? st.renderedScale : null
          onErrorsRef.current?.([{ message: err instanceof Error ? err.message : String(err) }])
        })
    }

    function reconcile() {
      if (disposed || numPages === 0) return
      const rendered = new Map<number, number>()
      for (const st of states.values()) if (st.wantScale !== null) rendered.set(st.n, st.wantScale)
      const plan = planRender({ visible, numPages, rendered, scale: target, debouncing })
      for (const p of plan.free) {
        const st = states.get(p)
        if (st) freePage(st)
      }
      for (const p of plan.render) {
        const st = states.get(p)
        if (st) renderPage(st, target)
      }
    }

    function ensureObserver(): IntersectionObserver | null {
      if (io) return io
      if (typeof IntersectionObserver === 'undefined') return null
      const scroller = rootRef.current?.closest('.document-viewer-scroll') ?? null
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page)
            if (!n) continue
            if (e.isIntersecting) visible.add(n)
            else visible.delete(n)
          }
          reconcile()
        },
        { root: scroller, rootMargin: '50% 0px' }
      )
      return io
    }

    const engine: Engine = {
      setHost(n, el) {
        const st = states.get(n)
        if (!st) return
        if (st.host && st.host !== el) io?.unobserve(st.host)
        st.host = el
        if (!el) {
          visible.delete(n)
          return
        }
        if (st.inner) el.appendChild(st.inner)
        const obs = ensureObserver()
        if (obs) obs.observe(el)
        else {
          visible.add(n)
          reconcile()
        }
      },
      setScale(next) {
        if (sameScale(next, target)) return
        target = next
        let any = false
        for (const st of states.values()) {
          applyStretch(st)
          // In-flight renders at the old scale are wasted work: drop them now.
          if (st.task) {
            cancelTask(st)
            st.wantScale = st.inner ? st.renderedScale : null
          }
          if (st.inner) any = true
        }
        if (!any) {
          reconcile()
          return
        }
        // Instant feedback came from the CSS stretch; the sharp re-render of
        // already-drawn pages waits until the zoom settles. Visible pages with
        // no canvas yet render right away (planRender), never blank for 150ms.
        debouncing = true
        if (debounceTimer !== null) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          debounceTimer = null
          debouncing = false
          reconcile()
        }, RESCALE_DEBOUNCE_MS)
        reconcile()
      },
    }
    engineRef.current = engine

    async function run() {
      try {
        const doc = await loadingTask.promise
        if (disposed) return
        numPages = doc.numPages
        // Cheap pass first: page sizes only, so placeholders (and therefore
        // layout and scroll height) are right before anything is drawn.
        const proxies = await Promise.all(Array.from({ length: numPages }, (_, i) => doc.getPage(i + 1)))
        if (disposed) return
        const pageSizes: Size[] = proxies.map((proxy, i) => {
          const v = proxy.getViewport({ scale: 1 })
          const size = { w: v.width, h: v.height }
          states.set(i + 1, {
            n: i + 1,
            proxy,
            size,
            content: null,
            itemStarts: null,
            host: null,
            inner: null,
            textDiv: null,
            renderedScale: null,
            wantScale: null,
            gen: 0,
            task: null,
            textBuilding: false,
          })
          return size
        })
        setSizes(pageSizes)
        onPageSizesRef.current?.(pageSizes)

        // Text for ALL pages is extracted eagerly so offsets are global and
        // consistent; only DOM and canvases are lazy.
        let offset = 0
        let text = ''
        for (let n = 1; n <= numPages; n++) {
          if (disposed) return
          const st = states.get(n)!
          const content = await st.proxy.getTextContent()
          if (disposed) return
          const items = content.items as TextItemLike[]
          let pageText = ''
          const itemStarts: number[] = []
          for (const item of items) {
            itemStarts.push(offset + pageText.length)
            if (item.str !== undefined) pageText += item.str
            if (item.hasEOL) pageText += '\n'
          }
          st.content = content
          st.itemStarts = itemStarts
          void ensureText(st)
          text += pageText
          if (n < numPages) text += PAGE_JOIN
          offset = text.length
        }
        if (!disposed) {
          setFullText(text)
          onTextRef.current?.(text)
        }
      } catch (err) {
        if (disposed) return
        onErrorsRef.current?.([{ message: err instanceof Error ? err.message : String(err) }])
        // A failed load still ends the awaiting state (known-empty text).
        onTextRef.current?.('')
      }
    }

    void run()
    return () => {
      disposed = true
      engineRef.current = null
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      if (bumpTimer !== null) clearTimeout(bumpTimer)
      io?.disconnect()
      for (const st of states.values()) freePage(st)
      states.clear()
      loadingTask.destroy()
    }
  }, [url])

  // Zoom changed: stretch what is drawn right away, re-render when it settles.
  useLayoutEffect(() => {
    engineRef.current?.setScale(scale)
  }, [scale])

  // Wires marker click/keyboard handling directly onto the real text-layer
  // divs that fall inside a marker's token span — no separate overlay
  // geometry to keep in sync with the text layer's own positioning. Re-runs
  // whenever a page's text layer is rebuilt (tick).
  useEffect(() => {
    const root = rootRef.current
    if (!root || !fullText) return
    const markerSpans = markers
      .map((marker) => ({ marker, span: markerSpanInternal(fullText, marker.offset) }))
      .filter((m): m is { marker: ResolvedMarker; span: { start: number; end: number } } => m.span !== null)
    if (markerSpans.length === 0) return

    const cleanups: (() => void)[] = []
    root.querySelectorAll<HTMLElement>('[data-start]').forEach((div) => {
      const start = Number(div.dataset.start)
      const end = start + (div.textContent?.length ?? 0)
      const hit = markerSpans.find((m) => m.span.end > start && m.span.start < end)
      if (!hit) return
      div.classList.add('document-viewer-pdf-marker')
      div.setAttribute('role', 'button')
      div.tabIndex = 0
      const onClick = () => hit.marker.activate()
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }
      div.addEventListener('click', onClick)
      div.addEventListener('keydown', onKeyDown)
      cleanups.push(() => {
        div.removeEventListener('click', onClick)
        div.removeEventListener('keydown', onKeyDown)
        div.classList.remove('document-viewer-pdf-marker')
      })
    })
    return () => cleanups.forEach((fn) => fn())
  }, [tick, fullText, markers])

  // Highlights and the live selection are drawn as clean per-line overlay bars
  // (not ::highlight on the ragged text spans); see pdfOverlays.ts. Repaints
  // when the data changes or any page's text layer is (re)built.
  useEffect(() => {
    const root = rootRef.current
    if (root) paintPdfHighlights(root, anchors, highlights, showOverlays)
  }, [anchors, highlights, showOverlays, tick, fullText])

  useEffect(() => {
    let raf = 0
    const paint = () => {
      raf = 0
      if (rootRef.current) paintPdfSelection(rootRef.current)
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(paint)
    }
    paint()
    document.addEventListener('selectionchange', schedule)
    return () => {
      document.removeEventListener('selectionchange', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [tick, fullText])

  const register = useCallback((n: number, el: HTMLDivElement | null) => engineRef.current?.setHost(n, el), [])

  return (
    <div className="document-viewer-pdf-pages" ref={rootRef}>
      {sizes.map((size, i) => (
        <PageHost key={i + 1} n={i + 1} width={size.w * scale} height={size.h * scale} register={register} />
      ))}
      {sizes.length === 0 && <div className="document-viewer-placeholder">Loading document…</div>}
    </div>
  )
}

// A fixed-size box per page; the engine fills it with the canvas and text
// layer when the page is near the viewport.
function PageHost({
  n,
  width,
  height,
  register,
}: {
  n: number
  width: number
  height: number
  register: (n: number, el: HTMLDivElement | null) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const el = hostRef.current
    register(n, el)
    return () => register(n, null)
  }, [n, register])
  return <div className="document-viewer-pdf-page" data-page={n} style={{ width, height }} ref={hostRef} />
}
