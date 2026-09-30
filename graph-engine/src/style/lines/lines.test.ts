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
// whether it varies its width, and its texture. Six types, six signatures.
function signature(type: LineType): string {
  const out = draw(type, SEGMENT, { looseness: 0.3 })
  const strokes = out.filter((p) => p.kind === 'stroke')
  const shapes = out.filter((p) => p.kind === 'shape')
  const dots = out.filter((p) => p.kind === 'dots')
  const curved = strokes.some((p) => p.kind === 'stroke' && p.pieces.some((piece) => piece.kind === 'cubic'))
  const texture = LINES[type].texture(settingsFor(type))?.name ?? 'none'
  return [`strokes:${strokes.length > 2 ? 'many' : strokes.length}`, `shapes:${shapes.length}`, `dots:${dots.length > 0}`, `curved:${curved}`, `texture:${texture}`].join(' ')
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

  it('ink varies its width (pressure) and bleeds at the ends', () => {
    const out = draw('ink', SEGMENT)
    const shape = out.find((p) => p.kind === 'shape')
    expect(shape).toBeDefined()
    expect(out.some((p) => p.kind === 'dots')).toBe(true)
    if (shape?.kind === 'shape') {
      const n = shape.spine.length
      const halfWidths = shape.spine.map((s, i) => near(s, shape.outline[i]))
      expect(Math.max(...halfWidths.slice(1, n - 1)) - Math.min(...halfWidths.slice(1, n - 1))).toBeGreaterThan(0.15 * WIDTH)
    }
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
