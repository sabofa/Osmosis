// Pure, React/DOM-free surface — safe to import from `server` (see
// server/src/lib/extract/pdf.ts) without pulling in the React component or
// any browser-only APIs. Mirrors graph-engine's `./parser` subpath.
export { extractPdfText, joinTextItems } from './extractPdfText'
export type { PdfTextExtraction } from './extractPdfText'
export { findTokenSpan } from './findTokenSpan'
export type { TokenSpan } from './findTokenSpan'
