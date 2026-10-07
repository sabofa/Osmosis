import { describe, expect, it, vi } from 'vitest'
import { edgeClassOf, smoothClasses } from '../model/edges'
import { quadMesh, sceneOf } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import type { PaintParams } from '../params'
import { buildWorldEdges, smoothRunClasses, type WorldEdgeRun } from './edges'
import { bake, boxMesh, framing, FRONT, LIGHT, meanH, P, runsOf, SPHERE_SCENE } from './edgesFixture'

// A plan over a refined surface is heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 180_000 })

// The hardness rules one by one: each of these tests fails if its rule is taken out of buildWorldEdges.

describe('the class of a closed run wraps round its start', () => {
  // the median of the 7 samples about i of a cyclic sequence, written out
  const cyclicMedian = (raw: ArrayLike<number>): number[] => {
    const n = raw.length
    return Array.from({ length: n }, (_, i) => {
      const w = Array.from({ length: 7 }, (_, k) => raw[(i + k - 3 + 7 * n) % n]).sort((a, b) => a - b)
      return w[3]
    })
  }

  it('is, for a closed run, the median of the 7 samples about each one round the loop; for an open run the model’s (the ends repeat)', () => {
    let seed = 7
    const next = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
      return seed / 4294967296
    }
    let differs = 0
    for (let round = 0; round < 200; round++) {
      const n = 7 + Math.floor(next() * 40)
      // runs of a class, short ones among them
      const raw = new Uint8Array(n)
      let c = Math.floor(next() * 4)
      for (let i = 0; i < n; i++) {
        if (next() < 0.25) c = Math.floor(next() * 4)
        raw[i] = c
      }
      const wrapped = smoothRunClasses(raw, true)
      expect(Array.from(wrapped), `round ${round}`).toEqual(cyclicMedian(raw))
      expect(Array.from(smoothRunClasses(raw, false))).toEqual(Array.from(smoothClasses(raw)))
      if (Array.from(smoothClasses(raw)).join() !== Array.from(wrapped).join()) differs++
    }
    expect(differs).toBeGreaterThan(20) // (the wrap matters for a good many of them)
  })

  it('smooths a short class change across the start of a real run: a soft stretch of 3 samples straddling the start of the sphere’s terminator is gone, as one in the middle of it would be', () => {
    // The eye at azimuth -54, elevation -34 puts the focal point's reach (the hardness peak) at the start of the terminator loop; the lost/soft
    // threshold is set between its third and fourth highest scores, so three samples are soft: two of them are at the end of the run and the
    // start of it, and the median of 7 round the loop takes them out. Without the wrap the ends repeat and they stay.
    const b = bake(SPHERE_SCENE, LIGHT)
    const eye = framing(-54, -34)
    const base = runsOf(buildWorldEdges(b.plan, b.planes, P, b.scene, eye), 'terminator')[0]
    const sorted = Array.from(base.h).sort((a, c) => c - a)
    const thr = (sorted[2] + sorted[3]) / 2
    const params: PaintParams = { ...P, edges: { ...P.edges, lostBelow: thr, softBelow: 0.9, firmBelow: 0.95 } }
    const r = runsOf(buildWorldEdges(b.plan, b.planes, params, b.scene, eye), 'terminator')[0]
    const n = r.h.length
    expect(r.closed).toBe(true)
    const raw = Uint8Array.from(r.h, (h) => edgeClassOf(h, params))
    // the precondition: the soft samples are few and one of them is at each end of the run
    expect(Array.from(raw).reduce((a, c) => a + c, 0)).toBe(3)
    expect(raw[0] + raw[n - 1]).toBeGreaterThan(0)
    expect(Array.from(smoothClasses(raw))).not.toEqual(Array.from(r.cls)) // (the clamped smoothing would not have removed them)
    expect(Array.from(r.cls)).toEqual(cyclicMedian(raw))
    expect(r.cls.every((c) => c === 0)).toBe(true)
  })
})

describe('the curvature term of an edge between planes', () => {
  // a flat-shaded box lit from above: its faces turn 90 degrees at every crease, and two lit faces of the light family meet along some of them
  const box = bake(sceneOf([boxMesh([-1, -1, -1], [1, 1, 1], 0)]), worldLight(30, 50))
  const noK: PaintParams = { ...P, edges: { ...P.edges, wCurvature: [0, P.edges.wCurvature[1], P.edges.wCurvature[2]] } }
  const boxNoK = buildWorldEdges(box.plan, box.planes, noK, box.scene, FRONT)

  // the samples of the plane boundaries that have a contrast to speak of (a boundary under 0.03 is lost whatever its terms)
  const visible = (runs: WorldEdgeRun[]): [number, number][] => {
    const out: [number, number][] = []
    runs.forEach((r, k) => {
      for (let i = 0; i < r.h.length; i++) if (Math.abs(r.uA[i] - r.uB[i]) >= 0.03) out.push([k, i])
    })
    return out
  }

  it('scores a plane boundary along a sharp flat-shaded crease by the angle of the form turning there: the curvature weight (0.22 at its full turn) is in it', () => {
    const runs = runsOf(box.edges, 'plane')
    const runsNoK = runsOf(boxNoK, 'plane')
    expect(runs.length).toBeGreaterThanOrEqual(3)
    const samples = visible(runs)
    expect(samples.length).toBeGreaterThan(100)
    let gain = 0
    for (const [k, i] of samples) gain += runs[k].h[i] - runsNoK[k].h[i]
    // (a right angle is over the term's 0.06 rad per px: its whole weight)
    expect(gain / samples.length).toBeGreaterThan(0.18)
    expect(gain / samples.length).toBeLessThan(0.23)
  })

  it('leaves a plane boundary on a smooth part alone: the same weight changes the sphere’s by under 0.02', () => {
    const sphere = bake(SPHERE_SCENE, LIGHT)
    const sphereNoK = buildWorldEdges(sphere.plan, sphere.planes, noK, sphere.scene, FRONT)
    const runs = runsOf(sphere.edges, 'plane')
    const runsNoK = runsOf(sphereNoK, 'plane')
    const samples = visible(runs)
    expect(samples.length).toBeGreaterThan(300)
    let gain = 0
    for (const [k, i] of samples) gain += runs[k].h[i] - runsNoK[k].h[i]
    expect(gain / samples.length).toBeLessThan(0.02)
    // and a boundary along a flat-shaded crease reads harder than a smooth one, other terms what they are
    const hard = samples.reduce((s, [k, i]) => s + runs[k].h[i], 0) / samples.length
    const boxSamples = visible(runsOf(box.edges, 'plane'))
    const boxMean = boxSamples.reduce((s, [k, i]) => s + runsOf(box.edges, 'plane')[k].h[i], 0) / boxSamples.length
    expect(boxMean).toBeGreaterThan(hard + 0.1)
  })
})

describe('no visible transition is lost', () => {
  // a plan whose light family spans 0.02 of value (the half-tone ramp 0.52 to 0.54, nothing above it): two faces of a box lit from nearly above
  // differ by under 0.02 in value, and a crease between them, with the curvature of a right angle, would score well over the lost threshold
  const flat: PaintParams = { ...P, value: { ...P.value, halfLo: 0.52, halfHi: 0.54, lightLo: 0.54, lightHi: 0.54 } }
  const box = bake(sceneOf([boxMesh([-1, -1, -1], [1, 1, 1], 0)]), worldLight(0, 80), flat)
  const uncapped: PaintParams = { ...flat, edges: { ...flat.edges, lostBelow: 0.95, softBelow: 0.96, firmBelow: 0.97 } }
  const free = buildWorldEdges(box.plan, box.planes, uncapped, box.scene, FRONT)

  it('has a step of 0.02 between two faces all lost: every sample of a boundary under 0.03 of contrast is at most the lost threshold less 0.01, and the class is lost', () => {
    const runs = runsOf(box.edges, 'plane')
    const runsFree = runsOf(free, 'plane')
    expect(runs.length).toBe(runsFree.length)
    let flatSamples = 0
    let wouldBeAbove = 0
    runs.forEach((r, k) => {
      for (let i = 0; i < r.h.length; i++) {
        if (Math.abs(r.uA[i] - r.uB[i]) >= 0.03) continue
        flatSamples++
        const cap = P.edges.lostBelow - 0.01
        // the score without the rule (the thresholds moved out of the way: the cap is 0.94) is over the lost threshold for most of them
        if (runsFree[k].h[i] > P.edges.lostBelow) wouldBeAbove++
        expect(r.h[i]).toBeCloseTo(Math.min(runsFree[k].h[i], cap), 6)
        expect(r.cls[i]).toBe(0)
      }
    })
    expect(flatSamples).toBeGreaterThan(100)
    expect(wouldBeAbove).toBeGreaterThan(0.5 * flatSamples)
    // the step is the 0.02 of the brief: the planes' means differ by that, not by 0.03
    const flatRuns = runs.filter((r) => r.contrast < 0.03)
    expect(flatRuns.length).toBeGreaterThanOrEqual(1)
    const steps = flatRuns.map((r) => Math.abs(r.uA[0] - r.uB[0]))
    expect(Math.max(...steps)).toBeLessThan(0.03)
    expect(Math.max(...steps)).toBeGreaterThan(0.005)
  })
})

describe('the found-edge floor of an outline in shadow', () => {
  // an open sheet lit from above: its lit side against the canvas, and its back, a form in shadow, against the canvas. With every weight of the outline's
  // hardness (kind 1) taken out, the outline scores nothing; the model's floor makes the outline of a form in the shadow family against light a found
  // edge, SOFT at the least, and leaves the lit side's alone.
  const sheet = quadMesh({ origin: [-1, -1, 0.2], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, index: 0 })
  const bare: PaintParams = {
    ...P,
    edges: {
      ...P.edges,
      noise: 0,
      wContrast: [P.edges.wContrast[0], 0, P.edges.wContrast[2]],
      wCurvature: [P.edges.wCurvature[0], 0, P.edges.wCurvature[2]],
      wFocal: [P.edges.wFocal[0], 0, P.edges.wFocal[2]],
      wLight: [P.edges.wLight[0], 0, P.edges.wLight[2]],
      wDepth: [P.edges.wDepth[0], 0, P.edges.wDepth[2]],
    },
  }
  const b = bake(sceneOf([sheet]), [0.3, 0.2, 0.9], bare)

  it('raises the outline of the form in shadow against light to a found edge (soft at the least) and does not touch the lit side’s', () => {
    const borders = runsOf(b.edges, 'border')
    const dark = borders.filter((r) => r.side === -1)
    const lit = borders.filter((r) => r.side === 1)
    expect(dark.length).toBe(4)
    expect(lit.length).toBe(4)
    for (const r of dark) {
      for (let i = 0; i < r.h.length; i++) {
        // the shadow family's value against the canvas
        expect(r.uA[i]).toBeLessThanOrEqual(b.plan.capU)
        expect(r.uB[i]).toBeGreaterThanOrEqual(b.plan.floorU)
        expect(r.h[i], `dark border sample ${i}`).toBeGreaterThanOrEqual(P.edges.softBelow + 0.01 - 1e-6)
      }
      expect(r.cls.every((c) => c >= 1)).toBe(true)
    }
    // the lit side: nothing in the outline's own terms, nothing from the floor
    for (const r of lit) {
      expect(r.uA[0]).toBeGreaterThan(b.plan.capU)
      expect(meanH([r])).toBeLessThan(0.05)
      expect(r.cls.every((c) => c === 0)).toBe(true)
    }
  })

  it('applies it to a crease of two faces, a shadow face against a lit one, and not to a crease between faces both in the light', () => {
    // a box lit from above on its east: the top and the east faces are lit, the west and south ones in shadow
    const box = bake(sceneOf([boxMesh([-1, -1, -1], [1, 1, 1], 0)]), worldLight(30, 50), bare)
    const creases = runsOf(box.edges, 'crease')
    expect(creases.length).toBe(12)
    let floored = 0
    let unfloored = 0
    for (const r of creases) {
      for (let i = 0; i < r.h.length; i++) {
        const lo = Math.min(r.uA[i], r.uB[i])
        const hi = Math.max(r.uA[i], r.uB[i])
        if (Math.abs(r.uA[i] - r.uB[i]) < 0.03) continue
        if (lo <= box.plan.capU && hi >= box.plan.floorU) {
          floored++
          expect(r.h[i]).toBeGreaterThanOrEqual(P.edges.softBelow + 0.01 - 1e-6)
        } else if (lo > box.plan.capU) {
          unfloored++
          expect(r.h[i]).toBeLessThan(P.edges.softBelow)
        }
      }
    }
    expect(floored).toBeGreaterThan(100)
    expect(unfloored).toBeGreaterThan(50)
  })
})
