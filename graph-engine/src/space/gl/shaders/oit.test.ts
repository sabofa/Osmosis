// The OIT weight's normalisation (S6 plan V4, S3 parked item M10). GLSL
// cannot run in this test environment, so oitWeightTs below is a byte-for-
// byte mirror of OIT_WEIGHT_GLSL's oitWeight(a, z, depthSpan) — keep them in
// sync. What it proves: normalising z by the box's own view-space depth span
// (u_cueRange.y - u_cueRange.x, look.ts) — not a fixed literal 200 — is what
// makes nearer layers dominate over farther ones, at the small view-space
// scale this renderer actually draws at (box half-extents at most 1).

import { describe, expect, it } from 'vitest'

function oitWeightTs(a: number, z: number, depthSpan: number): number {
  return a * clamp(0.03 / (1e-5 + (z / depthSpan) ** 4), 1e-2, 3e3)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

// The fixed literal the fix replaces, kept here only to prove the bug it fixed.
const OLD_FIXED_DIVISOR = 200

describe('oitWeight normalisation (V4)', () => {
  it('at the scale this renderer actually draws at (box half-extents <= 1, so depthSpan is a few units), a near and a far layer get meaningfully different weight', () => {
    const depthSpan = 2 * Math.hypot(1, 1, 0.7) // a typical auto-aspect box's bounding sphere diameter
    const near = oitWeightTs(0.5, 0, depthSpan)
    const far = oitWeightTs(0.5, depthSpan, depthSpan)
    expect(near).toBeGreaterThan(far * 10)
  })

  it('reproduces the bug the fix replaces: the old fixed divisor (200) saturates every fragment to the same weight at this renderer\'s scale', () => {
    const depthSpan = 2 * Math.hypot(1, 1, 0.7)
    const near = oitWeightTs(0.5, 0, OLD_FIXED_DIVISOR)
    const far = oitWeightTs(0.5, depthSpan, OLD_FIXED_DIVISOR)
    // Both sit within 1% of the same top weight: no depth ordering at all.
    expect(Math.abs(near - far) / near).toBeLessThan(0.01)
    expect(near).toBeCloseTo(0.5 * 3e3, 6)
  })

  it('is monotonically non-increasing in z (nearer never weighs less than farther)', () => {
    const depthSpan = 3
    let previous = Infinity
    for (let z = 0; z <= depthSpan * 2; z += depthSpan / 20) {
      const w = oitWeightTs(1, z, depthSpan)
      expect(w).toBeLessThanOrEqual(previous + 1e-9)
      previous = w
    }
  })

  it('scales linearly with alpha', () => {
    const depthSpan = 2.3
    expect(oitWeightTs(1, 1, depthSpan)).toBeCloseTo(2 * oitWeightTs(0.5, 1, depthSpan), 9)
  })

  it('a degenerate depthSpan (guarded to >= 1e-3 in the shader) does not divide by zero', () => {
    expect(Number.isFinite(oitWeightTs(1, 0.001, 1e-3))).toBe(true)
  })
})
