// Uses pdfjs-dist's legacy (Node-compatible) build — the same package the
// browser-side renderer uses for its per-page text layer — so extraction
// here and rendering there walk identical text items in identical order.
// That's what keeps an author-set char offset landing in the same spot in
// both places; see the vite.lib.config.ts comment on why pdfjs-dist is
// externalized rather than bundled separately into each consumer.
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface PdfTextExtraction {
  text: string
  // Char offset in `text` where each page's text begins (0-indexed by page).
  pageOffsets: number[]
}

const PAGE_JOIN = '\n\n'

interface TextItemLike {
  str?: string
  hasEOL?: boolean
}

// Exported so the client-side renderer builds its per-page text exactly the
// same way when reconstructing text-layer positions from the same
// getTextContent() items pdfjs hands back for a rendered page.
export function joinTextItems(items: TextItemLike[]): string {
  let out = ''
  for (const item of items) {
    if (item.str === undefined) continue // TextMarkedContent items have no `str`
    out += item.str
    if (item.hasEOL) out += '\n'
  }
  return out
}

export async function extractPdfText(data: Uint8Array | ArrayBuffer): Promise<PdfTextExtraction> {
  // pdfjs insists on a plain Uint8Array — a Node Buffer (a Uint8Array
  // subclass) is rejected outright, so this always produces a fresh
  // same-memory Uint8Array view rather than trusting `instanceof`.
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const loadingTask = getDocument({ data: bytes, useWorkerFetch: false })
  try {
    const doc = await loadingTask.promise
    const pageOffsets: number[] = []
    const pageTexts: string[] = []
    let offset = 0
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum)
      const content = await page.getTextContent()
      const pageText = joinTextItems(content.items as TextItemLike[])
      pageOffsets.push(offset)
      pageTexts.push(pageText)
      offset += pageText.length + (pageNum < doc.numPages ? PAGE_JOIN.length : 0)
    }
    return { text: pageTexts.join(PAGE_JOIN), pageOffsets }
  } finally {
    await loadingTask.destroy()
  }
}
