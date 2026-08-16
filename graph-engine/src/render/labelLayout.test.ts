import { describe, expect, it } from 'vitest'
import { clampedLabelPlacement } from './labelLayout'

const RIGHT: { x: number; y: number } = { x: 1, y: 0 }

describe('clampedLabelPlacement', () => {
  it('behaves as plain fixed-pixel placement when no cap is given', () => {
    const p = clampedLabelPlacement({ x: 5, y: 5 }, RIGHT, 0.3, 1.2, 0.6, null)
    expect(p.position).toEqual({ x: 5.3, y: 5 })
    expect(p.width).toBe(1.2)
    expect(p.height).toBe(0.6)
  })

  it('does not shrink the label when the cap is looser than the raw offset', () => {
    const p = clampedLabelPlacement({ x: 0, y: 0 }, RIGHT, 0.3, 1.2, 0.6, 5)
    expect(p.position.x).toBeCloseTo(0.3, 10)
    expect(p.width).toBe(1.2)
    expect(p.height).toBe(0.6)
  })

  // The scenario this whole fix targets: a shape zoomed out far enough that
  // the fixed-pixel label offset (rawOffset) has grown past the shape's own
  // size. Using numbers from an actual extreme-zoom-out reproduction — a
  // hexagon of radius 3 (so ~3 world units between neighboring vertices),
  // viewed at a camera zoomed out to viewHeight=200 on a ~700px-tall canvas
  // (worldPerPixel ~= 0.2857), giving a raw label offset of
  // 19.8px * 0.2857 =~ 5.66 world units — nearly twice the hexagon's own
  // radius, let alone the tighter cap.
  it('shrinks both the offset and the label size by the same ratio once the cap engages', () => {
    const rawOffset = 5.66
    const rawWidth = 60 * 0.2857 // ~17.1
    const rawHeight = 30 * 0.2857 // ~8.6
    const maxOffset = 0.75 // e.g. 25% of a ~3-unit nearest-neighbor spacing
    const p = clampedLabelPlacement({ x: 3, y: 0 }, RIGHT, rawOffset, rawWidth, rawHeight, maxOffset)

    const ratio = maxOffset / rawOffset
    expect(p.position.x - 3).toBeCloseTo(maxOffset, 10) // offset itself is capped exactly at maxOffset
    expect(p.width).toBeCloseTo(rawWidth * ratio, 10)
    expect(p.height).toBeCloseTo(rawHeight * ratio, 10)

    // The property that actually matters: width-to-offset and height-to-
    // offset stay at *exactly* the same ratio they'd be at with no clamp at
    // all (offset/width/height all scaled by the identical factor) — a
    // clamped label looks like a smaller version of an unclamped one, not a
    // differently-proportioned one.
    expect(p.width / (p.position.x - 3)).toBeCloseTo(rawWidth / rawOffset, 10)
    expect(p.height / (p.position.x - 3)).toBeCloseTo(rawHeight / rawOffset, 10)
  })

  it('is a no-op (offset 0) when rawOffset is 0, regardless of maxOffset', () => {
    const p = clampedLabelPlacement({ x: 1, y: 1 }, RIGHT, 0, 10, 5, 0.5)
    expect(p.position).toEqual({ x: 1, y: 1 })
  })
})
