import { describe, expect, it } from 'vitest'
import { Scratch } from './scratch'

describe('Scratch', () => {
  it('hands out the same array again while the length asked for is the same, and counts only the arrays it had to make', () => {
    const scratch = new Scratch()
    const a = scratch.array('path', Float32Array, 16)
    expect(a).toBeInstanceOf(Float32Array)
    expect(a.length).toBe(16)
    expect(scratch.allocations).toBe(1)
    // the same key and length: the very array, with what it held
    a[3] = 7
    const again = scratch.array('path', Float32Array, 16)
    expect(again).toBe(a)
    expect(again[3]).toBe(7)
    expect(scratch.allocations).toBe(1)
    // another key is another array
    const other = scratch.array('alpha', Float32Array, 16)
    expect(other).not.toBe(a)
    expect(scratch.allocations).toBe(2)
  })

  it('makes a new one when the length changes, and when the type does', () => {
    const scratch = new Scratch()
    const a = scratch.array('seed', Uint32Array, 8)
    const longer = scratch.array('seed', Uint32Array, 9)
    expect(longer).not.toBe(a)
    expect(longer.length).toBe(9)
    // (and the new one is the one kept)
    expect(scratch.array('seed', Uint32Array, 9)).toBe(longer)
    const bytes = scratch.array('seed', Uint8Array, 9)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes).not.toBe(longer)
    expect(scratch.allocations).toBe(3)
  })

  it('keeps nothing between two Scratches', () => {
    const one = new Scratch()
    const two = new Scratch()
    expect(one.array('a', Float32Array, 4)).not.toBe(two.array('a', Float32Array, 4))
  })
})
