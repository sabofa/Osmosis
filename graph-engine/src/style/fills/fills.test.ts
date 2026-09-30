import { describe, expect, it } from 'vitest'
import { randomFor } from '../random'
import { pointOn, polylineChain, type Chain } from '../path'
import { FILL_TYPES, type FillSettings, type FillType } from '../tokens'
import { FILLS } from './index'
import { insideRegion, MARK_BUDGET, regionPolygons } from './region'
import type { FillMark } from './types'

// The seven fills, held to their rules: marks inside the region (the hole of
// an annulus included), hatching at its angle and spacing, determinism.

const SQUARE: Chain[] = [polylineChain([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }], true)]
const circle = (r: number, clockwise: boolean): Chain => ({
  pieces: [{ kind: 'arc', center: { x: 100, y: 100 }, radius: r, start: 0, end: clockwise ? -2 * Math.PI : 2 * Math.PI }],
  closed: true,
})
// An annulus: outer radius 90, a hole of radius 45.
const ANNULUS: Chain[] = [circle(90, false), circle(45, true)]

const settingsFor = (type: FillType, overrides: Partial<FillSettings> = {}): FillSettings => ({ type, angle: 30, spacing: 10, opacity: 0.5, ...overrides })

const fill = (type: FillType, outline: Chain[], overrides: Partial<FillSettings> = {}, identity = 's1/R') =>
  FILLS[type].draw({ outline, settings: settingsFor(type, overrides), random: randomFor(identity, 0) }).marks

// Where a fill puts ink: its line pieces' midpoints and its dots' centres.
function inkPoints(marks: readonly FillMark[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const mark of marks) {
    if (mark.kind === 'lines') for (const chain of mark.chains) for (const piece of chain.pieces) out.push(pointOn(piece, 0.5))
    if (mark.kind === 'dots') out.push(...mark.dots.map((d) => d.at))
  }
  return out
}

describe('every fill', () => {
  for (const type of FILL_TYPES) {
    describe(type, () => {
      it('is deterministic', () => {
        expect(fill(type, SQUARE)).toEqual(fill(type, SQUARE))
        expect(fill(type, ANNULUS)).toEqual(fill(type, ANNULUS))
      })

      it('puts its marks inside the region, and none in the annulus’s hole', () => {
        const polygons = regionPolygons(ANNULUS)
        for (const p of inkPoints(fill(type, ANNULUS))) {
          const r = Math.hypot(p.x - 100, p.y - 100)
          expect(r, `${type} at ${p.x},${p.y}`).toBeLessThanOrEqual(90 + 1e-6)
          expect(r, `${type} at ${p.x},${p.y}`).toBeGreaterThanOrEqual(45 - 1e-6)
          expect(insideRegion(p, polygons) || Math.abs(r - 45) < 1e-6 || Math.abs(r - 90) < 1e-6).toBe(true)
        }
      })

      it('writes only finite numbers', () => {
        expect(JSON.stringify(fill(type, ANNULUS))).not.toMatch(/null|NaN|Infinity/)
      })
    })
  }

  it('none draws nothing, and flat is the region itself', () => {
    expect(fill('none', SQUARE)).toEqual([])
    expect(fill('flat', SQUARE)).toEqual([{ kind: 'area' }])
  })

  it('stipple is dots, scribble is one zig-zag stroke per run, wash is a textured area with a darker edge', () => {
    expect(fill('stipple', SQUARE).map((m) => m.kind)).toEqual(['dots'])
    const scribble = fill('scribble', SQUARE)
    expect(scribble.map((m) => m.kind)).toEqual(['lines'])
    // A square is one run: one long stroke going back and forth.
    if (scribble[0].kind === 'lines') {
      expect(scribble[0].chains).toHaveLength(1)
      expect(scribble[0].chains[0].pieces.length).toBeGreaterThan(20)
    }
    expect(fill('wash', SQUARE)).toEqual([{ kind: 'area', texture: 'wash' }, expect.objectContaining({ kind: 'edge' })])
  })

  it('draws a different stipple for a different identity', () => {
    expect(fill('stipple', SQUARE, {}, 's1/R')).not.toEqual(fill('stipple', SQUARE, {}, 's2/R'))
  })
})

// The direction of a straight hatch line, in degrees anticlockwise from the
// page's horizontal (y points down on the page), folded into [0, 180).
function directionOf(chain: Chain): number {
  const piece = chain.pieces[0]
  if (piece.kind !== 'line') throw new Error('hatch lines are straight')
  const degrees = (Math.atan2(-(piece.to.y - piece.from.y), piece.to.x - piece.from.x) * 180) / Math.PI
  return ((degrees % 180) + 180) % 180
}

// Signed distance of a line's midpoint across the hatch direction.
function offsetOf(chain: Chain, angle: number): number {
  const m = pointOn(chain.pieces[0], 0.5)
  const theta = (angle * Math.PI) / 180
  return m.x * Math.sin(theta) + m.y * Math.cos(theta)
}

describe('hatching', () => {
  for (const angle of [0, 30, 45, 90, 135]) {
    it(`follows angle ${angle} and spacing 10`, () => {
      const marks = fill('hatch', SQUARE, { angle, spacing: 10 })
      expect(marks.map((m) => m.kind)).toEqual(['lines'])
      const chains = marks[0].kind === 'lines' ? marks[0].chains : []
      expect(chains.length).toBeGreaterThan(10)
      for (const chain of chains) expect(Math.min(Math.abs(directionOf(chain) - angle), 180 - Math.abs(directionOf(chain) - angle))).toBeLessThan(1e-6)
      const offsets = [...new Set(chains.map((c) => Math.round(offsetOf(c, angle) * 1e6) / 1e6))].sort((a, b) => a - b)
      for (let i = 1; i < offsets.length; i++) expect(offsets[i] - offsets[i - 1]).toBeCloseTo(10, 6)
    })
  }

  it('cross-hatch is two families, a quarter turn apart', () => {
    const marks = fill('crosshatch', SQUARE, { angle: 30 })
    const directions = new Set(marks.flatMap((m) => (m.kind === 'lines' ? m.chains.map((c) => Math.round(directionOf(c))) : [])))
    expect([...directions].sort((a, b) => a - b)).toEqual([30, 120])
  })

  it('spaces stipple dots by `spacing`', () => {
    const sparse = fill('stipple', SQUARE, { spacing: 20 })
    const dense = fill('stipple', SQUARE, { spacing: 10 })
    const count = (marks: FillMark[]) => (marks[0].kind === 'dots' ? marks[0].dots.length : 0)
    expect(count(dense) / count(sparse)).toBeGreaterThan(3)
    expect(count(dense) / count(sparse)).toBeLessThan(5)
  })
})

// The mark budget (review 1): a region may hold at most MARK_BUDGET of
// shading, whatever spacing is asked for; past it the spacing opens out.
describe('the mark budget', () => {
  const BIG: Chain[] = [polylineChain([{ x: 0, y: 0 }, { x: 640, y: 0 }, { x: 640, y: 640 }, { x: 0, y: 640 }, { x: 0, y: 0 }], true)]
  const length = (marks: FillMark[]) =>
    marks.reduce((sum, m) => sum + (m.kind === 'lines' ? m.chains.reduce((s, c) => s + c.pieces.reduce((t, p) => t + Math.hypot(pointOn(p, 1).x - pointOn(p, 0).x, pointOn(p, 1).y - pointOn(p, 0).y), 0), 0) : 0), 0)

  it('opens a hatch out to the budget, and no further', () => {
    for (const type of ['hatch', 'crosshatch', 'scribble'] as const) {
      const total = length(fill(type, BIG, { spacing: 3 }))
      expect(total, type).toBeLessThanOrEqual(MARK_BUDGET.length * 1.02)
      expect(total, type).toBeGreaterThan(MARK_BUDGET.length * 0.8)
    }
  })

  it('leaves a region inside the budget at its own spacing', () => {
    // 200 x 200 at spacing 10 is twenty lines, 4000 units: untouched.
    expect(length(fill('hatch', SQUARE, { spacing: 10, angle: 0 }))).toBeCloseTo(200 * 20, 6)
  })

  it('caps stipple dots', () => {
    const marks = fill('stipple', BIG, { spacing: 3 })
    const dots = marks[0].kind === 'dots' ? marks[0].dots.length : 0
    expect(dots).toBeLessThanOrEqual(MARK_BUDGET.dots * 1.1)
    expect(dots).toBeGreaterThan(MARK_BUDGET.dots * 0.7)
  })
})
