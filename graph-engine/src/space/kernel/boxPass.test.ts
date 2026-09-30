// The box pass (integration J1): statements that define the scene build first,
// the kernel resolves the box from their extent with frame/bounds.ts's
// resolveBox (the renderer's own function), and box-dependent statements then
// build against it. Every box below is worked by hand from resolveBox's rule:
// a data axis is rounded outward to multiples of niceStep(span, 8).

import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { resolveBox } from '../frame/bounds'
import { sceneExtent } from '../scene/extent'
import type { Box3, Mark, SpaceScene } from '../scene/types'
import { createSpaceKernel } from './index'

function kernelOf(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return { kernel: createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines), space: parsed.config.space }
}

function markOf(scene: SpaceScene, object: string): Mark {
  const mark = scene.marks.find((m) => m.source.object === object)
  if (!mark) throw new Error(`no mark ${object} among ${scene.marks.map((m) => m.source.object).join(', ')}`)
  return mark
}

function positions(mark: Mark): number[][] {
  const p = mark.kind === 'arrows' ? mark.tails : mark.kind === 'boxes' ? mark.mins : mark.positions
  const out: number[][] = []
  for (let i = 0; i + 2 < p.length; i += 3) out.push([p[i], p[i + 1], p[i + 2]])
  return out
}

function range(values: number[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const v of values) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  return [lo, hi]
}

const box = (x: [number, number], y: [number, number], z: [number, number]): Box3 => ({
  x: { min: x[0], max: x[1] },
  y: { min: y[0], max: y[1] },
  z: { min: z[0], max: z[1] },
})

describe('the box pass: J1’s three scenarios', () => {
  it('two surfaces and a gradient: the floor arrow lies on the resolved floor z = -50, not on the tool’s own z = 0', () => {
    // x^2 + y^2 and -x^2 - y^2 over [-5, 5]^2 span z in [-50, 50];
    // niceStep(100, 8) = 10 keeps it. f = x^2 + y^2 alone spans [0, 50].
    const { kernel, space } = kernelOf(`z = x^2 + y^2
z = -x^2 - y^2
gradient: x^2 + y^2 at (1, 1)`)
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([-5, 5], [-5, 5], [-50, 50]))
    const arrow = markOf(scene, 's3')
    if (arrow.kind !== 'arrows') throw new Error('not an arrow')
    expect(Array.from(arrow.tails)).toEqual([1, 1, -50])
    expect(Array.from(arrow.vectors)).toEqual([2, 2, 0])
    for (const [, , z] of positions(markOf(scene, 's3.level'))) expect(z).toBe(-50)
  })

  it('a surface over its own x in [-1, 2] and a trace: the trace runs over that x range and does not stretch it to [-5, 5]', () => {
    // x: [-1, 2], niceStep(3, 8) = 0.5 keeps it; y: [-1, 1], step 0.2;
    // z = x^2 - y^2 there runs from -1 to 4, step 0.5.
    const { kernel, space } = kernelOf(`z = x^2 - y^2 for x in [-1, 2], y in [-1, 1]
trace: x^2 - y^2 at y = 0`)
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([-1, 2], [-1, 1], [-1, 4]))
    const curve = positions(markOf(scene, 's2'))
    expect(range(curve.map((p) => p[0]))).toEqual([-1, 2])
    for (const [x, y, z] of curve) {
      expect(y).toBe(0)
      expect(Math.abs(z - x * x)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('a plane beside a surface spans exactly the surface’s box: z = 1 over [0, 2]^2', () => {
    // x*y over [0, 2]^2: z in [0, 4], step 0.5.
    const { kernel, space } = kernelOf(`z = x*y for x in [0, 2], y in [0, 2]
plane: z = 1`)
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([0, 2], [0, 2], [0, 4]))
    const corners = positions(markOf(scene, 's2')).map((p) => p.join(','))
    expect(new Set(corners)).toEqual(new Set(['0,0,1', '2,0,1', '2,2,1', '0,2,1']))
  })
})

describe('the box pass: the renderer’s box is the kernel’s, by construction', () => {
  it('scene.extent is the defining statements’ extent, so resolveBox over it gives the box the plane was built in', () => {
    // The segment's x runs over [0.19, 2.71]: niceStep(2.52, 8) = 0.2 gives
    // [0, 2.8] (14 steps of 0.2, 2.8000000000000003 in floating point). The
    // plane spans that. Resolving over EVERY mark instead would
    // see x in [0, 2.8], whose step is niceStep(2.8, 8) = 0.5, and give
    // [0, 3]: a box the plane does not reach. So the extent the renderer
    // reads leaves box-dependent marks out.
    const { kernel, space } = kernelOf(`(0.19, 0, 0) -- (2.71, 1, 1)
plane: z = 0.5`)
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    const resolved = resolveBox(space, scene.extent, scene.boxSpanning)
    expect(resolved).toEqual(box([0, 14 * 0.2], [0, 1], [0, 1]))
    const plane = positions(markOf(scene, 's2'))
    expect(range(plane.map((p) => p[0]))).toEqual([0, 14 * 0.2])
    expect(range(plane.map((p) => p[1]))).toEqual([0, 1])
    // the trap the construction avoids
    expect(resolveBox(space, sceneExtent(scene.marks, scene.labels)).x).toEqual({ min: 0, max: 3 })
  })

  it('with nothing else drawn, a box-dependent statement gets @bounds3d where given and [-5, 5] on every other axis', () => {
    const { kernel, space } = kernelOf(`@bounds3d: z [0, 2]
plane: x + y = 0`)
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    expect(scene.extent).toBeNull()
    expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([-5, 5], [-5, 5], [0, 2]))
    expect(range(positions(markOf(scene, 's2')).map((p) => p[2]))).toEqual([0, 2])
  })

  it('a region sizes the box by its x and y, and is drawn on the box floor', () => {
    // The region x in [0, 1], y in [x^2, x] alone: x and y [0, 1]; no z
    // data, so region: gets a thin flat box (S6 plan V1) instead of the old
    // [-5, 5]: s = 0.05 * max(1, 1) = 0.05, floor -0.05. With @bounds3d z
    // [-1, 3] (authored, so the flat rule never applies), -1.
    const alone = kernelOf('region: x in [0, 1], y in [x^2, x]')
    const scene = alone.kernel.scene()
    expect(scene.errors).toEqual([])
    expect(resolveBox(alone.space, scene.extent, scene.boxSpanning)).toEqual(box([0, 1], [0, 1], [-0.05, 0.05]))
    for (const [, , z] of positions(markOf(scene, 's1'))) expect(z).toBe(-0.05)
    const bounded = kernelOf('@bounds3d: z [-1, 3]\nregion: x in [0, 1], y in [x^2, x]').kernel.scene()
    for (const [, , z] of positions(markOf(bounded, 's2'))) expect(z).toBe(-1)
  })
})

describe('the box pass under setValue', () => {
  // Line 2's surface reads a; line 3's point reads b; line 4's plane reads
  // neither. x*y*a over [0, 2]^2: z in [0, 4a].
  const SPEC = `@param a = 1 range [1, 3]
@param b = 0.5 range [0, 1]
z = a*x*y for x in [0, 2], y in [0, 2]
(b, 1, 1)
plane: x = 1`

  it('a box-independent change that moves the box rebuilds every box-dependent statement: the plane grows with z', () => {
    const { kernel } = kernelOf(SPEC)
    const before = markOf(kernel.scene(), 's5')
    expect(range(positions(before).map((p) => p[2]))).toEqual([0, 4])
    const after = markOf(kernel.setValue('a', 2), 's5')
    expect(after).not.toBe(before)
    expect(range(positions(after).map((p) => p[2]))).toEqual([0, 8])
  })

  it('a change that leaves the box where it was keeps the box-dependent marks by identity (the S1 rule)', () => {
    const { kernel } = kernelOf(SPEC)
    const before = markOf(kernel.scene(), 's5')
    const scene = kernel.setValue('b', 0.7)
    expect(Array.from((markOf(scene, 's4') as { positions: Float64Array }).positions)).toEqual([0.7, 1, 1])
    expect(markOf(scene, 's5')).toBe(before)
  })

  it('holdBox: during play or drag the dependent statements use the renderer’s frozen box; released, the resolved one', () => {
    const { kernel, space } = kernelOf(SPEC)
    const frozen = resolveBox(space, kernel.scene().extent, kernel.scene().boxSpanning)
    const held = kernel.setValue('a', 2, { holdBox: frozen })
    // The data moved (the extent reaches z = 8), the plane did not.
    expect(resolveBox(space, held.extent, held.boxSpanning).z).toEqual({ min: 0, max: 8 })
    expect(range(positions(markOf(held, 's5')).map((p) => p[2]))).toEqual([0, 4])
    // Released: no value changes, but the plane rebuilds in the resolved box.
    const released = kernel.setValues(new Map())
    expect(released).not.toBe(held)
    expect(range(positions(markOf(released, 's5')).map((p) => p[2]))).toEqual([0, 8])
    // And a release with nothing held changes nothing.
    expect(kernel.setValues(new Map())).toBe(released)
  })
})

// Fix round 1 (Important 2): a region reads the box's z (its floor) only, and
// is rebuilt when that moves.
describe('the box pass: a region follows the floor', () => {
  it('lies on the floor of the surface beside it, and moves with it when setValue moves the surface', () => {
    // x*y + a over [0, 2]^2 spans z in [a, 4 + a]: at a = 1 the box z is
    // [1, 5] (step 0.5), at a = 2 it is [2, 6]. Built against the
    // provisional box alone, the region would lie at z = -5, below the box.
    const { kernel } = kernelOf(`@param a = 1 range [0, 3]
z = x*y + a for x in [0, 2], y in [0, 2]
region: x in [0, 1], y in [0, 1]`)
    const before = markOf(kernel.scene(), 's3')
    expect(new Set(positions(before).map((p) => p[2]))).toEqual(new Set([1]))
    const after = markOf(kernel.setValue('a', 2), 's3')
    expect(after).not.toBe(before)
    expect(new Set(positions(after).map((p) => p[2]))).toEqual(new Set([2]))
  })
})

// Fix round 1 (Minor 3): a coordinate surface is box-dependent only when a
// default range reads the box (r or ρ over [0, the largest half-span], z over
// the box's z); with its angles alone defaulted it is data, and sizes the box.
describe('the box pass: coordinate surfaces, statement by statement', () => {
  it('spherical: rho = 2 (θ and φ defaulted, a full sphere) sizes the box: [-2, 2]^3 alone, and beside a segment', () => {
    for (const spec of ['spherical: rho = 2', '(0, 0, 0) -- (1, 1, 1)' + '\n' + 'spherical: rho = 2']) {
      const { kernel, space } = kernelOf(spec)
      const scene = kernel.scene()
      expect(scene.errors).toEqual([])
      // ±2 on each axis; niceStep(4, 8) = 0.5 keeps it
      expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([-2, 2], [-2, 2], [-2, 2]))
      const sphere = scene.marks.find((m) => m.kind === 'mesh')!
      for (const p of positions(sphere)) expect(Math.abs(Math.hypot(...p) - 2)).toBeLessThanOrEqual(1e-12)
    }
  })

  it('cylindrical: r = 2 (z defaulted, so it reads the box) spans the box the segment sizes: z in [0, 1]', () => {
    // The segment alone: [0, 1]^3 (niceStep(1, 8) = 0.1 keeps it).
    const { kernel, space } = kernelOf('(0, 0, 0) -- (1, 1, 1)' + '\n' + 'cylindrical: r = 2')
    const scene = kernel.scene()
    expect(scene.errors).toEqual([])
    expect(resolveBox(space, scene.extent, scene.boxSpanning)).toEqual(box([0, 1], [0, 1], [0, 1]))
    expect(range(positions(markOf(scene, 's2')).map((p) => p[2]))).toEqual([0, 1])
  })
})
