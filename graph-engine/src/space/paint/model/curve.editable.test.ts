import { describe, expect, it } from 'vitest'
import { randomFor } from '../../../style/random'
import { evalCurve } from '../curves'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { lchToLab, labToLch } from './colour'
import { makeCurve } from './curve'
import { compileCurve, isFlatCurve, isIdentityCurve } from './respond'

const TERRACOTTA = lchToLab(0.56, 0.14, 38)
const GREY = lchToLab(0.5, 0, 0)

describe('editable curves in the lighting curve (spec §11)', () => {
  it('compiles the identity and flat curves to exact functions, so the defaults change nothing', () => {
    const rng = randomFor('curve-identity', 1)
    const id = compileCurve([[0, 0], [1, 1]])
    const flat0 = compileCurve([[0, 0], [1, 0]])
    const flat1 = compileCurve([[0, 1], [1, 1]])
    const flat3 = compileCurve([[0, 0.3], [0.4, 0.3], [1, 0.3]])
    for (let i = 0; i < 200; i++) {
      const x = rng.next()
      expect(id(x)).toBe(x) // not 0.30000000000000004
      expect(flat0(x)).toBe(0)
      expect(flat1(x)).toBe(1)
      expect(flat3(x)).toBe(0.3)
    }
    expect(isIdentityCurve([[0, 0], [1, 1]])).toBe(true)
    expect(isIdentityCurve([[0, 0], [0.5, 0.5], [1, 1]])).toBe(false) // only the plain two-point identity is exact
    expect(isFlatCurve([[0, 0.2], [1, 0.2]])).toBe(true)
    // anything else is read from a table, to within 1e-5 of the contract's evalCurve
    const wavy: [number, number][] = [[0, 0], [0.2, 0.05], [0.25, 0.9], [1, 1]]
    const fn = compileCurve(wavy)
    for (let i = 0; i <= 100; i++) expect(Math.abs(fn(i / 100) - evalCurve(wavy, i / 100))).toBeLessThan(1e-5)
    // and it clamps outside 0..1
    expect(fn(-1)).toBeCloseTo(0, 12)
    expect(fn(2)).toBeCloseTo(1, 12)
  })

  it('leaves L, C and H bit-identical under the default (flat) adjustment curves', () => {
    const base = makeCurve(DEFAULT_PAINT_PARAMS)
    // the same flats written another way: three points, other values only if equal
    const spelled = makeCurve(
      resolvePaintParams({ curves: { lAdjust: [[0, 0], [0.3, 0], [1, 0]], cAdjust: [[0, 1], [0.6, 1], [1, 1]], hAdjust: [[0, 0], [0.5, 0], [1, 0]] } }),
    )
    const rng = randomFor('curve-defaults', 2)
    for (let i = 0; i < 60; i++) {
      const input = { local: lchToLab(0.3 + 0.5 * rng.next(), 0.12 * rng.next(), 360 * rng.next()), u: rng.next(), nz: rng.range(-1, 1), bounce: rng.next() * 0.6, planeHue: rng.range(-10, 10) }
      expect(spelled.lch(input)).toEqual(base.lch(input))
    }
    // and the colour is the spec formula's: the hand values of curve.test.ts hold at the same defaults
    const at = base.lch({ local: TERRACOTTA, u: 0.62, noDev: true })
    expect(at[0]).toBeCloseTo(0.56, 12)
  })

  it('adds lAdjust to L, multiplies C by cAdjust, and adds hAdjust degrees to H', () => {
    const bare = { curve: { tintWarm: 0, tintCool: 0, accentMax: 0 } }
    const base = makeCurve(resolvePaintParams(bare))
    const at = (extra: Record<string, unknown>, colormapped = false) =>
      makeCurve(resolvePaintParams(bare, { curves: extra })).lch({ local: TERRACOTTA, u: 0.62, noDev: true, colormapped })
    const ref = base.lch({ local: TERRACOTTA, u: 0.62, noDev: true })
    // L: a flat +0.05
    const lUp = at({ lAdjust: [[0, 0.05], [1, 0.05]] })
    expect(lUp[0] - ref[0]).toBeCloseTo(0.05, 12)
    expect(lUp[1]).toBeCloseTo(ref[1], 12)
    expect(lUp[2]).toBeCloseTo(ref[2], 9)
    // C: a flat x1.5
    const cUp = at({ cAdjust: [[0, 1.5], [1, 1.5]] })
    expect(cUp[1] / ref[1]).toBeCloseTo(1.5, 12)
    expect(cUp[0]).toBeCloseTo(ref[0], 12)
    expect(cUp[2]).toBeCloseTo(ref[2], 9)
    // H: a flat +20 degrees, a third of it on a colormapped colour
    const hUp = at({ hAdjust: [[0, 20], [1, 20]] })
    expect(hUp[2] - ref[2]).toBeCloseTo(20, 9)
    const refCm = base.lch({ local: TERRACOTTA, u: 0.62, noDev: true, colormapped: true })
    const hCm = at({ hAdjust: [[0, 20], [1, 20]] }, true)
    expect(hCm[2] - refCm[2]).toBeCloseTo(20 / 3, 9)
    expect(hCm[0]).toBeCloseTo(refCm[0], 12)
    // a curve over value: lAdjust peaks at +0.1 at u = 0.5 and is 0 at the ends
    const peak: [number, number][] = [[0, 0], [0.5, 0.1], [1, 0]]
    const mid = makeCurve(resolvePaintParams(bare, { curves: { lAdjust: peak } })).lch({ local: TERRACOTTA, u: 0.5, noDev: true })
    const midRef = base.lch({ local: TERRACOTTA, u: 0.5, noDev: true })
    expect(mid[0] - midRef[0]).toBeCloseTo(0.1, 9)
    const end = makeCurve(resolvePaintParams(bare, { curves: { lAdjust: peak } })).lch({ local: TERRACOTTA, u: 1, noDev: true })
    expect(end[0]).toBeCloseTo(base.lch({ local: TERRACOTTA, u: 1, noDev: true })[0], 12)
    // the adjustment is read at the curve's own u: at u = 0.24 the peak curve is evalCurve's value there
    const low = makeCurve(resolvePaintParams(bare, { curves: { lAdjust: peak } })).lch({ local: TERRACOTTA, u: 0.24, noDev: true })
    const lowRef = base.lch({ local: TERRACOTTA, u: 0.24, noDev: true })
    expect(low[0] - lowRef[0]).toBeCloseTo(evalCurve(peak, 0.24), 5)
  })

  it('absorbs the environment: exactly (cos hue, sin hue) · chroma · absorption · ambientShare in OKLab, L untouched', () => {
    // environment hue 250, chroma 0.02; a grey with no tints so the vector is all there is
    const quiet = { curve: { tintWarm: 0, tintCool: 0, skyTint: 0, bounceTint: 0 } }
    const none = makeCurve(resolvePaintParams(quiet, { environment: { absorption: 0 } }))
    const full = makeCurve(resolvePaintParams(quiet, { environment: { absorption: 1 } }))
    const half = makeCurve(resolvePaintParams(quiet, { environment: { absorption: 0.5 } }))
    const lab = (c: ReturnType<typeof makeCurve>, share: number | undefined, colormapped = false) =>
      lchToLab(...c.lch({ local: GREY, u: 0.62, noDev: true, ambientShare: share, colormapped }))
    const ref = lab(none, 0.5)
    // absorption 0 changes nothing, whatever the share; so does an unknown share
    expect(lab(none, 1)).toEqual(lab(none, undefined))
    expect(lab(full, undefined)).toEqual(ref)
    // absorption 1, share 0.5: the vector 0.02·0.5 = 0.01 at 250 degrees: (-0.0034202, -0.0093969)
    const v = lab(full, 0.5)
    expect(v[1] - ref[1]).toBeCloseTo(0.01 * Math.cos((250 * Math.PI) / 180), 12)
    expect(v[2] - ref[2]).toBeCloseTo(0.01 * Math.sin((250 * Math.PI) / 180), 12)
    expect(v[1] - ref[1]).toBeCloseTo(-0.0034202, 6)
    expect(v[2] - ref[2]).toBeCloseTo(-0.0093969, 6)
    expect(v[0]).toBe(ref[0]) // lightness is never touched
    // proportional in absorption and in the share
    const h = lab(half, 0.5)
    expect(h[1] - ref[1]).toBeCloseTo(0.5 * (v[1] - ref[1]), 12)
    const s = lab(full, 1)
    expect(s[2] - ref[2]).toBeCloseTo(2 * (v[2] - ref[2]), 12)
    // the environment's own hue and chroma are the sliders
    const red = makeCurve(resolvePaintParams(quiet, { environment: { absorption: 1, hue: 0, chroma: 0.04 } }))
    const r = lab(red, 1)
    expect(r[1] - ref[1]).toBeCloseTo(0.04, 12)
    expect(r[2] - ref[2]).toBeCloseTo(0, 12)
    // a colormapped colour takes in a third of it: it is a tint
    const cm = lab(full, 0.5, true)
    expect(cm[1] - ref[1]).toBeCloseTo((v[1] - ref[1]) / 3, 12)
    expect(labToLch(cm)[0]).toBeCloseTo(0.5, 12)
  })
})
