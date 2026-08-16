// Browser-side pdfjs setup, shared by the full and simple PDF renderers.
// Separate from document-engine/core's Node-side extraction (which imports
// `pdfjs-dist/legacy/build/pdf.mjs` directly and needs no worker) — this is
// the DOM-rendering half, which does need a worker script.
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from 'pdfjs-dist'
// eslint-disable-next-line import/no-unresolved -- Vite `?url` import, resolved at build time
import workerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

// Returns the loading task itself (not just its `.promise`) so callers can
// `.destroy()` it on unmount/url-change — `PDFDocumentProxy` (what the
// promise resolves to) has no destroy method of its own; cleanup only lives
// on the task that produced it.
export function loadPdf(url: string): PDFDocumentLoadingTask {
  return getDocument({ url })
}

export interface TextItemLike {
  str?: string
  hasEOL?: boolean
}

// Identical join rule to document-engine/core's extractPdfText — this is
// what keeps a char offset computed server-side (against extractedText)
// landing on the same on-page text item here.
export function joinTextItems(items: TextItemLike[]): string {
  let out = ''
  for (const item of items) {
    if (item.str === undefined) continue
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out
}

export const PAGE_JOIN = '\n\n'
