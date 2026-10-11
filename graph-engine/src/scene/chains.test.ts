import { describe, expect, it } from 'vitest'
import { chainOf, chainPoints, markKey, vertexCount } from './chains'

describe('chains', () => {
  it('round-trips points and parameters', () => {
    const c = chainOf([{ x: 0, y: 1 }, { x: 2, y: 3 }], [0, 2])
    expect(c.xy).toEqual(Float64Array.from([0, 1, 2, 3]))
    expect(c.param).toEqual(Float64Array.from([0, 2]))
    expect(c.closed).toBe(false)
    expect(chainPoints(c)).toEqual([{ x: 0, y: 1 }, { x: 2, y: 3 }])
    expect(vertexCount(c)).toBe(2)
  })
  it('keys a mark id as statement/object', () => {
    expect(markKey({ statement: 3, object: 'hole.0' })).toBe('3/hole.0')
  })
  it('refuses mismatched lengths', () => {
    expect(() => chainOf([{ x: 0, y: 0 }], [0, 1])).toThrow()
  })
})
