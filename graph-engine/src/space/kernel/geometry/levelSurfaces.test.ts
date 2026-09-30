// S6 fix round 1, I7: 3-variable contour: (level surfaces) marches the same
// way an implicit surface does (implicit.ts, geometry/marchingTets.ts) but
// had not been given implicit.ts's V11 fix — held (a play or a drag)
// remeshed at full resolution every frame regardless. This mirrors
// implicit.test.ts's own "progressive resolution while held" coverage.

import { describe, expect, it } from 'vitest'
import type { MeshMark } from '../../scene/types'
import { kernelOf, vertices } from '../../testing/kernel'

const CUBE3 = '@bounds3d: x [-3, 3], y [-3, 3], z [-3, 3]'

describe('S6 fix round 1, I7: progressive resolution while held (3-variable contour:)', () => {
  const BOX3 = { x: { min: -3, max: 3 }, y: { min: -3, max: 3 }, z: { min: -3, max: 3 } }
  const SPHERE = `${CUBE3}\n@param a = 2 range [1, 3]\ng(x, y, z) = x^2 + y^2 + z^2\ncontour: g level a^2 res: 32`

  it('meshes coarser while held than the very next release, at the same value — the release is a real rebuild, not a stale one, though the box never moved', () => {
    const kernel = kernelOf(SPHERE)
    const held = kernel.setValue('a', 2.5, { holdBox: BOX3 })
    const heldMesh = held.marks[0] as MeshMark
    const heldVertices = heldMesh.positions.length / 3
    const released = kernel.setValues(new Map())
    const releasedMesh = released.marks[0] as MeshMark
    expect(releasedMesh).not.toBe(heldMesh)
    const releasedVertices = releasedMesh.positions.length / 3
    // res 16 (held: heldRes(32, true)) vs res 32 (released): markedly
    // sparser, not just a rounding difference.
    expect(heldVertices).toBeLessThan(releasedVertices * 0.5)
    // Both are the true sphere at the same radius: a lower-poly
    // approximation while held, never a wrong one.
    for (const p of vertices(heldMesh.positions)) expect(Math.hypot(...p)).toBeCloseTo(2.5, 6)
    for (const p of vertices(releasedMesh.positions)) expect(Math.hypot(...p)).toBeCloseTo(2.5, 6)
  })

  it('does not rebuild again while held at the same value: one rebuild per change, not per frame', () => {
    const kernel = kernelOf(SPHERE)
    const a = kernel.setValue('a', 2.5, { holdBox: BOX3 }).marks[0]
    const b = kernel.setValue('a', 2.5, { holdBox: BOX3 }).marks[0]
    expect(b).toBe(a)
  })
})

// Gate fix M1: level surfaces mesh through the same grid as an implicit
// surface (implicit.ts), and are owed the same fix — the halved
// held-resolution grid can legitimately find no cell for a surface
// smaller than its own cells, where the full resolution would. It is
// rebuilt once at the full resolution instead, before ever being reported
// missing (implicit.test.ts proves the shared mechanism; this proves
// levelSurfaces.ts actually wires it in).
describe('gate fix M1: a small level surface never vanishes while held', () => {
  const BOX5 = { x: { min: -5, max: 5 }, y: { min: -5, max: 5 }, z: { min: -5, max: 5 } }
  const F = '(x-0.15)^2 + (y-0.15)^2 + (z-0.15)^2'
  // Default res (64, no res: clause): held halves it to 32, a 0.3125 cell —
  // wider than the sphere's 0.242 diameter (a = 0.121), so the held grid's
  // corners can all land outside it; the full 64 grid still finds it.
  const TINY_LEVEL = `@bounds3d: x [-5, 5], y [-5, 5], z [-5, 5]\n@param a = 0.12 range [0.05, 1]\ncontour: ${F} level a^2`

  it('a level surface the halved (32) grid entirely misses still draws while held, rebuilt at the full 64', () => {
    const kernel = kernelOf(TINY_LEVEL)
    const held = kernel.setValue('a', 0.121, { holdBox: BOX5 })
    expect(held.errors).toEqual([])
    const mesh = held.marks[0] as MeshMark
    expect(mesh.indices.length).toBeGreaterThan(0)
    for (const [x, y, z] of vertices(mesh.positions)) expect(Math.hypot(x - 0.15, y - 0.15, z - 0.15)).toBeCloseTo(0.121, 2)
  })

  it('a level missing at every resolution is still refused, its message never quoting the halved res', () => {
    const kernel = kernelOf(`@bounds3d: x [-5, 5], y [-5, 5], z [-5, 5]\n@param a = 0.12 range [0.05, 1]\ncontour: ${F} level -a^2 - 1`)
    const held = kernel.setValue('a', 0.121, { holdBox: BOX5 })
    expect(held.errors).toHaveLength(1)
    expect(held.errors[0].line).toBe(3)
    expect(held.errors[0].message).toMatch(/does not meet the box$/)
    expect(held.errors[0].message).not.toMatch(/res 32|res 16/)
  })
})
