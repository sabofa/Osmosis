// Pure, React/DOM-free surface — safe to import from `server` (see
// server/src/lib/extract/pdf.ts) without pulling in the React component or
// any browser-only APIs. Mirrors graph-engine's `./parser` subpath.
export { extractPdfText, joinTextItems } from './extractPdfText'
export type { PdfTextExtraction } from './extractPdfText'
export { findTokenSpan } from './findTokenSpan'
export type { TokenSpan } from './findTokenSpan'
export { cpToUtf16, utf16ToCp, cpLength, sliceCp } from './offsets'
export { toNfc, isNfc } from './normalize'
export { makeAnchor, resolveAnchor } from './anchors'
export type { TextAnchor } from './anchors'
