// Pure scanning for the live-preview widgets (no CodeMirror, no DOM): where
// the block constructs (`$$` math, fences) and inline `$…$` math are, and
// which of them become widgets for a given selection. It follows the viewer's
// own reader (src/markdown.ts) so edit and read mode agree on what is math.
import { parseInline } from '../markdown'
import { isGraphFence } from '../graphFence'

export interface LiveSpan { from: number; to: number }

export type LiveBlockKind = 'math' | 'graph' | 'fence'

export interface LiveBlock {
  kind: LiveBlockKind
  // Whole lines: opening line start .. closing line end.
  from: number
  to: number
  // Math: the TeX source. Graph: the fence body. Fence: ''.
  body: string
  // Fence info string ('' when absent). Fences and graphs only.
  info: string
  // False for a fence with no closing line (it runs to the end of the text).
  closed: boolean
}

const FENCE_OPEN = /^\s*```(.*)$/
const FENCE_CLOSE = /^\s*```\s*$/

const eolOf = (text: string, from: number): number => {
  const e = text.indexOf('\n', from)
  return e === -1 ? text.length : e
}

/**
 * Every `$$` math block and fenced block in `text`, in document order. Only
 * lines that open a fence or `$$` are visited (a sticky-free regex walk), so a
 * 200 KB document with few blocks scans in about a millisecond.
 */
export function scanLiveBlocks(text: string): LiveBlock[] {
  const out: LiveBlock[] = []
  const cand = /^[ \t]*(```|\$\$)/gm
  let m: RegExpExecArray | null
  while ((m = cand.exec(text))) {
    const from = m.index
    const to = eolOf(text, from)
    const lineText = text.slice(from, to)
    if (m[1] === '```') {
      const info = FENCE_OPEN.exec(lineText)![1].trim()
      let pos = to + 1
      let closeTo = -1
      while (pos <= text.length) {
        const e = eolOf(text, pos)
        if (FENCE_CLOSE.test(text.slice(pos, e))) { closeTo = e; break }
        if (e === text.length) break
        pos = e + 1
      }
      const closed = closeTo !== -1
      const end = closed ? closeTo : text.length
      const graph = isGraphFence(info)
      let body = ''
      if (graph) {
        const lastBodyEnd = closed ? text.lastIndexOf('\n', closeTo - 1) : text.length
        body = to + 1 <= lastBodyEnd ? text.slice(to + 1, lastBodyEnd) : ''
      }
      out.push({ kind: graph ? 'graph' : 'fence', from, to: end, body, info, closed })
      cand.lastIndex = Math.min(text.length, end + 1)
      continue
    }
    const open = lineText.indexOf('$$')
    const rest = lineText.slice(open + 2)
    const sameClose = rest.lastIndexOf('$$')
    if (sameClose > 0) {
      out.push({ kind: 'math', from, to, body: rest.slice(0, sameClose), info: '', closed: true })
      cand.lastIndex = to + 1
      continue
    }
    let pos = to + 1
    while (pos <= text.length) {
      const e = eolOf(text, pos)
      if (text.slice(pos, e).trim() === '$$') {
        const mid = pos - 1 >= to + 1 ? text.slice(to + 1, pos - 1) : ''
        const body = (mid ? rest + '\n' + mid : rest).trim()
        out.push({ kind: 'math', from, to: e, body, info: '', closed: true })
        cand.lastIndex = Math.min(text.length, e + 1)
        break
      }
      if (e === text.length) break
      pos = e + 1
    }
  }
  return out
}

export interface InlineMath { from: number; to: number; tex: string }

/** Inline `$…$` / mid-line `$$…$$` math on one line (`from` = line start offset). */
export function inlineMathInLine(lineText: string, from: number): InlineMath[] {
  if (lineText.indexOf('$') === -1) return []
  const out: InlineMath[] = []
  for (const r of parseInline(lineText, 0)) {
    if (!r.math) continue
    const double = lineText.slice(r.start - 2, r.start) === '$$' && lineText.slice(r.end, r.end + 2) === '$$'
    const d = double ? 2 : 1
    if (lineText[r.start - d] !== '$') continue
    out.push({ from: from + r.start - d, to: from + r.end + d, tex: lineText.slice(r.start, r.end) })
  }
  return out
}

export const touchesSel = (sel: readonly LiveSpan[], from: number, to: number): boolean =>
  sel.some((r) => r.from <= to && r.to >= from)

export interface BlockDecision { block: LiveBlock; revealed: boolean }

/**
 * Which blocks become widgets: math always, graph only when the host gave a
 * renderer and the fence is closed, an unclosed fence never. Revealed means
 * the caret or a selection touches the block, so its raw source is shown.
 */
export function decideBlockWidgets(
  blocks: readonly LiveBlock[], sel: readonly LiveSpan[], opts: { graph: boolean },
): BlockDecision[] {
  const out: BlockDecision[] = []
  for (const b of blocks) {
    if (b.kind === 'fence' || !b.closed) continue
    if (b.kind === 'graph' && !opts.graph) continue
    out.push({ block: b, revealed: touchesSel(sel, b.from, b.to) })
  }
  return out
}

/** True when `pos` lies inside any block range (inline scanning skips these). */
export function insideBlock(blocks: readonly LiveBlock[], from: number, to: number): boolean {
  return blocks.some((b) => from >= b.from && to <= b.to)
}
