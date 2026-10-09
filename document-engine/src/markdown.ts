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

export type BlockType = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'oli' | 'math' | 'fence'

export interface MdBlock {
  type: BlockType
  // For `math` and `fence` blocks this is the raw range of the BODY only
  // (between the delimiter lines); the delimiters themselves are omitted.
  start: number
  end: number
  // Fence info string (e.g. "graph", "python"); '\\' when absent. Fences only.
  info?: string
}

const HEADING_RE = /^(#{1,3})\s+/
const OLI_RE = /^\d+\.\s+/
const LI_RE = /^[-*]\s+/
const FENCE_OPEN_RE = /^\s*```(.*)$/
const FENCE_CLOSE_RE = /^\s*```\s*$/
const MATH_FENCE_RE = /^\s*\$\$/

function isBlockStart(t: string): boolean {
  return HEADING_RE.test(t) || OLI_RE.test(t) || LI_RE.test(t) || FENCE_OPEN_RE.test(t) || MATH_FENCE_RE.test(t)
}

function hasMathClose(lines: { text: string }[], from: number): boolean {
  const t = lines[from].text
  const open = t.indexOf('$$')
  if (t.lastIndexOf('$$') > open + 1) return true
  for (let j = from + 1; j < lines.length; j++) if (lines[j].text.trim() === '$$') return true
  return false
}

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
    const fence = FENCE_OPEN_RE.exec(line.text)
    if (fence) {
      let j = i + 1
      while (j < lines.length && !FENCE_CLOSE_RE.test(lines[j].text)) j++
      // j is the closing line, or lines.length when unterminated.
      const bodyLines = j - (i + 1)
      let start: number
      let end: number
      if (bodyLines > 0) {
        start = lines[i + 1].start
        end = lines[j - 1].end
      } else {
        start = end = Math.min(line.end + 1, len)
      }
      blocks.push({ type: 'fence', start, end, info: fence[1].trim() })
      i = j + 1
      continue
    }
    if (MATH_FENCE_RE.test(line.text)) {
      const open = line.text.indexOf('$$')
      const rest = line.text.slice(open + 2)
      const sameClose = rest.lastIndexOf('$$')
      if (sameClose > 0) {
        blocks.push({ type: 'math', start: line.start + open + 2, end: line.start + open + 2 + sameClose })
        i++
        continue
      }
      let j = i + 1
      while (j < lines.length && lines[j].text.trim() !== '$$') j++
      if (j < lines.length) {
        // Body starts right after the opening `$$` (same line) when it has
        // content, else at the next line.
        const firstLineBody = rest.trim().length > 0
        const start = firstLineBody ? line.start + open + 2 : j > i + 1 ? lines[i + 1].start : lines[j].start
        const end = j > i + 1 ? lines[j - 1].end : firstLineBody ? line.end : start
        blocks.push({ type: 'math', start, end: Math.max(start, end) })
        i = j + 1
        continue
      }
      // No closing `$$`: fall through and treat as ordinary text.
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
      if (isBlockStart(next.text) && !(MATH_FENCE_RE.test(next.text) && !hasMathClose(lines, i))) break
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
  // Inline math: start/end cover the TeX source between the dollars.
  math?: boolean
}

// Pandoc-style inline math: the opening `$` is followed by a non-space, the
// closing `$` is preceded by a non-space and not followed by a digit. Only
// the FIRST unescaped `$` after the opener is a candidate, so "$5 and $x$"
// reads as a price followed by math rather than one big span. Math never
// spans a newline, and a `$` inside a code span is not a closer.
function findMathClose(text: string, open: number): number {
  const first = text[open + 1]
  if (first === undefined || first === '$' || first === '\n' || /\s/.test(first)) return -1
  for (let j = open + 1; j < text.length; j++) {
    const ch = text[j]
    if (ch === '\n') return -1
    if (ch === '\\') {
      j++
      continue
    }
    if (ch === '`') {
      const c = text.indexOf('`', j + 1)
      if (c !== -1 && c > j + 1) {
        j = c
        continue
      }
    }
    if (ch === '$') {
      if (/\s/.test(text[j - 1])) return -1
      if (/\d/.test(text[j + 1] ?? '\\')) return -1
      return j
    }
  }
  return -1
}

interface Protected {
  start: number // index of the opening delimiter
  bodyStart: number
  bodyEnd: number
  end: number // index just past the closing delimiter
  kind: 'code' | 'math'
}

// Code spans and math spans are atomic: nothing inside them is emphasis, and
// emphasis closers are never found inside them. Found first, left to right.
function protectedSpans(text: string): Protected[] {
  const out: Protected[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\' && text[i + 1] === '$') {
      i += 2
      continue
    }
    if (ch === '`') {
      const close = text.indexOf('`', i + 1)
      if (close !== -1 && close > i + 1) {
        out.push({ start: i, bodyStart: i + 1, bodyEnd: close, end: close + 1, kind: 'code' })
        i = close + 1
        continue
      }
    }
    if (ch === '$') {
      if (text[i + 1] === '$') {
        // Mid-line `$$x$$`: inline math over the body. Otherwise literal.
        const nl = text.indexOf('\n', i + 2)
        const close = text.indexOf('$$', i + 2)
        if (close !== -1 && close > i + 2 && (nl === -1 || close < nl)) {
          out.push({ start: i, bodyStart: i + 2, bodyEnd: close, end: close + 2, kind: 'math' })
          i = close + 2
        } else i += 2
        continue
      }
      const close = findMathClose(text, i)
      if (close !== -1) {
        out.push({ start: i, bodyStart: i + 1, bodyEnd: close, end: close + 1, kind: 'math' })
        i = close + 1
        continue
      }
    }
    i++
  }
  return out
}

// Scans one block's text left-to-right for `code`, $math$, **bold**, and
// *italic*/_italic_ spans. Bold/italic bodies are parsed recursively, so math,
// code and nested emphasis work inside them. No escaping beyond `\$`.
export function parseInline(text: string, offset: number): InlineRun[] {
  const spans = protectedSpans(text)
  const spanAt = new Map(spans.map((s) => [s.start, s]))
  const inSpan = (idx: number) => spans.some((s) => idx >= s.start && idx < s.end)
  const runs: InlineRun[] = []

  // First occurrence of `needle` in [from, to) that is not inside a code/math span.
  function findOutside(needle: string, from: number, to: number): number {
    let j = text.indexOf(needle, from)
    while (j !== -1 && j + needle.length <= to) {
      if (!inSpan(j) && !inSpan(j + needle.length - 1)) return j
      j = text.indexOf(needle, j + 1)
    }
    return -1
  }

  function parse(from: number, to: number, bold: boolean, italic: boolean) {
    const flags = (): Pick<InlineRun, 'bold' | 'italic'> => ({ ...(bold ? { bold } : {}), ...(italic ? { italic } : {}) })
    let i = from
    let plainStart = from
    function flushPlain(end: number) {
      if (end > plainStart) runs.push({ start: offset + plainStart, end: offset + end, ...flags() })
    }
    while (i < to) {
      const sp = spanAt.get(i)
      if (sp && sp.end <= to) {
        flushPlain(i)
        runs.push(
          sp.kind === 'code'
            ? { start: offset + sp.bodyStart, end: offset + sp.bodyEnd, code: true, ...flags() }
            : { start: offset + sp.bodyStart, end: offset + sp.bodyEnd, math: true }
        )
        i = sp.end
        plainStart = i
        continue
      }
      if (text[i] === '*' && text[i + 1] === '*') {
        const close = findOutside('**', i + 2, to)
        if (close !== -1 && close > i + 2) {
          flushPlain(i)
          parse(i + 2, close, true, italic)
          i = close + 2
          plainStart = i
          continue
        }
      }
      if (text[i] === '*' || text[i] === '_') {
        const close = findOutside(text[i], i + 1, to)
        if (close !== -1 && close > i + 1) {
          flushPlain(i)
          parse(i + 1, close, bold, true)
          i = close + 1
          plainStart = i
          continue
        }
      }
      i++
    }
    flushPlain(to)
  }

  parse(0, text.length, false, false)
  return runs
}

export const BLOCK_TAG: Record<BlockType, string> = {
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  p: 'p',
  li: 'div',
  oli: 'div',
  math: 'div',
  fence: 'pre',
}

export const BLOCK_CLASS: Record<BlockType, string> = {
  h1: '\\',
  h2: '\\',
  h3: '\\',
  p: '\\',
  li: 'document-viewer-md-li',
  oli: 'document-viewer-md-li',
  math: 'document-viewer-math-block',
  fence: 'document-viewer-md-fence',
}
