import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { buildScene } from '../../scene/buildScene'
import { chainPoints } from '../../scene/chains'
import type { Scene, SceneObject, Vec2 } from '../../scene/types'
import { anchorSkip, firstBridge } from './dense'

// Seeded random rationals against their analytic poles and holes (calc P2, the spec's property test: "seeded random polynomials and
// rationals against their analytic roots, poles and holes"). A rational is c N(x) / D(x) with N and D products of linear factors
// (x - r, r a whole number) and quadratic ones (x^2 - k, whose roots are +-sqrt k, which no double is exactly), a factor often in
// both so that it cancels. Each factor's net power (its power in N less its power in D) says what its roots are: a factor in D
// with a power in N at least as great is a HOLE at each root, the limit being the reduced rational there (0 if the factor is
// left with a power); a factor in D with the greater power is a POLE; a factor only in N is a plain zero, with no mark.
// Through buildScene, every analytic pole has a pole break, a guide and no chain across it; every hole an open ring at its limit;
// there is no other mark; every vertex is on the curve (at its own parameter, against the reduced rational computed here, not by
// the kernel); and no segment spans a jump or a pole of the true curve (testing/dense.ts).

// mulberry32: a seeded generator, so the cases are the same every run
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Factor {
  text: string
  roots: number[]
  at: (x: number) => number
}

// Roots at least 0.23 apart, 9 px at 40 px a unit, so no two trouble spots share a pixel
const FACTORS: Factor[] = [
  ...[-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((r): Factor => ({ text: r === 0 ? 'x' : `(x ${r < 0 ? '+' : '-'} ${Math.abs(r)})`, roots: [r], at: (x) => x - r })),
  ...[2, 3, 5, 7].map((k): Factor => ({ text: `(x^2 - ${k})`, roots: [-Math.sqrt(k), Math.sqrt(k)], at: (x) => x * x - k })),
]

interface Rational {
  spec: string
  // the reduced rational: c times each factor to its net power
  at: (x: number) => number
  holes: Vec2[]
  poles: number[]
}

function generate(seed: number): Rational | null {
  const rand = mulberry32(seed)
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]
  const num = new Map<number, number>()
  const den = new Map<number, number>()
  const add = (m: Map<number, number>, i: number) => m.set(i, (m.get(i) ?? 0) + (rand() < 0.25 ? 2 : 1))
  for (let k = Math.floor(rand() * 3); k >= 0; k--) add(num, Math.floor(rand() * FACTORS.length))
  for (let k = Math.floor(rand() * 3); k >= 0; k--) {
    const i = Math.floor(rand() * FACTORS.length)
    add(den, i)
    // most denominators have a numerator that shares a factor with them: a hole (or a weaker pole)
    if (rand() < 0.65) add(num, i)
  }
  const c = pick([1, 1, 2, -1, 0.5, -3])
  const net = new Map<number, number>()
  for (const i of new Set([...num.keys(), ...den.keys()])) net.set(i, (num.get(i) ?? 0) - (den.get(i) ?? 0))
  const power = (m: Map<number, number>) => [...m.entries()].map(([i, p]) => (p === 1 ? FACTORS[i].text : `${FACTORS[i].text}^${p}`)).join(' * ') || '1'
  const spec = `y = ${c} * ${power(num)} / (${power(den)})`
  const at = (x: number) => {
    let v = c
    for (const [i, n] of net) v *= FACTORS[i].at(x) ** n
    return v
  }
  const holes: Vec2[] = []
  const poles: number[] = []
  for (const [i, n] of net) {
    const d = den.get(i) ?? 0
    if (d === 0) continue
    for (const r of FACTORS[i].roots) {
      if (n < 0) {
        poles.push(r)
        continue
      }
      // a hole: the reduced rational at the root, with this factor's own power (0 if it has one left)
      let v = n > 0 ? 0 : c
      if (n === 0) for (const [j, m] of net) if (j !== i) v *= FACTORS[j].at(r) ** m
      holes.push({ x: r, y: v })
    }
  }
  // (a limit far out of the picture is no test of a ring, and the curve's own scale is the sampler's)
  if (holes.some((h) => !(Math.abs(h.y) <= 30))) return null
  return { spec, at, holes, poles: poles.sort((a, b) => a - b) }
}

const VIEW = { xMin: -8, xMax: 8, yMin: -20, yMax: 20 }
const WIDTH = 800
const HEIGHT = 800
const PX = { x: WIDTH / (VIEW.xMax - VIEW.xMin), y: HEIGHT / (VIEW.yMax - VIEW.yMin) }

type CurveObject = Extract<SceneObject, { kind: 'curve' }>
type MarkObject = Extract<SceneObject, { kind: 'mark' }>

function check(r: Rational, quality: 'full' | 'coarse') {
  const parsed = parseSpec(r.spec)
  expect(parsed.errors, r.spec).toEqual([])
  const scene: Scene = buildScene(parsed.statements, VIEW, parsed.config, undefined, parsed.statementLines, { widthPx: WIDTH, heightPx: HEIGHT, quality })
  expect(scene.errors, r.spec).toEqual([])
  const curve = scene.objects.find((o): o is CurveObject => o.kind === 'curve')!
  const marks = scene.objects.filter((o): o is MarkObject => o.kind === 'mark')
  const label = `${quality}: ${r.spec}`

  // every analytic pole has a pole break and a guide, and nothing else does
  const poles = curve.breaks.filter((b) => b.kind === 'pole').map((b) => b.at).sort((a, b) => a - b)
  expect(poles, `${label}: poles`).toHaveLength(r.poles.length)
  r.poles.forEach((p, k) => expect(Math.abs(poles[k] - p), `${label}: pole ${k} at ${poles[k]} for ${p}`).toBeLessThanOrEqual(1e-8))
  const guides = scene.objects.filter((o) => o.kind === 'line' && o.role === 'asymptote').map((o) => (o.kind === 'line' ? o.through.x : Number.NaN)).sort((a, b) => a - b)
  expect(guides, `${label}: guides`).toHaveLength(r.poles.length)
  // and no chain has vertices on both sides of one
  for (const chain of curve.chains) {
    const lo = Math.min(...chain.param)
    const hi = Math.max(...chain.param)
    for (const p of r.poles) expect(lo < p - 1e-9 && hi > p + 1e-9, `${label}: a chain from ${lo} to ${hi} crosses the pole at ${p}`).toBe(false)
  }

  // every hole has an open ring at its limit, and there is no other mark (a rational has no end, no jump, no value of its own)
  const rings = marks.filter((m) => m.role === 'hole').sort((a, b) => a.at.x - b.at.x)
  const want = [...r.holes].sort((a, b) => a.x - b.x)
  expect(rings, `${label}: holes ${rings.map((m) => `(${m.at.x}, ${m.at.y})`).join(' ')}`).toHaveLength(want.length)
  want.forEach((h, k) => {
    expect(Math.abs(rings[k].at.x - h.x), `${label}: ring ${k} at x = ${rings[k].at.x} for ${h.x}`).toBeLessThanOrEqual(1e-8)
    expect(Math.abs(rings[k].at.y - h.y), `${label}: ring ${k} at y = ${rings[k].at.y} for ${h.y}`).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(h.y)))
    expect(rings[k].fill, label).toBe('open')
  })
  expect(marks.filter((m) => m.role !== 'hole'), `${label}: marks that are not holes`).toEqual([])
  // a curve with holes is not broken at them
  expect(curve.breaks.filter((b) => b.kind !== 'pole'), `${label}: breaks that are not poles`).toEqual([])

  // every vertex is on the curve, at its own parameter, except where it is anchored at a spot or cut at the clip box
  const spots = [...r.poles, ...r.holes.map((h) => h.x)]
  const clipY = VIEW.yMax + 0.25 * (VIEW.yMax - VIEW.yMin)
  for (const chain of curve.chains) {
    const pts = chainPoints(chain)
    pts.forEach((p, i) => {
      const t = chain.param[i]
      if (spots.some((s) => Math.abs(t - s) < 1e-6) || Math.abs(Math.abs(p.y) - clipY) < 1e-9) return
      expect(Math.abs(r.at(t) - p.y) * PX.y, `${label}: the vertex at ${t} is ${p.y}, the curve is ${r.at(t)}`).toBeLessThanOrEqual(0.5)
    })
  }
  // and no segment spans a pole, a jump or an undefined stretch of the true curve
  const clip = { xMin: VIEW.xMin - 0.25 * (VIEW.xMax - VIEW.xMin), xMax: VIEW.xMax + 0.25 * (VIEW.xMax - VIEW.xMin), yMin: VIEW.yMin - 0.25 * (VIEW.yMax - VIEW.yMin), yMax: clipY }
  const bridge = firstBridge(curve.chains, (t): Vec2 => ({ x: t, y: r.at(t) }), PX, anchorSkip(scene.objects, curve.id.statement, 'x', clip))
  expect(bridge.size, `${label}: the segment from ${bridge.from} to ${bridge.to} spans a jump of ${bridge.size} px`).toBe(0)
  expect(curve.chains.length, label).toBeGreaterThan(0)
}

const SEEDS = Array.from({ length: 48 }, (_, i) => i + 1)

describe('seeded random rationals against their analytic poles and holes', () => {
  const cases = SEEDS.map((seed) => ({ seed, r: generate(seed) })).filter((c): c is { seed: number; r: Rational } => c.r !== null)

  it('generates a spread: enough cases, with irrational and whole holes and poles, and some of neither', () => {
    expect(cases.length).toBeGreaterThanOrEqual(36)
    const holes = cases.flatMap((c) => c.r.holes)
    const poles = cases.flatMap((c) => c.r.poles)
    expect(holes.filter((h) => Number.isInteger(h.x)).length).toBeGreaterThan(5)
    expect(holes.filter((h) => !Number.isInteger(h.x)).length).toBeGreaterThan(5)
    expect(poles.filter((p) => Number.isInteger(p)).length).toBeGreaterThan(5)
    expect(poles.filter((p) => !Number.isInteger(p)).length).toBeGreaterThan(5)
    expect(holes.some((h) => h.y === 0)).toBe(true)
    expect(cases.filter((c) => c.r.holes.length === 0).length).toBeGreaterThan(2)
    expect(cases.filter((c) => c.r.poles.length === 0).length).toBeGreaterThan(2)
  })

  for (const { seed, r } of cases) {
    it(`seed ${seed}: ${r.spec}`, () => {
      check(r, 'full')
      // a drag's quality too, for every fourth
      if (seed % 4 === 0) check(r, 'coarse')
    }, 30_000)
  }
})
