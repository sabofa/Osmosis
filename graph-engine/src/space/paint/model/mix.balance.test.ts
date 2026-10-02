import { describe, expect, it } from 'vitest'
import { randomFor } from '../../../style/random'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import type { Oklab } from '../types'
import { lchToLab } from './colour'
import { LoadMixer, nextSign, type MixResult } from './mix'

const TERRACOTTA: Oklab = lchToLab(0.55, 0.12, 40)

// One result per load (the first stroke of each).
function firstOfEachLoad(params: PaintParams, loads: number, u = 0.6): MixResult[] {
  const mixer = new LoadMixer(params)
  const out: MixResult[] = []
  for (let i = 0; out.length < loads; i++) {
    const r = mixer.mix({ role: 'block', cell: i, u, x: 0, y: 0, lab: TERRACOTTA, colormapped: false, seed: i, jitter: 0 })
    if (r.index === 0) out.push(r)
  }
  return out
}
const share = (xs: number[]): number => xs.filter((x) => x > 0).length / xs.length

describe('the ± balance of the brush-load mix (spec §11)', () => {
  it('has the + direction come up (1 + bias)/2 of the time: 75% at bias 0.5, for hue, chroma and value steps', () => {
    const p = resolvePaintParams({ mix: { hueBias: 0.5, chromaBias: 0.5, valueBias: 0.5 } })
    const loads = firstOfEachLoad(p, 3000)
    // hue: + is counter-clockwise
    expect(share(loads.map((l) => l.hueOffset))).toBeGreaterThan(0.72)
    expect(share(loads.map((l) => l.hueOffset))).toBeLessThan(0.78)
    // chroma: + is up
    expect(share(loads.map((l) => l.chromaOffset))).toBeGreaterThan(0.72)
    expect(share(loads.map((l) => l.chromaOffset))).toBeLessThan(0.78)
    // value steps, among the loads that take one
    const steps = loads.map((l) => l.step).filter((s) => s !== 0)
    expect(steps.length).toBeGreaterThan(600)
    expect(share(steps)).toBeGreaterThan(0.71)
    expect(share(steps)).toBeLessThan(0.79)
  })

  it('is symmetric at bias 0, mirrored at a negative bias, and one-sided at ±1', () => {
    const sym = firstOfEachLoad(DEFAULT_PAINT_PARAMS, 3000)
    expect(share(sym.map((l) => l.hueOffset))).toBeGreaterThan(0.47)
    expect(share(sym.map((l) => l.hueOffset))).toBeLessThan(0.53)
    const neg = firstOfEachLoad(resolvePaintParams({ mix: { hueBias: -0.5, chromaBias: -0.5 } }), 3000)
    expect(share(neg.map((l) => l.hueOffset))).toBeGreaterThan(0.22)
    expect(share(neg.map((l) => l.hueOffset))).toBeLessThan(0.28)
    expect(share(neg.map((l) => l.chromaOffset))).toBeGreaterThan(0.22)
    expect(share(neg.map((l) => l.chromaOffset))).toBeLessThan(0.28)
    const up = firstOfEachLoad(resolvePaintParams({ mix: { hueBias: 1, chromaBias: 1, valueBias: 1 } }), 500)
    expect(up.every((l) => l.hueOffset > 0 && l.chromaOffset > 0 && l.step >= 0)).toBe(true)
    const down = firstOfEachLoad(resolvePaintParams({ mix: { hueBias: -1, chromaBias: -1, valueBias: -1 } }), 500)
    expect(down.every((l) => l.hueOffset < 0 && l.chromaOffset < 0 && l.step <= 0)).toBe(true)
  })

  it('still alternates: neighbours flip 80% of the time at bias 0, and less as the bias pulls the chain to one side', () => {
    const flips = (p: PaintParams) => {
      const loads = firstOfEachLoad(p, 3000)
      let n = 0
      for (let i = 1; i < loads.length; i++) if (Math.sign(loads[i].hueOffset) !== Math.sign(loads[i - 1].hueOffset)) n++
      return n / (loads.length - 1)
    }
    expect(flips(DEFAULT_PAINT_PARAMS)).toBeGreaterThan(0.77)
    expect(flips(DEFAULT_PAINT_PARAMS)).toBeLessThan(0.83)
    // at 0.75 + the chain flips 2·0.75·0.25·λ with λ = min(1.6, 1/0.75) = 4/3: half the time
    const biased = flips(resolvePaintParams({ mix: { hueBias: 0.5 } }))
    expect(biased).toBeGreaterThan(0.46)
    expect(biased).toBeLessThan(0.54)
  })

  it('walks a two-state chain with the stationary share the bias asks for', () => {
    const rng = randomFor('nextSign', 3)
    // pi = 0.75, f = 0.8: from + flip with probability λ(1 − π) = 1/3, from − with λπ = 1
    let sign = 0
    let plus = 0
    let flips = 0
    const n = 60000
    for (let i = 0; i < n; i++) {
      const next = nextSign(sign, 0.75, 0.8, rng.next())
      if (sign !== 0 && next !== sign) flips++
      sign = next
      if (sign > 0) plus++
    }
    expect(plus / n).toBeGreaterThan(0.74)
    expect(plus / n).toBeLessThan(0.76)
    expect(flips / n).toBeGreaterThan(0.48)
    expect(flips / n).toBeLessThan(0.52)
    // exact transition rules, by hand: draws just under and over the thresholds
    expect(nextSign(1, 0.75, 0.8, 0.33)).toBe(-1) // below 1/3
    expect(nextSign(1, 0.75, 0.8, 0.34)).toBe(1)
    expect(nextSign(-1, 0.75, 0.8, 0.999)).toBe(1) // λπ = 1: a minus always flips to +
    // the first sign is the bias itself
    expect(nextSign(0, 0.75, 0.8, 0.74)).toBe(1)
    expect(nextSign(0, 0.75, 0.8, 0.76)).toBe(-1)
    // at pi = 0.5 it is the plain anti-correlation: flip when the draw is under f
    expect(nextSign(1, 0.5, 0.8, 0.79)).toBe(-1)
    expect(nextSign(1, 0.5, 0.8, 0.81)).toBe(1)
    expect(nextSign(-1, 0.5, 0.8, 0.79)).toBe(1)
  })

  it('leaves the offset magnitudes alone: the bias only chooses the sign', () => {
    const plain = firstOfEachLoad(DEFAULT_PAINT_PARAMS, 400)
    const biased = firstOfEachLoad(resolvePaintParams({ mix: { hueBias: 0.5 } }), 400)
    for (const l of [...plain, ...biased]) {
      expect(Math.abs(l.hueOffset)).toBeGreaterThanOrEqual(12 - 1e-6)
      expect(Math.abs(l.hueOffset)).toBeLessThanOrEqual(25 + 1e-6)
    }
  })
})

describe('the mix strength over value (spec §11)', () => {
  const hue = (p: PaintParams, u: number) => firstOfEachLoad(p, 1, u)[0].hueOffset

  it('multiplies the strength by curves.mixAmount at the stroke’s value', () => {
    // the identity-to-flat default is 1 everywhere: the offset is the same at any value
    expect(hue(DEFAULT_PAINT_PARAMS, 0.2)).toBe(hue(DEFAULT_PAINT_PARAMS, 0.9))
    const full = hue(DEFAULT_PAINT_PARAMS, 0.5)
    // a rising curve: mixAmount(u) = u, so the offset at u = 0.5 is half of full, at u = 0.25 a quarter
    const ramp = resolvePaintParams({ curves: { mixAmount: [[0, 0], [1, 1]] } })
    expect(hue(ramp, 0.5)).toBeCloseTo(0.5 * full, 12)
    expect(hue(ramp, 0.25)).toBeCloseTo(0.25 * full, 12)
    // a flat 2 doubles it; a flat 0 is no mix at all
    expect(hue(resolvePaintParams({ curves: { mixAmount: [[0, 2], [1, 2]] } }), 0.5)).toBeCloseTo(2 * full, 12)
    const mixer = new LoadMixer(resolvePaintParams({ curves: { mixAmount: [[0, 0], [1, 0]] } }))
    const r = mixer.mix({ role: 'block', cell: 1, u: 0.5, x: 0, y: 0, lab: TERRACOTTA, colormapped: false, seed: 1 })
    expect(r.lab).toEqual(TERRACOTTA)
    expect(mixer.loads).toBe(0)
    // it multiplies with the master strength and the role's own scale
    const both = resolvePaintParams({ mix: { strength: 2, roleBlock: 0.5 }, curves: { mixAmount: [[0, 0.5], [1, 0.5]] } })
    expect(hue(both, 0.5)).toBeCloseTo(0.5 * full, 12) // 2 x 0.5 x 0.5 = 0.5
  })
})
