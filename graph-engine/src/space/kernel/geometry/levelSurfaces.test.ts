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
