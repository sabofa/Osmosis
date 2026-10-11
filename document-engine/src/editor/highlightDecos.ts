// Highlight painting inside the editor, with Decoration.mark (the Custom
// Highlight API cannot paint inside CodeMirror's re-rendered lines). The
// colours are the same tokens as read mode: --de-highlight-N at
// HIGHLIGHT_ALPHA through color-mix. Offsets arrive as codepoints into the
// LF-normalised text; the field stores UTF-16 decorations, which then map
// through edits by themselves.
import { StateEffect, StateField, type Range } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'
import type { DocumentHighlight } from '../types'
import { HIGHLIGHT_PALETTE } from '../highlightPalette'
import { HIGHLIGHT_ALPHA } from '../tokenVars'
import { cpToUtf16 } from '../core/offsets'

export interface HighlightSpan { from: number; to: number; slot: number }

// One pass over `text` for many codepoint offsets (cpToUtf16 alone is O(n) each).
function cpTable(text: string, cps: number[]): Map<number, number> {
  const want = [...new Set(cps.map((c) => Math.max(0, c)))].sort((a, b) => a - b)
  const out = new Map<number, number>()
  let i = 0, n = 0, k = 0
  while (k < want.length) {
    while (k < want.length && want[k] === n) out.set(want[k++], i)
    if (i >= text.length) break
    const c = text.charCodeAt(i)
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00 ? 2 : 1
    n++
  }
  while (k < want.length) out.set(want[k++], text.length)
  return out
}

/** Pure: codepoint highlights to clamped UTF-16 spans with a 0..3 colour slot. */
export function highlightSpans(text: string, hs: readonly DocumentHighlight[]): HighlightSpan[] {
  const out: HighlightSpan[] = []
  const at = cpTable(text, hs.flatMap((h) => [h.start, h.end]))
  for (const h of hs) {
    const from = at.get(Math.max(0, h.start)) ?? cpToUtf16(text, h.start)
    const to = at.get(Math.max(0, h.end)) ?? cpToUtf16(text, h.end)
    if (!(to > from)) continue
    const i = HIGHLIGHT_PALETTE.findIndex((c) => c.id === h.color)
    out.push({ from, to, slot: i < 0 ? 0 : i % 4 })
  }
  return out
}

/** Stable key: equal keys paint identically (skip redundant dispatches). */
export const highlightKey = (hs: readonly DocumentHighlight[]): string =>
  hs.map((h) => `${h.start}:${h.end}:${h.color ?? ''}`).join('|')

export const setHighlightSpans = StateEffect.define<HighlightSpan[]>()

const marks = [0, 1, 2, 3].map((n) => Decoration.mark({ class: `cm-hl cm-hl-${n + 1}` }))

export const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setHighlightSpans)) continue
      const len = tr.state.doc.length
      const ranges: Range<Decoration>[] = []
      for (const s of e.value) {
        const from = Math.min(s.from, len), to = Math.min(s.to, len)
        if (to > from) ranges.push(marks[s.slot].range(from, to))
      }
      deco = Decoration.set(ranges, true)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

const pct = Math.round(HIGHLIGHT_ALPHA * 100)
export const highlightTheme = EditorView.theme({
  '.cm-hl-1': { backgroundColor: `color-mix(in srgb, var(--de-highlight-1) ${pct}%, transparent)` },
  '.cm-hl-2': { backgroundColor: `color-mix(in srgb, var(--de-highlight-2) ${pct}%, transparent)` },
  '.cm-hl-3': { backgroundColor: `color-mix(in srgb, var(--de-highlight-3) ${pct}%, transparent)` },
  '.cm-hl-4': { backgroundColor: `color-mix(in srgb, var(--de-highlight-4) ${pct}%, transparent)` },
})

export const highlightExtensions = [highlightField, highlightTheme]
