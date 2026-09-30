import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { pointOn, polylineChain, type Chain } from '../path'
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

// Every point the output puts on the page's centre lines: a stroke's start and
// each piece's end (and, for an exact arc, points along it), a shape's spine,
// a dot's centre.
function points(primitives: readonly Primitive[]): Point[] {
  const out: Point[] = []
  for (const p of primitives) {
    if (p.kind === 'stroke') {
      out.push(p.start)
      for (const piece of p.pieces) {
        if (piece.kind === 'arc' || piece.kind === 'ellipticalArc') for (let i = 1; i <= 8; i++) out.push(pointOn(piece, i / 8))
        else out.push(piece.to)
      }
    } else if (p.kind === 'shape') out.push(...p.spine)
    else out.push(...p.dots.map((d) => d.at))
  }
  return out
}

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
