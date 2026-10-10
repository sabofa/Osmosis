import { useEffect, useRef, useState } from 'react'
import { loadPdf } from './pdfSetup'
import type { DocumentRenderError } from './types'

const RENDER_SCALE = 1.75

// Bare page rendering for `mode: 'simple'` — no text content extraction, no
// overlays, no click handling. Cheap enough to mount several at once (e.g.
// a handful of small figure references inline in a list of description
// boxes) since it skips all the per-item geometry work PdfLayer does.
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
  onPageSizes?: (sizes: { w: number; h: number }[]) => void
}) {
  const [canvases, setCanvases] = useState<HTMLCanvasElement[]>([])
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const onPageSizesRef = useRef(onPageSizes)
  onPageSizesRef.current = onPageSizes

  useEffect(() => {
    let cancelled = false
    const loadingTask = loadPdf(url)

    async function run() {
      try {
        const doc = await loadingTask.promise
        const built: HTMLCanvasElement[] = []
        const sizes: { w: number; h: number }[] = []
        const outputScale = Math.max(window.devicePixelRatio || 1, 1)
        for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
          if (cancelled) return
          const page = await doc.getPage(pageNumber)
          const viewport = page.getViewport({ scale: RENDER_SCALE })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * outputScale)
          canvas.height = Math.floor(viewport.height * outputScale)
          canvas.style.width = `${viewport.width}px`
          canvas.style.height = `${viewport.height}px`
          const ctx = canvas.getContext('2d')
          if (!ctx) continue
          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise
          if (cancelled) return
          built.push(canvas)
          sizes.push({ w: viewport.width / RENDER_SCALE, h: viewport.height / RENDER_SCALE })
        }
        if (!cancelled) {
          setCanvases(built)
          onPageSizesRef.current?.(sizes)
        }
      } catch (err) {
        onErrorsRef.current?.([{ message: err instanceof Error ? err.message : String(err) }])
      }
    }

    run()
    return () => {
      cancelled = true
      loadingTask.destroy()
    }
  }, [url])

  return (
    <div className="document-viewer-pdf-pages" style={{ zoom: scale / RENDER_SCALE }}>
      {canvases.map((canvas, i) => (
        <PageCanvas key={i} canvas={canvas} />
      ))}
      {canvases.length === 0 && <div className="document-viewer-placeholder">Loading document…</div>}
    </div>
  )
}

function PageCanvas({ canvas }: { canvas: HTMLCanvasElement }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(canvas)
    return () => {
      if (canvas.parentElement === host) host.removeChild(canvas)
    }
  }, [canvas])
  return <div className="document-viewer-pdf-canvas-host" ref={hostRef} />
}
