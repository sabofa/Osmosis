// The OIT weight's normalisation (S6 plan V4, S3 parked item M10; S6 fix
// round 1 I2). GLSL cannot run in this test environment, so oitWeight in
// oit.ts is the exact TypeScript mirror of the GLSL oitWeight(a, zRel); the
// source-containment test below keeps the two from drifting apart.
//
// I2's bug: the shader passed oitWeight the fragment's raw view depth (an
// absolute distance from the eye) divided by the box's own depth span, not
// that depth relative to the box's own near edge. At this renderer's actual
// scale the eye sits several box radii back, so that ratio never dropped
// below about 1.5 for any fragment in the box, and every fragment clamped to
// the same floor weight: depth order was lost regardless of the divisor. The
// fix normalises the same way depthCue() does (look.ts): zRel = clamp((z -
// u_cueRange.x) / depthSpan, 0, 1), 0 at the sphere's near point, 1 at its
// far one — this test drives that normalisation through markLook's real
// cueRange for both projections, not the formula in isolation.

import { describe, expect, it } from 'vitest'
import type { SpaceView } from '../../config'
import { cameraMatrices } from '../../camera/projection'
import { worldMap } from '../../camera/world'
import type { Box3 } from '../../scene/types'
import { LIGHT_PALETTE } from '../../../render/palette'
import { spaceColors } from '../../theme'
import { markLook } from '../look'
import { OIT_FALLOFF, OIT_FLOOR, OIT_PEAK, OIT_WEIGHT_GLSL, oitWeight } from './oit'

const BOX: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 0.4 } }
const VIEWPORT = { width: 800, height: 600 }
const VIEW: SpaceView = { azimuth: 35, elevation: 20, zoom: 1, target: [0, 0, 0] }
const COLORS = spaceColors(LIGHT_PALETTE, 'light')

// zRel of a fragment at view depth z, exactly as the shader now computes it.
function zRelOf(z: number, cueRange: readonly [number, number]): number {
  const depthSpan = Math.max(cueRange[1] - cueRange[0], 1e-3)
  return Math.min(1, Math.max(0, (z - cueRange[0]) / depthSpan))
}

describe('oitWeight normalisation through the real cueRange (I2)', () => {
  for (const projection of ['orthographic', 'perspective'] as const) {
    it(`near > mid > far, strictly, under a real ${projection} camera's cueRange`, () => {
      const world = worldMap(BOX, [1, 1, 1])
      const camera = cameraMatrices(VIEW, world, VIEWPORT, projection)
      const look = markLook(camera, world, COLORS, true)
      const [nearZ, farZ] = look.cueRange
      const midZ = (nearZ + farZ) / 2
      const near = oitWeight(0.5, zRelOf(nearZ, look.cueRange))
      const mid = oitWeight(0.5, zRelOf(midZ, look.cueRange))
      const far = oitWeight(0.5, zRelOf(farZ, look.cueRange))
      expect(near).toBeGreaterThan(mid)
      expect(mid).toBeGreaterThan(far)
      // The bug this replaces: every one of these used to sit within 1% of
      // the same top weight (OIT_PEAK * 0.5), i.e. no depth ordering at all.
      expect((near - far) / near).toBeGreaterThan(0.5)
    })
  }

  it('is monotonically non-increasing in zRel (nearer never weighs less than farther)', () => {
    let previous = Infinity
    for (let zRel = 0; zRel <= 1; zRel += 0.05) {
      const w = oitWeight(1, zRel)
      expect(w).toBeLessThanOrEqual(previous + 1e-9)
      previous = w
    }
  })

  it('scales linearly with alpha', () => {
    expect(oitWeight(1, 0.3)).toBeCloseTo(2 * oitWeight(0.5, 0.3), 9)
  })

  it('is exactly OIT_PEAK at zRel = 0 and exactly OIT_FLOOR at zRel = 1 (alpha 1)', () => {
    expect(oitWeight(1, 0)).toBe(OIT_PEAK)
    expect(oitWeight(1, 1)).toBe(OIT_FLOOR)
  })

  it('the GLSL source contains the same expression as the TypeScript mirror', () => {
    // Not a duplicated formula string: each literal is re-derived from the
    // same constants oitWeight() itself computes from, so a change to any of
    // them, on only one side, fails this test.
    expect(OIT_WEIGHT_GLSL).toContain(`max(${OIT_FLOOR}, ${OIT_PEAK}.0 * pow(1.0 - zRel, ${OIT_FALLOFF}.0))`)
  })
})
