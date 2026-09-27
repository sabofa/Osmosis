import { describe, expect, it } from 'vitest'
import type { Vec3 } from '../scene/types'
import { parametricMesh } from '../testing/marks'
import { buildBvh, intersectBvh, intersectTriangles, LEAF_SIZE } from './bvh'
import type { Ray } from './types'

// A torus, R = 2, r = 0.7, on a 40 x 40 grid.
const torus = parametricMesh(
  (u, v) => [(2 + 0.7 * Math.cos(v)) * Math.cos(u), (2 + 0.7 * Math.cos(v)) * Math.sin(u), 0.7 * Math.sin(v)],
  (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
  0,
  2 * Math.PI,
  0,
  2 * Math.PI,
  40,
  40,
)

// A seeded linear congruential generator (Numerical Recipes' constants), in [0, 1).
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

describe('the BVH', () => {
  it('agrees with brute force on 200 pseudo-random rays over a 40 x 40 torus', () => {
    const bvh = buildBvh(torus.positions, torus.indices)
    const random = lcg(20260927)
    let hits = 0
    for (let i = 0; i < 200; i++) {
      // From a point on a sphere of radius 5 toward a point near the torus.
      const a = random() * 2 * Math.PI
      const b = Math.acos(2 * random() - 1)
      const origin: Vec3 = [5 * Math.sin(b) * Math.cos(a), 5 * Math.sin(b) * Math.sin(a), 5 * Math.cos(b)]
      const aim: Vec3 = [(random() - 0.5) * 6, (random() - 0.5) * 6, (random() - 0.5) * 2]
      const ray: Ray = { origin, direction: [aim[0] - origin[0], aim[1] - origin[1], aim[2] - origin[2]] }
      const brute = intersectTriangles(torus.positions, torus.indices, ray, 0, Infinity)
      const fast = intersectBvh(bvh, torus.positions, torus.indices, ray, 0, Infinity)
      expect([i, fast]).toEqual([i, brute])
      if (brute) hits++
    }
    // The rays are not all misses (nor all hits).
    expect(hits).toBeGreaterThan(40)
    expect(hits).toBeLessThan(200)
  })

  it('splits down to leaves of at most 8 triangles', () => {
    const bvh = buildBvh(torus.positions, torus.indices)
    const leaves = Array.from(bvh.left.keys()).filter((n) => bvh.left[n] < 0)
    expect(leaves.every((n) => bvh.count[n] >= 1 && bvh.count[n] <= LEAF_SIZE)).toBe(true)
    // Every triangle is in exactly one leaf.
    const total = leaves.reduce((s, n) => s + bvh.count[n], 0)
    expect(total).toBe(torus.indices.length / 3)
  })
})
