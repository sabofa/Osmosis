import { describe, expect, it } from 'vitest'
import type { PaintDebug } from '../types'
import { EDGE_CLASS_COLOURS, greyForLightness, planeColour, planesImage, planeTintImage, valueImage, zonesImage } from './debug'

const debug = (over: Partial<PaintDebug>): PaintDebug => ({
  value: new Float32Array(0),
  planes: new Int32Array(0),
  zones: new Uint8Array(0),
  edgeSegments: new Float32Array(0),
  edgeClass: new Uint8Array(0),
  ...over,
})

describe('the value view', () => {
  it('draws the value as OKLab lightness 0.12 + 0.84 u: u = 0 -> grey 6, 0.5 -> 111, 1 -> 242', () => {
    const img = valueImage(Float32Array.from([0, 0.5, 1]))
    expect(Array.from(img.subarray(0, 4))).toEqual([6, 6, 6, 255])
    expect(Array.from(img.subarray(4, 8))).toEqual([111, 111, 111, 255])
    expect(Array.from(img.subarray(8, 12))).toEqual([242, 242, 242, 255])
  })

  it('leaves an empty pixel (-1) transparent, so the background shows', () => {
    const img = valueImage(Float32Array.from([-1]))
    expect(Array.from(img)).toEqual([0, 0, 0, 0])
  })

  it('converts lightness to a grey with that OKLab lightness: L = 0.5 -> linear 0.125 -> sRGB 0.38857', () => {
    expect(greyForLightness(0.5)).toBeCloseTo(0.38857, 4)
  })
})

describe('the zones view', () => {
  it('colours the five zones flat, and leaves 255 (empty) transparent', () => {
    const img = zonesImage(debug({ zones: Uint8Array.from([0, 2, 255]) }))
    // light: (0.96, 0.9, 0.62) -> 245, 230, 158; core: (0.36, 0.22, 0.42) -> 92, 56, 107
    expect(Array.from(img.subarray(0, 4))).toEqual([245, 230, 158, 255])
    expect(Array.from(img.subarray(4, 8))).toEqual([92, 56, 107, 255])
    expect(img[11]).toBe(0)
  })
})

describe('the planes view', () => {
  it('gives each plane id its own stable colour, and an empty pixel (-1) none', () => {
    expect(planeColour(3)).toEqual(planeColour(3))
    expect(planeColour(3)).not.toEqual(planeColour(4))
    const img = planesImage(debug({ planes: Int32Array.from([3, 4, -1]) }))
    expect(Array.from(img.subarray(0, 3))).not.toEqual(Array.from(img.subarray(4, 7)))
    expect(img[3]).toBe(255)
    expect(img[11]).toBe(0)
  })

  it('tints the edge view backdrop with faint greys, close to the background', () => {
    const img = planeTintImage(debug({ planes: Int32Array.from([0, 1, 2, 3, 4, 5, -1]) }))
    for (let i = 0; i < 6; i++) {
      expect(img[i * 4]).toBeGreaterThanOrEqual(214)
      expect(img[i * 4]).toBeLessThanOrEqual(230)
      expect(img[i * 4]).toBe(img[i * 4 + 1])
    }
    expect(img[27]).toBe(0)
  })
})

describe('the edge class colours', () => {
  it('are lost grey, soft blue, firm orange, hard red', () => {
    const c = (i: number) => Array.from(EDGE_CLASS_COLOURS.subarray(i * 3, i * 3 + 3))
    const [lost, soft, firm, hard] = [c(0), c(1), c(2), c(3)]
    expect(lost[0]).toBeCloseTo(lost[1], 6)
    expect(lost[1]).toBeCloseTo(lost[2], 6)
    expect(soft[2]).toBeGreaterThan(soft[0])
    expect(firm[0]).toBeGreaterThan(firm[2] + 0.4)
    expect(firm[1]).toBeGreaterThan(firm[2])
    expect(hard[0]).toBeGreaterThan(hard[1] + 0.5)
    expect(hard[0]).toBeGreaterThan(hard[2] + 0.5)
  })
})
