import { useEffect, useRef, useState } from 'react'
import { TextLayer } from 'pdfjs-dist'
import { loadPdf, PAGE_JOIN, type TextItemLike } from './pdfSetup'
import { findTokenSpan } from './core/findTokenSpan'
import { usePaintHighlights } from './highlightPainter'
import type { DocumentAnchor, DocumentHighlight, DocumentMarker, DocumentRenderError } from './types'

// Logical/layout scale — independent of the device-pixel-ratio multiplier
// applied to the canvas's backing buffer below. Bumped from the old 1.5:
// rendering the canvas 1:1 and relying on CSS zoom to enlarge it is exactly
// what produced the "compressed/softened" look.
const RENDER_SCALE = 1.75

interface RenderedPage {
  pageNumber: number
  canvas: HTMLCanvasElement
  textLayerDiv: HTMLDivElement
  width: number
  height: number
}

export default function PdfLayer({
  url,
  anchor,
  markers,
  highlights,
  showOverlays,
  groupPrefix,
  onJumpToQuestion,
  onErrors,
}: {
  url: string
  anchor: DocumentAnchor | null
  markers: DocumentMarker[]
  highlights: DocumentHighlight[]
  showOverlays: boolean
  groupPrefix: string
  onJumpToQuestion?: (id: string) => void
  onErrors?: (errors: DocumentRenderError[]) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [pages, setPages] = useState<RenderedPage[]>([])
  const [fullText, setFullText] = useState('')
  const onErrorsRef = useRef(onErrors)
  onErrorsRef.current = onErrors
  const onJumpRef = useRef(onJumpToQuestion)
  onJumpRef.current = onJumpToQuestion

  useEffect(() => {
    let cancelled = false
    const loadingTask = loadPdf(url)

    async function run() {
      try {
        const doc = await loadingTask.promise
        const built: RenderedPage[] = []
        let offset = 0
        let text = ''
        // Rendering into a backing buffer scaled by devicePixelRatio (then
        // displayed at the CSS/layout size via canvas.style) is the
        // standard technique for crisp canvas output on hiDPI screens.
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

          const content = await page.getTextContent()
          const items = content.items as TextItemLike[]

          const textLayerDiv = document.createElement('div')
          textLayerDiv.className = 'document-viewer-pdf-text-layer'
          // pdfjs's TextLayer computes each div's position/size via CSS
          // custom properties (--scale-factor, --total-scale-factor,
          // --scale-round-x/y) that its full-viewer stylesheet normally
          // sets on an ancestor `.page` element — since TextLayer is used
          // here standalone (no PDFPageView), those never get defined
          // otherwise, and the divs silently mis-size. Set them explicitly,
          // mirroring exactly what pdf_viewer.mjs itself sets on its page
          // container (see PDFPageView#draw / .setProperty("--scale-factor", ...)).
          textLayerDiv.style.setProperty('--scale-factor', String(viewport.scale))
          textLayerDiv.style.setProperty('--user-unit', '1')
          textLayerDiv.style.setProperty('--total-scale-factor', 'calc(var(--scale-factor) * var(--user-unit))')
          textLayerDiv.style.setProperty('--scale-round-x', '1px')
          textLayerDiv.style.setProperty('--scale-round-y', '1px')
          // pdfjs's own text-layer builder — real font metrics and
          // per-glyph positioning, the same quality every standard PDF
          // viewer's selectable text gets. Replaces hand-computed
          // item-transform math, which is what looked misaligned before.
          const textLayer = new TextLayer({ textContentSource: content, container: textLayerDiv, viewport })
          await textLayer.render()
          if (cancelled) return

          // textDivs is parallel to `items` (pdfjs guarantees this order),
          // so the same running-offset convention document-engine/core's
          // extraction uses lines up exactly with each div here.
          let pageText = ''
          const itemStarts: number[] = []
          for (const item of items) {
            itemStarts.push(offset + pageText.length)
            if (item.str !== undefined) pageText += item.str
            if (item.hasEOL) pageText += '\n'
          }
          textLayer.textDivs.forEach((div, i) => {
            const start = itemStarts[i]
            if (start !== undefined) div.dataset.start = String(start)
          })

          text += pageText
          if (pageNumber < doc.numPages) text += PAGE_JOIN
          offset = text.length

          built.push({ pageNumber, canvas, textLayerDiv, width: viewport.width, height: viewport.height })
        }
        if (!cancelled) {
          setPages(built)
          setFullText(text)
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

  // Wires marker click/keyboard handling directly onto the real text-layer
  // divs that fall inside a marker's token span — no separate overlay
  // geometry to keep in sync with the text layer's own positioning.
  useEffect(() => {
    if (pages.length === 0 || !fullText) return
    const markerSpans = markers
      .map((marker) => ({ marker, span: findTokenSpan(fullText, marker.offset) }))
      .filter((m): m is { marker: DocumentMarker; span: { start: number; end: number } } => m.span !== null)
    if (markerSpans.length === 0) return

    const cleanups: (() => void)[] = []
    for (const page of pages) {
      const divs = page.textLayerDiv.querySelectorAll<HTMLElement>('[data-start]')
      divs.forEach((div) => {
        const start = Number(div.dataset.start)
        const end = start + (div.textContent?.length ?? 0)
        const hit = markerSpans.find((m) => m.span.end > start && m.span.start < end)
        if (!hit) return
        div.classList.add('document-viewer-pdf-marker')
        div.setAttribute('role', 'button')
        div.tabIndex = 0
        const onClick = () => onJumpRef.current?.(hit.marker.id)
        const onKeyDown = (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ') onClick()
        }
        div.addEventListener('click', onClick)
        div.addEventListener('keydown', onKeyDown)
        cleanups.push(() => {
          div.removeEventListener('click', onClick)
          div.removeEventListener('keydown', onKeyDown)
          div.classList.remove('document-viewer-pdf-marker')
        })
      })
    }
    return () => cleanups.forEach((fn) => fn())
  }, [pages, fullText, markers])

  usePaintHighlights(rootRef, groupPrefix, anchor, highlights, showOverlays, pages)

  return (
    <div className="document-viewer-pdf-pages" ref={rootRef}>
      {pages.map((page) => (
        <PageHost key={page.pageNumber} page={page} />
      ))}
      {pages.length === 0 && <div className="document-viewer-placeholder">Loading document…</div>}
    </div>
  )
}

function PageHost({ page }: { page: RenderedPage }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.appendChild(page.canvas)
    host.appendChild(page.textLayerDiv)
    return () => {
      if (page.canvas.parentElement === host) host.removeChild(page.canvas)
      if (page.textLayerDiv.parentElement === host) host.removeChild(page.textLayerDiv)
    }
  }, [page])
  return <div className="document-viewer-pdf-page" style={{ width: page.width, height: page.height }} ref={hostRef} />
}
