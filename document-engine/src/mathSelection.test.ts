import { describe, it, expect } from 'vitest'
import { snapRangeToMath } from './mathSelection'

const math = [{ start: 10, end: 15 }]

describe('snapRangeToMath', () => {
  it('leaves ranges outside math alone', () => {
    expect(snapRangeToMath({ start: 2, end: 8 }, math)).toEqual({ start: 2, end: 8 })
    expect(snapRangeToMath({ start: 15, end: 20 }, math)).toEqual({ start: 15, end: 20 })
  })
  it('spanning across a math node is unchanged', () => {
    expect(snapRangeToMath({ start: 4, end: 30 }, math)).toEqual({ start: 4, end: 30 })
  })
  it('snaps a start inside math to the node start', () => {
    expect(snapRangeToMath({ start: 12, end: 30 }, math)).toEqual({ start: 10, end: 30 })
  })
  it('snaps an end inside math to the node end', () => {
    expect(snapRangeToMath({ start: 2, end: 12 }, math)).toEqual({ start: 2, end: 15 })
  })
  it('a range wholly inside math becomes the whole node', () => {
    expect(snapRangeToMath({ start: 11, end: 13 }, math)).toEqual({ start: 10, end: 15 })
  })
})
