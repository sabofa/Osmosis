import { describe, expect, it } from 'vitest'
import { pixelSizeXY } from './pixelSize'

describe('pixelSizeXY', () => {
  it('a 6 px circle is an ellipse in world units: rx = r/ppu.x, ry = r/ppu.y', () => {
    const s = pixelSizeXY(6, { x: 1 / 40, y: 1 / 20 })
    expect(s.x).toBeCloseTo(0.15)
    expect(s.y).toBeCloseTo(0.3)
  })
})

import { clampedLabelPlacementXY } from './labelLayout'

describe('clampedLabelPlacementXY', () => {
  it('offsets x by the x scale and y by the y scale; the cap shrinks the box by the same ratio', () => {
    const p = clampedLabelPlacementXY({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0.1, y: 0.2 }, 0.6, 0.6, null)
    expect(p.position.x).toBeCloseTo(1.1)
    expect(p.position.y).toBeCloseTo(1.2)
    const q = clampedLabelPlacementXY({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.1, y: 0.2 }, 0.6, 0.6, 0.05)
    expect(q.position.x).toBeCloseTo(0.05)
    expect(q.width).toBeCloseTo(0.3)
  })
})
