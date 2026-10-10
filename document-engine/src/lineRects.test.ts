import { describe, expect, it } from 'vitest'
import { groupIntoLines, mergeLine, mergeRects, type Box } from './lineRects'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

describe('lineRects', () => {
  it('returns nothing for empty input', () => {
    expect(mergeRects([])).toEqual([])
    expect(groupIntoLines([])).toEqual([])
    expect(mergeLine([])).toEqual([])
  })

  it('ignores zero-width rects', () => {
    expect(mergeRects([box(10, 0, 10, 12)])).toEqual([])
    expect(mergeRects([box(10, 0, 10, 12), box(0, 0, 8, 12)])).toEqual([box(0, 0, 8, 12)])
  })

  it('merges overlapping per-word spans on one line into one bar', () => {
    const bars = mergeRects([box(0, 0, 30, 12), box(25, 1, 60, 13), box(70, -1, 100, 11)])
    expect(bars).toHaveLength(1)
    expect(bars[0].left).toBe(0)
    expect(bars[0].right).toBe(100)
    expect(bars[0].bottom - bars[0].top).toBe(12)
  })

  it('keeps two lines with overlapping vertical extents as separate non-overlapping bars', () => {
    const bars = mergeRects([box(0, 0, 50, 14), box(0, 11, 50, 25), box(60, 12, 90, 24)])
    expect(bars).toHaveLength(2)
    expect(bars[0].bottom).toBeLessThanOrEqual(bars[1].top)
  })

  it('splits at a column gap', () => {
    const bars = mergeRects([box(0, 0, 40, 10), box(200, 0, 240, 10)])
    expect(bars).toHaveLength(2)
    expect(bars.map((b) => [b.left, b.right])).toEqual([[0, 40], [200, 240]])
  })

  it('uses the median height centred on the median centre', () => {
    const [bar] = mergeLine([box(0, 0, 10, 10), box(10, 0, 20, 10), box(20, -5, 30, 15)])
    expect(bar.bottom - bar.top).toBe(10)
    expect((bar.top + bar.bottom) / 2).toBe(5)
  })

  it('returns bars top to bottom', () => {
    const bars = mergeRects([box(0, 40, 10, 50), box(0, 0, 10, 10), box(0, 20, 10, 30)])
    expect(bars.map((b) => b.top)).toEqual([0, 20, 40])
  })
})
