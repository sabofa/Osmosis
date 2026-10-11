// Pure string transforms behind the editor's toolbar commands. Positions are
// string indices; the CodeMirror glue applies the returned changes (expressed
// in ORIGINAL document coordinates, ordered, non-overlapping) and selection.
import { mapOffset, type TextChange } from './anchorRemap'

export interface EditSel { from: number; to: number }
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
  return {
    anchor: mapOffset(sel.from, cs, empty ? 1 : -1),
    head: mapOffset(sel.to, cs, 1),
  }
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

export function toggleWrap(marker: string): MarkdownEdit {
  const m = marker.length
  const c = marker[0]
  return (doc, sel) => {
    let { from, to } = sel
    // trim whitespace inside the selection: emphasis cannot hug spaces
    while (from < to && /\s/.test(doc[from])) from++
    while (to > from && /\s/.test(doc[to - 1])) to--

    if (from < to) {
      const text = doc.slice(from, to)
      // selection itself carries the markers
      if (
        text.length >= 2 * m + 1 &&
        text.startsWith(marker) && text.endsWith(marker) &&
        text[m] !== c && text[text.length - m - 1] !== c
      ) {
        return {
          changes: [{ from, to, insert: text.slice(m, text.length - m) }],
          selection: { anchor: from, head: to - 2 * m },
        }
      }
      // markers sit just outside the selection
      if (
        from >= m && doc.startsWith(marker, from - m) && doc.startsWith(marker, to) &&
        doc[from - m - 1] !== c && doc[to + m] !== c
      ) {
        return {
          changes: [{ from: from - m, to: from, insert: '' }, { from: to, to: to + m, insert: '' }],
          selection: { anchor: from - m, head: to - m },
        }
      }
      return {
        changes: [{ from, to: from, insert: marker }, { from: to, to, insert: marker }],
        selection: { anchor: from + m, head: to + m },
      }
    }

    // caret: inside an existing pair on this line?
    const p = sel.from
    const ls = lineStartOf(doc, p)
    const line = doc.slice(ls, lineEndOf(doc, p))
    const runs = exactRuns(line, marker)
    for (let i = 0; i + 1 < runs.length; i += 2) {
      const open = ls + runs[i]
      const close = ls + runs[i + 1]
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

    interface L { start: number; indent: number; oldLen: number; oldKind: PrefixKind | null; blank: boolean }
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
      })
      if (end >= lastEnd) break
      at = end + 1
    }

    const nonBlank = lines.filter(l => !l.blank)
    const targets = nonBlank.length ? nonBlank : lines
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

/** Cycle the cursor line's heading level: none -> # ... ###### -> none. */
export function cycleHeading(delta: 1 | -1): MarkdownEdit {
  return (doc, sel) => {
    const ls = lineStartOf(doc, sel.from)
    const line = doc.slice(ls, lineEndOf(doc, sel.from))
    const mt = /^( {0,3})(#{1,6})([ \t]+|$)/.exec(line)
    const level = mt ? mt[2].length : 0
    const next = (((level + delta) % 7) + 7) % 7
    const insert = next === 0 ? '' : '#'.repeat(next) + ' '
    const indent = mt ? mt[1].length : 0
    const oldLen = mt ? mt[2].length + mt[3].length : 0
    const changes: EditChange[] = [{ from: ls + indent, to: ls + indent + oldLen, insert }]
    return { changes, selection: mapSel(sel, changes) }
  }
}

// ------------------------------------------------------------------------ link

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
    const u = url ?? 'url'
    const urlStart = from + 1 + text.length + 2
    return {
      changes: [{ from, to, insert: `[${text}](${u})` }],
      selection: url === undefined
        ? { anchor: urlStart, head: urlStart + u.length }
        : { anchor: urlStart + u.length + 1, head: urlStart + u.length + 1 },
    }
  }
}
