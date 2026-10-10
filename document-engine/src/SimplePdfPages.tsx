import { useEffect, useRef, useState } from 'react'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { loadPdf } from './pdfSetup'
import { RESCALE_DEBOUNCE_MS, canvasPlan, cssStretch } from './pdfRenderModel'
import type { DocumentRenderError } from './types'

interface Size {
  w: number
  h: number
}

// Bare page rendering for `mode: 'simple'` — no text content extraction, no
// overlays, no click handling. Cheap enough to mount several at once (e.g.
// a handful of small figure references inline in a list of description
// boxes) since it skips all the per-item geometry work PdfLayer does.
// Pages are drawn at the last settled scale; while a zoom is in flight the
// drawn canvases are CSS-stretched, then redrawn sharp after a short debounce.
export default function SimplePdfPages({
  url,
  onErrors,
  scale = 1,
  onPageSizes,
}: {
  url: string
  onErrors?: (errors: DocumentRenderError[]) => void
  // Numeric zoom: 1 = pdfjs viewport scale 1 (one PDF point per CSS px).
  scale?: number
  onPageSizes?: (sizes: Size[]) => void
}) {
  const [pages, setPages] = useState<{ proxy: PDFPageProxy; size: Size }[]>([])
  const [settled, setSettled] = useState(scale)
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const onPageSizesRef = useRef(onPageSizes)
  onPageSizesRef.current = onPageSizes

  useEffect(() => {
    const t = setTimeout(() => setSettled(scale), RESCALE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [scale])

  useEffect(() => {
    let cancelled = false
    setPages([])
    const loadingTask = loadPdf(url)
    loadingTask.promise
      .then(async (doc) => {
        const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)))
        if (cancelled) return
        const built = proxies.map((proxy) => {
          const v = proxy.getViewport({ scale: 1 })
          return { proxy, size: { w: v.width, h: v.height } }
        })
        setPages(built)
        onPageSizesRef.current?.(built.map((p) => p.size))
      })
      .catch((err) => {
        if (!cancelled) onErrorsRef.current?.([{ message: err instanceof Error ? err.message : String(err) }])
      })
    return () => {
      cancelled = true
      loadingTask.destroy()
    }
  }, [url])

  return (
    <div className="document-viewer-pdf-pages">
      {pages.map((p, i) => (
        <PageCanvas key={i} page={p.proxy} size={p.size} scale={scale} settled={settled} onErrors={onErrorsRef} />
      ))}
      {pages.length === 0 && <div className="document-viewer-placeholder">Loading document…</div>}
    </div>
  )
}

function PageCanvas({
  page,
  size,
  scale,
  settled,
  onErrors,
}: {
  page: PDFPageProxy
  size: Size
  scale: number
  settled: number
  onErrors: { current: ((errors: DocumentRenderError[]) => void) | undefined }
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [drawnAt, setDrawnAt] = useState<number | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let task: RenderTask | null = null
    let stale = false
    const plan = canvasPlan(size.w * settled, size.h * settled, window.devicePixelRatio || 1)
    const canvas = document.createElement('canvas')
    canvas.width = plan.width
    canvas.height = plan.height
    canvas.style.width = `${size.w * settled}px`
    canvas.style.height = `${size.h * settled}px`
    canvas.style.display = 'block'
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    task = page.render({
      canvasContext: ctx,
      viewport: page.getViewport({ scale: settled }),
      canvas,
      transform: plan.outputScale !== 1 ? [plan.outputScale, 0, 0, plan.outputScale, 0, 0] : undefined,
    })
    task.promise
      .then(() => {
        if (stale) return
        host.replaceChildren(canvas)
        setDrawnAt(settled)
      })
      .catch((err) => {
        if (stale || (err instanceof Error && err.name === 'RenderingCancelledException')) return
        onErrors.current?.([{ message: err instanceof Error ? err.message : String(err) }])
      })
    return () => {
      stale = true
      task?.cancel()
      canvas.width = 0
      canvas.height = 0
    }
  }, [page, size, settled, onErrors])

  const stretch = drawnAt === null ? 1 : cssStretch(drawnAt, scale)
  return (
    <div className="document-viewer-pdf-canvas-host" style={{ width: size.w * scale, height: size.h * scale, overflow: 'hidden' }}>
      <div ref={hostRef} style={{ transformOrigin: '0 0', transform: stretch === 1 ? undefined : `scale(${stretch})` }} />
    </div>
  )
}
