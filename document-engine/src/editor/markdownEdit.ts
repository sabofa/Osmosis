// Pure string transforms behind the editor's toolbar commands. Positions are
// string indices; the CodeMirror glue applies the returned changes (expressed
// in ORIGINAL document coordinates, ordered, non-overlapping) and selection.
import { mapOffset, type TextChange } from './anchorRemap'

// `reversed`: the user's anchor is after the head; results keep that direction.
export interface EditSel { from: number; to: number; reversed?: boolean }
export interface EditChange { from: number; to: number; insert: string }
export interface EditResult {
  changes: EditChange[]
  selection: { anchor: number; head: number }
}
export type MarkdownEdit = (doc: string, sel: EditSel) => EditResult | null

export type LinePrefix = '- ' | '1. ' | '> ' | '- [ ] '

// lastIndexOf clamps a negative fromIndex to 0, so pos 0 needs its own case.
const lineStartOf = (doc: string, pos: number): number => (pos <= 0 ? 0 : doc.lastIndexOf('\n', pos - 1) + 1)
const lineEndOf = (doc: string, pos: number): number => {
  const i = doc.indexOf('\n', pos)
  return i < 0 ? doc.length : i
}

function mapSel(sel: EditSel, changes: EditChange[]): { anchor: number; head: number } {
  const cs: TextChange[] = changes.map(c => ({ from: c.from, to: c.to, insertLen: c.insert.length }))
  const empty = sel.from === sel.to
  const lo = mapOffset(sel.from, cs, empty ? 1 : -1)
  const hi = mapOffset(sel.to, cs, 1)
  return sel.reversed ? { anchor: hi, head: lo } : { anchor: lo, head: hi }
}

/** Point `result` the way the user's selection pointed. */
function orient(sel: EditSel, res: EditResult | null): EditResult | null {
  if (!res || !sel.reversed) return res
  const { anchor, head } = res.selection
  return anchor < head ? { ...res, selection: { anchor: head, head: anchor } } : res
}

// -------------------------------------------------------------- fenced code

/** For each line start offset: whether that line is a fence delimiter or inside a fenced block. */
export function fencedLineStarts(doc: string): Set<number> {
  const out = new Set<number>()
  let open: { ch: string; len: number } | null = null
  let at = 0
  for (;;) {
    const end = lineEndOf(doc, at)
    const text = doc.slice(at, end)
    if (open) {
      out.add(at)
      const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text)
      if (c && c[1][0] === open.ch && c[1].length >= open.len) open = null
    } else {
      const o = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
      if (o && !(o[1][0] === '`' && o[2].includes('`'))) {
        open = { ch: o[1][0], len: o[1].length }
        out.add(at)
      }
    }
    if (end >= doc.length) break
    at = end + 1
  }
  return out
}

// ---------------------------------------------------------------- inline wrap

/** Marker runs on a line whose run length is exactly the marker length. */
function exactRuns(line: string, marker: string): number[] {
  const c = marker[0]
  const out: number[] = []
  let i = 0
  while (i < line.length) {
    if (line[i] !== c) { i++; continue }
    let j = i
    while (j < line.length && line[j] === c) j++
    if (j - i === marker.length) out.push(i)
    i = j
  }
  return out
}

/**
 * Marker runs on a line whose run length is exactly the marker length, paired
 * the way emphasis pairs: an opener needs a non-space after it, a closer a
 * non-space before it, so a stray `a * b` star is skipped. Returns [open, close] starts.
 */
function pairedRuns(line: string, marker: string): [number, number][] {
  const m = marker.length
  const out: [number, number][] = []
  let open = -1
  for (const at of exactRuns(line, marker)) {
    const canClose = at > 0 && !/\s/.test(line[at - 1])
    const canOpen = at + m < line.length && !/\s/.test(line[at + m])
    if (open >= 0 && canClose) {
      out.push([open, at])
      open = -1
    } else if (canOpen) {
      open = at
    }
  }
  return out
}

export function toggleWrap(marker: string): MarkdownEdit {
  const m = marker.length
  const c = marker[0]

  // One trimmed, non-empty single-line piece [from, to): how to unwrap it, or null.
  const unwrapChanges = (doc: string, from: number, to: number): { changes: EditChange[]; head: number } | null => {
    const text = doc.slice(from, to)
    // the piece itself carries the markers
    if (
      text.length >= 2 * m + 1 &&
      text.startsWith(marker) && text.endsWith(marker) &&
      text[m] !== c && text[text.length - m - 1] !== c
    ) {
      return { changes: [{ from, to, insert: text.slice(m, text.length - m) }], head: to - 2 * m }
    }
    // markers sit just outside the piece
    if (
      from >= m && doc.startsWith(marker, from - m) && doc.startsWith(marker, to) &&
      doc[from - m - 1] !== c && doc[to + m] !== c
    ) {
      return { changes: [{ from: from - m, to: from, insert: '' }, { from: to, to: to + m, insert: '' }], head: to - m }
    }
    return null
  }

  return (doc, sel) => orient(sel, run(doc, sel))

  function run(doc: string, sel: EditSel): EditResult | null {
    let { from, to } = sel
    // trim whitespace inside the selection: emphasis cannot hug spaces
    while (from < to && /\s/.test(doc[from])) from++
    while (to > from && /\s/.test(doc[to - 1])) to--

    if (from < to) {
      // one trimmed piece per non-blank line: a marker never spans a line break
      const pieces: [number, number][] = []
      let at = from
      for (;;) {
        const end = Math.min(lineEndOf(doc, at), to)
        let a = at
        let b = end
        while (a < b && /\s/.test(doc[a])) a++
        while (b > a && /\s/.test(doc[b - 1])) b--
        if (a < b) pieces.push([a, b])
        if (end >= to) break
        at = end + 1
      }
      const un = pieces.map(([a, b]) => unwrapChanges(doc, a, b))
      if (un.every((u) => u)) {
        const changes = un.flatMap((u) => u!.changes)
        if (pieces.length === 1) {
          const u = un[0]!
          const start = u.changes.length === 1 ? from : from - m
          return { changes, selection: { anchor: start, head: u.head } }
        }
        return { changes, selection: mapSel({ from, to }, changes) }
      }
      const changes: EditChange[] = []
      pieces.forEach(([a, b], i) => {
        if (un[i]) return // already wrapped: leave it
        changes.push({ from: a, to: a, insert: marker }, { from: b, to: b, insert: marker })
      })
      if (pieces.length === 1) {
        return { changes, selection: { anchor: from + m, head: to + m } }
      }
      return { changes, selection: mapSel({ from, to }, changes) }
    }

    // caret: inside an existing pair on this line?
    const p = sel.from
    const ls = lineStartOf(doc, p)
    const line = doc.slice(ls, lineEndOf(doc, p))
    for (const [o, cl] of pairedRuns(line, marker)) {
      const open = ls + o
      const close = ls + cl
      if (open + m <= p && p <= close) {
        return {
          changes: [{ from: open, to: open + m, insert: '' }, { from: close, to: close + m, insert: '' }],
          selection: { anchor: p - m, head: p - m },
        }
      }
    }
    return {
      changes: [{ from: p, to: p, insert: marker + marker }],
      selection: { anchor: p + m, head: p + m },
    }
  }
}

// ----------------------------------------------------------------- line prefix

const PREFIX_RE = /^([ \t]*)(- \[[ xX]\] |[-*+] |\d+[.)] |> )/

type PrefixKind = 'task' | 'bullet' | 'number' | 'quote'
function kindOfMatch(p: string): PrefixKind {
  if (p.startsWith('- [')) return 'task'
  if (p === '> ') return 'quote'
  if (/^\d/.test(p)) return 'number'
  return 'bullet'
}
function kindOfPrefix(prefix: LinePrefix): PrefixKind {
  return kindOfMatch(prefix)
}

export function toggleLinePrefix(prefix: LinePrefix): MarkdownEdit {
  const kind = kindOfPrefix(prefix)
  return (doc, sel) => {
    const lastPos = sel.to > sel.from && doc[sel.to - 1] === '\n' ? sel.to - 1 : sel.to
    const first = lineStartOf(doc, sel.from)
    const lastEnd = lineEndOf(doc, lastPos)
    const fenced = fencedLineStarts(doc)

    interface L { start: number; indent: number; oldLen: number; oldKind: PrefixKind | null; blank: boolean; fenced: boolean }
    const lines: L[] = []
    let at = first
    for (;;) {
      const end = lineEndOf(doc, at)
      const text = doc.slice(at, end)
      const mt = PREFIX_RE.exec(text)
      lines.push({
        start: at,
        indent: mt ? mt[1].length : (/^[ \t]*/.exec(text) as RegExpExecArray)[0].length,
        oldLen: mt ? mt[2].length : 0,
        oldKind: mt ? kindOfMatch(mt[2]) : null,
        blank: text.trim() === '',
        fenced: fenced.has(at),
      })
      if (end >= lastEnd) break
      at = end + 1
    }

    // code inside a fence is literal text: never prefix it
    const open = lines.filter(l => !l.fenced)
    if (!open.length) return null
    const nonBlank = open.filter(l => !l.blank)
    const targets = nonBlank.length ? nonBlank : open
    const removing = targets.every(l => l.oldKind === kind)

    const changes: EditChange[] = []
    let n = 1
    for (const l of targets) {
      const from = l.start + l.indent
      const to = from + l.oldLen
      if (removing) {
        changes.push({ from, to, insert: '' })
        continue
      }
      const insert = kind === 'number' ? `${n++}. ` : prefix
      // already exactly right (e.g. numbering unchanged): skip
      if (l.oldKind === kind && doc.slice(from, to) === insert) continue
      changes.push({ from, to, insert })
    }
    return { changes, selection: mapSel(sel, changes) }
  }
}

// -------------------------------------------------------------------- headings

// A quote and/or list marker at the start of a line (heading and quote/list are exclusive).
const BLOCK_MARKER = /^[ \t]*(?:>[ \t]?)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/

/**
 * Cycle the cursor line's heading level: none -> # ... ###### -> none. A quote
 * or list line is restyled, not wrapped: its marker is replaced by the heading
 * mark (as Word's styles do), never `# > x` or `# - x`.
 */
export function cycleHeading(delta: 1 | -1): MarkdownEdit {
  return (doc, sel) => {
    const ls = lineStartOf(doc, sel.from)
    if (fencedLineStarts(doc).has(ls)) return null
    const line = doc.slice(ls, lineEndOf(doc, sel.from))
    const mt = /^( {0,3})(#{1,6})([ \t]+|$)/.exec(line)
    const level = mt ? mt[2].length : 0
    const next = (((level + delta) % 7) + 7) % 7
    const insert = next === 0 ? '' : '#'.repeat(next) + ' '
    const indent = mt ? mt[1].length : 0
    const oldLen = mt ? mt[2].length + mt[3].length : 0
    let changes: EditChange[] = [{ from: ls + indent, to: ls + indent + oldLen, insert }]
    if (!mt) {
      const bm = BLOCK_MARKER.exec(line)
      if (bm && /[>\-*+\d]/.test(bm[0])) changes = [{ from: ls, to: ls + bm[0].length, insert }]
    }
    return { changes, selection: mapSel(sel, changes) }
  }
}

// ------------------------------------------------------------------------ link

// [text](url) as one whole piece: text may hold escaped brackets only.
const LINK_RE = /^\[((?:\\.|[^\\[\]])*)\]\(([^()\s]*)\)$/
const URL_RE = /^(?:https?:\/\/|mailto:|www\.)\S+$/i

export function makeLink(url?: string): MarkdownEdit {
  return (doc, sel) => {
    const { from, to } = sel
    const text = doc.slice(from, to)
    if (from === to) {
      const u = url ?? ''
      return {
        changes: [{ from, to, insert: `[](${u})` }],
        selection: { anchor: from + 1, head: from + 1 },
      }
    }
    if (url === undefined && URL_RE.test(text)) {
      return {
        changes: [{ from, to, insert: `[](${text})` }],
        selection: { anchor: from + 1, head: from + 1 },
      }
    }
    // already a link: do not wrap it again, just select its url
    const existing = LINK_RE.exec(text)
    if (existing) {
      const start = from + existing[1].length + 3
      return { changes: [], selection: { anchor: start, head: start + existing[2].length } }
    }
    const u = url ?? 'url'
    const label = text.replace(/\\?([[\]])/g, '\\$1') // brackets would end the link text early
    const urlStart = from + 1 + label.length + 2
    return {
      changes: [{ from, to, insert: `[${label}](${u})` }],
      selection: url === undefined
        ? { anchor: urlStart, head: urlStart + u.length }
        : { anchor: urlStart + u.length + 1, head: urlStart + u.length + 1 },
    }
  }
}

// ------------------------------------------------------------- block styles

export type BlockStyle = 'normal' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'quote' | 'code' | 'list'
/** The styles a user can apply (a list is detected, set with the list commands). */
export type SettableBlockStyle = Exclude<BlockStyle, 'list'>

const HEADING_PREFIX = /^ {0,3}#{1,6}(?:[ \t]+|$)/
const HEADING_LEVEL = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const QUOTE_PREFIX = /^ {0,3}(?:>[ \t]?)+/
const LIST_PREFIX = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/

interface DocLine { start: number; end: number; text: string }

/** The lines a selection touches (a selection ending right after a newline excludes the next line). */
function selectedLines(doc: string, sel: EditSel): DocLine[] {
  const lastPos = sel.to > sel.from && doc[sel.to - 1] === '\n' ? sel.to - 1 : sel.to
  const lastEnd = lineEndOf(doc, lastPos)
  const out: DocLine[] = []
  let at = lineStartOf(doc, sel.from)
  for (;;) {
    const end = lineEndOf(doc, at)
    out.push({ start: at, end, text: doc.slice(at, end) })
    if (end >= lastEnd) break
    at = end + 1
  }
  return out
}

/** The style of one non-fenced line: quote beats heading beats normal. */
function lineStyle(text: string): BlockStyle {
  if (QUOTE_PREFIX.test(text)) return 'quote'
  const h = HEADING_LEVEL.exec(text)
  return h ? (`h${h[1].length}` as BlockStyle) : 'normal'
}

interface FenceBlock { openStart: number; openEnd: number; closeStart: number | null; closeEnd: number }

/** Every fenced block in the document, with the line bounds of its delimiters. */
function fenceBlocks(doc: string): FenceBlock[] {
  const out: FenceBlock[] = []
  let open: { ch: string; len: number; start: number; end: number } | null = null
  let at = 0
  for (;;) {
    const end = lineEndOf(doc, at)
    const text = doc.slice(at, end)
    if (open) {
      const c = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(text)
      if (c && c[1][0] === open.ch && c[1].length >= open.len) {
        out.push({ openStart: open.start, openEnd: open.end, closeStart: at, closeEnd: end })
        open = null
      }
    } else {
      const o = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
      if (o && !(o[1][0] === '`' && o[2].includes('`'))) open = { ch: o[1][0], len: o[1].length, start: at, end }
    }
    if (end >= doc.length) break
    at = end + 1
  }
  if (open) out.push({ openStart: open.start, openEnd: open.end, closeStart: null, closeEnd: open.end })
  return out
}

/** Remove the opening and closing fence lines of every block the lines touch. */
function unfence(doc: string, sel: EditSel, lines: DocLine[]): EditResult | null {
  const lo = lines[0].start
  const hi = lines[lines.length - 1].end
  const raw: EditChange[] = []
  for (const b of fenceBlocks(doc)) {
    const blockEnd = b.closeStart === null ? doc.length : b.closeEnd
    if (b.openStart > hi || blockEnd < lo) continue
    // the opening line goes with its newline; at the very end of the document the preceding newline goes instead
    if (b.openEnd < doc.length) raw.push({ from: b.openStart, to: b.openEnd + 1, insert: '' })
    else raw.push({ from: Math.max(0, b.openStart - 1), to: b.openEnd, insert: '' })
    if (b.closeStart !== null) raw.push({ from: Math.max(0, b.closeStart - 1), to: b.closeEnd, insert: '' })
  }
  if (!raw.length) return null
  raw.sort((a, b) => a.from - b.from)
  const changes: EditChange[] = []
  for (const c of raw) {
    const prev = changes[changes.length - 1]
    if (prev && c.from <= prev.to) prev.to = Math.max(prev.to, c.to)
    else changes.push({ ...c })
  }
  return { changes, selection: mapSel(sel, changes) }
}

/**
 * Set the block style of the cursor line or every selected line. A style the
 * lines already have is toggled back to normal. `code` wraps the selected
 * lines in a ``` fence (the caret lands inside it on an empty line).
 */
export function setBlockStyle(style: SettableBlockStyle): MarkdownEdit {
  return (doc, sel) => {
    const lines = selectedLines(doc, sel)
    const fenced = fencedLineStarts(doc)

    // a fenced block is un-fenced by any style, Code included (it toggles off)
    if (lines.every(l => fenced.has(l.start))) return unfence(doc, sel, lines)

    if (style === 'code') {
      if (lines.some(l => fenced.has(l.start))) return null
      const first = lines[0]
      const last = lines[lines.length - 1]
      const changes: EditChange[] = [
        { from: first.start, to: first.start, insert: '```\n' },
        { from: last.end, to: last.end, insert: '\n```' },
      ]
      const shift = 4
      const a = sel.from + shift
      const b = sel.to + shift
      return { changes, selection: sel.reversed ? { anchor: b, head: a } : { anchor: a, head: b } }
    }

    const open = lines.filter(l => !fenced.has(l.start))
    if (!open.length) return null
    const nonBlank = open.filter(l => l.text.trim() !== '')
    const targets = nonBlank.length ? nonBlank : open
    const toggledOff = targets.every(l => lineStyle(l.text) === style)
    const eff: SettableBlockStyle = toggledOff ? 'normal' : style

    const changes: EditChange[] = []
    for (const l of targets) {
      let body = l.text
      const strip = (re: RegExp) => { const m = re.exec(body); if (m) body = body.slice(m[0].length) }
      strip(QUOTE_PREFIX)
      strip(HEADING_PREFIX)
      if (eff[0] === 'h') strip(LIST_PREFIX)
      const insert = eff === 'quote' ? '> ' : eff[0] === 'h' ? '#'.repeat(Number(eff[1])) + ' ' : ''
      const oldLen = l.text.length - body.length
      if (l.text.slice(0, oldLen) === insert) continue
      changes.push({ from: l.start, to: l.start + oldLen, insert })
    }
    return { changes, selection: mapSel(sel, changes) }
  }
}

// -------------------------------------------------------- clear formatting

/** Strip emphasis / strike markers outside code spans, then unwrap the code spans. */
const HR_LINE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

function stripInline(text: string): string {
  if (HR_LINE.test(text)) return text
  // odd segments are protected: code spans (unwrapped), $math$, link targets and bare URLs (kept)
  return text
    .split(/(`[^`\n]+`|\$[^$\n]+\$|\]\([^)\n]*\)|https?:\/\/[^\s)>\]]+)/)
    .map((seg, i) => {
      if (i % 2 === 1) return seg[0] === '`' ? seg.slice(1, -1) : seg
      return seg
        .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '$1')
        .replace(/(?<![*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?!\*)/g, '$1')
        .replace(/(?<![_\w])_(?![\s_])(.+?)(?<![\s_])_(?![_\w])/g, '$1')
    })
    .join('')
}

/** Remove inline markers and the heading / quote / list prefix from the selected lines. */
export function clearFormatting(): MarkdownEdit {
  return (doc, sel) => {
    const fenced = fencedLineStarts(doc)
    const changes: EditChange[] = []
    for (const l of selectedLines(doc, sel)) {
      if (fenced.has(l.start)) continue
      if (HR_LINE.test(l.text)) continue
      let body = l.text
      for (const re of [QUOTE_PREFIX, HEADING_PREFIX, LIST_PREFIX]) {
        const m = re.exec(body)
        if (m) body = body.slice(m[0].length)
      }
      body = stripInline(body)
      if (body !== l.text) changes.push({ from: l.start, to: l.end, insert: body })
    }
    if (!changes.length) return null
    return { changes, selection: mapSel(sel, changes) }
  }
}

// ------------------------------------------------------------ block inserts

/**
 * Insert `block` on its own, with a blank line either side. It goes after the
 * line holding the selection's end (replacing that line when it is blank).
 * `caret` is the offset inside `block` where the cursor lands. Null inside a fence.
 */
function insertBlock(block: string, caret: number): MarkdownEdit {
  return (doc, sel) => {
    const lineStart = lineStartOf(doc, sel.to)
    if (fencedLineStarts(doc).has(lineStart)) return null
    const to = lineEndOf(doc, sel.to)
    const blank = doc.slice(lineStart, to).trim() === ''
    const from = blank ? lineStart : to
    const pre = doc.slice(0, from)
    const post = doc.slice(to)
    const lead = from === 0 || pre.endsWith('\n\n') ? '' : pre.endsWith('\n') ? '\n' : '\n\n'
    const trail = post === '' ? '' : post.startsWith('\n\n') ? '' : '\n'
    const at = from + lead.length + caret
    return { changes: [{ from, to, insert: lead + block + trail }], selection: { anchor: at, head: at } }
  }
}

export const insertHr = (): MarkdownEdit => insertBlock('---', 3)

/** $$ fences: wraps the selected lines, or opens an empty pair with the caret between. */
export function insertMathBlock(): MarkdownEdit {
  return (doc, sel) => {
    const lines = selectedLines(doc, sel)
    if (lines.some(l => fencedLineStarts(doc).has(l.start))) return null
    const first = lines[0]
    const last = lines[lines.length - 1]
    if (doc.slice(first.start, last.end).trim() === '') return insertBlock('$$\n\n$$', 3)(doc, sel)
    const changes: EditChange[] = [
      { from: first.start, to: first.start, insert: '$$\n' },
      { from: last.end, to: last.end, insert: '\n$$' },
    ]
    const a = sel.from + 3
    const b = sel.to + 3
    return { changes, selection: sel.reversed ? { anchor: b, head: a } : { anchor: a, head: b } }
  }
}

export const GRAPH_STARTER = 'y = sin(x)\nx in [-6.28, 6.28]'

/** A ```graph fence with a starter plot, caret at the end of the body. */
export function insertGraphFence(): MarkdownEdit {
  const head = '```graph\n'
  return insertBlock(head + GRAPH_STARTER + '\n```', head.length + GRAPH_STARTER.length)
}

// ---------------------------------------------------------- indent / outdent

/** Add (delta 1) two spaces to, or remove up to two spaces (or one tab) from, each non-fenced selected line. */
export function indentLines(delta: 1 | -1): MarkdownEdit {
  return (doc, sel) => {
    const fenced = fencedLineStarts(doc)
    const changes: EditChange[] = []
    for (const l of selectedLines(doc, sel)) {
      if (fenced.has(l.start)) continue
      if (delta === 1) {
        if (l.text.trim() !== '') changes.push({ from: l.start, to: l.start, insert: '  ' })
      } else {
        const m = /^(?:\t| {1,2})/.exec(l.text)
        if (m) changes.push({ from: l.start, to: l.start + m[0].length, insert: '' })
      }
    }
    if (!changes.length) return null
    return { changes, selection: mapSel(sel, changes) }
  }
}

/** Whether every non-blank selected line is a list item. */
export function selectionIsAllList(doc: string, sel: EditSel): boolean {
  const ls = selectedLines(doc, sel).filter(l => l.text.trim() !== '')
  return ls.length > 0 && ls.every(l => LIST_PREFIX.test(l.text))
}
