import { describe, expect, it } from 'vitest'
import {
  blendStrokes,
  CROSSFADE_MS,
  crossfadeWeight,
  edgeFade,
  EDGE_FADE_MS,
  EDGE_ROLE,
  matchStrokes,
  shouldAdopt,
} from './liveOrbit'
import { buildParticles, paintFrame } from './model/index'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './model/testing'
import { DEFAULT_PAINT_PARAMS } from './params'
import { reprojectStrokes } from './reproject'
import { PATH_POINTS, ROLES, type StrokeBatch } from './types'

// The rules of a camera that drags (liveOrbit.ts): hand-computed numbers, on strokes made by hand.
const P = PATH_POINTS
const BLOCK = ROLES.indexOf('block')
const FORM = ROLES.indexOf('form')

interface Spec {
  role?: number
  seed: number
  x?: number
  colour?: [number, number, number]
  alpha?: number
  width?: number
}

// A batch of strokes made by hand: each a horizontal line of PATH_POINTS points at x, y = 0.
function batchOf(strokes: Spec[]): StrokeBatch {
  const n = strokes.length
  const b: StrokeBatch = {
    count: n,
    role: new Uint8Array(n),
    layer: new Uint8Array(n),
    path: new Float32Array(2 * P * n),
    width: new Float32Array(P * n),
    depth: new Float32Array(n),
    colour: new Float32Array(3 * n),
    alpha: new Float32Array(n),
    load: new Float32Array(n),
    impasto: new Float32Array(n),
    bristles: new Float32Array(n),
    bristleVar: new Float32Array(n),
    dry: new Float32Array(n),
    wet: new Float32Array(n),
    endSoft: new Float32Array(n),
    edge: new Uint8Array(n),
    seed: new Uint32Array(n),
    worldPath: new Float32Array(3 * P * n),
    worldNormal: new Float32Array(3 * n),
  }
  strokes.forEach((s, i) => {
    b.role[i] = s.role ?? BLOCK
    b.seed[i] = s.seed
    for (let q = 0; q < P; q++) {
      b.path[2 * P * i + 2 * q] = (s.x ?? 0) + q
      b.path[2 * P * i + 2 * q + 1] = 0
      b.width[P * i + q] = s.width ?? 4
    }
    const c = s.colour ?? [0.2, 0.3, 0.4]
    b.colour.set(c, 3 * i)
    b.alpha[i] = s.alpha ?? 1
    b.load[i] = 1
    b.bristles[i] = 10
  })
  return b
}

describe('the crossfade weight', () => {
  it('is 0 when the new base is adopted and 1 after CROSSFADE_MS, a straight ramp between', () => {
    expect(CROSSFADE_MS).toBe(120)
    expect(crossfadeWeight(0, false)).toBe(0)
    expect(crossfadeWeight(30, false)).toBeCloseTo(0.25, 12)
    expect(crossfadeWeight(60, false)).toBeCloseTo(0.5, 12)
    expect(crossfadeWeight(90, false)).toBeCloseTo(0.75, 12)
    expect(crossfadeWeight(120, false)).toBe(1)
    expect(crossfadeWeight(500, false)).toBe(1)
    // a clock that ran backwards, or a bad number, shows the old picture, never a weight outside 0..1
    expect(crossfadeWeight(-40, false)).toBe(0)
  })

  it('is 1 at once under reduced motion, at any time', () => {
    expect(crossfadeWeight(0, true)).toBe(1)
    expect(crossfadeWeight(60, true)).toBe(1)
    expect(crossfadeWeight(-5, true)).toBe(1)
  })
})

describe('the age of an edge', () => {
  it('leaves all of it at 0 ms and none from 200 ms on, a straight ramp between', () => {
    expect(EDGE_FADE_MS).toBe(200)
    expect(edgeFade(0)).toBe(1)
    expect(edgeFade(50)).toBeCloseTo(0.75, 12)
    expect(edgeFade(100)).toBeCloseTo(0.5, 12)
    expect(edgeFade(150)).toBeCloseTo(0.25, 12)
    expect(edgeFade(200)).toBe(0)
    expect(edgeFade(201)).toBe(0)
    expect(edgeFade(10_000)).toBe(0)
    expect(edgeFade(-20)).toBe(1)
  })
})

describe('which result may become the base', () => {
  it('is the one of a newer request than the base: an answer for an older drag position is never adopted', () => {
    expect(shouldAdopt(null, 1)).toBe(true) // nothing to replace
    expect(shouldAdopt(10, 11)).toBe(true)
    expect(shouldAdopt(10, 500)).toBe(true)
    expect(shouldAdopt(10, 10)).toBe(false) // the base itself
    expect(shouldAdopt(10, 9)).toBe(false) // late: for an older view than the one on screen
    expect(shouldAdopt(10, 0)).toBe(false)
  })
})

describe('matching the strokes of two bases', () => {
  it('pairs the strokes with the same particle and role, finds the ones that appeared and the ones that went, and never pairs an edge', () => {
    const old = batchOf([{ seed: 1 }, { seed: 2 }, { seed: 7, role: EDGE_ROLE }, { seed: 3, role: FORM }])
    const neu = batchOf([{ seed: 3, role: FORM }, { seed: 1 }, { seed: 9 }, { seed: 7, role: EDGE_ROLE }, { seed: 3 }])
    const m = matchStrokes(old, neu)
    // new 0 (form, seed 3) is old 3; new 1 (block, 1) is old 0; new 2 (block, 9) appeared; the edge is its own stroke, and so is
    // new 4 (block, seed 3: the same particle as a form stroke, another role)
    expect(Array.from(m.pair)).toEqual([3, 0, -1, -1, -1])
    // the old strokes nothing continues: block 2 and the edge
    expect(Array.from(m.gone)).toEqual([1, 2])
  })

  it('matches the k-th stroke of a particle’s role in one batch with the k-th in the other', () => {
    const old = batchOf([{ seed: 5, x: 0 }, { seed: 5, x: 100 }])
    const neu = batchOf([{ seed: 5, x: 3 }, { seed: 5, x: 103 }, { seed: 5, x: 200 }])
    const m = matchStrokes(old, neu)
    expect(Array.from(m.pair)).toEqual([0, 1, -1])
    expect(m.gone.length).toBe(0)
  })
})

describe('easing one base into another', () => {
  // old: A (block 1, at x 0), B (block 2, at x 10), E (an edge); new: A' (the same stroke, 4 px along), C (block 3), E' (an edge).
  const old = batchOf([{ seed: 1, x: 0, alpha: 0.8 }, { seed: 2, x: 10, alpha: 0.6 }, { seed: 7, role: EDGE_ROLE, x: 20, alpha: 1 }])
  const neu = batchOf([{ seed: 1, x: 4, alpha: 1 }, { seed: 3, x: 30, alpha: 0.5 }, { seed: 7, role: EDGE_ROLE, x: 24, alpha: 1 }])
  const match = matchStrokes(old, neu)

  it('at weight 0 shows the old strokes whole and the new ones not at all', () => {
    const out = blendStrokes(old, neu, match, 0)
    // the new strokes, then the old ones nothing continues (B and the edge)
    expect(out.count).toBe(5)
    expect(out.path[0]).toBeCloseTo(0, 6) // A' eased all the way back to A (the path's first point: A's x was 0, A' is 4)
    expect(out.alpha[0]).toBeCloseTo(0.8, 6)
    expect(out.alpha[1]).toBe(0) // C appeared: not there yet
    expect(out.alpha[2]).toBe(0) // the new edge likewise
    expect(out.alpha[3]).toBeCloseTo(0.6, 6) // B: the old stroke, whole
    expect(out.seed[3]).toBe(2)
    expect(out.alpha[4]).toBeCloseTo(1, 6) // the old edge
    expect(out.role[4]).toBe(EDGE_ROLE)
  })

  it('half way, eases the stroke both have and fades the others half in, half out', () => {
    const out = blendStrokes(old, neu, match, 0.5)
    expect(out.count).toBe(5)
    expect(out.path[0]).toBeCloseTo(2, 6) // half of the way from x 0 to 4
    expect(out.path[2 * (P - 1)]).toBeCloseTo(P - 1 + 2, 6)
    expect(out.alpha[0]).toBeCloseTo(0.9, 6) // between 0.8 and 1
    expect(out.alpha[1]).toBeCloseTo(0.25, 6) // C: half of 0.5
    expect(out.alpha[2]).toBeCloseTo(0.5, 6)
    expect(out.alpha[3]).toBeCloseTo(0.3, 6) // B: half of 0.6
    expect(out.alpha[4]).toBeCloseTo(0.5, 6)
    // eased: the colour, too, and what is not a number to ease is the new stroke's
    expect(out.seed[0]).toBe(1)
  })

  it('at weight 1 is the new base’s strokes and nothing else', () => {
    const out = blendStrokes(old, neu, match, 1)
    expect(out.count).toBe(3)
    expect(Array.from(out.alpha)).toEqual([1, 0.5, 1])
    expect(Array.from(out.path)).toEqual(Array.from(neu.path))
  })

  it('changes neither base', () => {
    const before = [Array.from(old.alpha), Array.from(neu.alpha), Array.from(old.path), Array.from(neu.path)]
    blendStrokes(old, neu, match, 0.3)
    expect([Array.from(old.alpha), Array.from(neu.alpha), Array.from(old.path), Array.from(neu.path)]).toEqual(before)
  })
})

describe('on real frames of a sphere turned a few degrees', () => {
  const COLOURS = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02] })
  const scene = sceneOf([sphereMesh({ radius: 0.6 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
  const particles = buildParticles(scene, COLOURS, DEFAULT_PAINT_PARAMS)
  const frame = (azimuth: number) => {
    const view = paintView({ width: 320, height: 240, azimuth, elevation: 25, zoom: 200 })
    const g = sphereGBuffer(320, 240, { view, params: DEFAULT_PAINT_PARAMS, centre: [0, 0, 0], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } })
    return { view, strokes: paintFrame(scene, particles, view, g, DEFAULT_PAINT_PARAMS).strokes }
  }

  it('carries most of the picture over: most strokes of one frame are strokes of the next, almost where the re-projection puts them, and no edge is', () => {
    const a = frame(30)
    const b = frame(36)
    const m = matchStrokes(a.strokes, b.strokes)
    const surface = Array.from({ length: b.strokes.count }, (_, j) => j).filter((j) => b.strokes.role[j] !== EDGE_ROLE)
    const paired = surface.filter((j) => m.pair[j] >= 0)
    expect(paired.length / surface.length).toBeGreaterThan(0.8)
    // the old frame re-projected into the new view, against the new frame: the median pair is within two pixels (a 320 px picture: the median stroke is 0.2 px off in a figure of 900)
    const there = reprojectStrokes(a.strokes, a.view, b.view, DEFAULT_PAINT_PARAMS)
    const moved = paired
      .map((j) => {
        const i = m.pair[j]
        let d = 0
        for (let q = 0; q < PATH_POINTS; q++) {
          d += Math.hypot(
            there.path[2 * PATH_POINTS * i + 2 * q] - b.strokes.path[2 * PATH_POINTS * j + 2 * q],
            there.path[2 * PATH_POINTS * i + 2 * q + 1] - b.strokes.path[2 * PATH_POINTS * j + 2 * q + 1],
          )
        }
        return d / PATH_POINTS
      })
      .sort((x, y) => x - y)
    expect(moved[Math.floor(moved.length / 2)]).toBeLessThan(2)
    for (let j = 0; j < b.strokes.count; j++) if (b.strokes.role[j] === EDGE_ROLE) expect(m.pair[j]).toBe(-1)
  })
})
