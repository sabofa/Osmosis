import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { MAX_BRISTLES, ROLES } from '../types'
import { bristleCount, brushDeposit, BRISTLE_REACH, CAP_PAD, DRY_TEXTURE_REF, DRY_TEXTURE_SCALE_MAX, dryGate, ribbonCap, rnd4, ROLE_A, toothOf, type BrushStroke } from './brush'

const P = DEFAULT_PAINT_PARAMS
const roleIndex = (name: string) => ROLES.indexOf(name as (typeof ROLES)[number])

describe('ribbonCap: how far the ribbon runs past each end of the path', () => {
  it('is 1.85 spacings of the half width, plus a pixel, with no ceiling: 40 px wide, 10 bristles -> 1.85 x 20 x 0.2 + 1 = 8.4', () => {
    expect(BRISTLE_REACH).toBeCloseTo(1.85, 12)
    expect(CAP_PAD).toBe(1)
    expect(ribbonCap(40, 10)).toBeCloseTo(8.4, 12)
    // far past the 6 px the old clamp allowed: 200 px wide, 6 bristles -> 1.85 x 100 x (2/6) + 1
    expect(ribbonCap(200, 6)).toBeCloseTo(1.85 * 100 * (2 / 6) + 1, 12)
    expect(ribbonCap(200, 6)).toBeGreaterThan(60)
  })

  it('has a floor of a pixel at the narrowest half width (0.6 px) and reads the bristle count as the shader does', () => {
    expect(ribbonCap(0, 8)).toBeCloseTo(1.85 * 0.6 * (2 / 8) + 1, 12)
    // the batch's number is clamped to 2..MAX_BRISTLES and rounded as int(clamp(n + 0.5, 2, MAX))
    expect(bristleCount(1)).toBe(2)
    expect(bristleCount(9)).toBe(9)
    expect(bristleCount(8.6)).toBe(9)
    expect(bristleCount(500)).toBe(MAX_BRISTLES)
    expect(ribbonCap(40, 500)).toBeCloseTo(1.85 * 20 * (2 / MAX_BRISTLES) + 1, 12)
  })
})

describe('rnd4: four numbers in (0, 1) from (seed, index, salt), the shader’s hash', () => {
  it('is deterministic, a byte each, and different for a different seed, index or salt', () => {
    const a = rnd4(12345, 3, 1)
    expect(rnd4(12345, 3, 1)).toEqual(a)
    for (const v of a) {
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
      expect(Math.abs(v * 256 - 0.5 - Math.round(v * 256 - 0.5))).toBeLessThan(1e-9)
    }
    expect(rnd4(12346, 3, 1)).not.toEqual(a)
    expect(rnd4(12345, 4, 1)).not.toEqual(a)
    expect(rnd4(12345, 3, 2)).not.toEqual(a)
  })
})

// The ribbon's start, seen as the shader sees it. The first row of fragments the ribbon covers lies half a pixel inside
// its cap; the paint a bristle lays ends in a round cap of its own that reaches 1.85 spacings past its start, so with
// the cap of ribbonCap that row is past every bristle and the stroke starts as a bristle's round end does. With the cap
// clamped to 6 px, a wide brush was cut off square: the first row was already the full stroke.
describe('the start and end of a stroke, row by row, at 1x, 2x and 4x', () => {
  const stroke = (name: string, scale: number, seed: number, bristleScale = 1): { s: BrushStroke; w: number; len: number } => {
    const rp = P.roles[name as keyof typeof P.roles]
    return {
      s: { role: roleIndex(name), alpha: 1, load: rp.load, bristles: Math.round(rp.bristles * bristleScale), bristleVar: rp.bristleVar, dry: rp.dry, endSoft: 0, seed },
      w: rp.width * scale,
      len: rp.length * scale,
    }
  }
  // the most paint any fragment of the first row (half a pixel inside the cap) of a stroke lays, across the brush
  const startRow = (name: string, scale: number, seed: number, cap: (w: number, bristles: number) => number, bristleScale = 1) => {
    const { s, w, len } = stroke(name, scale, seed, bristleScale)
    const hw = Math.max(w / 2, 0.6)
    let m = 0
    for (let o = -1; o <= 1; o += 0.02) m = Math.max(m, brushDeposit(s, o, -cap(w, s.bristles) + 0.5, hw, len).alpha)
    return m
  }
  const endRow = (name: string, scale: number, seed: number) => {
    const { s, w, len } = stroke(name, scale, seed)
    const hw = Math.max(w / 2, 0.6)
    let m = 0
    for (let o = -1; o <= 1; o += 0.02) m = Math.max(m, brushDeposit(s, o, len + ribbonCap(w, s.bristles) - 0.5, hw, len).alpha)
    return m
  }
  const SEEDS = 150
  const seeds = Array.from({ length: SEEDS }, (_, k) => (k * 2654435761) >>> 8)
  const oldCap = (w: number, bristles: number) => Math.min(Math.max((1.6 * w) / Math.max(bristles, 1), 1), 6)

  for (const name of ['block', 'dab', 'edge']) {
    it(`${name}: nothing is laid in the first row of the ribbon (at most 5%), at the strokes’ own size and twice and four times it, and the same at the end`, () => {
      for (const scale of [1, 2, 4]) {
        let mean = 0
        let max = 0
        let endMax = 0
        for (const seed of seeds) {
          for (const bristleScale of [0.88, 1, 1.12]) {
            const v = startRow(name, scale, seed, ribbonCap, bristleScale)
            max = Math.max(max, v)
            if (bristleScale === 1) mean += v / SEEDS
          }
          endMax = Math.max(endMax, endRow(name, scale, seed))
        }
        expect(mean, `${name} x${scale} mean`).toBeLessThanOrEqual(0.05)
        expect(max, `${name} x${scale} max`).toBeLessThanOrEqual(0.05)
        expect(endMax, `${name} x${scale} end`).toBeLessThanOrEqual(0.05)
      }
    })
  }

  it('is not vacuous: the stroke does lay paint in its body, and with the old 6 px ceiling a wide brush was already at full strength in its first row', () => {
    // the body of a block stroke at 4x, mid-stroke, is solid
    const { s, w, len } = stroke('block', 4, seeds[3])
    let body = 0
    for (let o = -1; o <= 1; o += 0.02) body = Math.max(body, brushDeposit(s, o, len * 0.3, w / 2, len).alpha)
    expect(body).toBeGreaterThan(0.5)
    // the old cap: block at 4x (width 88, 9 bristles -> a cap of 6 px against a reach of 1.85 x 44 x 2/9 = 18 px), measured 0.96
    let mean = 0
    for (const seed of seeds) mean += startRow('block', 4, seed, oldCap) / SEEDS
    expect(mean).toBeGreaterThan(0.5)
    // and the new cap is more than the old one wherever the old one was clamped
    expect(ribbonCap(88, 9)).toBeGreaterThan(oldCap(88, 9) * 2.5)
  })

  it('keeps the ribbon’s side clear too: at the lateral edge of the ribbon (1.3 half widths + 1.2 px) nothing is laid', () => {
    for (const name of ['block', 'dab', 'edge']) {
      for (const scale of [1, 2, 4]) {
        let max = 0
        for (const seed of seeds.slice(0, 40)) {
          const { s, w, len } = stroke(name, scale, seed)
          const hw = Math.max(w / 2, 0.6)
          const extent = (hw * 1.3 + 1.2) / hw
          for (let q = 0; q <= 40; q++) {
            const arc = (len * q) / 40
            max = Math.max(max, brushDeposit(s, extent - 0.5 / hw, arc, hw, len).alpha, brushDeposit(s, -extent + 0.5 / hw, arc, hw, len).alpha)
          }
        }
        expect(max, `${name} x${scale}`).toBeLessThanOrEqual(0.05)
      }
    }
  })

  it('reads the role’s own constants: a block stroke is opaque to 0.96, a dab to 0.96, an edge to 0.95', () => {
    expect(ROLE_A[4 * roleIndex('block')]).toBeCloseTo(0.96, 6)
    expect(ROLE_A[4 * roleIndex('dab')]).toBeCloseTo(0.96, 6)
    expect(ROLE_A[4 * roleIndex('edge')]).toBeCloseTo(0.95, 6)
  })
})

// The dry brush catches the canvas's tooth. The paper normalises its height to a standard deviation of 0.2 whatever the
// canvas texture, so the gate has to scale it by the slider or the weave a dry stroke catches never changes with it. The
// gate was tuned with the tooth unscaled, which is the default texture (0.5): there the scale must be exactly 1.
describe('the dry gate and the canvas texture', () => {
  // the gate as it was before the slider reached it (fix round 1): the raw tile height, whatever the texture
  const smooth = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  const gateBefore = (dep: number, hg: number, dry: number, t: number) => {
    const tail = smooth(1 - Math.min(Math.max(dry, 0.1), 1), 1, t)
    const dryEff = dry * (0.5 + 0.5 * tail)
    return dryEff > 0 ? smooth(0.08 + 0.12 * dryEff, 0.26 + 0.22 * dryEff, dep + 0.45 * hg) : smooth(0.03, 0.12, dep)
  }

  it('scales the tooth by the texture over the default, 0.5: exactly 1 at the default, up to twice, and never below 0', () => {
    expect(DRY_TEXTURE_REF).toBe(0.5)
    expect(DRY_TEXTURE_SCALE_MAX).toBe(2)
    for (const h of [-0.5, -0.2, 0, 0.13, 0.4, 0.5]) expect(toothOf(h, 0.5)).toBe(h) // bit for bit
    expect(toothOf(0.4, 1)).toBeCloseTo(0.8, 12)
    expect(toothOf(0.4, 0.1)).toBeCloseTo(0.08, 12)
    expect(toothOf(0.4, 0.25)).toBeCloseTo(0.2, 12)
    expect(toothOf(0.4, 0)).toBe(0)
    // the scale stops at 2: texture 1 and anything past it read the same, and a negative texture is no tooth
    expect(toothOf(0.4, 1.5)).toBeCloseTo(0.8, 12)
    expect(toothOf(0.4, 2)).toBeCloseTo(0.8, 12)
    expect(toothOf(0.4, -1)).toBe(0)
  })

  it('keeps the default look: at texture 0.5 the gate is the one before the fix, for every deposit, tooth, dry brush and place on the stroke', () => {
    for (const dry of [0, 0.15, 0.6, 1]) {
      for (const t of [0, 0.3, 0.5, 0.9, 1]) {
        for (let dep = 0; dep <= 0.6; dep += 0.02) {
          for (const hg of [-0.45, -0.2, 0, 0.2, 0.45]) {
            expect(dryGate(dep, toothOf(hg, 0.5), dry, t), `dep ${dep} hg ${hg} dry ${dry} t ${t}`).toBe(gateBefore(dep, hg, dry, t))
          }
        }
      }
    }
  })

  it('keeps the default look on a real stroke: every point of a block stroke lays what it laid before, at texture 0.5', () => {
    const rp = P.roles.block
    const stroke: BrushStroke = { role: roleIndex('block'), alpha: 1, load: rp.load, bristles: rp.bristles, bristleVar: rp.bristleVar, dry: 0.6, endSoft: 0, seed: 777 }
    const hw = rp.width / 2
    let compared = 0
    for (let o = -0.9; o <= 0.9; o += 0.1) {
      for (let s = 0; s < rp.length; s += 3) {
        for (const hg of [-0.3, 0.3]) {
          // hg raw is the tooth as it was read before the fix
          expect(brushDeposit(stroke, o, s, hw, rp.length, toothOf(hg, 0.5)).alpha).toBe(brushDeposit(stroke, o, s, hw, rp.length, hg).alpha)
          compared++
        }
      }
    }
    expect(compared).toBeGreaterThan(200)
  })

  it('differs between a low and a high texture: texture 0.1 and 1 gate the same deposit differently (hand values, dry 0.15, mid-stroke)', () => {
    // dry 0.15 at t = 0.5: the tail is 0, so the effective dry is 0.075, the gate runs g0 = 0.08 + 0.12 x 0.075 = 0.089 to
    // g1 = 0.26 + 0.22 x 0.075 = 0.2765 over dep + 0.45 x tooth. Tile height 0.4 over a thin deposit of 0.1:
    //   default (0.5): tooth 0.4, 0.1 + 0.18 = 0.28, past g1: 1
    expect(dryGate(0.1, toothOf(0.4, 0.5), 0.15, 0.5)).toBe(1)
    //   texture 1: tooth 0.8, 0.1 + 0.36 = 0.46: 1
    expect(dryGate(0.1, toothOf(0.4, 1), 0.15, 0.5)).toBe(1)
    //   texture 0.1: tooth 0.08, 0.1 + 0.036 = 0.136: x = (0.136 - 0.089) / 0.1875 = 0.2507, smoothstep 0.2507^2 (3 - 2 x 0.2507) = 0.1570
    expect(dryGate(0.1, toothOf(0.4, 0.1), 0.15, 0.5)).toBeCloseTo(0.157, 3)
    // over a low tile height (-0.4) of a deposit of 0.2 the texture holds paint back instead:
    //   texture 1: tooth -0.8, 0.2 - 0.36 < 0: 0 (the default's 0.2 - 0.18 = 0.02 is 0 too)
    expect(dryGate(0.2, toothOf(-0.4, 1), 0.15, 0.5)).toBe(0)
    expect(dryGate(0.2, toothOf(-0.4, 0.5), 0.15, 0.5)).toBe(0)
    //   texture 0.1: tooth -0.08, 0.2 - 0.036 = 0.164: x = 0.4, smoothstep 0.16 x 2.2 = 0.352
    expect(dryGate(0.2, toothOf(-0.4, 0.1), 0.15, 0.5)).toBeCloseTo(0.352, 3)
  })

  it('is the loaded brush’s gate, with no tooth in it, for a stroke with no dry brush', () => {
    expect(dryGate(0.075, 0.5, 0, 0.5)).toBeCloseTo(0.5, 12) // sstep(0.03, 0.12, 0.075): the midpoint of the smoothstep
    expect(dryGate(0.075, -0.5, 0, 0.5)).toBeCloseTo(0.5, 12)
  })

  it('changes what a real block stroke lays: a high tile height adds paint at texture 1 that texture 0.1 leaves out, and a low one takes it away', () => {
    const rp = P.roles.block
    const stroke: BrushStroke = { role: roleIndex('block'), alpha: 1, load: rp.load, bristles: rp.bristles, bristleVar: rp.bristleVar, dry: 0.6, endSoft: 0, seed: 777 }
    const hw = rp.width / 2
    let tested = 0
    for (let o = -0.9; o <= 0.9; o += 0.05) {
      for (let s = rp.length * 0.4; s < rp.length; s += 2) {
        const { dep } = brushDeposit(stroke, o, s, hw, rp.length)
        // a deposit in the band the gate is not already shut or open for
        if (dep < 0.1 || dep > 0.25) continue
        const high1 = brushDeposit(stroke, o, s, hw, rp.length, toothOf(0.4, 1)).alpha
        const high01 = brushDeposit(stroke, o, s, hw, rp.length, toothOf(0.4, 0.1)).alpha
        const low1 = brushDeposit(stroke, o, s, hw, rp.length, toothOf(-0.4, 1)).alpha
        const low01 = brushDeposit(stroke, o, s, hw, rp.length, toothOf(-0.4, 0.1)).alpha
        expect(high1).toBeGreaterThanOrEqual(high01)
        expect(low1).toBeLessThanOrEqual(low01)
        if (high1 - high01 > 0.01 && low01 - low1 > 0.01) tested++
      }
    }
    expect(tested).toBeGreaterThan(5)
  })
})
