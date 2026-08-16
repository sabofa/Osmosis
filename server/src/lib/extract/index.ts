import { readFileSync } from "node:fs";
import { extractPdf } from "./pdf.js";
import { extractImageViaDeepSeek } from "./image.js";

export interface ExtractInput {
  type: "url" | "text" | "file";
  content?: string;
  mime?: string;
  filePath?: string;
}

// Best-effort text extraction for an asset. Returns null when there is
// nothing sensible to extract (e.g. url assets — fetching arbitrary URLs
// server-side is out of scope here for SSRF reasons) or when the mime type
// isn't one we know how to read.
export async function extractText(input: ExtractInput): Promise<string | null> {
  if (input.type === "text") return input.content ?? null;
  if (input.type === "url") return null;

  if (input.type === "file") {
    if (!input.filePath) return null;
    if (input.mime === "application/pdf") return extractPdf(input.filePath);
    if (input.mime?.startsWith("image/")) return extractImageViaDeepSeek(input.filePath, input.mime);
    if (input.mime === "text/markdown" || input.mime === "text/plain") {
      return readFileSync(input.filePath, "utf8");
    }
    return null;
  }

  return null;
}
