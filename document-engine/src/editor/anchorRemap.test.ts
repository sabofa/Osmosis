import { describe, expect, it } from 'vitest'
import { mapOffset, mapRange, remapHighlights, type TextChange } from './anchorRemap'

const ins = (at: number, len: number): TextChange => ({ from: at, to: at, insertLen: len })
const del = (from: number, to: number): TextChange => ({ from, to, insertLen: 0 })

describe('mapOffset', () => {
  it('no changes is the identity', () => {
    expect(mapOffset(5, [], 1)).toBe(5)
    expect(mapOffset(5, [], -1)).toBe(5)
  })
  it('insert before shifts, after does not', () => {
    expect(mapOffset(10, [ins(3, 4)], 1)).toBe(14)
    expect(mapOffset(2, [ins(3, 4)], 1)).toBe(2)
  })
  it('insert at the position follows assoc', () => {
    expect(mapOffset(3, [ins(3, 4)], -1)).toBe(3)
    expect(mapOffset(3, [ins(3, 4)], 1)).toBe(7)
  })
  it('delete before shifts left', () => {
    expect(mapOffset(10, [del(2, 5)], 1)).toBe(7)
  })
  it('positions inside a deletion collapse to its start', () => {
    expect(mapOffset(4, [del(2, 6)], 1)).toBe(2)
    expect(mapOffset(4, [del(2, 6)], -1)).toBe(2)
    expect(mapOffset(2, [del(2, 6)], 1)).toBe(2)
    expect(mapOffset(6, [del(2, 6)], -1)).toBe(2)
  })
  it('replacement edges go to the near side, interior follows assoc', () => {
    const rep: TextChange = { from: 2, to: 6, insertLen: 3 }
    expect(mapOffset(2, [rep], 1)).toBe(2)
    expect(mapOffset(6, [rep], -1)).toBe(5)
    expect(mapOffset(4, [rep], -1)).toBe(2)
    expect(mapOffset(4, [rep], 1)).toBe(5)
  })
  it('multiple changes accumulate in original coordinates', () => {
    const cs = [ins(1, 2), del(4, 6), ins(8, 5)]
    expect(mapOffset(0, cs, 1)).toBe(0)
    expect(mapOffset(3, cs, 1)).toBe(5)
    expect(mapOffset(7, cs, 1)).toBe(7)
    expect(mapOffset(9, cs, 1)).toBe(14)
  })
})

describe('mapRange', () => {
  const r = { start: 10, end: 20 }
  it('is unchanged by an empty change list (idempotent no-op)', () => {
    expect(mapRange(r, [])).toEqual(r)
    expect(mapRange(mapRange(r, [])!, [])).toEqual(r)
  })
  it('insert before shifts the whole range', () => {
    expect(mapRange(r, [ins(2, 3)])).toEqual({ start: 13, end: 23 })
  })
  it('insert after leaves it', () => {
    expect(mapRange(r, [ins(25, 3)])).toEqual(r)
  })
  it('insert strictly inside grows it', () => {
    expect(mapRange(r, [ins(15, 4)])).toEqual({ start: 10, end: 24 })
  })
  it('insert at start pushes the whole range right', () => {
    expect(mapRange(r, [ins(10, 4)])).toEqual({ start: 14, end: 24 })
  })
  it('insert at end does not grow it', () => {
    expect(mapRange(r, [ins(20, 4)])).toEqual(r)
  })
  it('delete before shifts left', () => {
    expect(mapRange(r, [del(0, 4)])).toEqual({ start: 6, end: 16 })
  })
  it('delete fully covering collapses to null', () => {
    expect(mapRange(r, [del(8, 22)])).toBeNull()
    expect(mapRange(r, [del(10, 20)])).toBeNull()
  })
  it('partial overlap trims at the front', () => {
    expect(mapRange(r, [del(5, 14)])).toEqual({ start: 5, end: 11 })
  })
  it('partial overlap trims at the back', () => {
    expect(mapRange(r, [del(16, 30)])).toEqual({ start: 10, end: 16 })
  })
  it('delete strictly inside shrinks it', () => {
    expect(mapRange(r, [del(12, 15)])).toEqual({ start: 10, end: 17 })
  })
  it('replacing exactly the range keeps the replacement span out of an empty result', () => {
    expect(mapRange(r, [{ from: 10, to: 20, insertLen: 4 }])).toEqual({ start: 10, end: 14 })
  })
  it('empty ranges always map to null', () => {
    expect(mapRange({ start: 5, end: 5 }, [])).toBeNull()
  })
  it('handles several changes at once', () => {
    expect(mapRange(r, [ins(2, 1), ins(15, 2), del(18, 19)])).toEqual({ start: 11, end: 22 })
  })
})

describe('remapHighlights', () => {
  it('splits kept and dropped, preserving extra fields and order', () => {
    const items = [
      { id: 'a', start: 0, end: 4 },
      { id: 'b', start: 10, end: 12 },
      { id: 'c', start: 20, end: 30 },
    ]
    const { kept, dropped } = remapHighlights(items, [del(9, 13), ins(25, 2)])
    expect(dropped.map(d => d.id)).toEqual(['b'])
    expect(kept).toEqual([
      { id: 'a', start: 0, end: 4 },
      { id: 'c', start: 16, end: 28 },
    ])
  })
  it('no changes keeps everything', () => {
    const items = [{ start: 1, end: 2 }]
    expect(remapHighlights(items, [])).toEqual({ kept: items, dropped: [] })
  })
  it('does not mutate inputs', () => {
    const items = [{ start: 5, end: 9 }]
    remapHighlights(items, [ins(0, 3)])
    expect(items).toEqual([{ start: 5, end: 9 }])
  })
})
