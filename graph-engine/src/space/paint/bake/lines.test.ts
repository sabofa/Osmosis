import { describe, expect, it, vi } from 'vitest'
import { oklabToLinear } from '../model/colour'
import { curveFor, groundLocal, recipeEnv } from '../model/index'
import { LINE_MAX_PX, lineRecipeOf } from '../model/lines'
import { hash3 } from '../model/math'
import { LoadMixer } from '../model/mix'
import { colourOfRecipe } from '../model/recipe'
import { arrowMark, flatColours, lineMark, pointMark, quadMesh, sceneOf, sphereMesh } from '../model/testing'
import { setParam } from '../params'
import type { BoxMark } from '../../scene/types'
import type { Oklab } from '../types'
import { LAYER_ORDER, ROLES } from '../types'
import { CHAIN_BREAK, NO_PARTICLE, preMixLab } from './draft'
import { bakePainting, bakeStats, bakedRecipes, recolourBake } from './index'
import { dashed, dataColourOf, finiteRuns, splitCorners, splitLength } from './lines'
import { BAKE_MIX_LEVELS, BAKE_PATH_POINTS, HIDDEN_DASHED, HIDDEN_NONE, SIZING_FIXED } from './types'
import { FRONT, fixture, P, PX, type Fixture } from './bakeFixture'

// Whole bakes are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 120_000 })

const LINE = ROLES.indexOf('line')
const RP = P.roles.line
const MAX_LEN = Math.min(Math.max(8, RP.length), LINE_MAX_PX) * PX
const UMBER: Oklab = [0.4, 0.04, 0.035]
const boxMark = (lo: number[], hi: number[], opts: { index?: number; edges?: boolean } = {}): BoxMark => ({
  kind: 'boxes',
  source: lineMark([[0, 0, 0], [1, 1, 1]], { index: opts.index ?? 0 }).source,
  mins: new Float64Array(lo),
  maxs: new Float64Array(hi),
  style: { color: { author: null, slot: 4 }, opacity: 0.1, edges: opts.edges ?? true },
})
const data = (marks: Parameters<typeof sceneOf>[0], colours: Record<number, Oklab> = {}, authored = FRONT): Fixture => fixture(sceneOf(marks), flatColours(colours), P, undefined, authored)

// The strokes of a mark, in painting order.
const strokesOf = (f: Fixture, mark: number): number[] => {
  const out: number[] = []
  for (let i = 0; i < f.baked.count; i++) if (f.baked.mark[i] === mark) out.push(i)
  return out
}
const pt = (f: Fixture, i: number, q: number): [number, number, number] => {
  const o = 3 * (BAKE_PATH_POINTS * i + q)
  return [f.baked.worldPath[o], f.baked.worldPath[o + 1], f.baked.worldPath[o + 2]]
}
const dist = (a: ArrayLike<number>, b: ArrayLike<number>): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
// The distance of a point from the segment a-b.
function toSegment(p: ArrayLike<number>, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2]
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0
  return Math.hypot(p[0] - a[0] - t * ab[0], p[1] - a[1] - t * ab[1], p[2] - a[2] - t * ab[2])
}

describe('the data marks’ strokes: a line cut into pieces in the world', () => {
  // a straight line along x, 3 world units (450 px at 150 px a unit)
  const f = data([lineMark([[-1.5, 0, 0], [1.5, 0, 0]], { index: 0 })], { 0: UMBER })
  const strokes = strokesOf(f, 0)
  const byX = [...strokes].sort((a, b) => pt(f, a, 0)[0] - pt(f, b, 0)[0])

  it('is cut into equal pieces of at most LINE_MAX_PX px (at the reference scale), each with 16 points at equal arc length exactly on the line, the pieces meeting end to end', () => {
    const n = Math.ceil(450 / LINE_MAX_PX - 1e-9)
    expect(n).toBeGreaterThan(10)
    expect(strokes.length).toBe(n)
    expect(bakeStats(f.baked)!.dataStrokes.strokes).toBe(n)
    expect(bakeStats(f.baked)!.dataStrokes.lines).toBe(n)
    for (const i of strokes) {
      expect(f.baked.pathLength[i]).toBeLessThanOrEqual(MAX_LEN + 1e-6)
      expect(f.baked.pathLength[i]).toBeCloseTo(3 / n, 5)
      const chords: number[] = []
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const p = pt(f, i, q)
        expect(Math.abs(p[1])).toBeLessThan(1e-7)
        expect(Math.abs(p[2])).toBeLessThan(1e-7)
        if (q > 0) chords.push(dist(p, pt(f, i, q - 1)))
      }
      expect(Math.max(...chords) - Math.min(...chords)).toBeLessThan(1e-6)
    }
    expect(pt(f, byX[0], 0)[0]).toBeCloseTo(-1.5, 6)
    expect(pt(f, byX[n - 1], BAKE_PATH_POINTS - 1)[0]).toBeCloseTo(1.5, 6)
    for (let k = 0; k + 1 < n; k++) expect(dist(pt(f, byX[k], BAKE_PATH_POINTS - 1), pt(f, byX[k + 1], 0))).toBeLessThan(1e-6)
  })

  it('scales with the reference world per px: the same line at twice the world size of a px is half as many px long, so half as many pieces, each twice the world length', () => {
    const g = data([lineMark([[-1.5, 0, 0], [1.5, 0, 0]], { index: 0 })], { 0: UMBER }, { ...FRONT, worldPerPx: 2 * PX })
    const m = strokesOf(g, 0)
    expect(m.length).toBe(Math.ceil(225 / LINE_MAX_PX - 1e-9))
    for (const i of m) expect(g.baked.pathLength[i]).toBeLessThanOrEqual(LINE_MAX_PX * 2 * PX + 1e-6)
    expect(g.baked.referenceWorldPerPx).toBeCloseTo(2 * PX, 9)
  })

  it('gives each stroke the fields of a data line: the line role and layer, fixed size, side 0, no particle, rank 0, no edge class, a constant width, an alpha of 1, no surface normal', () => {
    const { baked } = f
    for (const i of strokes) {
      expect(baked.role[i]).toBe(LINE)
      expect(baked.layer[i]).toBe(LAYER_ORDER.indexOf('line'))
      expect(baked.sizing[i]).toBe(SIZING_FIXED)
      expect(baked.side[i]).toBe(0)
      expect(baked.particle[i]).toBe(NO_PARTICLE)
      expect(baked.rank[i]).toBe(0)
      expect(baked.edge[i]).toBe(255)
      expect(baked.handStart[i]).toBe(0)
      expect(baked.alpha[i]).toBe(1)
      expect(baked.endSoft[i]).toBe(0)
      // the style's width 2 → the role's width × 1
      expect(baked.basePx[2 * i + 1]).toBeCloseTo(RP.width, 6)
      expect(baked.basePx[2 * i]).toBeCloseTo(baked.pathLength[i] / PX, 3)
      expect(baked.load[i]).toBeCloseTo(RP.load, 6)
      expect(baked.impasto[i]).toBeCloseTo(RP.impasto, 6)
      expect(baked.bristles[i]).toBeCloseTo(RP.bristles, 6)
      expect(baked.dry[i]).toBeCloseTo(RP.dry, 6)
      for (let q = 0; q < BAKE_PATH_POINTS; q++) {
        const o = 3 * (BAKE_PATH_POINTS * i + q)
        expect([baked.worldNormal[o], baked.worldNormal[o + 1], baked.worldNormal[o + 2]]).toEqual([0, 0, 0])
      }
    }
    // the layer is the line's own whatever lies over it: a flat veil above does not move it (a frame moves a line seen through one)
    const veiled = data([lineMark([[-0.5, 0, 0], [0.5, 0, 0]], { index: 0 }), quadMesh({ origin: [-1, -1, 0.5], e1: [2, 0, 0], e2: [0, 2, 0], n: 4, opacity: 0.5, index: 1 })], { 0: UMBER, 1: [0.6, 0.05, 0.05] })
    for (const i of strokesOf(veiled, 0)) expect(veiled.baked.layer[i]).toBe(LAYER_ORDER.indexOf('line'))
  })

  it('takes a width from the style: the role’s width × the style’s over 2, held between a half and three times', () => {
    for (const [w, k] of [[0.5, 0.5], [2, 1], [3, 1.5], [6, 3], [30, 3]] as const) {
      const g = data([lineMark([[0, 0, 0], [0.3, 0, 0]], { index: 0, width: w })], { 0: UMBER })
      for (const i of strokesOf(g, 0)) expect(g.baked.basePx[2 * i + 1]).toBeCloseTo(RP.width * k, 5)
    }
  })

  it('leaves a short line one piece and a line too short to see (under 0.05 px) none', () => {
    const g = data([lineMark([[0, 0, 0], [10 * PX, 0, 0]], { index: 0 }), lineMark([[0, 1, 0], [0.01 * PX, 1, 0]], { index: 1 })], { 0: UMBER, 1: UMBER })
    expect(strokesOf(g, 0).length).toBe(1)
    expect(strokesOf(g, 1).length).toBe(0)
  })
})

describe('the data marks’ strokes: corners, dashes and the hidden style', () => {
  it('cuts a polyline at a corner over 30° of turn in the world, exactly at the corner, and not at a gentler bend', () => {
    // an L: 150 px along x, then 150 px along y (a 90° turn)
    const L = data([lineMark([[-1, 0, 0], [0, 0, 0], [0, 1, 0]], { index: 0 })], { 0: UMBER })
    const pieces = strokesOf(L, 0)
    expect(pieces.length).toBe(2 * Math.ceil(150 / LINE_MAX_PX - 1e-9))
    let acrossTheCorner = 0
    let atCorner = 0
    for (const i of pieces) {
      const a = pt(L, i, 0)
      const b = pt(L, i, BAKE_PATH_POINTS - 1)
      // each piece is on one arm
      const onX = [...Array(BAKE_PATH_POINTS).keys()].every((q) => Math.abs(pt(L, i, q)[1]) < 1e-6 && pt(L, i, q)[0] <= 1e-6)
      const onY = [...Array(BAKE_PATH_POINTS).keys()].every((q) => Math.abs(pt(L, i, q)[0]) < 1e-6 && pt(L, i, q)[1] >= -1e-6)
      if (!onX && !onY) acrossTheCorner++
      if (dist(a, [0, 0, 0]) < 1e-6 || dist(b, [0, 0, 0]) < 1e-6) atCorner++
    }
    expect(acrossTheCorner).toBe(0)
    // the corner is the end of one piece and the start of the next
    expect(atCorner).toBe(2)
    // a 20° bend is not a corner: one piece (a short polyline) takes it; a 35° one is
    const bend = (deg: number) => {
      const a = (deg * Math.PI) / 180
      return data([lineMark([[-0.05, 0, 0], [0, 0, 0], [0.05 * Math.cos(a), 0.05 * Math.sin(a), 0]], { index: 0 })], { 0: UMBER })
    }
    expect(strokesOf(bend(20), 0).length).toBe(1)
    expect(strokesOf(bend(35), 0).length).toBe(2)
    // (a turn the other way round, over the 3D: out of the plane)
    const up = data([lineMark([[-0.05, 0, 0], [0, 0, 0], [0.05 * Math.cos(1), 0, 0.05 * Math.sin(1)]], { index: 0 })], { 0: UMBER })
    expect(strokesOf(up, 0).length).toBe(2)
  })

  it('applies the style’s dash pattern in px at the reference scale, restarting at the polyline’s start: on 10 px, off 6 px along 160 px makes dashes that start every 16 px', () => {
    const g = data([lineMark([[0, 0, 0], [160 * PX, 0, 0]], { index: 0, dash: [10, 6] })], { 0: UMBER })
    const dashes = strokesOf(g, 0).sort((a, b) => pt(g, a, 0)[0] - pt(g, b, 0)[0])
    expect(dashes.length).toBe(10)
    dashes.forEach((i, k) => {
      expect(pt(g, i, 0)[0] / PX).toBeCloseTo(16 * k, 3)
      expect(g.baked.pathLength[i] / PX).toBeCloseTo(10, 3)
    })
    // another scale: the same pattern in px is another world length
    const h = data([lineMark([[0, 0, 0], [320 * PX, 0, 0]], { index: 0, dash: [10, 6] })], { 0: UMBER }, { ...FRONT, worldPerPx: 2 * PX })
    const d2 = strokesOf(h, 0).sort((a, b) => pt(h, a, 0)[0] - pt(h, b, 0)[0])
    expect(d2.length).toBe(10)
    d2.forEach((i, k) => expect(pt(h, i, 0)[0]).toBeCloseTo(32 * PX * k, 6))
    // a pattern of zeros is no dashing
    expect(strokesOf(data([lineMark([[0, 0, 0], [160 * PX, 0, 0]], { index: 0, dash: [0, 0] })], { 0: UMBER }), 0).length).toBe(Math.ceil(160 / LINE_MAX_PX - 1e-9))
  })

  it('has no hidden test: HIDDEN_DASHED for a mark whose style says dashed, HIDDEN_NONE otherwise, an arrow’s by its style, a box’s always none, the alpha the visible one (never halved)', () => {
    const f = data(
      [
        lineMark([[0, 0, 0], [0.5, 0, 0]], { index: 0, hidden: 'dashed' }),
        lineMark([[0, 1, 0], [0.5, 1, 0]], { index: 1, hidden: 'none' }),
        arrowMark([0, 2, 0], [0.5, 0, 0], { index: 2, hidden: 'dashed' }),
        arrowMark([0, 3, 0], [0.5, 0, 0], { index: 3, hidden: 'none' }),
        boxMark([0, 4, 0], [0.5, 4.5, 0.5], { index: 4 }),
      ],
      { 0: UMBER, 1: UMBER, 2: UMBER, 3: UMBER, 4: UMBER },
    )
    const dashed = [0, 2].flatMap((m) => strokesOf(f, m))
    const none = [1, 3, 4].flatMap((m) => strokesOf(f, m))
    expect(dashed.length).toBeGreaterThan(5)
    expect(none.length).toBeGreaterThan(20)
    for (const i of dashed) expect(f.baked.hidden[i]).toBe(HIDDEN_DASHED)
    for (const i of none) expect(f.baked.hidden[i]).toBe(HIDDEN_NONE)
    for (const i of [...dashed, ...none]) expect(f.baked.alpha[i]).toBe(1)
    expect(bakeStats(f.baked)!.dataStrokes.hiddenDashed).toBe(dashed.length)
  })
})

describe('the data marks’ strokes: arrows and boxes', () => {
  it('bakes an arrow’s shaft as a line from its tail to its tip (the head is the frame’s: no stroke for it), every point on the segment', () => {
    const f = data([arrowMark([0, 0, 0], [1, 0, 1], { index: 0 })], { 0: UMBER })
    const strokes = strokesOf(f, 0)
    const len = Math.SQRT2
    expect(strokes.length).toBe(Math.ceil(len / PX / LINE_MAX_PX - 1e-9))
    expect(bakeStats(f.baked)!.dataStrokes.arrows).toBe(strokes.length)
    for (const i of strokes) {
      for (let q = 0; q < BAKE_PATH_POINTS; q++) expect(toSegment(pt(f, i, q), [0, 0, 0], [1, 0, 1])).toBeLessThan(1e-6)
      // the shaft's width, not the head's
      expect(f.baked.basePx[2 * i + 1]).toBeCloseTo(RP.width * 1, 6)
    }
    const all = strokes.flatMap((i) => [pt(f, i, 0), pt(f, i, BAKE_PATH_POINTS - 1)])
    expect(Math.min(...all.map((p) => dist(p, [0, 0, 0])))).toBeLessThan(1e-6)
    expect(Math.min(...all.map((p) => dist(p, [1, 0, 1])))).toBeLessThan(1e-6)
    // a zero vector is no shaft
    expect(strokesOf(data([arrowMark([0, 0, 0], [0, 0, 0], { index: 0 })], { 0: UMBER }), 0).length).toBe(0)
  })

  it('bakes the 12 edges of a box with edges, each along the box edge it is, and none for a box without edges, a flat one or a point', () => {
    const f = data([boxMark([0, 0, 0], [1, 2, 1], { index: 0 })], { 0: UMBER })
    const strokes = strokesOf(f, 0)
    // the edges: 4 of each length 1, 2 (x, y, z: 1, 2, 1) in px / maxLen
    const expected = 4 * Math.ceil(150 / LINE_MAX_PX - 1e-9) * 2 + 4 * Math.ceil(300 / LINE_MAX_PX - 1e-9)
    expect(strokes.length).toBe(expected)
    expect(bakeStats(f.baked)!.dataStrokes.boxes).toBe(expected)
    const onEdge = (p: ArrayLike<number>): boolean => {
      // a point of a box's edge has two of its coordinates at the box's bounds
      const at = [0, 1, 2].filter((c) => Math.abs(p[c] - 0) < 1e-6 || Math.abs(p[c] - [1, 2, 1][c]) < 1e-6).length
      return at >= 2
    }
    const covered = new Set<string>()
    for (const i of strokes) {
      for (let q = 0; q < BAKE_PATH_POINTS; q++) expect(onEdge(pt(f, i, q))).toBe(true)
      const a = pt(f, i, 0)
      const b = pt(f, i, BAKE_PATH_POINTS - 1)
      // one axis moves along a stroke
      const moved = [0, 1, 2].filter((c) => Math.abs(a[c] - b[c]) > 1e-6)
      expect(moved.length).toBe(1)
      covered.add(`${[0, 1, 2].filter((c) => c !== moved[0]).map((c) => (Math.abs(a[c]) < 1e-6 ? 0 : 1)).join('')}${moved[0]}`)
      expect(f.baked.basePx[2 * i + 1]).toBeCloseTo(RP.width, 6)
    }
    expect(covered.size).toBe(12)
    expect(strokesOf(data([boxMark([0, 0, 0], [1, 1, 1], { index: 0, edges: false })], { 0: UMBER }), 0).length).toBe(0)
    expect(strokesOf(data([boxMark([0, 0, 0], [0, 0, 0], { index: 0 })], { 0: UMBER }), 0).length).toBe(0)
  })

  it('bakes no stroke for a point (a short dab the frame builds on the screen), but gives it its colour', () => {
    const f = data([pointMark([[0, 0, 0], [1, 1, 1]], { index: 0 })], { 0: [0.5, 0.1, 0.05] })
    expect(f.baked.count).toBe(0)
    expect([...f.baked.dataColour].every((v) => Number.isFinite(v) && v > 0)).toBe(true)
  })

  it('cuts a line at a vertex that is not finite (a curve that left its domain), each part its own polyline of pieces, and makes no non-finite number', () => {
    const f = data([lineMark([[0, 0, 0], [0.5, 0, 0], [Number.NaN, 0, 0], [1, 1, 0], [1.5, 1, 0]], { index: 0 })], { 0: UMBER })
    const strokes = strokesOf(f, 0)
    expect(strokes.length).toBe(2 * Math.ceil(75 / LINE_MAX_PX - 1e-9))
    expect(f.baked.worldPath.every((v) => Number.isFinite(v))).toBe(true)
    expect(f.baked.colour.every((v) => Number.isFinite(v))).toBe(true)
    // (the two parts count their pieces together: no two strokes of the polyline have a tag, so a seed, in common)
    expect(new Set(strokes.map((i) => f.baked.seed[i])).size).toBe(strokes.length)
    expect(finiteRuns([0, 0, 0, 1, 0, 0, Number.NaN, 0, 0, 2, 0, 0]).length).toBe(1)
  })
})

describe('the data marks’ pieces, the world helpers on their own', () => {
  it('splits a polyline by length into equal parts, by dashes at the pattern’s offsets, and by corners at the vertex', () => {
    const p = [0, 0, 0, 10, 0, 0]
    const parts = splitLength(p, 3)
    expect(parts.length).toBe(4)
    parts.forEach((q, k) => {
      expect(q[0]).toBeCloseTo(2.5 * k, 9)
      expect(q[q.length - 3]).toBeCloseTo(2.5 * (k + 1), 9)
    })
    const d = dashed(p, [2, 3])
    expect(d.length).toBe(2)
    expect(d[1][0]).toBeCloseTo(5, 9)
    expect(d[1][d[1].length - 3]).toBeCloseTo(7, 9)
    expect(splitCorners([0, 0, 0, 1, 0, 0, 1, 1, 0], 1e-9).length).toBe(2)
    expect(splitCorners([0, 0, 0, 1, 0, 0, 2, 0.1, 0], 1e-9).length).toBe(1)
  })
})

describe('the data marks’ colours', () => {
  const MARKS = () => [
    lineMark([[-1, 0, 0], [1, 0, 0]], { index: 0 }),
    arrowMark([0, 1, 0], [1, 0, 0], { index: 1 }),
    boxMark([0, 2, 0], [0.5, 2.5, 0.5], { index: 2 }),
    pointMark([[0, 3, 0]], { index: 3 }),
    sphereMesh({ radius: 0.2, index: 4, nu: 8, nv: 6 }),
  ]
  const COLOURS: Record<number, Oklab> = { 0: [0.4, 0.04, 0.035], 1: [0.55, 0.1, -0.08], 2: [0.6, -0.08, 0.05], 3: [0.5, 0.12, 0.03], 4: [0.56, 0.1, 0.08] }
  const f = data(MARKS(), COLOURS)
  const env = (params = P) => recipeEnv(params, curveFor(params), groundLocal(params))
  // (the sphere has strokes of its own, which are not under test here)
  const lineStrokes = (g: Fixture): number[] => [0, 1, 2].flatMap((m) => strokesOf(g, m))

  it('fills dataColour for every mark that is not a mesh (the line recipe of its colour before the mix, no jitter, linear sRGB) and leaves a mesh’s zero', () => {
    const e = env()
    for (const m of [0, 1, 2, 3]) {
      const expected = Float32Array.from(oklabToLinear(colourOfRecipe(lineRecipeOf(COLOURS[m]), e)))
      expect([...f.baked.dataColour.slice(3 * m, 3 * m + 3)]).toEqual([...expected])
      expect(expected.every((v) => v >= 0 && v <= 1)).toBe(true)
      expect([...dataColourOf(COLOURS[m], e)].map(Math.fround)).toEqual([...expected])
    }
    expect([...f.baked.dataColour.slice(12, 15)]).toEqual([0, 0, 0])
    // (another colour, another dataColour)
    expect([...f.baked.dataColour.slice(0, 3)]).not.toEqual([...f.baked.dataColour.slice(3, 6)])
  })

  it('gives every line stroke the same colour at every level (the sequential mix), finite and displayable', () => {
    const { baked } = f
    expect(lineStrokes(f).length).toBeGreaterThan(30)
    for (const i of lineStrokes(f)) {
      const o = 3 * BAKE_MIX_LEVELS * i
      for (let l = 0; l < BAKE_MIX_LEVELS; l++) for (let c = 0; c < 3; c++) {
        expect(baked.colour[o + 3 * l + c]).toBe(baked.colour[o + c])
        expect(baked.colour[o + c]).toBeGreaterThanOrEqual(-1e-6)
        expect(baked.colour[o + c]).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })

  it('mixes the line strokes by the SEQUENTIAL mixer in the order they are made (polylines in the scene’s order): the model’s LoadMixer over the recipes gives the baked colour bit for bit, and a load breaks at the first stroke of a chain', () => {
    const rec = bakedRecipes(f.baked)!
    const r = rec.recipes
    const e = env()
    const mixer = new LoadMixer(P)
    const painted = new Map<number, number>()
    rec.perm.forEach((c, k) => painted.set(c, k))
    let axis = 0
    let n = 0
    let starts = 0
    for (let c = 0; c < r.count; c++) {
      if (r.mixRole[c] !== LINE) continue
      expect(r.sequential[c]).toBe(1)
      axis += r.mx[c]
      const out = mixer.mix({ role: 'line', cell: r.cells[BAKE_MIX_LEVELS * c], u: r.u[c], x: axis, y: 0, lab: preMixLab(r, c, e), colormapped: false, seed: r.seed[c], jit0: r.jit0[c], jit1: r.jit1[c] })
      if (out.index === 0) starts++
      const k = painted.get(c)!
      expect(Array.from(f.baked.colour.slice(3 * BAKE_MIX_LEVELS * k, 3 * BAKE_MIX_LEVELS * k + 3))).toEqual(Array.from(Float32Array.from(oklabToLinear(out.lab))))
      expect(r.fam[c]).toBe(-1)
      n++
    }
    expect(n).toBe(lineStrokes(f).length)
    // the first stroke of the chain starts a load (it is CHAIN_BREAK from nothing), and a load is 3 to 8 strokes
    expect(r.mx[[...Array(r.count).keys()].find((c) => r.mixRole[c] === LINE)!]).toBe(CHAIN_BREAK)
    expect(starts).toBeGreaterThanOrEqual(n / 8)
    expect(starts).toBeLessThan(n)
  })

  it('is made again by a recolour, dataColour included, bit for bit what a fresh bake gives, for the curve, the mix, and where the loads break; the geometry arrays are shared', () => {
    const wasData = (a: Float32Array) => [...a.slice(0, 12)]
    for (const next of [setParam(P, 'curve.warmHue', 20), setParam(P, 'mix.strength', 1.6), setParam(P, 'environment.absorption', 0.9), setParam(P, 'mix.loadBreakPx', 30)]) {
      const again = recolourBake(f.baked, next)!
      const fresh = bakePainting(f.scene, f.particles, f.colours, f.light, next, f.authored)
      expect(Buffer.compare(Buffer.from(again.colour.buffer), Buffer.from(fresh.colour.buffer))).toBe(0)
      expect(Buffer.compare(Buffer.from(again.dataColour.buffer), Buffer.from(fresh.dataColour.buffer))).toBe(0)
      expect(again.worldPath).toBe(f.baked.worldPath)
      expect(again.key).toBe(f.baked.key)
    }
    // (the curve does move the data colours; a load break does not)
    expect(wasData(recolourBake(f.baked, setParam(P, 'curve.warmHue', 20))!.dataColour)).not.toEqual(wasData(f.baked.dataColour))
    expect(wasData(recolourBake(f.baked, setParam(P, 'mix.loadBreakPx', 30))!.dataColour)).toEqual(wasData(f.baked.dataColour))
  })

  it('gives every stroke its own seed, and the same painting twice (the tag is the piece’s place along its polyline, not the order a bake met it in)', () => {
    const seeds = new Set<number>()
    for (const i of lineStrokes(f)) seeds.add(f.baked.seed[i])
    expect(seeds.size).toBeGreaterThanOrEqual(0.98 * lineStrokes(f).length)
    const again = bakePainting(f.scene, f.particles, f.colours, f.light, f.params, f.authored)
    expect(Buffer.compare(Buffer.from(again.seed.buffer), Buffer.from(f.baked.seed.buffer))).toBe(0)
    expect(Buffer.compare(Buffer.from(again.worldPath.buffer), Buffer.from(f.baked.worldPath.buffer))).toBe(0)
    expect(again.key).toBe(f.baked.key)
  })

  it('seeds a load by the position hash of the piece’s middle vertex (the model’s cell: the world point rounded to 1/7), so the loads along a line differ', () => {
    // a straight line: the pieces are 2-vertex, whose middle vertex is the end one
    const g = data([lineMark([[-1.5, 0, 0], [1.5, 0, 0]], { index: 0 })], { 0: UMBER })
    const rec = bakedRecipes(g.baked)!
    const n = strokesOf(g, 0).length
    const expected = new Set<number>()
    for (let k = 0; k < n; k++) expected.add(hash3(Math.round((-1.5 + (3 * (k + 1)) / n) * 7), 0, 0))
    const got = new Set<number>()
    for (let c = 0; c < rec.recipes.count; c++) got.add(rec.recipes.cells[BAKE_MIX_LEVELS * c])
    expect(got).toEqual(expected)
    expect(got.size).toBeGreaterThan(5)
  })

  it('does not hold the load break to a chain it does not belong to: strokes of two lines far apart start their own loads, ones near each other may share', () => {
    // two lines 3 units (450 px) apart, each of 5 pieces: far over the default load break (120 px)
    const g = data([lineMark([[0, 0, 0], [105 * PX, 0, 0]], { index: 0 }), lineMark([[0, 3, 0], [105 * PX, 3, 0]], { index: 1 })], { 0: UMBER, 1: UMBER })
    const r = bakedRecipes(g.baked)!.recipes
    const breaks = [...Array(r.count).keys()].filter((c) => r.mx[c] >= 120)
    expect(breaks.length).toBe(2)
    expect(r.mx[breaks[0]]).toBe(CHAIN_BREAK)
    // (the last piece of the first line's middle is at 94.5 px along it, the first of the second's at 10.5 px, 450 px over)
    expect(r.mx[breaks[1]]).toBeCloseTo(Math.hypot(84, 450), 1)
  })
})
