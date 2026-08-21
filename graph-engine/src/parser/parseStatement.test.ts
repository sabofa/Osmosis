import { describe, expect, it } from 'vitest'
import { parseStatement } from './parseStatement'

describe('parseStatement', () => {
  it('parses an explicit function of x', () => {
    const s = parseStatement('y = x^2 - 1')
    expect(s.kind).toBe('explicit')
    if (s.kind !== 'explicit') throw new Error('unreachable')
    expect(s.independent).toBe('x')
    expect(s.condition).toBeNull()
  })

  it('parses a piecewise condition clause', () => {
    const s = parseStatement('y = -x - 1 if x < 0')
    expect(s.kind).toBe('explicit')
    if (s.kind !== 'explicit') throw new Error('unreachable')
    expect(s.condition).toEqual({ kind: 'compare', op: '<', value: { kind: 'num', value: 0 } })
  })

  it('parses a two-sided range condition', () => {
    const s = parseStatement('y = x if -1 <= x < 1')
    if (s.kind !== 'explicit' || !s.condition) throw new Error('unreachable')
    expect(s.condition.kind).toBe('range')
  })

  it('parses an implicit curve', () => {
    const s = parseStatement('x^2/9 + y^2/4 = 1')
    expect(s.kind).toBe('implicit')
  })

  it('parses an inequality region, preferring "=" when both appear (piecewise "if")', () => {
    const region = parseStatement('y > x^2 - 4')
    expect(region.kind).toBe('region')
    const piecewise = parseStatement('y = x if x < 0')
    expect(piecewise.kind).toBe('explicit')
  })

  // Regression: 2026-08-21 MCP stress test v2 wrote "y > 0 if 0 <= x <= 3",
  // mistakenly applying the y=/x= piecewise "if" clause to an inequality
  // region (which doesn't support one). Previously this fell through to the
  // expression tokenizer, which choked on the leftover "<=" inside the
  // right-hand expression with an opaque "Unexpected character "<"" error —
  // accurate but not actionable. Region statements now reject a trailing
  // "if" explicitly, with a message naming the actual mistake and the fix.
  it('rejects an "if" clause on an inequality region with an actionable error, not a raw tokenizer error', () => {
    expect(() => parseStatement('y > 0 if 0 <= x <= 3')).toThrow(/inequality-region/i)
    expect(() => parseStatement('y > 0 if 0 <= x <= 3')).toThrow(/y = x\^2 if 0 <= x <= 3/)
    expect(() => parseStatement('y > 0 if 0 <= x <= 3')).not.toThrow(/Unexpected character/)
  })

  it('parses a polar curve with default and explicit ranges', () => {
    const s1 = parseStatement('r = 1 + cos(theta)')
    expect(s1.kind).toBe('polar')
    const s2 = parseStatement('r = theta for theta in [0, 3.14]')
    if (s2.kind !== 'polar') throw new Error('unreachable')
    expect(s2.to).toEqual({ kind: 'num', value: 3.14 })
  })

  it('parses points, segments, rays, and vectors', () => {
    expect(parseStatement('(1, 2)').kind).toBe('point')
    expect(parseStatement('A = (1, 2)').kind).toBe('point')
    expect(parseStatement('(0,0) -- (1,1)').kind).toBe('segment')
    expect(parseStatement('(0,0) -> (1,1)').kind).toBe('ray')
    expect(parseStatement('vector: (0,0) -> (1,1)').kind).toBe('vector')
  })

  it('parses a 3D point/segment via a 3-tuple', () => {
    const s = parseStatement('(1, 2, 3)')
    if (s.kind !== 'point') throw new Error('unreachable')
    expect(s.z).toEqual({ kind: 'num', value: 3 })
  })

  it('parses parametric curves and surfaces', () => {
    const curve = parseStatement('(cos(t), sin(t)) for t in [0, 6.283]')
    expect(curve.kind).toBe('parametric')
    const surface = parseStatement('(u, v, u*v) for u in [0,1], v in [0,1]')
    expect(surface.kind).toBe('parametricSurface')
  })

  it('parses field, scatter, tangent, animate, table statements', () => {
    expect(parseStatement('field: dy/dx = x - y').kind).toBe('field')
    expect(parseStatement('scatter: (1,2), (2,3)').kind).toBe('scatter')
    expect(parseStatement('tangent: x^2 at x = 1').kind).toBe('tangent')
    expect(parseStatement('animate: (cos(t), sin(t)) for t in [0, 6.283]').kind).toBe('animatedPoint')
    expect(parseStatement('header: a | b').kind).toBe('tableHeader')
    expect(parseStatement('row: 1 | 2').kind).toBe('tableRow')
    expect(parseStatement('table: y = x^2 for x in [0, 5] step 1').kind).toBe('tableGenerator')
  })

  it('parses function definitions and constants, including names with digits/underscores', () => {
    const fn = parseStatement('k1(x) = x^2 + 1')
    expect(fn.kind).toBe('functionDef')
    if (fn.kind !== 'functionDef') throw new Error('unreachable')
    expect(fn.name).toBe('k1')
    const c = parseStatement('my_const = 5')
    expect(c.kind).toBe('constantDef')
  })

  it('parses a trailing color clause off any statement kind', () => {
    const s = parseStatement('y = x^2 color: teal')
    expect(s.color).toBe('teal')
    expect(s.kind).toBe('explicit')
  })

  it('rejects an unknown color', () => {
    expect(() => parseStatement('y = x color: notacolor')).toThrow(/Unknown color/)
  })

  it('rejects an unrecognized statement', () => {
    expect(() => parseStatement('this is not valid')).toThrow()
  })

  it('parses a circle by center and radius', () => {
    const s = parseStatement('circle: (2, 3), 5')
    expect(s.kind).toBe('circle')
    if (s.kind !== 'circle') throw new Error('unreachable')
    expect(s.cx).toEqual({ kind: 'num', value: 2 })
    expect(s.cy).toEqual({ kind: 'num', value: 3 })
    expect(s.radius).toEqual({ kind: 'num', value: 5 })
  })

  it('parses a polygon with at least 3 labeled vertices', () => {
    const s = parseStatement('polygon: A(0,0), B(4,0), C(2,3)')
    expect(s.kind).toBe('polygon')
    if (s.kind !== 'polygon') throw new Error('unreachable')
    expect(s.vertices.map((v) => v.label)).toEqual(['A', 'B', 'C'])
    expect(s.vertices[1].x).toEqual({ kind: 'num', value: 4 })
  })

  it('rejects a polygon with fewer than 3 vertices', () => {
    expect(() => parseStatement('polygon: A(0,0), B(4,0)')).toThrow(/at least 3/)
  })

  it('parses an angle statement, with and without a label', () => {
    const plain = parseStatement('angle: A-B-C')
    expect(plain.kind).toBe('angle')
    if (plain.kind !== 'angle') throw new Error('unreachable')
    expect(plain.from).toBe('A')
    expect(plain.vertex).toBe('B')
    expect(plain.to).toBe('C')
    expect(plain.label).toBeNull()

    const labeled = parseStatement('angle: A-B-C label: 60°')
    if (labeled.kind !== 'angle') throw new Error('unreachable')
    expect(labeled.label).toBe('60°')
  })

  it('parses a tick statement, defaulting count to 1', () => {
    const plain = parseStatement('tick: A-B')
    expect(plain.kind).toBe('tick')
    if (plain.kind !== 'tick') throw new Error('unreachable')
    expect(plain.count).toBe(1)

    const counted = parseStatement('tick: A-B count: 2')
    if (counted.kind !== 'tick') throw new Error('unreachable')
    expect(counted.count).toBe(2)
  })

  it('rejects a non-integer tick count', () => {
    expect(() => parseStatement('tick: A-B count: 1.5')).toThrow(/positive integer/)
  })

  it('parses a right-angle marker', () => {
    const s = parseStatement('right-angle: A-B-C')
    expect(s.kind).toBe('rightAngle')
    if (s.kind !== 'rightAngle') throw new Error('unreachable')
    expect(s.from).toBe('A')
    expect(s.vertex).toBe('B')
    expect(s.to).toBe('C')
  })

  it('applies a trailing color clause to a polygon and an angle', () => {
    const polygon = parseStatement('polygon: A(0,0), B(4,0), C(2,3) color: teal')
    expect(polygon.color).toBe('teal')
    const angle = parseStatement('angle: A-B-C label: 60° color: purple')
    expect(angle.color).toBe('purple')
    if (angle.kind !== 'angle') throw new Error('unreachable')
    expect(angle.label).toBe('60°')
  })
})
