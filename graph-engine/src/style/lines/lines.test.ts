import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { pieceLength, pointOn, polylineChain, type Chain } from '../path'
import { LINE_TYPES, type LineSettings, type LineType, type Point } from '../tokens'
import { LINES } from './index'
import type { Primitive } from './types'

// The six line types, held to the rules every one of them keeps, and to being
// six different algorithms rather than one with six sets of numbers.

const WIDTH = 2.4
const A = { x: 10, y: 20 }
const B = { x: 250, y: 90 }
const SEGMENT: Chain = polylineChain([A, B])
const ARC: Chain = { pieces: [{ kind: 'arc', center: { x: 0, y: 0 }, radius: 80, start: 0.3, end: 2.4 }], closed: false }
const CIRCLE: Chain = { pieces: [{ kind: 'arc', center: { x: 5, y: 5 }, radius: 60, start: 0, end: 2 * Math.PI }], closed: true }
// A cylinder's rim: an elliptical arc.
const RIM: Chain = { pieces: [{ kind: 'ellipticalArc', center: { x: 0, y: 0 }, rx: 90, ry: 30, rotation: 0.2, start: 0, end: Math.PI }], closed: false }

const settingsFor = (type: LineType, overrides: Partial<LineSettings> = {}): LineSettings => ({
  type,
  looseness: 0,
  wobble: 0.8,
  passes: 3,
  width: 1,
  variation: 0.7,
  taper: 0.6,
  grain: 0.7,
  opacity: 0.9,
  ...overrides,
})

const draw = (type: LineType, chain: Chain, overrides: Partial<LineSettings> = {}, identity = 's1/AB/0') =>
  LINES[type].draw({ chain, width: WIDTH, settings: settingsFor(type, overrides), random: randomFor(identity, 0) })

// Every point the output puts on the page's centre lines, sampled DENSELY: a
// stroke's start and eight points along every piece (the curve between
// samples, not only its ends — review 1), a shape's spine and the midpoint of
// each spine step, a dot's centre.
function points(primitives: readonly Primitive[]): Point[] {
  const out: Point[] = []
  for (const p of primitives) {
    if (p.kind === 'stroke') {
      out.push(p.start)
      for (const piece of p.pieces) for (let i = 1; i <= 8; i++) out.push(pointOn(piece, i / 8))
    } else if (p.kind === 'shape') {
      p.spine.forEach((s, i) => {
        out.push(s)
        if (i > 0) out.push({ x: (s.x + p.spine[i - 1].x) / 2, y: (s.y + p.spine[i - 1].y) / 2 })
      })
    } else out.push(...p.dots.map((d) => d.at))
  }
  return out
}

// Distance to an ellipse (or an arc of one), by a fine sampling of the true
// curve: 4000 points is far finer than any tolerance tested here.
function distanceToEllipse(p: Point, piece: Extract<Chain['pieces'][number], { kind: 'ellipticalArc' }>): number {
  let best = Infinity
  for (let i = 0; i <= 4000; i++) best = Math.min(best, near(p, pointOn(piece, i / 4000)))
  return best
}

const ELLIPSE: Chain = { pieces: [{ kind: 'ellipticalArc', center: { x: 10, y: -5 }, rx: 110, ry: 45, rotation: -0.35, start: 0, end: 2 * Math.PI }], closed: true }

const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y)

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

// Distance to the ARC itself: to the circle when the point is within the
// sweep, to the nearer end otherwise — so running past an end counts.
function distanceToArc(p: Point, chain: Chain): number {
  const piece = chain.pieces[0]
  if (piece.kind !== 'arc') throw new Error('arc expected')
  const angle = Math.atan2(p.y - piece.center.y, p.x - piece.center.x)
  const lo = Math.min(piece.start, piece.end)
  const hi = Math.max(piece.start, piece.end)
  const wrapped = [angle, angle + 2 * Math.PI, angle - 2 * Math.PI].find((a) => a >= lo - 1e-12 && a <= hi + 1e-12)
  if (wrapped !== undefined) return Math.abs(Math.hypot(p.x - piece.center.x, p.y - piece.center.y) - piece.radius)
  return Math.min(near(p, pointOn(piece, 0)), near(p, pointOn(piece, 1)))
}

const EPS = 1e-9 * 250

describe('every line type', () => {
  for (const type of LINE_TYPES) {
    describe(type, () => {
      it('is deterministic for one identity', () => {
        expect(draw(type, SEGMENT)).toEqual(draw(type, SEGMENT))
        expect(draw(type, ARC, { looseness: 0.6 })).toEqual(draw(type, ARC, { looseness: 0.6 }))
      })

      it('draws a different stroke for a different identity', () => {
        if (type === 'technical') return // no randomness at looseness 0 by design
        expect(draw(type, SEGMENT, {}, 's1/AB/0')).not.toEqual(draw(type, SEGMENT, {}, 's2/AB/0'))
      })

      it('reaches both true ends exactly at looseness 0, and strays at most half a width', () => {
        const out = points(draw(type, SEGMENT))
        expect(Math.min(...out.map((p) => near(p, A))), 'start').toBeLessThanOrEqual(EPS)
        expect(Math.min(...out.map((p) => near(p, B))), 'end').toBeLessThanOrEqual(EPS)
        for (const p of out) expect(distanceToSegment(p, A, B)).toBeLessThanOrEqual(WIDTH / 2)
      })

      it('keeps an arc on its circle at looseness 0', () => {
        const out = points(draw(type, ARC))
        const piece = ARC.pieces[0]
        expect(Math.min(...out.map((p) => near(p, pointOn(piece, 0))))).toBeLessThanOrEqual(EPS)
        expect(Math.min(...out.map((p) => near(p, pointOn(piece, 1))))).toBeLessThanOrEqual(EPS)
        for (const p of out) expect(distanceToArc(p, ARC)).toBeLessThanOrEqual(WIDTH / 2)
      })

      it('keeps a whole circle on its circle at looseness 0', () => {
        const out = points(draw(type, CIRCLE))
        for (const p of out) expect(Math.abs(Math.hypot(p.x - 5, p.y - 5) - 60)).toBeLessThanOrEqual(WIDTH / 2)
      })

      it('keeps an elliptical arc (a rim) on its ellipse at looseness 0', () => {
        const piece = RIM.pieces[0]
        if (piece.kind !== 'ellipticalArc') throw new Error('rim')
        const out = points(draw(type, RIM))
        expect(Math.min(...out.map((p) => near(p, pointOn(piece, 0))))).toBeLessThanOrEqual(EPS)
        expect(Math.min(...out.map((p) => near(p, pointOn(piece, 1))))).toBeLessThanOrEqual(EPS)
        for (const p of out) expect(distanceToEllipse(p, piece)).toBeLessThanOrEqual(WIDTH / 2)
      })

      it('keeps a whole ellipse on its ellipse at looseness 0', () => {
        const piece = ELLIPSE.pieces[0]
        if (piece.kind !== 'ellipticalArc') throw new Error('ellipse')
        for (const p of points(draw(type, ELLIPSE))) expect(distanceToEllipse(p, piece)).toBeLessThanOrEqual(WIDTH / 2)
      })

      it('strays measurably at looseness 1', () => {
        const out = points(draw(type, SEGMENT, { looseness: 1 }))
        expect(Math.max(...out.map((p) => distanceToSegment(p, A, B)))).toBeGreaterThan(WIDTH)
      })

      it('writes only finite numbers', () => {
        for (const chain of [SEGMENT, ARC, CIRCLE, RIM, polylineChain([A, A])]) {
          for (const looseness of [0, 0.5, 1]) {
            const json = JSON.stringify(draw(type, chain, { looseness }))
            expect(json).not.toMatch(/null|NaN|Infinity/)
            for (const p of points(draw(type, chain, { looseness }))) {
              expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true)
            }
          }
        }
      })
    })
  }
})

// A line type's structural signature: what KINDS of primitive it makes, how
// many strokes, whether its strokes are exact geometry or smooth curves,
// whether its outline's two edges wander independently (ink's bumpy edges,
// against brush's mirrored nib), and its texture. Six types, six signatures.
function signature(type: LineType): string {
  const out = draw(type, SEGMENT, { looseness: 0.3 })
  const strokes = out.filter((p) => p.kind === 'stroke')
  const shapes = out.filter((p) => p.kind === 'shape')
  const dots = out.filter((p) => p.kind === 'dots')
  const curved = strokes.some((p) => p.kind === 'stroke' && p.pieces.some((piece) => piece.kind === 'cubic'))
  const texture = LINES[type].texture(settingsFor(type))?.name ?? 'none'
  // On a loop a ribbon has no end caps: outline[i] and outline[2n - 1 - i]
  // are the two edges beside spine[i].
  const loop = draw(type, CIRCLE).find((p) => p.kind === 'shape')
  const ragged =
    loop?.kind === 'shape' &&
    loop.outline.length === 2 * loop.spine.length &&
    loop.spine.some((p, i) => Math.abs(near(p, loop.outline[i]) - near(p, loop.outline[2 * loop.spine.length - 1 - i])) > 1e-6)
  return [`strokes:${strokes.length > 2 ? 'many' : strokes.length}`, `shapes:${shapes.length}`, `dots:${dots.length > 0}`, `curved:${curved}`, `ragged:${ragged}`, `texture:${texture}`].join(' ')
}

describe('the six line types are six algorithms', () => {
  it('each has its own structural signature', () => {
    const signatures = LINE_TYPES.map(signature)
    expect(new Set(signatures).size, signatures.join('\n')).toBe(LINE_TYPES.length)
  })

  it('technical is one exact stroke: straight lines stay lines and arcs stay arcs', () => {
    for (const chain of [SEGMENT, ARC]) {
      const out = draw('technical', chain)
      expect(out).toHaveLength(1)
      expect(out[0].kind === 'stroke' && out[0].pieces.map((p) => p.kind)).toEqual([chain.pieces[0].kind])
    }
    expect(LINES.technical.texture(settingsFor('technical'))).toBeNull()
  })

  // Ink's left edge sits at outline[i] beside spine[i] (ribbon2's layout),
  // and on a loop, with no end caps, its right edge at outline[2n - 1 - i].
  const inkHalves = (out: Primitive[]) => {
    const shape = out[0]
    if (shape.kind !== 'shape') throw new Error('ink draws one shape')
    const n = shape.spine.length
    return {
      n,
      left: shape.spine.map((s, i) => near(s, shape.outline[i])),
      right: (closed: boolean) => (closed ? shape.spine.map((s, i) => near(s, shape.outline[2 * n - 1 - i])) : []),
    }
  }

  it('ink is one solid shape: no texture, no blots, no second pass', () => {
    const out = draw('ink', SEGMENT)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('shape')
    expect(LINES.ink.texture(settingsFor('ink'))).toBeNull()
  })

  it('ink swells and thins along its length with the pressure', () => {
    const { n, left } = inkHalves(draw('ink', SEGMENT, { taper: 0 }))
    const middle = left.slice(Math.floor(n * 0.2), Math.ceil(n * 0.8))
    expect(Math.max(...middle) / Math.min(...middle)).toBeGreaterThan(1.6)
  })

  it('ink tapers to fine points at both ends', () => {
    const { n, left } = inkHalves(draw('ink', SEGMENT, { taper: 1, variation: 0 }))
    expect(left[0]).toBeLessThan(0.05 * WIDTH)
    expect(left[n - 1]).toBeLessThan(0.05 * WIDTH)
    expect(left[Math.floor(n / 2)]).toBeCloseTo(WIDTH / 2, 9)
  })

  it('a loop has no ends to taper: no neck at the seam, even drawn loose', () => {
    for (const looseness of [0, 0.25, 0.6]) {
      const shape = draw('ink', CIRCLE, { taper: 1, variation: 0, looseness })[0]
      if (shape.kind !== 'shape') throw new Error('ink draws one shape')
      const n = shape.spine.length
      // Loose loops overlap and may carry end caps, so read the left edge only.
      const left = shape.spine.map((p, i) => near(p, shape.outline[i]))
      expect(Math.min(...left.slice(0, n)), `looseness ${looseness}`).toBeGreaterThan(0.45 * WIDTH)
    }
  })

  it('a long line tapers only at its ends, over a few widths', () => {
    const long = polylineChain([{ x: 0, y: 0 }, { x: 600, y: 0 }])
    const { n, left } = inkHalves(LINES.ink.draw({ chain: long, width: WIDTH, settings: settingsFor('ink', { taper: 1, variation: 0, looseness: 0 }), random: randomFor('long', 0) }))
    // 14 widths is 33.6 units of 600: by a tenth of the way in, full width.
    expect(left[Math.floor(n * 0.1)]).toBeCloseTo(WIDTH / 2, 9)
  })

  it('at variation 0 and taper 0, ink is an even ribbon', () => {
    const { left } = inkHalves(draw('ink', CIRCLE, { taper: 0, variation: 0 }))
    for (const h of left) expect(h).toBeCloseTo(WIDTH / 2, 9)
  })

  it('its two edges are bumpy, each in its own way', () => {
    const halves = inkHalves(draw('ink', CIRCLE, { variation: 0.8 }))
    const right = halves.right(true)
    expect(halves.left.some((h, i) => Math.abs(h - right[i]) > 0.02 * WIDTH)).toBe(true)
  })

  it('grain is not read: the same ink at grain 0 and 1', () => {
    expect(JSON.stringify(draw('ink', ARC, { grain: 1 }))).toBe(JSON.stringify(draw('ink', ARC, { grain: 0 })))
  })

  it('brush is one calligraphic outline: pointed tips, width set by direction', () => {
    const across = draw('brush', polylineChain([{ x: 0, y: 0 }, { x: 200, y: 0 }]), { variation: 0, wobble: 0 })
    const down = draw('brush', polylineChain([{ x: 0, y: 0 }, { x: 0, y: 200 }]), { variation: 0, wobble: 0 })
    for (const out of [across, down]) {
      expect(out).toHaveLength(1)
      expect(out[0].kind).toBe('shape')
    }
    const widest = (out: Primitive[]) => {
      const shape = out[0]
      if (shape.kind !== 'shape') return 0
      return Math.max(...shape.spine.map((s, i) => near(s, shape.outline[i])))
    }
    // The nib is held at an angle, so a horizontal and a vertical stroke of
    // the same length are drawn at different widths.
    expect(Math.abs(widest(across) - widest(down))).toBeGreaterThan(0.3 * WIDTH)
    // Tips: the outline starts and turns at the true ends.
    const shape = across[0]
    if (shape.kind === 'shape') {
      expect(near(shape.outline[0], { x: 0, y: 0 })).toBeLessThanOrEqual(EPS)
    }
  })

  it('pencil draws one light, grainy pass per `passes`', () => {
    for (const passes of [1, 2, 3]) {
      const out = draw('pencil', SEGMENT, { passes })
      expect(out.filter((p) => p.kind === 'stroke')).toHaveLength(passes)
      for (const p of out) if (p.kind === 'stroke') expect(p.opacity).toBeLessThan(0.9)
    }
    expect(LINES.pencil.texture(settingsFor('pencil'))?.name).toBe('grain')
  })

  it('marker is one thick, translucent, overlap-darkening stroke that blots at its ends', () => {
    const out = draw('marker', SEGMENT)
    const strokes = out.filter((p) => p.kind === 'stroke')
    expect(strokes).toHaveLength(1)
    const stroke = strokes[0]
    if (stroke.kind === 'stroke') {
      expect(stroke.width).toBeGreaterThan(1.3 * WIDTH)
      expect(stroke.opacity).toBeLessThan(1)
      expect(stroke.blend).toBe('multiply')
      expect(stroke.cap).toBe('round')
    }
    const blots = out.find((p) => p.kind === 'dots')
    expect(blots?.kind === 'dots' && blots.dots.length).toBe(2)
  })

  it('chalk is broken into several strokes and dusted', () => {
    const out = draw('chalk', SEGMENT)
    expect(out.filter((p) => p.kind === 'stroke').length).toBeGreaterThan(2)
    const dust = out.find((p) => p.kind === 'dots')
    expect(dust?.kind === 'dots' && dust.dots.length).toBeGreaterThan(10)
    expect(LINES.chalk.texture(settingsFor('chalk'))?.name).toBe('chalk')
  })
})

// Closing a loop (controller's visual finding V2): a circle drawn by hand
// must not show a notch or tick where the stroke's start meets its end.
describe('closing a loop', () => {
  // The centre-line runs of a line type's output, densely sampled: each
  // stroke on its own, each shape's spine.
  const runs = (primitives: readonly Primitive[]): { points: Point[]; closed: boolean }[] =>
    primitives.flatMap((p) => {
      if (p.kind === 'stroke') {
        const out = [p.start]
        for (const piece of p.pieces) {
          const count = Math.max(8, Math.ceil(pieceLength(piece) / 2))
          for (let i = 1; i <= count; i++) out.push(pointOn(piece, i / count))
        }
        return [{ points: out, closed: p.closed === true }]
      }
      if (p.kind === 'shape') return [{ points: p.spine, closed: near(p.spine[0], p.spine[p.spine.length - 1]) <= EPS }]
      return []
    })
  const direction = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x)
  const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))
  // The turns between consecutive steps of a run, and — for a closed run —
  // the turn across its seam.
  const turns = (run: { points: Point[]; closed: boolean }) => {
    const steps = run.points.slice(1).map((p, i) => direction(run.points[i], p)).filter((_, i) => near(run.points[i], run.points[i + 1]) > 1e-6)
    const along: number[] = []
    for (let i = 1; i < steps.length; i++) along.push(turn(steps[i - 1], steps[i]))
    const seam = run.closed && steps.length > 1 ? turn(steps[steps.length - 1], steps[0]) : 0
    return { along, seam }
  }
  const sharpest = (run: { points: Point[]; closed: boolean }) => {
    const { along, seam } = turns(run)
    return Math.max(seam, ...along)
  }

  for (const type of LINE_TYPES) {
    it(`${type} closes a circle and an ellipse exactly and smoothly at looseness 0`, () => {
      for (const chain of [CIRCLE, ELLIPSE]) {
        const out = draw(type, chain)
        // No ends at all: no blots, no caps, every whole stroke closed.
        if (type !== 'chalk') expect(out.filter((p) => p.kind === 'dots'), type).toEqual([])
        for (const p of out) {
          if (p.kind === 'shape') expect(p.outline.length, `${type}: a closed ribbon has no end caps`).toBe(2 * p.spine.length)
        }
        const closedRuns = runs(out).filter((r) => r.closed)
        if (type !== 'chalk') expect(closedRuns.length, type).toBeGreaterThan(0)
        for (const run of closedRuns) {
          // The seam turns no more sharply than the curve does anywhere else.
          const { along, seam } = turns(run)
          expect(seam, `${type}: the seam is no corner`).toBeLessThanOrEqual(1.25 * Math.max(...along) + 0.01)
        }
        if (chain === CIRCLE) for (const run of runs(out)) expect(sharpest(run), `${type}: no corner anywhere on a circle`).toBeLessThan(0.12)
      }
    })

    it(`${type} closes a circle above looseness 0 by overlapping along the curve, not with a tick`, () => {
      const out = draw(type, CIRCLE, { looseness: 0.6, wobble: 0 })
      expect(out.filter((p) => p.kind === 'dots' && type !== 'chalk')).toEqual([])
      for (const run of runs(out)) expect(sharpest(run), type).toBeLessThan(0.2)
      if (type === 'technical' || type === 'chalk') return
      // The main run goes all the way round and on past its start.
      const main = runs(out)[0].points
      let swept = 0
      for (let i = 1; i < main.length; i++) {
        const a = Math.atan2(main[i - 1].y - 5, main[i - 1].x - 5)
        const b = Math.atan2(main[i].y - 5, main[i].x - 5)
        swept += Math.atan2(Math.sin(b - a), Math.cos(b - a))
      }
      expect(Math.abs(swept), type).toBeGreaterThan(2 * Math.PI)
      // The end comes back onto the start's own track (the circle, or a
      // pencil pass's concentric one), not beside it: an end set off the
      // track next to the start reads as a tick.
      const radius = (p: Point) => Math.hypot(p.x - 5, p.y - 5)
      expect(Math.abs(radius(main[main.length - 1]) - radius(main[0])), type).toBeLessThan(0.05)
      expect(Math.abs(radius(main[0]) - 60), type).toBeLessThan(0.3 * WIDTH)
    })
  }
})

// Re-review 1: with wobble, a loop's end still comes back onto the start's
// track above looseness 0. The wobble is pinned at a loop overlap's ends, so
// the gap is nothing but rounding.
describe('closing a wobbly loop', () => {
  for (const type of ['ink', 'brush', 'pencil', 'marker'] as const) {
    it(`${type} ends on its start's track`, () => {
      for (const identity of ['s1/k#0', 's2/k#0', 's3/O#0', 's4/rim#0']) {
        for (const looseness of [0.25, 0.6]) {
          const out = draw(type, CIRCLE, { looseness, wobble: 0.8 }, identity)
          const main = out[0]
          const points = main.kind === 'stroke' ? [main.start, ...main.pieces.map((p) => pointOn(p, 1))] : main.kind === 'shape' ? main.spine : []
          const radius = (p: Point) => Math.hypot(p.x - 5, p.y - 5)
          const gap = Math.abs(radius(points[points.length - 1]) - radius(points[0]))
          expect(gap, `${type} ${identity} at ${looseness}`).toBeLessThan(0.01 * WIDTH)
        }
      }
    })
  }
})

// Technical is clean's line (review 1): it keeps the caller's ends and dashes.
describe('the technical line', () => {
  it('keeps the cap it is given, and none when it is given none', () => {
    const capOf = (cap?: 'round' | 'butt' | 'square') => {
      const [out] = LINES.technical.draw({ chain: SEGMENT, width: WIDTH, settings: settingsFor('technical'), random: randomFor('t', 0), ...(cap ? { cap } : {}) })
      return out.kind === 'stroke' ? (out.cap ?? 'none') : 'not a stroke'
    }
    expect(capOf('round')).toBe('round')
    expect(capOf('square')).toBe('square')
    expect(capOf()).toBe('none')
  })

  it('dashes natively, as one stroke with the pattern', () => {
    expect(LINES.technical.nativeDash).toBe(true)
    const out = LINES.technical.draw({ chain: SEGMENT, width: WIDTH, settings: settingsFor('technical'), random: randomFor('t', 0), dash: [9, 7] })
    expect(out).toHaveLength(1)
    expect(out[0].kind === 'stroke' && out[0].dash).toEqual([9, 7])
  })

  it('closes a loop with the path itself', () => {
    const out = LINES.technical.draw({ chain: CIRCLE, width: WIDTH, settings: settingsFor('technical'), random: randomFor('t', 0) })
    expect(out[0].kind === 'stroke' && out[0].closed).toBe(true)
  })
})

// A medium's opacity is a line type's STROKE STRENGTH: it replaces the line type's own factor (a pencil
// pass 0.8 to 0.95, a marker's 0.82, chalk's 0.85) rather than multiplying it, and `settings.opacity` still
// multiplies on top. Without one, every line type draws exactly as it did.
describe('a medium’s strength', () => {
  const FACTOR: Record<LineType, number> = { technical: 1, ink: 1, brush: 1, pencil: Number.NaN, marker: 0.82, chalk: 0.85 }
  const withStrength = (type: LineType, strength: number | undefined, overrides: Partial<LineSettings> = {}) =>
    LINES[type].draw({ chain: ARC, width: WIDTH, settings: settingsFor(type, overrides), random: randomFor('s1/AB/0', 0), ...(strength === undefined ? {} : { strength }) })
  const main = (out: Primitive[]) => out.filter((p) => p.kind !== 'dots')
  const opacities = (out: Primitive[]) => main(out).map((p) => p.opacity)

  for (const type of LINE_TYPES) {
    it(`${type}: every stroke is drawn at the strength, times the line's own opacity, and no other factor`, () => {
      for (const strength of [0.5, 0.85, 1]) {
        for (const opacity of [1, 0.6]) {
          for (const value of opacities(withStrength(type, strength, { opacity }))) expect(value, `${type} ${strength} x ${opacity}`).toBeCloseTo(strength * opacity, 12)
        }
      }
    })

    it(`${type}: draws exactly as before when it is given no strength, and keeps its own factor`, () => {
      expect(withStrength(type, undefined)).toEqual(draw(type, ARC))
      if (type !== 'pencil') for (const value of opacities(withStrength(type, undefined))) expect(value, type).toBeCloseTo(0.9 * FACTOR[type], 12)
    })

    it(`${type}: lies where it lay, whatever the strength: only the opacity moves`, () => {
      const without = withStrength(type, undefined)
      const faint = withStrength(type, 0.4)
      expect(faint.map((p) => ({ ...p, opacity: 0 }))).toEqual(without.map((p) => ({ ...p, opacity: 0 })))
    })
  }

  it('pencil: every pass is the strength, where its own passes vary between 0.8 and 0.95', () => {
    const own = opacities(withStrength('pencil', undefined)).map((value) => value / 0.9)
    expect(own).toHaveLength(3)
    for (const value of own) {
      expect(value).toBeGreaterThanOrEqual(0.8 - 1e-9)
      expect(value).toBeLessThanOrEqual(0.95 + 1e-9)
    }
    expect(new Set(own).size).toBeGreaterThan(1)
    expect(new Set(opacities(withStrength('pencil', 0.85))).size).toBe(1)
  })

  it('chalk and marker keep their secondary marks at the same share of the strength as of their own factor', () => {
    const dust = (out: Primitive[]) => out.find((p) => p.kind === 'dots')!.opacity
    // Chalk's dust is 0.7 against its run's 0.85; a marker's pooled ends 0.3 against its line's 0.82.
    expect(dust(withStrength('chalk', undefined))).toBeCloseTo(0.9 * 0.7, 12)
    expect(dust(withStrength('chalk', 0.9))).toBeCloseTo(0.9 * 0.9 * (0.7 / 0.85), 12)
    expect(dust(withStrength('marker', undefined))).toBeCloseTo(0.9 * 0.3, 12)
    expect(dust(withStrength('marker', 0.9))).toBeCloseTo(0.9 * 0.9 * (0.3 / 0.82), 12)
    // A medium laid at the line type's own factor changes nothing at all.
    expect(dust(withStrength('chalk', 0.85))).toBeCloseTo(dust(withStrength('chalk', undefined)), 12)
    expect(dust(withStrength('marker', 0.82))).toBeCloseTo(dust(withStrength('marker', undefined)), 12)
  })
})
