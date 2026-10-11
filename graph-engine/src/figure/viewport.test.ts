import { describe, expect, it } from 'vitest'
import { compensatedSize, parseViewBox, viewBoxAttribute, type ViewBox } from './viewport'

const FITTED: ViewBox = { x: -320, y: -240, width: 640, height: 480 }

describe('parseViewBox', () => {
  it('reads the viewBox the renderer wrote', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -20 30 40" preserveAspectRatio="xMidYMid meet">'
    expect(parseViewBox(svg)).toEqual({ x: -10, y: -20, width: 30, height: 40 })
  })

  it('reads a fractional viewBox', () => {
    expect(parseViewBox('<svg viewBox="-1.5 2.25 3.5 4.75">')).toEqual({ x: -1.5, y: 2.25, width: 3.5, height: 4.75 })
  })

  it('is null for markup with no viewBox, rather than a box of NaNs', () => {
    expect(parseViewBox('<svg xmlns="http://www.w3.org/2000/svg">')).toBeNull()
    expect(parseViewBox('<svg viewBox="-10 -20 30">')).toBeNull()
    expect(parseViewBox('<svg viewBox="a b c d">')).toBeNull()
  })

  it('round-trips through the attribute it writes', () => {
    expect(parseViewBox(`<svg viewBox="${viewBoxAttribute(FITTED)}">`)).toEqual(FITTED)
  })
})

describe('compensatedSize', () => {
  // A figure's text is written in the same units as its geometry, so it
  // magnifies with the drawing by default. Writing it at 1 / zoom of its
  // fitted size cancels the magnification exactly: the label keeps the size
  // it had on screen.
  it('is the written size at the fitted view (zoom 1)', () => {
    expect(compensatedSize(15, 1)).toBe(15)
  })

  it('shrinks the written size as the view magnifies, and grows it as the view pulls back', () => {
    expect(compensatedSize(15, 4)).toBeCloseTo(3.75, 12)
    expect(compensatedSize(15, 0.5)).toBeCloseTo(30, 12)
  })

  // 15 view units at 4x are four times the screen size they were; 3.75 at 4x
  // is the size 15 was at 1x. This is the whole arithmetic of "labels keep
  // their size".
  it('cancels the magnification exactly: written size times zoom is constant', () => {
    for (const zoom of [0.1, 0.5, 1, 2.5, 4, 64]) {
      expect(compensatedSize(15, zoom) * zoom).toBeCloseTo(15, 10)
    }
  })

  it('does not divide by a degenerate zoom', () => {
    expect(compensatedSize(15, 0)).toBe(15)
    expect(compensatedSize(15, Number.NaN)).toBe(15)
    expect(compensatedSize(15, -2)).toBe(15)
  })
})
