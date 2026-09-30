import { describe, expect, it } from 'vitest'
import type { Texture } from './lines/types'
import { textureFilter } from './textures'

// Guards on the masking textures' numbers (review round 1's critical
// finding): `bleed`'s pinhole cut was inverted, knocking out most of every
// ink line — even at grain 0 — because the cut left positive alpha only
// above noise 0.64. These tests read the gain and cut straight out of the
// generated filter markup, so a future retuning that overshoots the same
// way turns one of them red before it ever reaches a rendered figure.

const BOX = { x: 0, y: 0, width: 100, height: 100 }

// A texture's alpha row: the one `feColorMatrix` every masking or tinting
// texture has, an SVG 4x5 "matrix" (row-major R, G, B, A outputs, each a
// weighted sum of the input's R, G, B, A and a constant). Every texture here
// writes its noise mask into the ALPHA output only, as `gain` on the
// turbulence's first channel plus a constant `bias` — positions 15 and 19 of
// the 20 numbers. `bias` is the knock-out cut's negative, for grain, chalk
// and bleed; a coverage floor, for wash and mottle.
function alphaRow(texture: Texture): { gain: number; bias: number } {
  const svg = textureFilter(texture, 'f', BOX)
  const values = [...svg.matchAll(/values="([^"]+)"/g)]
  const last = values[values.length - 1]
  if (!last) throw new Error(`no feColorMatrix in the ${texture.name} filter`)
  const nums = last[1].trim().split(/\s+/).map(Number)
  return { gain: nums[15], bias: nums[19] }
}

const STRENGTHS = Array.from({ length: 11 }, (_, i) => i / 10)

describe('bleed’s pinhole mask', () => {
  it('keeps the line at typical noise, for every strength', () => {
    for (const s of STRENGTHS) {
      const { gain, bias } = alphaRow({ name: 'bleed', strength: s })
      expect(gain * 0.5 + bias, `s=${s}`).toBeGreaterThanOrEqual(1 - 1e-9)
    }
  })

  it('knocks out only the lowest noise, and only once strength is near 1', () => {
    const { gain, bias } = alphaRow({ name: 'bleed', strength: 1 })
    expect(gain * 0.25 + bias).toBeLessThan(0)
  })

  it('never knocks out more as strength falls', () => {
    let lastCut = -Infinity
    for (const s of STRENGTHS) {
      const { bias } = alphaRow({ name: 'bleed', strength: s })
      const cut = -bias
      expect(cut, `s=${s}`).toBeGreaterThanOrEqual(lastCut - 1e-9)
      lastCut = cut
    }
  })
})

describe('every masking line texture keeps the line at typical noise', () => {
  for (const name of ['grain', 'chalk', 'bleed'] as const) {
    it(name, () => {
      for (const s of STRENGTHS) {
        const { gain, bias } = alphaRow({ name, strength: s })
        expect(gain * 0.5 + bias, `${name} s=${s}`).toBeGreaterThanOrEqual(1 - 1e-9)
      }
    })
  }
})

describe('mottle stays subtle', () => {
  it('alpha never drops below 0.7, at any noise level or strength', () => {
    for (const s of STRENGTHS) {
      const { gain, bias } = alphaRow({ name: 'mottle', strength: s })
      // Linear in the noise channel, so both ends of [0, 1] bound it.
      expect(bias, `s=${s} noise=0`).toBeGreaterThanOrEqual(0.7 - 1e-9)
      expect(gain + bias, `s=${s} noise=1`).toBeGreaterThanOrEqual(0.7 - 1e-9)
    }
  })
})
