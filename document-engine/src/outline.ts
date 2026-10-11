// The document outline: the headings of a markdown/text asset, for the host's
// Outline tool, plus the pure helpers that locate a heading for scrolling.
// Offsets are codepoints into the LF-normalised text (CRLF -> LF), like every
// other public offset in this engine.

export interface OutlineHeading {
  // Stable slug of the heading text; repeats get -2, -3, ... suffixes.
  id: string
  // 1..6
  level: number
  // Plain text: inline markup stripped. May be '' for an empty heading.
  text: string
  // Codepoint offset of the heading's first line start in the LF text.
  offset: number
}

const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/
const SETEXT_RE = /^ {0,3}(=+|-+)[ \t]*$/
const NOT_PARAGRAPH_RE = /^(?: {4,}|\t|[ \t]*(?:[-*+]|\d+[.)])[ \t]|[ \t]*>)/

// Removes inline markdown from heading text, keeping the words.
export function stripInline(raw: string): string {
  let s = raw
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
  s = s.replace(/<[^>\n]+>/g, '')
  s = s.replace(/`+([^`]*)`+/g, '$1')
  s = s.replace(/\$([^$\n]+)\$/g, '$1')
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2')
  s = s.replace(/~~(.+?)~~/g, '$1')
  s = s.replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
  s = s.replace(/(^|[^\w])_(\S(?:.*?\S)?)_(?=[^\w]|$)/g, '$1$2')
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!~$<>|])/g, '$1')
  return s.replace(/\s+/g, ' ').trim()
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'heading'
}

function cpLen(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1)
      if (d >= 0xdc00 && d <= 0xdfff) i++
    }
    n++
  }
  return n
}

export function extractHeadings(text: string): OutlineHeading[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  // Codepoint offset of each line start.
  const starts: number[] = []
  let acc = 0
  for (const ln of lines) {
    starts.push(acc)
    acc += cpLen(ln) + 1
  }

  const raw: { level: number; text: string; offset: number }[] = []
  let fence: { ch: string; len: number } | null = null
  // First line of the paragraph being collected (for setext headings).
  let para: number | null = null
  const paraLines: string[] = []
  const endPara = () => {
    para = null
    paraLines.length = 0
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (fence) {
      const m = FENCE_RE.exec(line)
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len && m[2].trim() === '') fence = null
      continue
    }
    const open = FENCE_RE.exec(line)
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { ch: open[1][0], len: open[1].length }
      endPara()
      continue
    }
    if (/^\s*\$\$/.test(line)) {
      const t = line.trimStart()
      if (t.indexOf('$$', 2) > 1) {
        endPara()
        continue
      }
      let j = i + 1
      while (j < lines.length && lines[j].trim() !== '$$') j++
      if (j < lines.length) {
        i = j
        endPara()
        continue
      }
      // unterminated: ordinary text, like the renderer
    }
    if (line.trim() === '') {
      endPara()
      continue
    }
    const atx = ATX_RE.exec(line)
    if (atx) {
      let body = atx[2] ?? ''
      body = body.replace(/(?:^|[ \t]+)#+[ \t]*$/, '')
      raw.push({ level: atx[1].length, text: stripInline(body), offset: starts[i] })
      endPara()
      continue
    }
    const under = para !== null ? SETEXT_RE.exec(line) : null
    if (under && para !== null) {
      raw.push({ level: under[1][0] === '=' ? 1 : 2, text: stripInline(paraLines.join(' ')), offset: starts[para] })
      endPara()
      continue
    }
    if (NOT_PARAGRAPH_RE.test(line)) {
      endPara()
      continue
    }
    if (para === null) para = i
    paraLines.push(line.trim())
  }

  const seen = new Map<string, number>()
  const used = new Set<string>()
  return raw.map((h) => {
    const base = slugify(h.text)
    let n = (seen.get(base) ?? 0) + 1
    let id = n === 1 ? base : `${base}-${n}`
    while (used.has(id)) {
      n++
      id = `${base}-${n}`
    }
    seen.set(base, n)
    used.add(id)
    return { id, level: h.level, text: h.text, offset: h.offset }
  })
}

export function sameHeadings(a: OutlineHeading[], b: OutlineHeading[]): boolean {
  return a.length === b.length && a.every((h, i) => h.id === b[i].id && h.level === b[i].level && h.text === b[i].text && h.offset === b[i].offset)
}

// The line holding LF-text codepoint offset `cp`, as UTF-16 indices into the
// RAW text (which may contain CRLF); `end` excludes the line break.
export function lineRangeAt(raw: string, cp: number): { start: number; end: number } {
  let i = 0
  let n = 0
  while (i < raw.length && n < cp) {
    const c = raw.charCodeAt(i)
    if (c === 13 && raw.charCodeAt(i + 1) === 10) {
      i++ // the \r of CRLF is not in the LF text
      continue
    }
    if (c >= 0xd800 && c <= 0xdbff) i++
    i++
    n++
  }
  let end = raw.indexOf('\n', i)
  if (end === -1) end = raw.length
  else if (end > i && raw.charCodeAt(end - 1) === 13) end--
  return { start: i, end }
}

// Which rendered block shows the heading whose line ends at `lineEnd`: the
// last block whose first data-start is <= that end. -1 if none. `blockStarts`
// holds each block's first data-start in document order (null: no mapped text).
export function headingBlockIndex(blockStarts: (number | null)[], lineEnd: number): number {
  let found = -1
  for (let i = 0; i < blockStarts.length; i++) {
    const s = blockStarts[i]
    if (s !== null && s <= lineEnd) found = i
  }
  return found
}
