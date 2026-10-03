import { describe, expect, it } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { labToLch, lchInGamut, lchToLab } from './colour'
import { makeCurve } from './curve'
import { halfToneLowest, reflectedMax } from './value'

// A terracotta local colour: L 0.56, C 0.14, h 38°.
const TERRACOTTA = lchToLab(0.56, 0.14, 38)

describe('lighting curve', () => {
  // Hand computation for u = 0.62 (the pivot), spec §3.4:
  //   L = 0.56 + 0.80·(0.62 − 0.62)                        = 0.56
  //   C = 0.14·(0.42 + 0.88·exp(−(0.12/0.25)²))            = 0.14·1.11903 = 0.156647
  //   s = (0.62 − 0.5)/0.4 = 0.3 (warm), arc(38 → 75°) = 37
  //   H = 38 + 0.40·0.3·37                                  = 42.44
  //     + accent: clamp(0.5·arc(38 → 95°) = 28.5, ±18) = 18, × exp(−((0.62 − 0.56)/0.17)²) = 0.8829 → 15.892
  //                                                         = 58.332
  //   then the warm tint 0.018·0.3 = 0.0054 at 75° (OKLab a, b only):
  //   a = 0.156647·cos 58.332° + 0.0054·cos 75° = 0.083737
  //   b = 0.156647·sin 58.332° + 0.0054·sin 75° = 0.138481  → C 0.161828, h 58.880°
  it.each([
    // u, L, C, h (final, after the tint)
    [0.24, 0.256, 0.103236, 355.3322],
    [0.5, 0.464, 0.182, 53.8918],
    [0.62, 0.56, 0.161828, 58.8802],
    [0.9, 0.784, 0.085292, 57.6385],
  ])('a terracotta local colour at u = %f follows the spec formulas, with the swing cap off', (u, L, C, h) => {
    // (curve.shiftMax is the cap on the warm and cool swing and on the tints' hue: at 360 the formulas are the spec's, bit for bit)
    const out = makeCurve(resolvePaintParams({ curve: { shiftMax: 360 } })).lch({ local: TERRACOTTA, u, noDev: true })
    expect(out[0]).toBeCloseTo(L, 5)
    expect(out[1]).toBeCloseTo(C, 5)
    expect(out[2]).toBeCloseTo(h, 3)
  })

  it('swings warm in the lights and cool in the shadows, with chroma peaking in the half-tones', () => {
    // tints and accent off, so only the swing moves the hue
    const swing = resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, shiftMax: 360 } })
    const at = (u: number) => makeCurve(swing).lch({ local: TERRACOTTA, u, noDev: true })
    // u = 0.9: s = 1, arc(38 -> 75) = +37, H = 38 + 0.40·37 = 52.8 (toward warm)
    expect(at(0.9)[2]).toBeCloseTo(52.8, 6)
    // u = 0.24: s = -0.65, arc(38 -> 280) = -118, H = 38 - 0.46·0.65·118 = 2.718 (toward cool, the short way)
    expect(at(0.24)[2]).toBeCloseTo(2.718, 6)
    // at the middle of the value range there is no swing at all
    expect(at(0.5)[2]).toBeCloseTo(38, 9)
    // chroma is a bell in u: the half-tone beats both ends at the same local chroma
    const c = (u: number) => at(u)[1]
    expect(c(0.5)).toBeGreaterThan(c(0.24))
    expect(c(0.5)).toBeGreaterThan(c(0.9))
    expect(c(0.5)).toBeCloseTo(0.14 * (0.42 + 0.88), 9) // the bell's peak: cc·(cBase + cPeak)
    // and the lightness follows the slope: 0.56 + 0.8·(u - 0.62)
    expect(at(0.24)[0]).toBeCloseTo(0.56 + 0.8 * (0.24 - 0.62), 9)
  })

  it('never lets a tint touch lightness, and keeps the grey tints in a/b only', () => {
    const grey = lchToLab(0.5, 0, 0)
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    // u = 0.9 and a grey local colour: L is exactly 0.5 + 0.8·0.28
    const lit = curve.lch({ local: grey, u: 0.9, noDev: true })
    expect(lit[0]).toBeCloseTo(0.724, 9)
    // all the chroma is the warm tint: 0.018·|s| with s = 1
    expect(lit[1]).toBeCloseTo(0.018, 9)
    expect(lit[2]).toBeCloseTo(75, 6)
    // a sky tint (0.030 at 250°) on an up-facing grey in the shadow, with the cool tint
    // (0.022·0.75 = 0.0165 at 280°): a = −0.007395, b = −0.044440 → C 0.045051, h 260.552°
    const shade = curve.lch({ local: grey, u: 0.2, nz: 1, noDev: true })
    expect(shade[0]).toBeCloseTo(0.5 + 0.8 * (0.2 - 0.62), 9)
    expect(shade[1]).toBeCloseTo(0.045051, 5)
    expect(shade[2]).toBeCloseTo(260.552, 2)
    // a bounce tint (0.034 at 68°) on a down-facing grey: a = 0.015602, b = 0.015275
    const under = curve.lch({ local: grey, u: 0.2, nz: -1, noDev: true })
    expect(under[1]).toBeCloseTo(0.021834, 5)
    expect(under[2]).toBeCloseTo(44.393, 2)
  })

  it('mixes the bounce colour’s hue and chroma into reflected light, up to 0.55, and never touches L', () => {
    const grey = lchToLab(0.5, 0, 0)
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    const bare = curve.lch({ local: grey, u: 0.62, noDev: true })
    // b = 0.45 gives w = 0.55: a and b move that far toward the bounce colour (the canvas tone at L − 0.04, ×2.1 its chroma)
    const [bl, ba, bb] = lchToLab(curve.bounceLch[0], curve.bounceLch[1], curve.bounceLch[2])
    expect(bl).toBeGreaterThan(0.85)
    const [l0, a0, b0] = lchToLab(...bare)
    const refl = curve.lch({ local: grey, u: 0.62, bounce: 0.45, noDev: true })
    const [l1, a1, b1] = lchToLab(...refl)
    expect(a1).toBeCloseTo(a0 + (ba - a0) * 0.55, 9)
    expect(b1).toBeCloseTo(b0 + (bb - b0) * 0.55, 9)
    // the value is the plan's: the bounce colour is a light one, and the mix does not lift L toward it
    expect(l1).toBeCloseTo(l0, 12)
    expect(refl[0]).toBeCloseTo(bare[0], 12)
    // the mix saturates there: b = 0.9 changes nothing more; a smaller b mixes proportionally less (w = 0.275)
    const [, a2, b2] = lchToLab(...curve.lch({ local: grey, u: 0.62, bounce: 0.9, noDev: true }))
    expect([a2, b2]).toEqual([a1, b1])
    const [, a3] = lchToLab(...curve.lch({ local: grey, u: 0.62, bounce: 0.225, noDev: true }))
    expect(a3).toBeCloseTo(a0 + (ba - a0) * 0.275, 9)
  })

  it('keeps reflected light under the shadow ceiling: no bounce tint or bounce mix lifts L past the lightness the plan’s cap gives', () => {
    // every colour term that could lift a shadow, at its slider maximum
    const loud = resolvePaintParams({
      curve: { reflectedBounceMix: 1, bounceTint: 0.1, skyTint: 0.1 },
      environment: { chroma: 0.2, absorption: 1 },
      light: { bounce: 1, sky: 1, ambient: 1 },
    })
    const ceilingU = reflectedMax(loud)
    const floorU = halfToneLowest(loud)
    const curve = makeCurve(loud)
    for (const local of [lchToLab(0.3, 0.05, 20), lchToLab(0.56, 0.14, 38), lchToLab(0.8, 0.1, 200), lchToLab(0.95, 0.02, 90), lchToLab(0.5, 0, 0)]) {
      // the lightness the curve gives the cap, with the bounce off: the shadow family's ceiling for this colour
      const ceiling = curve.lch({ local, u: ceilingU, noDev: true })[0]
      const halfTone = curve.lch({ local, u: floorU, noDev: true })[0]
      for (const nz of [-1, -0.5, 0, 0.5, 1]) {
        for (const bounce of [0, 0.1, 0.45, 0.85, 1.275]) {
          for (let k = 0; k <= 20; k++) {
            const u = (k / 20) * ceilingU
            const L = curve.lch({ local, u, nz, bounce, ambientShare: 1, noDev: true })[0]
            expect(L, `u ${u}, bounce ${bounce}, nz ${nz}`).toBeLessThanOrEqual(ceiling + 1e-9)
          }
        }
      }
      // and the ceiling is well under the darkest half-tone: what the plan keeps apart, the colour keeps apart (for a
      // colour whose lightness is away from the soft clamps at the ends of the range, which squeeze the gap)
      const mid = labToLch(local)[0]
      if (mid > 0.45 && mid < 0.7) {
        expect(halfTone - ceiling).toBeGreaterThanOrEqual(loud.curve.lSlope * (1 - loud.value.reflectedShare) * (floorU - loud.value.corePlateau) - 1e-9)
      }
      expect(halfTone).toBeGreaterThan(ceiling)
    }
  })

  it('rotates a colormapped colour by a third, and scales its tints by a third', () => {
    // with the accent and the tints off, the swing is exactly k·|s|·arc: a third of it
    const bare = resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, skyTint: 0, bounceTint: 0, shiftMax: 360 } })
    const curve = makeCurve(bare)
    for (const [u, swing] of [[0.24, -35.282], [0.9, 14.8]] as const) {
      // u = 0.24: 0.46·0.65·(−118) = −35.282;  u = 0.9: 0.40·1·37 = 14.8
      const full = curve.lch({ local: TERRACOTTA, u, noDev: true })
      const third = curve.lch({ local: TERRACOTTA, u, noDev: true, colormapped: true })
      expect(full[2] - 38).toBeCloseTo(swing, 6)
      expect(third[2] - 38).toBeCloseTo(swing / 3, 6)
      // the value is held either way: L and C do not depend on the rotation
      expect(third[0]).toBeCloseTo(full[0], 9)
      expect(third[1]).toBeCloseTo(full[1], 9)
    }
    // tints: on a grey the warm tint is the only chroma, 0.018 whole, 0.006 colormapped
    const grey = lchToLab(0.5, 0, 0)
    const d = makeCurve(DEFAULT_PAINT_PARAMS)
    expect(d.lch({ local: grey, u: 0.9, noDev: true })[1]).toBeCloseTo(0.018, 9)
    expect(d.lch({ local: grey, u: 0.9, noDev: true, colormapped: true })[1]).toBeCloseTo(0.006, 9)
    // the capped swing (12°) is shared the same way: a third of it, 4°
    const capped = makeCurve(resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, skyTint: 0, bounceTint: 0 } }))
    expect(capped.lch({ local: TERRACOTTA, u: 0.24, noDev: true })[2] - 38).toBeCloseTo(-12, 9)
    expect(capped.lch({ local: TERRACOTTA, u: 0.24, noDev: true, colormapped: true })[2] - 38).toBeCloseTo(-4, 9)
    // colormapHue is the slider: 1 gives the whole rotation back
    const whole = makeCurve(resolvePaintParams({ curve: { colormapHue: 1 } }))
    expect(whole.lch({ local: grey, u: 0.9, noDev: true, colormapped: true })[1]).toBeCloseTo(0.018, 9)
  })

  describe('the swing is relative to the local colour and capped (curve.shiftMax)', () => {
    const arc = (from: number, to: number) => ((to - from + 540) % 360) - 180
    const BLUE = lchToLab(0.35, 0.12, 260)
    // every zone of the shadow family (the contact 0.2, the core 0.24, the cast 0.32, up to the cap 0.352 and a little under), under every
    // sky and bounce, with and without reflected light and the environment's share of the light
    const shadows = [0.1, 0.2, 0.24, 0.32, 0.352]
    const sweep = (curve: ReturnType<typeof makeCurve>, local: readonly number[]) => {
      const hues: number[] = []
      for (const u of shadows) for (const nz of [-1, -0.5, 0, 0.5, 1]) for (const bounce of [0, 0.5, 1.275]) for (const ambientShare of [0, 1]) hues.push(curve.lch({ local, u, nz, bounce, ambientShare, noDev: true })[2])
      return hues
    }

    it('turns a colour toward its own warmer or cooler neighbour by at most shiftMax: a terracotta’s core is a dark red, a blue stays blue (hand values)', () => {
      // swing alone: tints, accent, sky and bounce off
      const bare = makeCurve(resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, skyTint: 0, bounceTint: 0 } }))
      // terracotta 38°: u 0.24 would pull it 0.46·0.65·(−118) = −35.3° toward 280°, and u 0.9 0.40·37 = +14.8° toward 75°: held to ∓12
      expect(bare.lch({ local: TERRACOTTA, u: 0.24, noDev: true })[2]).toBeCloseTo(26, 9)
      expect(bare.lch({ local: TERRACOTTA, u: 0.9, noDev: true })[2]).toBeCloseTo(50, 9)
      // a blue 260°: its cool target is 20° away, 0.46·0.65·20 = +5.98°: under the cap, as it was; the warm side 0.4·175 = 70°: held to 12
      expect(bare.lch({ local: BLUE, u: 0.24, noDev: true })[2]).toBeCloseTo(265.98, 9)
      expect(bare.lch({ local: BLUE, u: 0.9, noDev: true })[2]).toBeCloseTo(272, 9)
      // the cap is the slider: 6° halves it, and 0 is no swing at all
      const six = makeCurve(resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, skyTint: 0, bounceTint: 0, shiftMax: 6 } }))
      expect(six.lch({ local: TERRACOTTA, u: 0.24, noDev: true })[2]).toBeCloseTo(32, 9)
      const none = makeCurve(resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0, accentMax: 0, skyTint: 0, bounceTint: 0, shiftMax: 0 } }))
      expect(none.lch({ local: TERRACOTTA, u: 0.24, noDev: true })[2]).toBeCloseTo(38, 9)
    })

    it('keeps a terracotta’s shadows within 38° ± 15°, never toward purple, under every tint, sky, bounce and the environment', () => {
      const curve = makeCurve(DEFAULT_PAINT_PARAMS)
      for (const h of sweep(curve, TERRACOTTA)) expect(Math.abs(arc(38, h)), `hue ${h.toFixed(1)}`).toBeLessThanOrEqual(15 + 1e-6)
      // the same colours before: a swing to 345° at the core, the purple Ben saw
      const old = makeCurve(resolvePaintParams({ curve: { shiftMax: 360 } }))
      expect(Math.max(...sweep(old, TERRACOTTA).map((h) => Math.abs(arc(38, h))))).toBeGreaterThan(45)
    })

    it('keeps a blue object’s shadows within its own hue ± 15°', () => {
      for (const h of sweep(makeCurve(DEFAULT_PAINT_PARAMS), BLUE)) expect(Math.abs(arc(260, h)), `hue ${h.toFixed(1)}`).toBeLessThanOrEqual(15 + 1e-6)
    })

    it('holds the tints, the sky, the bounce and the environment to shiftMax + 3° of the colour’s own hue, at every value, as loud as the sliders go', () => {
      // every colour term at its slider maximum, accent off: the colour's own hue is 38° and the swing is at its cap
      const loud = resolvePaintParams({
        curve: { tintWarm: 0.1, tintCool: 0.1, skyTint: 0.1, bounceTint: 0.1, reflectedBounceMix: 1, accentMax: 0 },
        environment: { chroma: 0.2, absorption: 1 },
      })
      const curve = makeCurve(loud)
      let worst = 0
      for (let k = 0; k <= 20; k++) {
        for (const nz of [-1, 0, 1]) for (const bounce of [0, 0.45]) {
          const h = curve.lch({ local: TERRACOTTA, u: k / 20, nz, bounce, ambientShare: 1, noDev: true })[2]
          worst = Math.max(worst, Math.abs(arc(38, h)))
        }
      }
      expect(worst).toBeLessThanOrEqual(15 + 1e-6)
      // without the hold (the cap off) the same colour terms turn it far past that
      const free = makeCurve(resolvePaintParams({ ...loud, curve: { ...loud.curve, shiftMax: 360 } }))
      let freeWorst = 0
      for (let k = 0; k <= 20; k++) freeWorst = Math.max(freeWorst, Math.abs(arc(38, free.lch({ local: TERRACOTTA, u: k / 20, nz: 1, ambientShare: 1, noDev: true })[2])))
      expect(freeWorst).toBeGreaterThan(40)
    })

    it('never touches lightness, however loud the colour terms: the swing and the hold turn the hue only', () => {
      const loud = resolvePaintParams({ curve: { tintCool: 0.1, skyTint: 0.1, accentMax: 0 }, environment: { chroma: 0.2, absorption: 1 } })
      const held = makeCurve(loud).lch({ local: TERRACOTTA, u: 0.24, nz: 1, ambientShare: 1, noDev: true })
      const free = makeCurve(resolvePaintParams({ ...loud, curve: { ...loud.curve, shiftMax: 360 } })).lch({ local: TERRACOTTA, u: 0.24, nz: 1, ambientShare: 1, noDev: true })
      expect(held[0]).toBeCloseTo(free[0], 12)
      expect(held[0]).toBeCloseTo(0.56 + 0.8 * (0.24 - 0.62), 12)
      expect(Math.abs(arc(38, held[2]))).toBeLessThan(Math.abs(arc(38, free[2])))
    })

    it('restores roughly the old behaviour at shiftMax 60, and takes a grey’s tints whole at any cap', () => {
      const at = (shiftMax: number) => makeCurve(resolvePaintParams({ curve: { shiftMax } })).lch({ local: TERRACOTTA, u: 0.24, noDev: true })[2]
      // the core hue at the defaults is the spec's 355.3° (42.7° from the colour's own); a cap of 12 holds it to within 15°, a cap of 60 does not
      expect(Math.abs(arc(38, at(12)))).toBeLessThanOrEqual(15 + 1e-6)
      expect(at(60)).toBeCloseTo(at(360), 9)
      expect(Math.abs(arc(38, at(60)))).toBeGreaterThan(40)
      // a grey has no hue of its own to keep: the cool tint and the sky are whole, whatever the cap
      const grey = lchToLab(0.5, 0, 0)
      const shade = (shiftMax: number) => makeCurve(resolvePaintParams({ curve: { shiftMax } })).lch({ local: grey, u: 0.2, nz: 1, noDev: true })
      expect(shade(0)[2]).toBeCloseTo(260.552, 2)
      expect(shade(12)[1]).toBeCloseTo(0.045051, 5)
    })
  })

  it('adds the plane hue and chroma steps, the lightness scale and the per-stroke jitter', () => {
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    const base = curve.lch({ local: TERRACOTTA, u: 0.62, noDev: true })
    const stepped = curve.lch({ local: TERRACOTTA, u: 0.62, noDev: true, planeHue: 10, planeChroma: 0.05 })
    // the step turns the hue by 10° before the tint, and scales chroma by 1.05
    const bareP = resolvePaintParams({ curve: { tintWarm: 0, tintCool: 0 } })
    const b0 = makeCurve(bareP).lch({ local: TERRACOTTA, u: 0.62, noDev: true })
    const b1 = makeCurve(bareP).lch({ local: TERRACOTTA, u: 0.62, noDev: true, planeHue: 10, planeChroma: 0.05 })
    expect(b1[2] - b0[2]).toBeCloseTo(10, 6)
    expect(b1[1] / b0[1]).toBeCloseTo(1.05, 6)
    expect(stepped[2]).toBeGreaterThan(base[2])
    // lScale halves the slope: u = 0.9 → 0.56 + 0.8·0.5·0.28 = 0.672
    expect(curve.lch({ local: TERRACOTTA, u: 0.9, noDev: true, lScale: 0.5 })[0]).toBeCloseTo(0.672, 9)
    // the jitter adds to L, scales C and adds to H
    const j = curve.lch({ local: TERRACOTTA, u: 0.62, noDev: true, j: [0.01, 0.1, 2] })
    expect(j[0]).toBeCloseTo(0.57, 9)
    // lightness is softly clamped at the ends: a very light result is pulled in
    expect(curve.lch({ local: lchToLab(0.9, 0.02, 40), u: 0.98, noDev: true })[0]).toBeCloseTo(0.92 + (0.9 + 0.8 * 0.36 - 0.92) * 0.5, 9)
  })

  it('is seeded and smooth: the same seed repeats, another seed differs, and nothing jumps', () => {
    const a = makeCurve(DEFAULT_PAINT_PARAMS)
    const b = makeCurve(DEFAULT_PAINT_PARAMS)
    const other = makeCurve(resolvePaintParams({ seed: 7 }))
    const dev = (c: ReturnType<typeof makeCurve>, u: number) => c.deviation(u)
    expect(dev(a, 0.37)).toEqual(dev(b, 0.37))
    expect(dev(a, 0.37)).not.toEqual(dev(other, 0.37))
    expect(a.devU(0.3, -0.2, 0.9)).toBe(b.devU(0.3, -0.2, 0.9))
    // the deviation is bounded by the sum of its three amplitudes, and continuous
    let maxL = 0
    let maxStep = 0
    let prev = dev(a, 0)[0]
    for (let i = 1; i <= 1000; i++) {
      const d = dev(a, i / 1000)
      maxL = Math.max(maxL, Math.abs(d[0]))
      maxStep = Math.max(maxStep, Math.abs(d[0] - prev))
      prev = d[0]
      expect(Math.abs(d[1])).toBeLessThanOrEqual(0.06 + 0.04 + 0.025 + 1e-9)
      expect(Math.abs(d[2])).toBeLessThanOrEqual(2.2 + 1.4 + 0.8 + 1e-9)
    }
    expect(maxL).toBeLessThanOrEqual(0.02 + 1e-9)
    expect(maxL).toBeGreaterThan(0.001)
    expect(maxStep).toBeLessThan(0.0006) // smooth: no step above amplitude × 2π × f_max / 1000
    // and it moves the colour by the deviation (L only)
    const withDev = a.lch({ local: TERRACOTTA, u: 0.4 })
    const without = a.lch({ local: TERRACOTTA, u: 0.4, noDev: true })
    expect(withDev[0] - without[0]).toBeCloseTo(a.deviation(0.4)[0], 9)
  })

  it('keeps the plan-value deviation inside ±value.deviation and smooth in space', () => {
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    let max = 0
    let maxJump = 0
    let prev = curve.devU(-1, 0.2, 0.1)
    for (let i = 1; i <= 2000; i++) {
      const v = curve.devU(-1 + (2 * i) / 2000, 0.2, 0.1)
      max = Math.max(max, Math.abs(v))
      maxJump = Math.max(maxJump, Math.abs(v - prev))
      prev = v
    }
    expect(max).toBeLessThanOrEqual(0.018 + 1e-9)
    expect(max).toBeGreaterThan(0.005)
    expect(maxJump).toBeLessThan(0.0005)
    // over a whole volume the bound is the amplitude itself (sin·cos + 0.6·sin never exceeds 1.6, divided by 1.6)
    // and it is nearly reached: the sum of the two terms peaks at 1.6 where both are 1
    let volMax = 0
    for (let ix = -20; ix <= 20; ix++) {
      for (let iy = -10; iy <= 10; iy++) {
        for (let iz = -10; iz <= 10; iz++) volMax = Math.max(volMax, Math.abs(curve.devU(ix * 0.3, iy * 0.4, iz * 0.4)))
      }
    }
    expect(volMax).toBeLessThanOrEqual(0.018 + 1e-9)
    expect(volMax).toBeGreaterThan(0.017)
    // a different seed moves it; zero deviation removes it
    expect(makeCurve(resolvePaintParams({ seed: 3 })).devU(0.4, 0.2, 0.1)).not.toBe(curve.devU(0.4, 0.2, 0.1))
    expect(makeCurve(resolvePaintParams({ value: { deviation: 0 } })).devU(0.4, 0.2, 0.1)).toBeCloseTo(0, 12)
  })

  it('gives a plane a smooth hue and chroma step from its mean normal', () => {
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    const [h, c] = curve.planeStep(0.3, -0.2, 0.9)
    // at most 10° + 6° of hue, 5% of chroma
    expect(Math.abs(h)).toBeLessThanOrEqual(16 + 1e-9)
    expect(Math.abs(c)).toBeLessThanOrEqual(0.05 + 1e-9)
    expect(curve.planeStep(0.3, -0.2, 0.9)).toEqual([h, c])
    // neighbouring normals get neighbouring steps (planes differ by 8-20° overall, but smoothly)
    const [h2] = curve.planeStep(0.31, -0.2, 0.9)
    expect(Math.abs(h2 - h)).toBeLessThan(0.5)
  })

  it('fits to the gamut after the curve', () => {
    const curve = makeCurve(DEFAULT_PAINT_PARAMS)
    const vivid = lchToLab(0.7, 0.3, 140)
    const fitted = labToLch(curve.lab({ local: vivid, u: 0.62, noDev: true }))
    expect(lchInGamut(fitted[0], fitted[1], fitted[2])).toBe(true)
  })
})
