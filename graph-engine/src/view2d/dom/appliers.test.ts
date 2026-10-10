import { describe, expect, it } from 'vitest'
import { contentToScreen } from '../camera'
import type { Camera, Rect, Size } from '../types'
import { cssTransformValue, overscanLayout, viewBoxValue } from './appliers'

describe('viewBoxValue', () => {
  it('writes the window as the four numbers of a viewBox', () => {
    expect(viewBoxValue({ x: -10, y: 5, width: 200, height: 100 })).toBe('-10 5 200 100')
  })

  it('keeps precision a three-decimal format would lose, for a window deep inside a drawing', () => {
    const value = viewBoxValue({ x: 12.3456789, y: -0.000123456, width: 0.0625, height: 0.04321 })
    expect(value).toBe('12.3456789 -0.000123456 0.0625 0.04321')
  })

  it('refuses a window that is not a finite positive box, rather than writing NaN into the markup', () => {
    expect(viewBoxValue({ x: 0, y: 0, width: 0, height: 10 })).toBeNull()
    expect(viewBoxValue({ x: 0, y: 0, width: 10, height: -1 })).toBeNull()
    expect(viewBoxValue({ x: Number.NaN, y: 0, width: 10, height: 10 })).toBeNull()
    expect(viewBoxValue({ x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 10 })).toBeNull()
  })
})

describe('cssTransformValue', () => {
  const frame: Rect = { x: 20, y: 10, width: 400, height: 200 }
  const screen: Size = { width: 800, height: 600 }

  // Apply the transform to a point of the element the way CSS does (scale,
  // then translate, origin top-left) and compare it with the camera's own map.
  const through = (value: string, p: { x: number; y: number }) => {
    const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(value)
    if (!m) throw new Error(value)
    const [tx, ty, s] = [Number(m[1]), Number(m[2]), Number(m[3])]
    return { x: tx + (p.x - frame.x) * s, y: ty + (p.y - frame.y) * s }
  }

  it('lands every content point where the camera says it goes', () => {
    const camera: Camera = { cx: 150, cy: 60, zoom: 2.5 }
    const value = cssTransformValue(frame, camera, screen)!
    for (const p of [frame, { x: 220, y: 110 }, { x: 420, y: 210 }]) {
      const want = contentToScreen({ x: p.x, y: p.y }, frame, camera, screen)
      const got = through(value, p)
      expect(got.x).toBeCloseTo(want.x, 6)
      expect(got.y).toBeCloseTo(want.y, 6)
    }
  })

  it('centres the fitted view', () => {
    const value = cssTransformValue(frame, { cx: 220, cy: 110, zoom: 1 }, screen)!
    const middle = through(value, { x: 220, y: 110 })
    expect(middle.x).toBeCloseTo(400, 6)
    expect(middle.y).toBeCloseTo(300, 6)
  })

  it('is null when the arithmetic is not finite', () => {
    expect(cssTransformValue(frame, { cx: Number.NaN, cy: 0, zoom: 1 }, screen)).toBeNull()
  })
})

describe('overscanLayout', () => {
  it('is the screen itself for no overscan', () => {
    expect(overscanLayout(0)).toEqual({ size: '100%', offset: '0%', origin: '0%' })
  })

  it('is the screen plus the overscan on every side, placed so the screen is in the middle', () => {
    const l = overscanLayout(0.25)
    expect(l).toEqual({ size: '150%', offset: '-25%', origin: '16.66666667%' })
  })

  it('puts the transform origin at the screen corner: offset and origin agree', () => {
    for (const o of [0.1, 0.3, 0.5, 1]) {
      const l = overscanLayout(o)
      const size = parseFloat(l.size)
      // The corner of the screen, as a fraction of the element, is -offset / size.
      expect(parseFloat(l.origin)).toBeCloseTo((-parseFloat(l.offset) / size) * 100, 8)
    }
  })

  it('treats a bad overscan as none', () => {
    expect(overscanLayout(-1)).toEqual(overscanLayout(0))
    expect(overscanLayout(Number.NaN)).toEqual(overscanLayout(0))
  })
})
