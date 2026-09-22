import type { Vec2 } from '../scene/types'

// The SVG primitive emitter: geometry plus style in, markup out.
//
// Pure string building, no DOM and no library. Two reasons it is written this
// way rather than against `document.createElementNS`: the figure renderer has
// to run in node (tests, and eventually server-side figure generation, where
// there is no DOM at all), and the spec's determinism requirement is a
// statement about *bytes*, which is only checkable if bytes are what this
// layer produces.
//
// Everything here is deliberately dumb. No layering, no theming, no layout —
// those are document.ts, and keeping them out of here is what makes each of
// these functions a one-line assertion in a test.

// ---------------------------------------------------------------------------
// The single number formatter
// ---------------------------------------------------------------------------

// Coordinates are written with three decimals, then trailing zeros are
// dropped.
//
// **Three, and the choice is about the output's own units, not the world's.**
// Everything reaching this function has already been mapped into the figure's
// viewBox coordinate system, which is a few hundred units across (see
// document.ts's VIEWBOX_SIZE). Three decimals is therefore a thousandth of a
// unit on a canvas of ~700 — comfortably finer than a device pixel at any
// zoom a printed or on-screen figure reaches, and coarse enough that the last
// digit is never the noise of a long construction chain.
//
// Rounding *at all* is the point. `String(0.1 + 0.2)` is "0.30000000000000004"
// and `String(0.3)` is "0.3": the same geometric answer arrived at two ways
// serialises two ways, and the byte-identical requirement dies. Fixing the
// precision collapses both to "0.3" and makes the output a function of the
// figure rather than of the arithmetic route taken to it.
const PRECISION = 3

export function fmt(n: number): string {
  if (!Number.isFinite(n)) {
    throw new Error(`Cannot write ${n} into SVG markup — coordinates must be finite numbers`)
  }
  let s = n.toFixed(PRECISION)
  // Trailing zeros carry no information and cost bytes on every coordinate.
  if (s.includes('.')) s = s.replace(/\.?0+$/, '')
  // "-0" and "-0.000" both round to nothing, but keep their sign through
  // toFixed. A negative zero in the output is a byte that depends on which
  // side of zero a rounding error landed on, which is exactly the run-to-run
  // instability this formatter exists to remove.
  if (s === '-0' || s === '') return '0'
  return s
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

// A label can hold anything an author typed. `&` is replaced first so an
// escape introduced by a later replacement is not itself escaped again.
export function svgEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

// A number is formatted through `fmt`; a string is escaped; null/undefined
// means "this attribute is not set" and is dropped entirely, which is what
// lets a caller pass an optional style slot straight through.
export type SvgAttrs = Record<string, string | number | null | undefined>

function attrs(a: SvgAttrs): string {
  let out = ''
  // Insertion order, not sorted: object literal key order is stable in JS,
  // and a caller that wants a particular attribute order (geometry first,
  // then style, then identity) gets it by writing them in that order.
  for (const key of Object.keys(a)) {
    const value = a[key]
    if (value === null || value === undefined) continue
    out += ` ${key}="${typeof value === 'number' ? fmt(value) : svgEscape(value)}"`
  }
  return out
}

function points(list: readonly Vec2[]): string {
  return list.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ')
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function svgLine(a: Vec2, b: Vec2, style: SvgAttrs): string {
  return `<line${attrs({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...style })}/>`
}

export function svgPolyline(list: readonly Vec2[], style: SvgAttrs): string {
  return `<polyline${attrs({ points: points(list), ...style })}/>`
}

export function svgPolygon(list: readonly Vec2[], style: SvgAttrs): string {
  return `<polygon${attrs({ points: points(list), ...style })}/>`
}

export function svgCircle(center: Vec2, radius: number, style: SvgAttrs): string {
  return `<circle${attrs({ cx: center.x, cy: center.y, r: radius, ...style })}/>`
}

// An arc of `radius` about `center`, swept from `startAngle` to `endAngle`.
//
// Angles are in radians in the *SVG* coordinate system — y increases
// downward — so the caller converts from world space before getting here, the
// same way it does for every other coordinate in this file.
//
// Emitted as a path rather than as a sampled polyline: a real elliptical-arc
// command is four numbers and two flags regardless of how far it sweeps,
// where a polyline's fidelity (and its byte count) is a sample-rate choice
// that would then have to be pinned for determinism.
export function svgArc(center: Vec2, radius: number, startAngle: number, endAngle: number, style: SvgAttrs): string {
  const from = { x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) }
  const to = { x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) }
  const delta = endAngle - startAngle
  const largeArc = Math.abs(delta) > Math.PI ? 1 : 0
  const sweep = delta >= 0 ? 1 : 0
  const d = `M ${fmt(from.x)} ${fmt(from.y)} A ${fmt(radius)} ${fmt(radius)} 0 ${largeArc} ${sweep} ${fmt(to.x)} ${fmt(to.y)}`
  return `<path${attrs({ d, ...style })}/>`
}

export function svgText(at: Vec2, text: string, style: SvgAttrs): string {
  return `<text${attrs({ x: at.x, y: at.y, ...style })}>${svgEscape(text)}</text>`
}

// A group. Empty groups self-close rather than emitting `<g></g>`: a figure
// always emits every layer (see E1), and most figures leave several of them
// empty, so this is the common case and not an edge one.
export function svgGroup(children: readonly string[], style: SvgAttrs): string {
  if (children.length === 0) return `<g${attrs(style)}/>`
  return `<g${attrs(style)}>${children.join('')}</g>`
}
