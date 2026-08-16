import { readFileSync } from "node:fs";
import { extractPdfText } from "document-engine/core";

// Uses document-engine's shared pdfjs-dist-based extractor rather than
// pdf-parse — this keeps the char offsets authors set (document_anchor_*,
// document_marker_offset) consistent with what the client-side PDF renderer
// computes from the exact same library/join logic. See the "Key technical
// risk" note in the graph/document integration plan for why a separate
// extraction library would silently drift out of alignment.
export async function extractPdf(filePath: string): Promise<string> {
  const { text } = await extractPdfText(readFileSync(filePath));
  return text;
}
