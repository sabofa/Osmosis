// A small, deliberately scoped markdown reader — not a full CommonMark
// implementation. It exists to make `type: 'text'` assets (treated as
// markdown natively, not plain .txt — see DocumentPanel's download comment)
// render with real formatting instead of literal '**bold**' asterisks,
// while keeping every visible character's position traceable back to an
// absolute offset in the RAW source text. That offset-fidelity is what lets
// anchors/markers/highlights (all authored against extracted_text) keep
// working — syntax characters (`#`, `**`, backticks) are simply omitted
// from the rendered runs rather than hidden-but-present, so a highlight
// can't land exactly on a stripped character (an acceptable, rare edge
// case), but everything else resolves exactly like plain text did.

export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'oli'

export interface MdBlock {
  type: BlockType
  start: number
  end: number
}

const HEADING_RE = /^(#{1,3})\s+/
const OLI_RE = /^\d+\.\s+/
const LI_RE = /^[-*]\s+/

export function parseBlocks(text: string): MdBlock[] {
  const lines: { start: number; end: number; text: string }[] = []
  let pos = 0
  const len = text.length
  while (pos <= len) {
    let lineEnd = text.indexOf('\n', pos)
    if (lineEnd === -1) lineEnd = len
    lines.push({ start: pos, end: lineEnd, text: text.slice(pos, lineEnd) })
    if (lineEnd === len) break
    pos = lineEnd + 1
  }

  const blocks: MdBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.text.trim().length === 0) {
      i++
      continue
    }
    const heading = HEADING_RE.exec(line.text)
    if (heading) {
      blocks.push({ type: `h${heading[1].length}` as BlockType, start: line.start + heading[0].length, end: line.end })
      i++
      continue
    }
    if (OLI_RE.test(line.text)) {
      // Keeps the "1. " marker itself as visible content (rather than
      // faking auto-numbering with a CSS counter) — simpler, and avoids
      // getting out of sync with the source if items are non-sequential.
      blocks.push({ type: 'oli', start: line.start, end: line.end })
      i++
      continue
    }
    if (LI_RE.test(line.text)) {
      blocks.push({ type: 'li', start: line.start, end: line.end })
      i++
      continue
    }
    // Consecutive plain lines merge into one paragraph (soft-wrapped
    // source lines), so they don't each get their own paragraph margin.
    const pStart = line.start
    let pEnd = line.end
    i++
    while (i < lines.length) {
      const next = lines[i]
      if (next.text.trim().length === 0) break
      if (HEADING_RE.test(next.text) || OLI_RE.test(next.text) || LI_RE.test(next.text)) break
      pEnd = next.end
      i++
    }
    blocks.push({ type: 'p', start: pStart, end: pEnd })
  }
  return blocks
}

export interface InlineRun {
  start: number
  end: number
  bold?: boolean
  italic?: boolean
  code?: boolean
}

// Scans one block's text left-to-right for `code`, **bold**, and
// *italic*/_italic_ spans. Deliberately simple (no nesting, no escaping) —
// matches the scope of what a question/passage author actually writes.
export function parseInline(text: string, offset: number): InlineRun[] {
  const runs: InlineRun[] = []
  let i = 0
  let plainStart = 0

  function flushPlain(end: number) {
    if (end > plainStart) runs.push({ start: offset + plainStart, end: offset + end })
  }

  while (i < text.length) {
    if (text[i] === '`') {
      const close = text.indexOf('`', i + 1)
      if (close !== -1 && close > i + 1) {
        flushPlain(i)
        runs.push({ start: offset + i + 1, end: offset + close, code: true })
        i = close + 1
        plainStart = i
        continue
      }
    }
    if (text[i] === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2)
      if (close !== -1 && close > i + 2) {
        flushPlain(i)
        runs.push({ start: offset + i + 2, end: offset + close, bold: true })
        i = close + 2
        plainStart = i
        continue
      }
    }
    if (text[i] === '*' || text[i] === '_') {
      const marker = text[i]
      const close = text.indexOf(marker, i + 1)
      if (close !== -1 && close > i + 1) {
        flushPlain(i)
        runs.push({ start: offset + i + 1, end: offset + close, italic: true })
        i = close + 1
        plainStart = i
        continue
      }
    }
    i++
  }
  flushPlain(text.length)
  return runs
}

export const BLOCK_TAG: Record<BlockType, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  p: 'p',
  li: 'div',
  oli: 'div',
}

export const BLOCK_CLASS: Record<BlockType, string> = {
  h1: '',
  h2: '',
  h3: '',
  p: '',
  li: 'document-viewer-md-li',
  oli: 'document-viewer-md-li',
}
