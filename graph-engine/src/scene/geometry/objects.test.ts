import { describe, expect, it } from 'vitest'
import {
  areParallel,
  circle,
  footOfPerpendicular,
  GeometryScope,
  isPointOnLine,
  lineDirection,
  lineNormal,
  makeLine,
  point,
  ray,
  segment,
} from './objects'

describe('constructors', () => {
  it('builds the three kinds', () => {
    expect(point({ x: 1, y: 2 })).toEqual({ kind: 'point', at: { x: 1, y: 2 } })
    expect(makeLine({ x: 0, y: 0 }, { x: 1, y: 1 }, 'infinite').extent).toBe('infinite')
    expect(segment({ x: 0, y: 0 }, { x: 1, y: 1 }).extent).toBe('segment')
    expect(ray({ x: 0, y: 0 }, { x: 1, y: 1 }).extent).toBe('ray')
    expect(circle({ x: 2, y: 3 }, 4)).toEqual({ kind: 'circle', center: { x: 2, y: 3 }, radius: 4 })
  })

  it('rejects a line through two coincident points', () => {
    expect(() => segment({ x: 1, y: 1 }, { x: 1, y: 1 })).toThrow(/same point/i)
  })

  it('rejects a circle with a non-positive radius', () => {
    expect(() => circle({ x: 0, y: 0 }, 0)).toThrow(/radius/i)
    expect(() => circle({ x: 0, y: 0 }, -2)).toThrow(/radius/i)
  })
})

describe('GeometryScope', () => {
  it('binds and looks up any of the three kinds under one namespace', () => {
    const scope = new GeometryScope()
    scope.bind('A', point({ x: 1, y: 2 }))
    scope.bind('m', segment({ x: 0, y: 0 }, { x: 3, y: 4 }))
    scope.bind('O', circle({ x: 0, y: 0 }, 5))
    expect(scope.lookup('A').kind).toBe('point')
    expect(scope.lookup('m').kind).toBe('line')
    expect(scope.lookup('O').kind).toBe('circle')
  })

  it('rejects rebinding and names what the name was already bound to', () => {
    const scope = new GeometryScope()
    scope.bind('A', point({ x: 1, y: 2 }))
    expect(() => scope.bind('A', circle({ x: 0, y: 0 }, 1))).toThrow(/"A".*already.*point/i)
  })

  it('rejects an unknown lookup, naming the missing name', () => {
    const scope = new GeometryScope()
    scope.bind('B', point({ x: 0, y: 0 }))
    expect(() => scope.lookup('A')).toThrow(/"A"/)
  })

  it('rejects a name that is not letters-only', () => {
    const scope = new GeometryScope()
    expect(() => scope.bind('A1', point({ x: 0, y: 0 }))).toThrow(/letters/i)
    expect(() => scope.bind('a_b', point({ x: 0, y: 0 }))).toThrow(/letters/i)
    expect(() => scope.bind('', point({ x: 0, y: 0 }))).toThrow(/letters/i)
    // ...but a multi-letter, mixed-case name is fine.
    expect(() => scope.bind('AB', point({ x: 0, y: 0 }))).not.toThrow()
  })

  it('reports a typed lookup failure when the kind is wrong', () => {
    const scope = new GeometryScope()
    scope.bind('A', point({ x: 1, y: 1 }))
    expect(() => scope.lookupLine('A')).toThrow(/"A".*line.*point/i)
    expect(scope.lookupPoint('A')).toEqual({ x: 1, y: 1 })
  })
})

describe('line primitives', () => {
  it('gives a unit direction and a unit normal perpendicular to it', () => {
    const l = segment({ x: 1, y: 1 }, { x: 4, y: 5 })
    const d = lineDirection(l)
    expect(d.x).toBeCloseTo(0.6, 12)
    expect(d.y).toBeCloseTo(0.8, 12)
    const n = lineNormal(l)
    expect(d.x * n.x + d.y * n.y).toBeCloseTo(0, 12)
    expect(Math.hypot(n.x, n.y)).toBeCloseTo(1, 12)
  })

  it('detects parallel lines and rejects near-parallel ones', () => {
    const base = segment({ x: 1, y: 1 }, { x: 4, y: 5 })
    const parallel = segment({ x: 0, y: 7 }, { x: -3, y: 3 }) // direction (-3,-4): antiparallel counts
    const near = segment({ x: 0, y: 7 }, { x: 3, y: 11.01 })
    expect(areParallel(base, parallel)).toBe(true)
    expect(areParallel(base, near)).toBe(false)
  })

  it('tests point-on-line against a non-axis-aligned line, honouring extent', () => {
    const through = { x: 1, y: 1 }
    const to = { x: 4, y: 5 }
    const inf = makeLine(through, to, 'infinite')
    const seg = segment(through, to)
    const rayObj = ray(through, to)
    const beyond = { x: 7, y: 9 } // on the line, past the segment's far end
    const behind = { x: -2, y: -3 } // on the line, behind the ray's origin
    const off = { x: 2.5, y: 3.5 } // not on the line at all

    expect(isPointOnLine({ x: 2.5, y: 3 }, inf)).toBe(true)
    expect(isPointOnLine(off, inf)).toBe(false)
    expect(isPointOnLine(beyond, inf)).toBe(true)
    expect(isPointOnLine(beyond, seg)).toBe(false)
    expect(isPointOnLine(beyond, rayObj)).toBe(true)
    expect(isPointOnLine(behind, inf)).toBe(true)
    expect(isPointOnLine(behind, rayObj)).toBe(false)
    expect(isPointOnLine(behind, seg)).toBe(false)
  })

  it('finds the foot of the perpendicular on a non-axis-aligned line', () => {
    // A=(1,1), B=(4,5): direction (3,4)/5. P=(5,1) projects at t = 12/25 = 0.48
    // along (3,4), so the foot is (1,1) + 0.48*(3,4) = (2.44, 2.92).
    const l = makeLine({ x: 1, y: 1 }, { x: 4, y: 5 }, 'infinite')
    const foot = footOfPerpendicular({ x: 5, y: 1 }, l)
    expect(foot.x).toBeCloseTo(2.44, 12)
    expect(foot.y).toBeCloseTo(2.92, 12)
    // ...and the residual really is perpendicular.
    const d = lineDirection(l)
    expect((5 - foot.x) * d.x + (1 - foot.y) * d.y).toBeCloseTo(0, 12)
  })

  it('does not clamp the foot to a segment when the projection lands outside it', () => {
    // The foot is a property of the underlying line; extent does not clamp it.
    const l = segment({ x: 1, y: 1 }, { x: 4, y: 5 })
    const foot = footOfPerpendicular({ x: 10, y: 13 }, l)
    expect(foot.x).toBeCloseTo(10, 12)
    expect(foot.y).toBeCloseTo(13, 12)
  })
})
