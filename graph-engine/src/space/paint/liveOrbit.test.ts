import { describe, expect, it } from 'vitest'
import {
  blendStrokes,
  CROSSFADE_MS,
  crossfadeWeight,
  edgeFade,
  EDGE_FADE_MS,
  EDGE_ROLE,
  matchStrokes,
  PAIR_KEEP_LENGTH,
  PAIR_MIN_PX,
  refineMatch,
  shouldAdopt,
} from './liveOrbit'
import { worldLightDirection } from '../../../../review/src/paintLabCamera'
import { buildParticles, paintFrame } from './model/index'
import { flatColours, graphMesh, meshGBuffer, paintView, sceneOf, sphereGBuffer, sphereMesh, tableMesh } from './model/testing'
import { DEFAULT_PAINT_PARAMS } from './params'
import { reprojectStrokes } from './reproject'
import { Scratch } from './scratch'
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
  // one width for every point, or one for each
  width?: number | number[]
  y?: number
  // a zigzag of this amplitude on the line: below it at even points, above at odd (the opposite for a negative amplitude)
  wave?: number
  // the stroke runs from x + PATH_POINTS - 1 down to x (its points and widths in that order)
  reverse?: boolean
  // a world path of points (wx + q, wy, wz); none (all zero) when left out
  world?: [number, number, number]
}

// A batch of strokes made by hand: each a horizontal line of PATH_POINTS points at x, y = 0 (or y).
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
      const at = s.reverse ? P - 1 - q : q
      b.path[2 * P * i + 2 * q] = (s.x ?? 0) + at
      b.path[2 * P * i + 2 * q + 1] = (s.y ?? 0) + (s.wave ?? 0) * (at % 2 === 1 ? 1 : -1)
      b.width[P * i + q] = Array.isArray(s.width) ? s.width[q] : (s.width ?? 4)
      if (s.world) b.worldPath.set([s.world[0] + at, s.world[1], s.world[2]], 3 * P * i + 3 * q)
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

describe('refining a match with both bases in one view', () => {
  it('keeps a pair within max(3 px, half the width) of each other and unpairs one further apart: the old stroke goes, the new one appears', () => {
    expect(PAIR_MIN_PX).toBe(3)
    const old = batchOf([{ seed: 1 }, { seed: 2 }, { seed: 3 }, { seed: 4 }])
    // 2 px apart (width 4: the limit is 3); 5 px (the limit 3); 8 px with a width of 20 (the limit 10); 3.5 px with a width of 6 (the limit 3)
    const neu = batchOf([{ seed: 1, y: 2 }, { seed: 2, y: 5 }, { seed: 3, y: 8, width: 20 }, { seed: 4, y: 3.5, width: 6 }])
    const m = matchStrokes(old, neu)
    expect(Array.from(m.pair)).toEqual([0, 1, 2, 3])
    refineMatch(m, old, neu)
    expect(Array.from(m.pair)).toEqual([0, -1, 2, -1])
    expect(Array.from(m.gone)).toEqual([1, 3])
    expect(m.refined).toBe(true)
    // the stroke that appeared fades in where it is, and the one that went fades out where it was
    const half = blendStrokes(old, neu, m, 0.5)
    expect(half.count).toBe(4 + 2)
    expect(half.alpha[1]).toBeCloseTo(0.5, 6)
    expect(half.path[2 * P * 1 + 1]).toBeCloseTo(5, 6) // the new stroke, where it is
    expect(half.alpha[4]).toBeCloseTo(0.5, 6)
    expect(half.path[2 * P * 4 + 1]).toBeCloseTo(0, 6) // the old one, where it was
  })

  it('unpairs a pair whose half-way stroke would be squeezed below 0.8 of the shorter end: two zigzags in opposite phase', () => {
    expect(PAIR_KEEP_LENGTH).toBe(0.8)
    // within a pixel and a half of each other, but one is above where the other is below: half way is a straight line of 7,
    // against zigzags of 7 x sqrt(1 + 4) = 15.7
    const old = batchOf([{ seed: 1, wave: 1 }, { seed: 2, wave: 1 }])
    const neu = batchOf([{ seed: 1, wave: -1 }, { seed: 2, wave: 1, y: 1 }])
    const m = matchStrokes(old, neu)
    refineMatch(m, old, neu)
    // the zigzag in the other phase goes; the same zigzag a pixel over stays (half way is the same zigzag)
    expect(Array.from(m.pair)).toEqual([-1, 1])
    expect(Array.from(m.gone)).toEqual([0])
  })

  it('finds a stroke that runs the other way and eases it against its reversed points, widths and all: the two do not collapse to a point', () => {
    const widths = [1, 2, 3, 4, 5, 6, 7, 8]
    const old = batchOf([{ seed: 1, width: widths }])
    // the same stroke, 2 px over, walked from its far end: its first point is the old stroke's last
    const neu = batchOf([{ seed: 1, y: 2, reverse: true, width: widths.slice().reverse() }])
    const plain = matchStrokes(old, neu)
    // eased point to point, as it was (the model's own order), the pair collapses to the middle at mid-fade
    const collapsed = blendStrokes(old, neu, plain, 0.5)
    for (let q = 0; q < P; q++) expect(collapsed.path[2 * q]).toBeCloseTo(3.5, 6)
    const m = matchStrokes(old, neu)
    refineMatch(m, old, neu)
    expect(Array.from(m.pair)).toEqual([0])
    expect(Array.from(m.reversed)).toEqual([1])
    const half = blendStrokes(old, neu, m, 0.5)
    for (let q = 0; q < P; q++) {
      expect(half.path[2 * q]).toBeCloseTo(P - 1 - q, 6) // the stroke, still from x 7 down to x 0
      expect(half.path[2 * q + 1]).toBeCloseTo(1, 6) // half way over
      expect(half.width[q]).toBeCloseTo(P - q, 6) // 8 down to 1
    }
    const start = blendStrokes(old, neu, m, 0)
    for (let q = 0; q < P; q++) {
      expect(start.path[2 * q]).toBeCloseTo(P - 1 - q, 6)
      expect(start.path[2 * q + 1]).toBeCloseTo(0, 6) // the old stroke, in the new one's order
    }
  })

  it('does not call a stroke reversed that is not: a pair at the same place keeps its order', () => {
    const old = batchOf([{ seed: 1 }])
    const neu = batchOf([{ seed: 1, y: 1 }])
    const m = matchStrokes(old, neu)
    refineMatch(m, old, neu)
    expect(Array.from(m.reversed)).toEqual([0])
  })

  it('eases the world path where both strokes have one, so the depth test reads the stroke that is drawn, and keeps the new stroke’s where one has none', () => {
    const old = batchOf([{ seed: 1, world: [10, 2, 3] }, { seed: 2 }, { seed: 3, world: [1, 1, 1] }])
    const neu = batchOf([{ seed: 1, y: 1, world: [20, 4, 5] }, { seed: 2, y: 1, world: [30, 0, 0] }, { seed: 3, y: 1 }])
    const m = matchStrokes(old, neu)
    refineMatch(m, old, neu)
    expect(Array.from(m.world)).toEqual([1, 0, 0])
    const half = blendStrokes(old, neu, m, 0.5)
    // both have it: half way, point by point
    expect(Array.from(half.worldPath.subarray(0, 3))).toEqual([15, 3, 4])
    expect(Array.from(half.worldPath.subarray(3 * (P - 1), 3 * P))).toEqual([15 + P - 1, 3, 4])
    // only the new has it: the new one's; only the old has it: none (the new stroke has none)
    expect(Array.from(half.worldPath.subarray(3 * P, 3 * P + 3))).toEqual([30, 0, 0])
    expect(Array.from(half.worldPath.subarray(6 * P, 6 * P + 3))).toEqual([0, 0, 0])
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

  it('given a scratch, blends the same strokes into arrays it keeps: a second blend of the same count allocates nothing', () => {
    const scratch = new Scratch()
    const plain = blendStrokes(old, neu, match, 0.25)
    const a = blendStrokes(old, neu, match, 0.25, scratch)
    for (const key of Object.keys(plain) as (keyof StrokeBatch)[]) expect(Array.from(a[key] as ArrayLike<number>), String(key)).toEqual(Array.from(plain[key] as ArrayLike<number>))
    const made = scratch.allocations
    expect(made).toBeGreaterThan(15)
    const b = blendStrokes(old, neu, match, 0.75, scratch)
    expect(scratch.allocations).toBe(made)
    expect(b.alpha).toBe(a.alpha)
    expect(b.path).toBe(a.path)
    // the second blend's strokes, not the first's
    expect(b.alpha[0]).toBeCloseTo(0.95, 6) // A eased 0.75 of the way from 0.8 to 1
    // and neither base is touched
    expect(old.alpha[0]).toBeCloseTo(0.8, 6)
    expect(neu.path[0]).toBe(4)
  })

  it('changes neither base', () => {
    const before = [Array.from(old.alpha), Array.from(neu.alpha), Array.from(old.path), Array.from(neu.path)]
    blendStrokes(old, neu, match, 0.3)
    expect([Array.from(old.alpha), Array.from(neu.alpha), Array.from(old.path), Array.from(neu.path)]).toEqual(before)
  })
})

describe('on real frames, the pairs that are eased lie on the same bit of the picture', () => {
  const COLOURS = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02] })
  const sphereScene = sceneOf([sphereMesh({ radius: 0.6 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
  const saddleMesh = graphMesh((x: number, y: number) => 0.4 * (x * x - y * y), { half: 0.8, n: 40, index: 0 })
  const saddleScene = sceneOf([saddleMesh])
  const params = DEFAULT_PAINT_PARAMS
  const viewAt = (azimuth: number) => {
    const view = paintView({ width: 640, height: 480, azimuth, elevation: 25, zoom: 400 })
    view.lightDir = [...worldLightDirection(-35, 39)] as [number, number, number]
    return view
  }
  const sphereFrame = (particles: ReturnType<typeof buildParticles>, azimuth: number) => {
    const view = viewAt(azimuth)
    const g = sphereGBuffer(640, 480, { view, params, centre: [0, 0, 0], radius: 0.6, mark: 0, table: { z: -0.6, mark: 1 } })
    return { view, strokes: paintFrame(sphereScene, particles, view, g, params).strokes }
  }
  const saddleFrame = (particles: ReturnType<typeof buildParticles>, azimuth: number) => {
    const view = viewAt(azimuth)
    const g = meshGBuffer(640, 480, [{ mesh: saddleMesh, mark: 0 }], { view, params })
    return { view, strokes: paintFrame(saddleScene, particles, view, g, params).strokes }
  }
  const pathLength = (b: StrokeBatch, j: number) => {
    let l = 0
    for (let k = 1; k < P; k++) l += Math.hypot(b.path[2 * P * j + 2 * k] - b.path[2 * P * j + 2 * k - 2], b.path[2 * P * j + 2 * k + 1] - b.path[2 * P * j + 2 * k - 1])
    return l
  }
  // the mean distance of stroke i of `a` from stroke j of `b`, point to point and against the reversed points
  const distances = (a: StrokeBatch, i: number, b: StrokeBatch, j: number) => {
    let direct = 0
    let flipped = 0
    for (let k = 0; k < P; k++) {
      const ox = a.path[2 * P * i + 2 * k]
      const oy = a.path[2 * P * i + 2 * k + 1]
      direct += Math.hypot(ox - b.path[2 * P * j + 2 * k], oy - b.path[2 * P * j + 2 * k + 1])
      flipped += Math.hypot(ox - b.path[2 * P * j + 2 * (P - 1 - k)], oy - b.path[2 * P * j + 2 * (P - 1 - k) + 1])
    }
    return { direct: direct / P, flipped: flipped / P }
  }

  // The sphere turned 6 degrees and the saddle 12: raw, 149 of the sphere's 2,439 pairs lie more than 8 px apart (p99 22 px,
  // the farthest 31) and 75 are reversed; the saddle's 12-degree pairs are worse (323 and 335).
  it.each([
    ['the sphere turned 6 degrees', 6, 'sphere', 30, 60],
    ['the saddle turned 12 degrees', 12, 'saddle', 150, 150],
  ] as const)('%s: the pairs kept are near, none runs the other way unnoticed, and at mid-fade nothing collapses', (_name, turn, which, farMin, reversedMin) => {
    const scene = which === 'sphere' ? sphereScene : saddleScene
    const particles = buildParticles(scene, COLOURS, params)
    const frame = which === 'sphere' ? sphereFrame : saddleFrame
    const a = frame(particles, 30)
    const b = frame(particles, 30 + turn)
    const there = reprojectStrokes(a.strokes, a.view, b.view, params)
    const raw = matchStrokes(a.strokes, b.strokes)
    // the measure is not vacuous: before refining there are far pairs and reversed ones
    let far = 0
    let reversedRaw = 0
    let rawPairs = 0
    for (let j = 0; j < b.strokes.count; j++) {
      const i = raw.pair[j]
      if (i < 0 || (there.alpha[i] <= 0.01 && b.strokes.alpha[j] <= 0.01)) continue
      rawPairs++
      const d = distances(there, i, b.strokes, j)
      if (d.direct > 8) far++
      if (d.flipped < 0.5 * d.direct && d.direct > 2) reversedRaw++
    }
    expect(far).toBeGreaterThan(farMin)
    expect(reversedRaw).toBeGreaterThan(reversedMin)

    const m = matchStrokes(a.strokes, b.strokes)
    refineMatch(m, there, b.strokes)
    const aligned: number[] = []
    let kept = 0
    let turned = 0
    for (let j = 0; j < b.strokes.count; j++) {
      const i = m.pair[j]
      if (i < 0) continue
      kept++
      const d = distances(there, i, b.strokes, j)
      // the alignment used is the nearer one, so no pair that runs the other way is eased point to point
      const used = m.reversed[j] === 1 ? d.flipped : d.direct
      const other = m.reversed[j] === 1 ? d.direct : d.flipped
      expect(used).toBeLessThanOrEqual(other)
      if (m.reversed[j] === 1) turned++
      let width = 0
      for (let k = 0; k < P; k++) width += b.strokes.width[P * j + k]
      expect(used).toBeLessThanOrEqual(Math.max(PAIR_MIN_PX, (0.5 * width) / P) + 1e-6)
      aligned.push(used)
    }
    aligned.sort((x, y) => x - y)
    // the 99th percentile of what is eased (raw: 22 px) and the farthest are bounded by the rule
    expect(aligned[Math.floor(0.99 * (aligned.length - 1))]).toBeLessThan(9)
    expect(aligned[aligned.length - 1]).toBeLessThan(13)
    // the ones that were pairs by seed and are not strokes of one place any more are a small share
    expect((rawPairs - kept) / rawPairs).toBeLessThan(0.3)
    expect(turned).toBeGreaterThan(reversedMin / 2) // and the ones that run the other way are found, and eased in their order

    // at mid-fade a stroke that is eased keeps its length: none falls below 0.8 of the shorter of its two ends
    const half = blendStrokes(there, b.strokes, m, 0.5)
    let eased = 0
    let shrunk = 0
    for (let j = 0; j < b.strokes.count; j++) {
      const i = m.pair[j]
      if (i < 0) continue
      const shortest = Math.min(pathLength(there, i), pathLength(b.strokes, j))
      if (shortest < 2) continue
      eased++
      if (pathLength(half, j) < 0.8 * shortest) shrunk++
    }
    expect(eased).toBeGreaterThan(200)
    expect(shrunk).toBe(0)
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
    // the old frame re-projected into the new view, against the new frame: the median pair is within two pixels
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
