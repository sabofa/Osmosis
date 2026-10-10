import { describe, expect, it } from 'vitest'
import { clampedLabelPlacement, labelBoxesPx, titleLayout, type TitlePlacement } from './labelLayout'
import { gridPlan } from './grid'
import { defaultConfig } from '../parser/config'
import { TITLE } from '../plot/frame/tuning'

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

describe('titleLayout', () => {
  const B = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 }
  const both = { x: 't (s)', y: 'v (m/s)' }
  const boxOf = (p: TitlePlacement, b: typeof B, w: number, h: number) => {
    const wp = p.text.length * TITLE.charPx
    const px = ((p.at.x - b.xMin) / (b.xMax - b.xMin)) * w
    const py = ((b.yMax - p.at.y) / (b.yMax - b.yMin)) * h
    const left = p.align === 'end' ? px - wp : px
    const top = p.baseline === 'bottom' ? py - TITLE.heightPx : py
    return { x: left, y: top, w: wp, h: TITLE.heightPx }
  }
  const hit = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  type Box = { x: number; y: number; w: number; h: number }

  it('returns nothing without titles', () => {
    expect(titleLayout({ bounds: B, widthPx: 800, heightPx: 600, titles: { x: '', y: '' }, labelBoxesPx: [] })).toEqual([])
  })

  it('puts the x title flush right, just above the axis line', () => {
    const [p] = titleLayout({ bounds: B, widthPx: 800, heightPx: 600, titles: { x: 'time', y: '' }, labelBoxesPx: [] })
    expect(p.axis).toBe('x')
    expect(p.align).toBe('end')
    expect(p.baseline).toBe('bottom')
    const inset = (TITLE.marginPx / 800) * 20
    expect(p.at.x).toBeCloseTo(10 - inset, 9)
    expect(p.at.y).toBeCloseTo(((TITLE.marginPx / 600) * 12), 9) // y=0 axis, margin above it
  })

  it('sits above the bottom edge when the axis is pinned there', () => {
    const b = { xMin: -10, xMax: 10, yMin: 2, yMax: 8 }
    const [p] = titleLayout({ bounds: b, widthPx: 800, heightPx: 600, titles: { x: 'time', y: '' }, labelBoxesPx: [] })
    expect(p.at.y).toBeCloseTo(2 + (TITLE.marginPx / 600) * 6, 9)
  })

  it('puts the y title at the top, right of the axis line, or inside the left edge when pinned', () => {
    const [p] = titleLayout({ bounds: B, widthPx: 800, heightPx: 600, titles: { x: '', y: 'v' }, labelBoxesPx: [] })
    expect(p).toMatchObject({ axis: 'y', align: 'start', baseline: 'top', rotate: false })
    expect(p.at.x).toBeCloseTo((TITLE.marginPx / 800) * 20, 9)
    const pinned = titleLayout({ bounds: { ...B, xMin: 3, xMax: 13 }, widthPx: 800, heightPx: 600, titles: { x: '', y: 'v' }, labelBoxesPx: [] })[0]
    expect(pinned.at.x).toBeCloseTo(3 + (TITLE.marginPx / 800) * 10, 9)
  })

  it('moves the x title left off a tick label', () => {
    const blocker = { x: 740, y: 280, w: 60, h: 40 } // sits where the x title lands
    const [p] = titleLayout({ bounds: B, widthPx: 800, heightPx: 600, titles: { x: 'time', y: '' }, labelBoxesPx: [blocker] })
    expect(hit(boxOf(p, B, 800, 600), blocker)).toBe(false)
  })

  for (const [w, h] of [[800, 600], [300, 200]] as const) {
    it(`keeps both titles clear of each other and of the real tick labels at ${w}x${h}`, () => {
      const plan = gridPlan(B, defaultConfig(), { widthPx: w, heightPx: h }, { x: (20 / w) * 20, y: (14 / h) * 12 }, { x: (14 / w) * 20, y: (14 / h) * 12 })
      const boxes = labelBoxesPx([...plan.labelsX, ...plan.labelsY], B, w, h)
      expect(boxes.length).toBeGreaterThan(0)
      const out = titleLayout({ bounds: B, widthPx: w, heightPx: h, titles: both, labelBoxesPx: boxes })
      expect(out).toHaveLength(2)
      const tb = out.map((p) => boxOf(p, B, w, h))
      expect(hit(tb[0], tb[1])).toBe(false)
      for (const t of tb) for (const l of boxes) expect(hit(t, l)).toBe(false)
    })
  }

  it('does not throw on a title wider than the view', () => {
    const out = titleLayout({ bounds: B, widthPx: 40, heightPx: 30, titles: { x: 'a very long x title', y: 'and a long y title' }, labelBoxesPx: [{ x: 0, y: 0, w: 40, h: 30 }] })
    expect(out).toHaveLength(2)
  })

  it('is deterministic', () => {
    const o = { bounds: B, widthPx: 800, heightPx: 600, titles: both, labelBoxesPx: [{ x: 700, y: 280, w: 60, h: 40 }] }
    expect(titleLayout(o)).toEqual(titleLayout(o))
  })
})
