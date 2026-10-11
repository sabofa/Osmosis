import type { Vec2 } from '../scene/types'
import { estimateTextSize } from './labels'
import { svgArc, svgLine, svgPolyline, svgText, type SvgAttrs } from './svg'

// Geometry notation — the overbars, arrows and arc marks that make a label
// read as mathematics rather than as a caption.
//
// F3: these are **SVG geometry positioned from measured text extents**, not
// Unicode combining characters. A combining macron renders at a different
// height in every font, is dropped entirely by some, and cannot be widened to
// cover two glyphs — none of which can be fixed from here. A line whose
// endpoints this file computes can be.
//
// The relation symbols (≅ ~ ∥ ⊥ ∠ △ °) are ordinary characters and appear
// here only as a spelling table: they need no geometry at all.

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

// What sits above a run of glyphs.
export type Overmark = 'none' | 'segment' | 'ray' | 'line' | 'arc'

// A notation label is a sequence of runs, because a mark covers *part* of a
// label: in "AB = 8" the overbar belongs to AB and stops before the "=". One
// text element per label could not express that, and one mark per label would
// draw a rule across the whole thing.
export interface NotationRun {
  text: string
  mark: Overmark
}

export interface PlacedRun extends NotationRun {
  // Offset from the notation's left edge, in view units.
  x: number
  width: number
}

export interface NotationLayout {
  runs: PlacedRun[]
  width: number
  // Vertical extent relative to the row's centre line, which is where the
  // text sits (emitted with dominant-baseline="central"). `top` is negative.
  top: number
  bottom: number
  height: number
  fontSize: number
}

// ---------------------------------------------------------------------------
// The vertical metrics, stated once
// ---------------------------------------------------------------------------

// All in em, so every mark scales with the font size rather than being right
// at one size and wrong at the others.
//
// Text is emitted centred on the row line, so a capital's top edge is about
// half a cap height above it. A UI sans has a cap height near 0.72 em, hence
// 0.36. The gap keeps the rule off the glyphs; below about 0.08 em an overbar
// starts to look like a strikethrough on the letters' own ascenders.
const CAP_HALF = 0.36
const MARK_GAP = 0.1
const MARK_Y = -(CAP_HALF + MARK_GAP)

// Half the text box, matching labels.ts's 1.15 em line height.
const HALF_LINE = 0.575

// A rule runs slightly past the glyphs it covers, the way a hand-drawn bar
// does. Absorbed by the padding of whatever box the notation sits in, so it
// is deliberately not counted in the layout's width.
const OVERHANG = 0.06

const ARROW_LENGTH = 0.24
const ARROW_HALF = 0.14

// How far the arc bows above its chord.
const ARC_SAGITTA = 0.16

// The furthest above the row line that any mark reaches. One number for every
// mark on purpose: a row mixing a bar with a ray would otherwise have two
// different heights, and the entries in a givens box would not line up.
const MARK_EXTENT = -MARK_Y + Math.max(ARROW_HALF, ARC_SAGITTA)

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function layoutNotation(runs: readonly NotationRun[], fontSize: number): NotationLayout {
  const placed: PlacedRun[] = []
  let x = 0
  let marked = false
  for (const run of runs) {
    const width = estimateTextSize(run.text, fontSize).width
    placed.push({ text: run.text, mark: run.mark, x, width })
    x += width
    if (run.mark !== 'none') marked = true
  }
  // The box grows *upward* for a mark and never downward, so adding an
  // overbar to a label does not move the glyphs it belongs to.
  const top = (marked ? -MARK_EXTENT : -HALF_LINE) * fontSize
  const bottom = HALF_LINE * fontSize
  return { runs: placed, width: x, top, bottom, height: bottom - top, fontSize }
}

// Where to write a notation label whose *box* has been centred at `centre` —
// by a label layout, which works in boxes and knows nothing about glyph rows.
//
// The two are not the same point. A marked label's box grows upward only, so
// its centre sits above the row the glyphs are on; writing the text at the
// box centre would push the overbar out through the top of the box the layout
// just reserved for it.
export function notationOrigin(layout: NotationLayout, centre: Vec2): Vec2 {
  return { x: centre.x - layout.width / 2, y: centre.y - (layout.top + layout.bottom) / 2 }
}

// ---------------------------------------------------------------------------
// Mark geometry
// ---------------------------------------------------------------------------

export interface ArrowHead {
  tip: Vec2
  // The two barbs, in a fixed order (upper then lower) so the emitted
  // polyline's point order is a function of the mark and not of iteration.
  wings: [Vec2, Vec2]
}

export interface OvermarkGeometry {
  bar: { from: Vec2; to: Vec2 } | null
  heads: ArrowHead[]
  arc: { from: Vec2; to: Vec2; center: Vec2; radius: number; startAngle: number; endAngle: number } | null
}

// `origin` is the notation's left edge on its row centre line; the run's own
// offset is added here, so a caller lays a label out once and asks for each
// mark in the same frame.
export function overmarkGeometry(run: PlacedRun, fontSize: number, origin: Vec2): OvermarkGeometry | null {
  if (run.mark === 'none') return null

  const y = origin.y + MARK_Y * fontSize
  const left = origin.x + run.x - OVERHANG * fontSize
  const right = origin.x + run.x + run.width + OVERHANG * fontSize

  if (run.mark === 'arc') {
    // A chord of length c bowed by a sagitta s lies on a circle of radius
    // (c²/4 + s²) / 2s — the standard relation, and the reason this is a real
    // arc rather than a flattened guess: the apex lands exactly s above the
    // chord at every label width.
    const chord = right - left
    const sagitta = ARC_SAGITTA * fontSize
    const radius = (chord * chord) / (8 * sagitta) + sagitta / 2
    // y grows downward, so the centre sits *below* the chord.
    const center = { x: (left + right) / 2, y: y - sagitta + radius }
    const from = { x: left, y }
    const to = { x: right, y }
    return {
      bar: null,
      heads: [],
      arc: {
        from,
        to,
        center,
        radius,
        startAngle: Math.atan2(from.y - center.y, from.x - center.x),
        endAngle: Math.atan2(to.y - center.y, to.x - center.x),
      },
    }
  }

  const bar = { from: { x: left, y }, to: { x: right, y } }
  const heads: ArrowHead[] = []
  const head = (tipX: number, direction: 1 | -1): ArrowHead => ({
    tip: { x: tipX, y },
    wings: [
      { x: tipX - direction * ARROW_LENGTH * fontSize, y: y - ARROW_HALF * fontSize },
      { x: tipX - direction * ARROW_LENGTH * fontSize, y: y + ARROW_HALF * fontSize },
    ],
  })
  // Left head first, so "line" emits its two heads in reading order.
  if (run.mark === 'line') heads.push(head(left, -1))
  if (run.mark === 'ray' || run.mark === 'line') heads.push(head(right, 1))
  return { bar, heads, arc: null }
}

// ---------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------

export interface NotationStyle {
  fill: string
  fontFamily: string
  // Defaults to `fill`: a mark is part of the glyph it sits over, so it takes
  // the text colour unless a caller says otherwise.
  stroke?: string
  strokeWidth?: number
  identity?: SvgAttrs
}

// Marks are drawn at a fraction of the font size rather than at the figure's
// stroke widths: an overbar is typography, and a 2.4-unit rule over a 15-unit
// label reads as a line through the figure rather than as part of the label.
const MARK_STROKE = 0.07

export function notationElements(layout: NotationLayout, origin: Vec2, style: NotationStyle): string[] {
  const out: string[] = []
  const stroke = style.stroke ?? style.fill
  const strokeWidth = style.strokeWidth ?? MARK_STROKE * layout.fontSize
  const identity = style.identity ?? {}

  for (const run of layout.runs) {
    out.push(
      svgText({ x: origin.x + run.x, y: origin.y }, run.text, {
        'font-size': layout.fontSize,
        'font-family': style.fontFamily,
        fill: style.fill,
        'text-anchor': 'start',
        'dominant-baseline': 'central',
        ...identity,
      })
    )
  }

  // Marks after the glyphs, so a mark is never painted under its own text.
  for (const run of layout.runs) {
    const mark = overmarkGeometry(run, layout.fontSize, origin)
    if (!mark) continue
    const lineStyle: SvgAttrs = { stroke, 'stroke-width': strokeWidth, 'stroke-linecap': 'round', ...identity }
    if (mark.bar) out.push(svgLine(mark.bar.from, mark.bar.to, lineStyle))
    for (const head of mark.heads) {
      out.push(svgPolyline([head.wings[0], head.tip, head.wings[1]], { fill: 'none', ...lineStyle }))
    }
    if (mark.arc) {
      out.push(svgArc(mark.arc.center, mark.arc.radius, mark.arc.startAngle, mark.arc.endAngle, { fill: 'none', ...lineStyle }))
    }
  }

  return out
}

// ---------------------------------------------------------------------------
// Relations — plain characters (F3)
// ---------------------------------------------------------------------------

const RELATIONS: Record<string, string> = {
  congruent: '≅',
  cong: '≅',
  similar: '~',
  sim: '~',
  parallel: '∥',
  par: '∥',
  perpendicular: '⊥',
  perp: '⊥',
  angle: '∠',
  triangle: '△',
  degree: '°',
  degrees: '°',
}

const SYMBOLS = new Set(Object.values(RELATIONS))

// The symbol an author's word names, or the word itself when it is already
// the symbol — a spec is typed text and "∥" is as likely to arrive as
// "parallel". Null for anything that names no relation, so a caller can tell
// "this is a relation" from "this is ordinary text".
export function relationSymbol(word: string): string | null {
  const key = word.trim()
  if (SYMBOLS.has(key)) return key
  return RELATIONS[key.toLowerCase()] ?? null
}
