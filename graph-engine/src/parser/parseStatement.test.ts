import { describe, expect, it } from 'vitest'
import { num, variable } from '../math/expr'
import { and, compare, factorialOf, or, piecewise } from '../math/reserved'
import { parseExprString } from './parseExpr'
import { parseStatement } from './parseStatement'
import type { Expr } from './types'

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

  // History: 2026-08-21 MCP stress test v2 wrote "y > 0 if 0 <= x <= 3",
  // applying an "if" clause to an inequality region, which then had no such
  // clause and was refused with a message naming the mistake. Calc P1 made it
  // valid: every plot form takes an "if" clause, so this line is a region that
  // is shaded only where the condition holds.
  it('reads an "if" clause on an inequality region as its where (calc P1 made it valid)', () => {
    const s = parseStatement('y > 0 if 0 <= x <= 3')
    expect(s).toMatchObject({
      kind: 'region',
      op: '>',
      left: variable('y'),
      right: num(0),
      where: and(compare('<=', num(0), variable('x')), compare('<=', variable('x'), num(3))),
    })
  })

  it('parses a polar curve with default and explicit ranges', () => {
    const s1 = parseStatement('r = 1 + cos(theta)')
    expect(s1.kind).toBe('polar')
    const s2 = parseStatement('r = theta for theta in [0, 3.14]')
    if (s2.kind !== 'polar') throw new Error('unreachable')
    expect(s2.to).toEqual({ kind: 'num', value: 3.14 })
  })

  // calc P2: the default range is a full turn in the document's angle unit, and only the
  // consumer knows the unit, so the parser says it supplied the default and does not guess
  it("flags a polar curve's default range as a full turn, and no range the author wrote", () => {
    const defaulted = parseStatement('r = 1 + cos(theta)')
    if (defaulted.kind !== 'polar') throw new Error('unreachable')
    expect(defaulted.fullTurn).toBe(true)
    // an author's own range, even one that happens to be [0, 2 pi], is theirs and not flagged
    for (const text of ['r = theta for theta in [0, 3.14]', 'r = 1 + cos(theta) for theta in [0, 2*pi]']) {
      const written = parseStatement(text)
      if (written.kind !== 'polar') throw new Error('unreachable')
      expect(written.fullTurn, text).toBeUndefined()
    }
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

  describe('chained inequality regions', () => {
    it('parses a "lo < mid < hi" chain into a normalised regionChain', () => {
      const s = parseStatement('7 < x < 12')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.low).toEqual({ kind: 'num', value: 7 })
      expect(s.lowOp).toBe('<')
      expect(s.mid).toEqual({ kind: 'var', name: 'x' })
      expect(s.highOp).toBe('<')
      expect(s.high).toEqual({ kind: 'num', value: 12 })
    })

    it('parses an inclusive chain "-2 <= y <= 5"', () => {
      const s = parseStatement('-2 <= y <= 5')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.lowOp).toBe('<=')
      expect(s.mid).toEqual({ kind: 'var', name: 'y' })
      expect(s.highOp).toBe('<=')
    })

    it('parses an annulus chain "0 < x^2 + y^2 < 9"', () => {
      const s = parseStatement('0 < x^2 + y^2 < 9')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.low).toEqual({ kind: 'num', value: 0 })
      expect(s.high).toEqual({ kind: 'num', value: 9 })
    })

    it('parses an inclusive annulus chain "1 <= x^2 + y^2 <= 4"', () => {
      const s = parseStatement('1 <= x^2 + y^2 <= 4')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.lowOp).toBe('<=')
      expect(s.highOp).toBe('<=')
    })

    it('parses mixed strictness "-2 <= x < 5"', () => {
      const s = parseStatement('-2 <= x < 5')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.lowOp).toBe('<=')
      expect(s.highOp).toBe('<')
    })

    it('normalises a ">" chain ("x^2 > k > 7") into the equivalent "<" shape', () => {
      const s = parseStatement('x^2 > k > 7')
      expect(s.kind).toBe('regionChain')
      if (s.kind !== 'regionChain') throw new Error('unreachable')
      expect(s.low).toEqual({ kind: 'num', value: 7 })
      expect(s.lowOp).toBe('<')
      expect(s.mid).toEqual({ kind: 'var', name: 'k' })
      expect(s.highOp).toBe('<')
      expect(s.high).toEqual({
        kind: 'binary',
        op: '^',
        left: { kind: 'var', name: 'x' },
        right: { kind: 'num', value: 2 },
      })
    })

    it('rejects a mixed-direction chain with a direction-conflict message naming both operators, not a tokenizer error', () => {
      expect(() => parseStatement('a < x > b')).toThrow(/direction/i)
      expect(() => parseStatement('a < x > b')).toThrow(/"<"/)
      expect(() => parseStatement('a < x > b')).toThrow(/">"/)
      expect(() => parseStatement('a < x > b')).not.toThrow(/Unexpected character/)
    })

    it('still parses single inequalities exactly as before (not as one-sided chains)', () => {
      const gt = parseStatement('y > x^2 - 4')
      expect(gt.kind).toBe('region')
      if (gt.kind !== 'region') throw new Error('unreachable')
      expect(gt.op).toBe('>')

      const gte = parseStatement('x >= 3')
      expect(gte.kind).toBe('region')
      if (gte.kind !== 'region') throw new Error('unreachable')
      expect(gte.op).toBe('>=')
      expect(gte.right).toEqual({ kind: 'num', value: 3 })
    })
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

describe('parseStatement — geometry constructions', () => {
  it('parses a parallel and a perpendicular line through a point', () => {
    const m = parseStatement('m = line through P parallel to A-B')
    if (m.kind !== 'construction') throw new Error('unreachable')
    expect(m.names).toEqual(['m'])
    expect(m.body).toEqual({
      kind: 'parallelLine',
      through: 'P',
      base: { kind: 'through', extent: 'infinite', from: 'A', to: 'B' },
    })

    const n = parseStatement('n = line through P perpendicular to A-B')
    if (n.kind !== 'construction') throw new Error('unreachable')
    expect(n.body.kind).toBe('perpendicularLine')
  })

  it('parses both bisectors', () => {
    const b = parseStatement('b = bisector of angle A-B-C')
    if (b.kind !== 'construction') throw new Error('unreachable')
    expect(b.body).toEqual({ kind: 'angleBisector', from: 'A', vertex: 'B', to: 'C' })

    const p = parseStatement('p = perpendicular bisector of A-B')
    if (p.kind !== 'construction') throw new Error('unreachable')
    expect(p.body).toEqual({ kind: 'perpendicularBisector', from: 'A', to: 'B' })
  })

  it('parses midpoint and foot', () => {
    const mid = parseStatement('M = midpoint A-B')
    if (mid.kind !== 'construction') throw new Error('unreachable')
    expect(mid.body).toEqual({ kind: 'midpoint', from: 'A', to: 'B' })

    const foot = parseStatement('D = foot C to A-B')
    if (foot.kind !== 'construction') throw new Error('unreachable')
    expect(foot.body).toEqual({ kind: 'foot', from: 'C', base: { kind: 'through', extent: 'infinite', from: 'A', to: 'B' } })
  })

  it('parses intersect with one name and with two', () => {
    const one = parseStatement('X = intersect m, n')
    if (one.kind !== 'construction') throw new Error('unreachable')
    expect(one.names).toEqual(['X'])
    expect(one.body).toEqual({
      kind: 'intersect',
      left: { kind: 'named', name: 'm' },
      right: { kind: 'named', name: 'n' },
    })

    const two = parseStatement('P, Q = intersect circle O, line B-C')
    if (two.kind !== 'construction') throw new Error('unreachable')
    expect(two.names).toEqual(['P', 'Q'])
    expect(two.body).toEqual({
      kind: 'intersect',
      left: { kind: 'named', name: 'O' },
      right: { kind: 'through', extent: 'infinite', from: 'B', to: 'C' },
    })
  })

  it('carries the extent of an explicitly written segment or ray operand', () => {
    const seg = parseStatement('X = intersect segment A-B, ray C-D')
    if (seg.kind !== 'construction' || seg.body.kind !== 'intersect') throw new Error('unreachable')
    expect(seg.body.left).toEqual({ kind: 'through', extent: 'segment', from: 'A', to: 'B' })
    expect(seg.body.right).toEqual({ kind: 'through', extent: 'ray', from: 'C', to: 'D' })
  })

  it('parses the derived-point constructions', () => {
    const divide = parseStatement('D = divide A-B at 2:3')
    if (divide.kind !== 'construction' || divide.body.kind !== 'divide') throw new Error('unreachable')
    expect(divide.body.ratioFrom).toEqual({ kind: 'num', value: 2 })
    expect(divide.body.ratioTo).toEqual({ kind: 'num', value: 3 })

    const reflect = parseStatement('R = reflect P over m')
    if (reflect.kind !== 'construction') throw new Error('unreachable')
    expect(reflect.body).toEqual({ kind: 'reflect', point: 'P', over: { kind: 'named', name: 'm' } })

    const rotate = parseStatement('R = rotate P about O by 90')
    if (rotate.kind !== 'construction' || rotate.body.kind !== 'rotate') throw new Error('unreachable')
    expect(rotate.body.about).toBe('O')

    const translate = parseStatement('T = translate P by (3, -4)')
    if (translate.kind !== 'construction' || translate.body.kind !== 'translate') throw new Error('unreachable')
    expect(translate.body.dx).toEqual({ kind: 'num', value: 3 })

    const dilate = parseStatement('E = dilate P from O by 1.5')
    if (dilate.kind !== 'construction' || dilate.body.kind !== 'dilate') throw new Error('unreachable')
    expect(dilate.body.from).toBe('O')
  })

  it('parses the four triangle centres and both centre circles', () => {
    for (const [text, centre] of [
      ['G = centroid ABC', 'centroid'],
      ['O = circumcenter ABC', 'circumcenter'],
      ['I = incenter of ABC', 'incenter'],
      ['H = orthocenter ABC', 'orthocenter'],
      ['K = incircle of ABC', 'incircle'],
    ] as const) {
      const s = parseStatement(text)
      if (s.kind !== 'construction') throw new Error('unreachable')
      expect(s.body).toEqual({ kind: 'triangleCentre', centre, vertices: ['A', 'B', 'C'] })
    }
  })

  it('parses a plane through three points as an operand (solid figures)', () => {
    const foot = parseStatement('F = foot D to plane A-B-C')
    if (foot.kind !== 'construction') throw new Error('unreachable')
    expect(foot.body).toEqual({
      kind: 'foot',
      from: 'D',
      base: { kind: 'plane', plane: { kind: 'points', points: ['A', 'B', 'C'], source: 'A-B-C' } },
    })

    const meet = parseStatement('X = intersect line A-G, plane B-D-E')
    if (meet.kind !== 'construction') throw new Error('unreachable')
    expect(meet.body).toEqual({
      kind: 'intersect',
      left: { kind: 'through', extent: 'infinite', from: 'A', to: 'G' },
      right: { kind: 'plane', plane: { kind: 'points', points: ['B', 'D', 'E'], source: 'B-D-E' } },
    })

    expect(() => parseStatement('F = foot D to plane A-B')).toThrow(/three point names/)
  })

  it('parses a centroid of four points, and only a centroid', () => {
    const s = parseStatement('G = centroid ABCD')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.body).toEqual({ kind: 'triangleCentre', centre: 'centroid', vertices: ['A', 'B', 'C', 'D'] })
    expect(() => parseStatement('O = circumcenter ABCD')).toThrow(/only a centroid/)
    expect(() => parseStatement('G = centroid ABCA')).toThrow(/distinct/)
  })

  it('parses the nameless incircle/circumcircle forms', () => {
    const inc = parseStatement('incircle of ABC')
    if (inc.kind !== 'construction') throw new Error('unreachable')
    expect(inc.names).toEqual([])
    expect(inc.body).toEqual({ kind: 'triangleCentre', centre: 'incircle', vertices: ['A', 'B', 'C'] })

    const circ = parseStatement('circumcircle of ABC')
    if (circ.kind !== 'construction' || circ.body.kind !== 'triangleCentre') throw new Error('unreachable')
    expect(circ.body.centre).toBe('circumcircle')
  })

  it('maps triangle measurements onto the canonical a/b/c slots', () => {
    const t = parseStatement('triangle ABC: AB = 8, angle A = 90, AC = 6')
    if (t.kind !== 'triangle') throw new Error('unreachable')
    expect(t.names).toEqual(['A', 'B', 'C'])
    // AB joins A and B, so it is the side opposite C -> slot c.
    expect(t.sides.c).toEqual({ kind: 'num', value: 8 })
    // AC joins A and C, so it is opposite B -> slot b.
    expect(t.sides.b).toEqual({ kind: 'num', value: 6 })
    expect(t.sides.a).toBeUndefined()
    expect(t.angles.a).toEqual({ kind: 'num', value: 90 })
  })

  it('maps a side written the other way round to the same slot', () => {
    // BA and AB are the same side. Writing both is a duplicate, and it is
    // caught rather than silently overwritten — which is also what proves the
    // two spellings really do land in one slot.
    expect(() => parseStatement('triangle ABC: BA = 8, AB = 8, angle A = 90')).toThrow(/given twice/i)
    const t = parseStatement('triangle ABC: BA = 8, angle A = 90, CA = 6')
    if (t.kind !== 'triangle') throw new Error('unreachable')
    expect(t.sides.c).toEqual({ kind: 'num', value: 8 })
    expect(t.sides.b).toEqual({ kind: 'num', value: 6 })
  })

  it('rejects a measurement that is not part of the triangle, naming it', () => {
    expect(() => parseStatement('triangle ABC: DE = 5, angle A = 90, AC = 6')).toThrow(/"DE" is not a side of triangle ABC/)
    expect(() => parseStatement('triangle ABC: AB = 8, angle D = 90, AC = 6')).toThrow(/"D" is not a vertex of triangle ABC/)
  })

  it('rejects an intersect with the wrong number of operands', () => {
    expect(() => parseStatement('X = intersect m')).toThrow(/two operands/i)
    expect(() => parseStatement('X = intersect m, n, p')).toThrow(/two operands/i)
  })

  it('leaves the pre-existing "=" statement forms alone', () => {
    // A construction keyword is only recognised as one; everything else that
    // looks like "<letters> = ..." keeps its old meaning.
    expect(parseStatement('a = 5').kind).toBe('constantDef')
    expect(parseStatement('A = (2, 3)').kind).toBe('point')
    expect(parseStatement('y = x^2 - 1').kind).toBe('explicit')
    expect(parseStatement('r = 1 + cos(theta)').kind).toBe('polar')
    expect(parseStatement('k(x) = x^2 + 1').kind).toBe('functionDef')
    expect(parseStatement('x^2/9 + y^2/4 = 1').kind).toBe('implicit')
  })

  it('accepts color: and name: clauses on a construction, like every other statement', () => {
    const s = parseStatement('M = midpoint A-B color: teal name: mid')
    expect(s.kind).toBe('construction')
    expect(s.color).toBe('teal')
    expect(s.statementName).toBe('mid')
  })
})

describe('parseStatement — measure labels', () => {
  it('parses a bare length label as a computed measure', () => {
    const s = parseStatement('label: AB')
    expect(s.kind).toBe('measureLabel')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'length', from: 'A', to: 'B' })
    expect(s.content).toEqual({ kind: 'computed' })
  })

  it('accepts the dashed spelling, so multi-letter point names work', () => {
    const s = parseStatement('label: P1-Q2')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'length', from: 'P1', to: 'Q2' })
  })

  it('parses "= <number>" as a stated value that asserts', () => {
    const s = parseStatement('label: AB = 8')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.content).toEqual({ kind: 'stated', value: 8 })
  })

  it('parses a decimal and a negative-free fractional stated value', () => {
    const s = parseStatement('label: AB = 7.5')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.content).toEqual({ kind: 'stated', value: 7.5 })
  })

  it('parses "= <anything else>" as symbolic, asserting nothing', () => {
    const s = parseStatement('label: AB = x')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.content).toEqual({ kind: 'symbol', text: 'x' })

    const greek = parseStatement('label: angle ABC = θ')
    if (greek.kind !== 'measureLabel') throw new Error('unreachable')
    expect(greek.content).toEqual({ kind: 'symbol', text: 'θ' })
  })

  it('parses an angle measure, vertex in the middle', () => {
    const s = parseStatement('label: angle ABC')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'angle', from: 'A', vertex: 'B', to: 'C' })
    expect(s.content).toEqual({ kind: 'computed' })
  })

  it('parses an asserted angle measure', () => {
    const s = parseStatement('label: angle A-B-C = 30')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'angle', from: 'A', vertex: 'B', to: 'C' })
    expect(s.content).toEqual({ kind: 'stated', value: 30 })
  })

  it('parses the notation forms, each carrying its own overmark', () => {
    const forms: [string, string][] = [
      ['label: segment AB', 'segment'],
      ['label: ray AB', 'ray'],
      ['label: line AB', 'line'],
    ]
    for (const [line, mark] of forms) {
      const s = parseStatement(line)
      if (s.kind !== 'measureLabel') throw new Error(`unreachable for "${line}"`)
      expect(s.subject).toEqual({ kind: 'length', from: 'A', to: 'B' })
      expect(s.content).toEqual({ kind: 'name', mark, prefix: '' })
    }
  })

  it('parses the triangle notation form', () => {
    const s = parseStatement('label: triangle ABC')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'triangle', names: ['A', 'B', 'C'] })
    expect(s.content).toEqual({ kind: 'name', mark: 'none', prefix: '△' })
  })

  it('takes color: and name: clauses like every other statement', () => {
    const s = parseStatement('label: AB = 8 color: teal name: side')
    expect(s.kind).toBe('measureLabel')
    expect(s.color).toBe('teal')
    expect(s.statementName).toBe('side')
  })

  it('refuses a single-vertex angle, naming the form it wants', () => {
    // The spec's "label: angle A" needs a containing shape to say which two
    // rays are meant; nothing in the statement carries that, so it is
    // refused rather than guessed at.
    expect(() => parseStatement('label: angle A')).toThrow(/three point names/)
  })

  it('refuses a subject that names the wrong number of points', () => {
    expect(() => parseStatement('label: ABC')).toThrow(/two point names/)
    expect(() => parseStatement('label: A')).toThrow(/two point names/)
    expect(() => parseStatement('label: triangle AB')).toThrow(/three/)
  })

  it('refuses an empty label', () => {
    expect(() => parseStatement('label:')).toThrow(/label:/)
  })
})

describe('parseStatement — the givens box', () => {
  it('parses a given value, defaulting to the computed one', () => {
    const s = parseStatement('given: AB')
    expect(s.kind).toBe('given')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.entry).toEqual({ kind: 'measure', subject: { kind: 'length', from: 'A', to: 'B' }, content: { kind: 'computed' } })
  })

  it('parses a stated given, which asserts like an inline label', () => {
    const s = parseStatement('given: AB = 8')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.entry).toEqual({ kind: 'measure', subject: { kind: 'length', from: 'A', to: 'B' }, content: { kind: 'stated', value: 8 } })
  })

  it('parses an angle given', () => {
    const s = parseStatement('given: angle ABC = 30')
    if (s.kind !== 'given') throw new Error('unreachable')
    if (s.entry.kind !== 'measure') throw new Error('unreachable')
    expect(s.entry.subject).toEqual({ kind: 'angle', from: 'A', vertex: 'B', to: 'C' })
  })

  it('parses a relation written as a word', () => {
    const s = parseStatement('given: AB parallel CD')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.entry).toEqual({
      kind: 'relation',
      left: { kind: 'length', from: 'A', to: 'B' },
      symbol: '∥',
      right: { kind: 'length', from: 'C', to: 'D' },
    })
  })

  it('parses a relation written as the symbol itself', () => {
    const s = parseStatement('given: AB ∥ CD')
    if (s.kind !== 'given') throw new Error('unreachable')
    if (s.entry.kind !== 'relation') throw new Error('unreachable')
    expect(s.entry.symbol).toBe('∥')
  })

  it('parses a relation between two triangles', () => {
    const s = parseStatement('given: triangle ABC similar triangle DEF')
    if (s.kind !== 'given') throw new Error('unreachable')
    if (s.entry.kind !== 'relation') throw new Error('unreachable')
    expect(s.entry.symbol).toBe('~')
    expect(s.entry.left).toEqual({ kind: 'triangle', names: ['A', 'B', 'C'] })
    expect(s.entry.right).toEqual({ kind: 'triangle', names: ['D', 'E', 'F'] })
  })

  it('parses a congruence between two angles', () => {
    const s = parseStatement('given: angle ABC congruent angle DEF')
    if (s.kind !== 'given') throw new Error('unreachable')
    if (s.entry.kind !== 'relation') throw new Error('unreachable')
    expect(s.entry.symbol).toBe('≅')
  })

  it('refuses an empty given', () => {
    expect(() => parseStatement('given:')).toThrow(/given:/)
  })

  it('refuses a relation whose sides are not geometry', () => {
    expect(() => parseStatement('given: ABC parallel D')).toThrow(/point names/)
  })
})

describe('parseStatement — the circle vocabulary', () => {
  it('parses a chord between two points of a named circle', () => {
    const s = parseStatement('c = chord P-Q on O')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.names).toEqual(['c'])
    expect(s.body).toEqual({ kind: 'chord', circle: 'O', from: 'P', to: 'Q' })
  })

  it('takes the run spelling as well, the way a label does', () => {
    const s = parseStatement('c = chord PQ on O')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.body).toEqual({ kind: 'chord', circle: 'O', from: 'P', to: 'Q' })
  })

  it('parses the tangent at a point of the circle', () => {
    const s = parseStatement('t = tangent at P on O')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.body).toEqual({ kind: 'tangentAt', circle: 'O', point: 'P' })
  })

  it('parses the two tangents from an external point, and takes two names', () => {
    const s = parseStatement('t, u = tangent from P to O')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.names).toEqual(['t', 'u'])
    expect(s.body).toEqual({ kind: 'tangentFrom', circle: 'O', point: 'P' })
  })

  it('tells the two tangent forms apart rather than guessing', () => {
    expect(() => parseStatement('t = tangent P on O')).toThrow(/tangent at|tangent from/)
  })

  it('parses a secant, with or without the spec\'s "through"', () => {
    const plain = parseStatement('k = secant P-Q on O')
    const through = parseStatement('k = secant through P-Q on O')
    if (plain.kind !== 'construction' || through.kind !== 'construction') throw new Error('unreachable')
    expect(plain.body).toEqual({ kind: 'secant', circle: 'O', from: 'P', to: 'Q' })
    expect(through.body).toEqual(plain.body)
  })

  it('parses a radius and a diameter', () => {
    // Named "u", not "r": "r = ..." is the polar-curve form and keeps its
    // meaning, exactly as "y = ..." does for a construction.
    const r = parseStatement('u = radius O to P')
    const d = parseStatement('d = diameter P-Q on O')
    if (r.kind !== 'construction' || d.kind !== 'construction') throw new Error('unreachable')
    expect(r.names).toEqual(['u'])
    expect(r.body).toEqual({ kind: 'radiusTo', circle: 'O', point: 'P' })
    expect(d.body).toEqual({ kind: 'diameter', circle: 'O', from: 'P', to: 'Q' })
  })

  it('draws any of them without a name to bind, like "incircle of ABC"', () => {
    const s = parseStatement('chord P-Q on O')
    if (s.kind !== 'construction') throw new Error('unreachable')
    expect(s.names).toEqual([])
    expect(s.body).toEqual({ kind: 'chord', circle: 'O', from: 'P', to: 'Q' })
  })

  it('still parses a tangent to a FUNCTION, which is a different statement', () => {
    expect(parseStatement('tangent: x^2 - 1 at x = 2').kind).toBe('tangent')
  })

  it('parses an arc, a sector and a circular segment, each with its direction', () => {
    for (const shape of ['arc', 'sector', 'segment'] as const) {
      const s = parseStatement(`${shape} P-Q on O minor`)
      expect(s.kind).toBe('circleShape')
      if (s.kind !== 'circleShape') throw new Error('unreachable')
      expect(s).toMatchObject({ shape, circle: 'O', from: 'P', to: 'Q', direction: 'minor' })
    }
  })

  it('takes all four directions', () => {
    for (const direction of ['minor', 'major', 'ccw', 'cw'] as const) {
      const s = parseStatement(`arc P-Q on O ${direction}`)
      if (s.kind !== 'circleShape') throw new Error('unreachable')
      expect(s.direction).toBe(direction)
    }
  })

  it('REFUSES an arc with no direction rather than drawing one of the two (G1)', () => {
    expect(() => parseStatement('arc P-Q on O')).toThrow(/two different arcs/)
    expect(() => parseStatement('arc P-Q on O')).toThrow(/minor/)
    expect(() => parseStatement('sector P-Q on O')).toThrow(/two different arcs/)
    expect(() => parseStatement('central angle P-Q on O')).toThrow(/two different arcs/)
  })

  it('refuses a direction it does not recognise, saying what it takes', () => {
    expect(() => parseStatement('arc P-Q on O widdershins')).toThrow(/widdershins/)
    expect(() => parseStatement('arc P-Q on O widdershins')).toThrow(/"ccw"/)
  })

  it('still parses "segment: A-B", which is a segment of a LINE', () => {
    expect(parseStatement('segment: A-B').kind).toBe('namedSegment')
  })

  it('parses the two angle marks', () => {
    const central = parseStatement('central angle P-Q on O major')
    expect(central).toMatchObject({ kind: 'centralAngle', circle: 'O', from: 'P', to: 'Q', direction: 'major' })
    const inscribed = parseStatement('inscribed angle P-Q-R on O')
    expect(inscribed).toMatchObject({ kind: 'inscribedAngle', circle: 'O', from: 'P', vertex: 'Q', to: 'R' })
  })

  it('still parses "angle: A-B-C", the plain angle mark', () => {
    expect(parseStatement('angle: A-B-C').kind).toBe('angle')
  })

  it('parses an arc measure label, which names its circle and its direction', () => {
    const s = parseStatement('label: arc PQ on O minor')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.subject).toEqual({ kind: 'arc', circle: 'O', from: 'P', to: 'Q', direction: 'minor' })
    expect(s.content).toEqual({ kind: 'computed' })
  })

  it('asserts a stated arc measure, exactly as a length or an angle does', () => {
    const s = parseStatement('label: arc PQ on O minor = 60')
    if (s.kind !== 'measureLabel') throw new Error('unreachable')
    expect(s.content).toEqual({ kind: 'stated', value: 60 })
  })

  it('refuses an arc label with no circle to be on', () => {
    expect(() => parseStatement('label: arc PQ')).toThrow(/arc PQ on/)
  })

  it('states an arc in the givens box', () => {
    const s = parseStatement('given: arc PQ on O minor = 60')
    if (s.kind !== 'given') throw new Error('unreachable')
    if (s.entry.kind !== 'measure') throw new Error('unreachable')
    expect(s.entry.subject).toEqual({ kind: 'arc', circle: 'O', from: 'P', to: 'Q', direction: 'minor' })
    expect(s.entry.content).toEqual({ kind: 'stated', value: 60 })
  })
})

describe('parseStatement \u2014 the Find section', () => {
  it('puts a "given:" row in the Given section', () => {
    const s = parseStatement('given: AB = 6')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.section).toBe('given')
  })

  it('puts a "find:" row in the Find section, with the same subject grammar', () => {
    const s = parseStatement('find: angle ABC')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.section).toBe('find')
    if (s.entry.kind !== 'measure') throw new Error('unreachable')
    expect(s.entry.subject).toEqual({ kind: 'angle', from: 'A', vertex: 'B', to: 'C' })
  })

  it('takes a relation in the Find section too', () => {
    const s = parseStatement('find: AB parallel CD')
    if (s.kind !== 'given') throw new Error('unreachable')
    expect(s.section).toBe('find')
    expect(s.entry.kind).toBe('relation')
  })

  it('names the statement the author wrote when there is nothing to find', () => {
    expect(() => parseStatement('find:')).toThrow(/find:/)
  })
})

describe('solids', () => {
  it('parses a prism by its three dimensions', () => {
    const s = parseStatement('solid: prism 8 by 5 by 6')
    expect(s.kind).toBe('solid')
    if (s.kind !== 'solid') return
    expect(s.name).toBeNull()
    expect(s.primitive).toEqual({
      kind: 'prism',
      width: { kind: 'num', value: 8 },
      height: { kind: 'num', value: 5 },
      depth: { kind: 'num', value: 6 },
    })
  })

  it('parses a square pyramid by its base and height', () => {
    const s = parseStatement('solid: pyramid square base 6, height 9')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive).toEqual({ kind: 'pyramid', base: { kind: 'num', value: 6 }, height: { kind: 'num', value: 9 } })
  })

  it('parses a tetrahedron by its edge', () => {
    const s = parseStatement('solid: tetrahedron edge 5')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive).toEqual({ kind: 'tetrahedron', edge: { kind: 'num', value: 5 } })
  })

  it('binds a name with the "S = solid ..." form', () => {
    const s = parseStatement('S = solid prism 8 by 5 by 6')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.name).toBe('S')
  })

  it('keeps dimensions as expressions, so a named constant works', () => {
    const s = parseStatement('solid: tetrahedron edge 2*a')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive.kind).toBe('tetrahedron')
    if (s.primitive.kind !== 'tetrahedron') return
    expect(s.primitive.edge.kind).toBe('binary')
  })

  it('names the primitives that exist when one does not', () => {
    expect(() => parseStatement('solid: dodecahedron edge 5')).toThrow(/prism, pyramid, tetrahedron/)
  })

  it('refuses a pyramid that does not say what its base is', () => {
    expect(() => parseStatement('solid: pyramid 6, 9')).toThrow(/pyramid square base/)
  })

  it('refuses a prism that is not three dimensions', () => {
    expect(() => parseStatement('solid: prism 8 by 5')).toThrow(/width> by <height> by <depth/)
  })

  it('takes a trailing "vertices" clause naming every vertex', () => {
    const s = parseStatement('S = solid tetrahedron edge 5 vertices ABCD')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.vertices).toEqual(['A', 'B', 'C', 'D'])
    expect(s.primitive).toEqual({ kind: 'tetrahedron', edge: { kind: 'num', value: 5 } })
  })

  it('refuses repeated vertex names', () => {
    expect(() => parseStatement('solid: tetrahedron edge 5 vertices ABCC')).toThrow(/distinct/)
  })

  it('still takes a color clause', () => {
    const s = parseStatement('solid: prism 2 by 2 by 2 color: teal')
    expect(s.kind).toBe('solid')
    expect(s.color).toBe('teal')
  })
})

describe('curved solids', () => {
  it('parses a cylinder and a cone by radius and height', () => {
    for (const kind of ['cylinder', 'cone'] as const) {
      const s = parseStatement(`solid: ${kind} radius 3, height 8`)
      if (s.kind !== 'solid') throw new Error('expected a solid')
      expect(s.primitive).toEqual({ kind, radius: { kind: 'num', value: 3 }, height: { kind: 'num', value: 8 } })
    }
  })

  it('parses a sphere by its radius', () => {
    const s = parseStatement('S = solid sphere radius 4')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive).toEqual({ kind: 'sphere', radius: { kind: 'num', value: 4 } })
    expect(s.name).toBe('S')
  })

  it('names all six primitives when one is unknown', () => {
    expect(() => parseStatement('solid: torus radius 4')).toThrow(/prism, pyramid, tetrahedron, cylinder, cone, sphere/)
  })

  it('refuses a cylinder that does not say which number is which', () => {
    expect(() => parseStatement('solid: cylinder 3, 8')).toThrow(/cylinder radius <r>, height <h>/)
  })

  it('labels a radius', () => {
    const s = parseStatement('label: C radius')
    if (s.kind !== 'measureLabel') throw new Error('expected a measure label')
    expect(s.subject).toEqual({ kind: 'solidDimension', solid: 'C', dimension: 'radius' })
  })
})

describe('segment styles (phase 6)', () => {
  it('parses auto, dashed and plain', () => {
    expect(parseStatement('segment: A-G')).toMatchObject({ kind: 'namedSegment', from: 'A', to: 'G', style: 'auto' })
    expect(parseStatement('segment: A-G dashed')).toMatchObject({ kind: 'namedSegment', style: 'dashed' })
    expect(parseStatement('segment: A-G plain')).toMatchObject({ kind: 'namedSegment', style: 'plain' })
  })
})

describe('the frustum (phase 7, P2)', () => {
  it('parses a conical frustum by radius, top and height', () => {
    const s = parseStatement('F = solid frustum radius 6, top 3, height 4')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive).toEqual({
      kind: 'frustum',
      radius: { kind: 'num', value: 6 },
      top: { kind: 'num', value: 3 },
      height: { kind: 'num', value: 4 },
    })
  })

  it('refuses a frustum that does not say which number is which', () => {
    expect(() => parseStatement('solid: frustum 6, 3, 4')).toThrow(/frustum radius <r>, top <r>, height <h>/)
  })

  it('labels a top', () => {
    const s = parseStatement('label: F top')
    if (s.kind !== 'measureLabel') throw new Error('expected a measure label')
    expect(s.subject).toEqual({ kind: 'solidDimension', solid: 'F', dimension: 'top' })
  })
})

describe('the hull of named points (phase 7, P3)', () => {
  it('parses a hyphenated run of point names', () => {
    const s = parseStatement('S = solid hull A-B-C-D-E')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    expect(s.primitive).toEqual({ kind: 'hull', points: ['A', 'B', 'C', 'D', 'E'] })
  })

  it('refuses a run with no hyphens, and a repeated name', () => {
    expect(() => parseStatement('solid: hull ABCD')).toThrow(/hull A-B-C-D/)
    expect(() => parseStatement('solid: hull A-B-C-A')).toThrow(/"A" is named twice/)
  })
})

describe('solids on named points (phase 7, P6)', () => {
  const primitive = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'solid') throw new Error('expected a solid')
    return s
  }
  const n = (value: number) => ({ kind: 'num', value })

  it('parses a tetrahedron, a pyramid and a prism on points', () => {
    expect(primitive('T = solid tetrahedron A-B-C-D').primitive).toEqual({ kind: 'tetrahedronOn', points: ['A', 'B', 'C', 'D'] })
    expect(primitive('P = solid pyramid A-B-C-D apex E').primitive).toEqual({ kind: 'pyramidOn', base: ['A', 'B', 'C', 'D'], apex: 'E' })
    const prism = primitive('Q = solid prism A-B-C height 5 vertices DEF')
    expect(prism.primitive).toEqual({ kind: 'prismOn', base: ['A', 'B', 'C'], height: n(5) })
    expect(prism.vertices).toEqual(['D', 'E', 'F'])
  })

  it('parses round solids placed by points', () => {
    expect(primitive('O = solid sphere center M radius 5').primitive).toEqual({ kind: 'sphereOn', center: 'M', radius: n(5) })
    expect(primitive('C = solid cylinder from A to B radius 3').primitive).toEqual({ kind: 'cylinderOn', from: 'A', to: 'B', radius: n(3) })
    expect(primitive('K = solid cone apex V base O radius 3').primitive).toEqual({ kind: 'coneOn', apex: 'V', base: 'O', radius: n(3) })
    expect(primitive('F = solid frustum from O radius 6 to P radius 3').primitive).toEqual({
      kind: 'frustumOn',
      from: 'O',
      fromRadius: n(6),
      to: 'P',
      toRadius: n(3),
    })
  })

  it('keeps every dimension form as it was', () => {
    expect(primitive('solid: tetrahedron edge 5').primitive.kind).toBe('tetrahedron')
    expect(primitive('solid: prism 8 by 5 by 6').primitive.kind).toBe('prism')
    expect(primitive('solid: cylinder radius 3, height 8').primitive.kind).toBe('cylinder')
    // A three-letter vertex list is still refused on anything but a prism's top.
    expect(() => parseStatement('solid: tetrahedron edge 5 vertices ABC')).toThrow(/vertices ABCD/)
  })
})

describe('the tetrahedron by its six edges (phase 7, P4)', () => {
  it('parses four vertex names and six edges, as written', () => {
    const s = parseStatement('T = solid tetrahedron ABCD with AB = sqrt(41), CD = sqrt(41), AC = 9, BD = 9, AD = 7, CB = 7')
    if (s.kind !== 'solid') throw new Error('expected a solid')
    const primitive = s.primitive
    if (primitive.kind !== 'tetrahedronEdges') throw new Error('expected a tetrahedron by its edges')
    expect(primitive.vertices).toEqual(['A', 'B', 'C', 'D'])
    expect(primitive.edges.map((e) => `${e.from}${e.to}`)).toEqual(['AB', 'CD', 'AC', 'BD', 'AD', 'CB'])
    expect(primitive.edges[0].length).toEqual({ kind: 'call', name: 'sqrt', args: [{ kind: 'num', value: 41 }] })
  })

  it('refuses a pair given twice in either letter order, and a missing one', () => {
    expect(() => parseStatement('solid: tetrahedron ABCD with AB = 1, BA = 1, AD = 1, BC = 1, BD = 1, CD = 1')).toThrow(/AB is given twice/)
    expect(() => parseStatement('solid: tetrahedron ABCD with AB = 1, AC = 1, AD = 1, BC = 1, BD = 1')).toThrow(/CD is missing/)
  })
})

describe('more solids by dimensions (phase 7, P5)', () => {
  const primitive = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'solid') throw new Error('expected a solid')
    return s.primitive
  }
  const n = (value: number) => ({ kind: 'num', value })

  it('parses the cube, the octahedron and the regular and rectangle forms', () => {
    expect(primitive('solid: cube edge 4')).toEqual({ kind: 'cube', edge: n(4) })
    expect(primitive('solid: octahedron edge 6')).toEqual({ kind: 'octahedron', edge: n(6) })
    expect(primitive('solid: prism regular 6 side 12, height 5')).toEqual({ kind: 'regularPrism', sides: n(6), side: n(12), height: n(5) })
    expect(primitive('solid: pyramid regular 5 side 4, height 6')).toEqual({ kind: 'regularPyramid', sides: n(5), side: n(4), height: n(6) })
    expect(primitive('solid: pyramid rectangle 6 by 4, height 9')).toEqual({ kind: 'rectanglePyramid', width: n(6), depth: n(4), height: n(9) })
    expect(primitive('solid: frustum regular 4 side 6, top 3, height 4')).toEqual({
      kind: 'regularFrustum',
      sides: n(4),
      side: n(6),
      top: n(3),
      height: n(4),
    })
  })

  it('names every primitive when one is unknown', () => {
    expect(() => parseStatement('solid: torus radius 4')).toThrow(
      /prism, pyramid, tetrahedron, cylinder, cone, sphere, frustum, hull, cube, octahedron/
    )
  })

  it('labels a side', () => {
    const s = parseStatement('label: S side')
    if (s.kind !== 'measureLabel') throw new Error('expected a measure label')
    expect(s.subject).toEqual({ kind: 'solidDimension', solid: 'S', dimension: 'side' })
  })

  it('refuses a malformed regular form, quoting the expected shape', () => {
    expect(() => parseStatement('solid: prism regular 6, height 5')).toThrow(/prism regular <n> side <s>, height <h>/)
  })
})

describe('planes as objects (phase 8, Q2)', () => {
  const n = (value: number) => ({ kind: 'num', value })
  const cut = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'crossSection') throw new Error('expected a cross-section')
    return s
  }

  it('keeps "plane z = 1" as the axis form, exactly as written', () => {
    expect(cut('cut: S by plane z = 1').plane).toEqual({ kind: 'axis', axis: 'z', at: n(1), source: 'z = 1' })
    // The axis letter is case-insensitive, as it always was.
    expect(cut('section: S by plane Z = 1 vertices PQRS').plane).toEqual({ kind: 'axis', axis: 'z', at: n(1), source: 'Z = 1' })
  })

  it('reads a plane through three points, a perpendicular, a parallel and a named plane', () => {
    expect(cut('cut: S by plane M-N-P').plane).toEqual({ kind: 'points', points: ['M', 'N', 'P'], source: 'M-N-P' })
    expect(cut('cut: C by plane through O perpendicular to A-G').plane).toEqual({
      kind: 'perpendicular',
      through: 'O',
      line: ['A', 'G'],
      source: 'through O perpendicular to A-G',
    })
    expect(cut('cut: C by plane through P parallel to A-B-C').plane).toEqual({
      kind: 'parallel',
      through: 'P',
      to: { kind: 'points', points: ['A', 'B', 'C'], source: 'A-B-C' },
      source: 'through P parallel to A-B-C',
    })
    expect(cut('cut: C by plane through P parallel to p').plane).toEqual({
      kind: 'parallel',
      through: 'P',
      to: { kind: 'named', name: 'p', source: 'p' },
      source: 'through P parallel to p',
    })
    expect(cut('cut: C by plane p').plane).toEqual({ kind: 'named', name: 'p', source: 'p' })
  })

  it('reads an equation, keeping both sides as expressions', () => {
    const plane = cut('section: S by plane 2x + y - z = 3 vertices PQR').plane
    expect(plane.kind).toBe('equation')
    if (plane.kind !== 'equation') return
    expect(plane.source).toBe('2x + y - z = 3')
    expect(plane.right).toEqual(n(3))
    expect(plane.left.kind).toBe('binary')
    // An axis letter equal to something that mentions another axis is an
    // equation, not the axis form.
    expect(cut('cut: S by plane z = x + 1').plane.kind).toBe('equation')
  })

  it('binds a named plane with "p = plane ...", which is a statement of its own', () => {
    const s = parseStatement('p = plane A-B-C')
    expect(s.kind).toBe('planeDef')
    if (s.kind !== 'planeDef') return
    expect(s.name).toBe('p')
    expect(s.plane).toEqual({ kind: 'points', points: ['A', 'B', 'C'], source: 'A-B-C' })
    const eq = parseStatement('q = plane 2x + y - z = 3')
    if (eq.kind !== 'planeDef') throw new Error('expected a plane definition')
    expect(eq.plane.kind).toBe('equation')
  })

  it('takes every form as a construction operand too', () => {
    const foot = parseStatement('F = foot A to plane p')
    if (foot.kind !== 'construction' || foot.body.kind !== 'foot') throw new Error('unreachable')
    expect(foot.body.base).toEqual({ kind: 'plane', plane: { kind: 'named', name: 'p', source: 'p' } })
    const meet = parseStatement('X = intersect line A-G, plane x + y + z = 1')
    if (meet.kind !== 'construction' || meet.body.kind !== 'intersect') throw new Error('unreachable')
    expect(meet.body.right).toMatchObject({ kind: 'plane', plane: { kind: 'equation', source: 'x + y + z = 1' } })
  })

  it('refuses a plane it cannot read, naming the forms', () => {
    expect(() => parseStatement('cut: S by plane through O')).toThrow(/plane through P perpendicular to A-B/)
    expect(() => parseStatement('F = foot D to plane A-B')).toThrow(/three point names/)
  })
})

describe('what phase 8 does not draw (Q7)', () => {
  it('refuses a plane drawn on its own, pointing at cut: and at naming it', () => {
    for (const line of ['plane: A-B-C', 'plane A-B-C']) {
      expect(() => parseStatement(line)).toThrow(/A plane is not drawn on its own — it is drawn through the section it cuts/)
    }
  })

  // Rewritten in phase 11 (sanctioned): "net: S" was refused here until
  // build step 11 made it the net statement (N1). It now reads the solid.
  it('reads a net (phase 11: no longer refused)', () => {
    expect(parseStatement('net: S')).toEqual({ kind: 'net', solid: 'S', color: null, statementName: null })
  })
})

describe('the Q7 refusals never catch an assignment (fix round 1)', () => {
  it('still reads "plane = 2", "plane=2", "net = 5" and "net=5" as named constants', () => {
    for (const [line, name, value] of [
      ['plane = 2', 'plane', 2],
      ['plane=2', 'plane', 2],
      ['plane  =  3', 'plane', 3],
      ['net = 5', 'net', 5],
      ['net=5', 'net', 5],
    ] as const) {
      expect(parseStatement(line)).toMatchObject({ kind: 'constantDef', name, value: { kind: 'num', value } })
    }
  })

  // Rewritten in phase 11 (sanctioned): "net: S" is the net statement now,
  // and a bare "net S" is still refused, pointing at the colon.
  it('still refuses a plane written as a statement, and a net with no colon', () => {
    expect(() => parseStatement('plane: A-B-C')).toThrow(/A plane is not drawn on its own/)
    expect(() => parseStatement('plane A-B-C')).toThrow(/A plane is not drawn on its own/)
    expect(parseStatement('net: S')).toMatchObject({ kind: 'net', solid: 'S' })
    expect(() => parseStatement('net S')).toThrow('A net is written with a colon — "net: S"')
  })
})

describe('the Q7 refusals never catch a line the base grammar read (fix round 2)', () => {
  // Each line below parsed at the base commit 27c1ff9 — as an implicit curve
  // or a region over named constants "plane" and "net" — and the expected
  // statements are that commit's own output, verbatim. Only "plane: ...",
  // "net: ..." and a bare "plane <operand>" / "net <solid>" with no relation
  // in it (all "Unrecognized statement" at base) are refused.
  const BASE: [string, unknown][] = [
    ["net + x = y", {"kind": "implicit", "left": {"kind": "binary", "op": "+", "left": {"kind": "var", "name": "net"}, "right": {"kind": "var", "name": "x"}}, "right": {"kind": "var", "name": "y"}, "color": null, "statementName": null}],
    ["net + 1 = y", {"kind": "implicit", "left": {"kind": "binary", "op": "+", "left": {"kind": "var", "name": "net"}, "right": {"kind": "num", "value": 1}}, "right": {"kind": "var", "name": "y"}, "color": null, "statementName": null}],
    ["plane * x = y", {"kind": "implicit", "left": {"kind": "binary", "op": "*", "left": {"kind": "var", "name": "plane"}, "right": {"kind": "var", "name": "x"}}, "right": {"kind": "var", "name": "y"}, "color": null, "statementName": null}],
    ["plane - y = 0", {"kind": "implicit", "left": {"kind": "binary", "op": "-", "left": {"kind": "var", "name": "plane"}, "right": {"kind": "var", "name": "y"}}, "right": {"kind": "num", "value": 0}, "color": null, "statementName": null}],
    ["net (x) = x^2", {"kind": "implicit", "left": {"kind": "call", "name": "net", "args": [{"kind": "var", "name": "x"}]}, "right": {"kind": "binary", "op": "^", "left": {"kind": "var", "name": "x"}, "right": {"kind": "num", "value": 2}}, "color": null, "statementName": null}],
    ["plane (t) = t + 1", {"kind": "implicit", "left": {"kind": "call", "name": "plane", "args": [{"kind": "var", "name": "t"}]}, "right": {"kind": "binary", "op": "+", "left": {"kind": "var", "name": "t"}, "right": {"kind": "num", "value": 1}}, "color": null, "statementName": null}],
    ["plane x = 1", {"kind": "implicit", "left": {"kind": "binary", "op": "*", "left": {"kind": "var", "name": "plane"}, "right": {"kind": "var", "name": "x"}}, "right": {"kind": "num", "value": 1}, "color": null, "statementName": null}],
    ["net x > y", {"kind": "region", "left": {"kind": "binary", "op": "*", "left": {"kind": "var", "name": "net"}, "right": {"kind": "var", "name": "x"}}, "op": ">", "right": {"kind": "var", "name": "y"}, "color": null, "statementName": null}],
    // Phase 11 — the net and shortest-path keywords take only "net:" and
    // "shortest:"; these read exactly as the base commit d2b91e8 read them.
    ["net(x) = x^2", {"kind": "functionDef", "name": "net", "param": "x", "body": {"kind": "binary", "op": "^", "left": {"kind": "var", "name": "x"}, "right": {"kind": "num", "value": 2}}, "color": null, "statementName": null}],
    ["net = 5", {"kind": "constantDef", "name": "net", "value": {"kind": "num", "value": 5}, "color": null, "statementName": null}],
  ]
  for (const [line, statement] of BASE) {
    it(`parses "${line}" exactly as the base commit did`, () => {
      expect(parseStatement(line)).toEqual(statement)
    })
  }
})

describe('spheres by tangency, and a sphere\'s centre (phase 9, R5 and R1)', () => {
  const primitive = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'solid') throw new Error('expected a solid')
    return s.primitive
  }

  it('reads a sphere tangent to a plane, in any plane form', () => {
    expect(primitive('S = solid sphere center P tangent to plane A-B-C')).toEqual({
      kind: 'sphereTangent',
      center: 'P',
      to: { kind: 'plane', plane: { kind: 'points', points: ['A', 'B', 'C'], source: 'A-B-C' } },
    })
    expect(primitive('S = solid sphere center P tangent to plane p')).toEqual({
      kind: 'sphereTangent',
      center: 'P',
      to: { kind: 'plane', plane: { kind: 'named', name: 'p', source: 'p' } },
    })
    const tilted = primitive('S = solid sphere center P tangent to plane x + y + z = 3')
    if (tilted.kind !== 'sphereTangent' || tilted.to.kind !== 'plane') throw new Error('expected a plane tangency')
    expect(tilted.to.plane.kind).toBe('equation')
  })

  it('reads a sphere externally or internally tangent to another', () => {
    expect(primitive('S = solid sphere center P externally tangent to T')).toEqual({
      kind: 'sphereTangent',
      center: 'P',
      to: { kind: 'sphere', sphere: 'T', side: 'external' },
    })
    expect(primitive('S = solid sphere center P internally tangent to T')).toEqual({
      kind: 'sphereTangent',
      center: 'P',
      to: { kind: 'sphere', sphere: 'T', side: 'internal' },
    })
  })

  it('refuses a tangency it cannot read, saying which forms there are', () => {
    // Tangent to a sphere is one of two things, and guessing is refused.
    expect(() => parseStatement('S = solid sphere center P tangent to T')).toThrow(/externally tangent to T" or "internally tangent to T/)
    // A plane is tangent, full stop.
    expect(() => parseStatement('S = solid sphere center P externally tangent to plane z = 1')).toThrow(/tangent to plane z = 1/)
    // Several objects at once is a solver (R7).
    expect(() => parseStatement('S = solid sphere center P tangent to plane z = 0 and T')).toThrow(/one object at a time/)
    expect(() => parseStatement('S = solid sphere center P externally tangent to T, U')).toThrow(/one object at a time/)
    expect(() => parseStatement('S = solid sphere tangent to plane z = 0')).toThrow(/placed by its centre/)
  })

  it('keeps the sphere forms it had', () => {
    expect(primitive('O = solid sphere center M radius 5').kind).toBe('sphereOn')
    expect(primitive('solid: sphere radius 4').kind).toBe('sphere')
  })

  it('reads "center of S" as a construction binding a point', () => {
    const s = parseStatement('M = center of S')
    expect(s).toMatchObject({ kind: 'construction', names: ['M'], body: { kind: 'centerOf', solid: 'S' } })
  })

  it('reads "centre of S" as the same construction (fix round 1)', () => {
    expect(parseStatement('M = centre of S')).toMatchObject({ kind: 'construction', names: ['M'], body: { kind: 'centerOf', solid: 'S' } })
  })

  it('points "tangent to p" at a named plane too, since the parser cannot tell p is one (fix round 1)', () => {
    expect(() => parseStatement('S = solid sphere center P tangent to p')).toThrow(
      'A sphere touches another from outside or from inside — write "externally tangent to p" or "internally tangent to p"; ' +
        'if p is a plane, write "tangent to plane p"'
    )
  })
})

describe('circumspheres (phase 9, R3 and R6)', () => {
  const primitive = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'solid') throw new Error('expected a solid')
    return s.primitive
  }

  it('reads the insphere of a solid, and nothing else', () => {
    expect(primitive('I = solid insphere of T')).toEqual({ kind: 'insphere', of: 'T' })
    expect(() => parseStatement('I = solid insphere A-B-C-D')).toThrow(/"insphere of <solid>"/)
  })

  it('reads the circumsphere of a solid, and of four points', () => {
    expect(primitive('O = solid circumsphere of T')).toEqual({ kind: 'circumsphere', of: 'T' })
    expect(primitive('O = solid circumsphere A-B-C-D')).toEqual({ kind: 'circumsphereOn', points: ['A', 'B', 'C', 'D'] })
  })

  it('refuses any other count of points, pointing at the hull', () => {
    expect(() => parseStatement('O = solid circumsphere A-B-C')).toThrow(/"circumsphere A-B-C-D" \(four points\).*hull A-B-C-D-E/)
    expect(() => parseStatement('O = solid circumsphere A-B-C-D-E')).toThrow(/four points/)
    expect(() => parseStatement('O = solid circumsphere A-B-C-A')).toThrow(/"A" is named twice/)
  })
})

describe('measures in space (phase 10, M3, M5 and M6)', () => {
  const given = (line: string) => {
    const s = parseStatement(line)
    if (s.kind !== 'given' || s.entry.kind !== 'measure') throw new Error('expected a measure row')
    return s.entry
  }

  it('reads the angle and the distance between two lines, "line" optional', () => {
    expect(given('given: angle between A-C and B-G').subject).toEqual({ kind: 'lineAngle', first: ['A', 'C'], second: ['B', 'G'] })
    expect(given('find: distance between line A-G and line B-F').subject).toEqual({ kind: 'lineDistance', first: ['A', 'G'], second: ['B', 'F'] })
    expect(given('given: angle between A-C and B-G = 60').content).toEqual({ kind: 'stated', value: 60 })
  })

  it('reads a line against a plane, and a point against a plane or a line', () => {
    expect(given('given: angle between A-G and plane A-B-C').subject).toEqual({
      kind: 'linePlaneAngle',
      line: ['A', 'G'],
      plane: { kind: 'points', points: ['A', 'B', 'C'], source: 'A-B-C' },
    })
    expect(given('given: distance from G to plane p').subject).toEqual({ kind: 'pointPlaneDistance', point: 'G', plane: { kind: 'named', name: 'p', source: 'p' } })
    expect(given('given: distance from G to line A-B').subject).toEqual({ kind: 'pointLineDistance', point: 'G', line: ['A', 'B'] })
    expect(given('given: distance from G to A-B = 1.5').content).toEqual({ kind: 'stated', value: 1.5 })
  })

  it('tells a plane equation\'s own "=" from the assertion', () => {
    // One "=" after an equation side: the plane's.
    const plain = given('given: distance from G to plane x + y + z = 1')
    expect(plain.subject).toMatchObject({ plane: { kind: 'equation', source: 'x + y + z = 1' } })
    expect(plain.content).toEqual({ kind: 'computed' })
    const axis = given('given: angle between A-B and plane z = 3')
    expect(axis.subject).toMatchObject({ plane: { kind: 'axis', axis: 'z', source: 'z = 3' } })
    expect(axis.content).toEqual({ kind: 'computed' })
    // Two: the last is the assertion.
    const asserted = given('given: distance from G to plane x + y + z = 1 = 0.577')
    expect(asserted.subject).toMatchObject({ plane: { kind: 'equation', source: 'x + y + z = 1' } })
    expect(asserted.content).toEqual({ kind: 'stated', value: 0.577 })
    // One after three names, "through ..." or a name: the assertion.
    expect(given('given: angle between A-G and plane A-B-C = 35').content).toEqual({ kind: 'stated', value: 35 })
    expect(given('given: distance from G to plane p = 2').content).toEqual({ kind: 'stated', value: 2 })
    expect(given('given: distance from G to plane through A perpendicular to A-G = 2').subject).toMatchObject({
      plane: { kind: 'perpendicular', through: 'A', line: ['A', 'G'] },
    })
  })

  it('reads a dihedral with its edge in the middle, as a label or a row', () => {
    expect(given('given: dihedral C-A-B-D = 90').subject).toEqual({ kind: 'dihedral', from: 'C', edge: ['A', 'B'], to: 'D' })
    expect(given('given: dihedral CABD').subject).toEqual({ kind: 'dihedral', from: 'C', edge: ['A', 'B'], to: 'D' })
    const label = parseStatement('label: dihedral A-B-F-G')
    expect(label).toMatchObject({ kind: 'measureLabel', subject: { kind: 'dihedral', from: 'A', edge: ['B', 'F'], to: 'G' }, content: { kind: 'computed' } })
    expect(() => parseStatement('given: dihedral A-B-C')).toThrow(/four point names/)
  })

  it('refuses an inline label on the between and from forms, pointing at the table', () => {
    expect(() => parseStatement('label: angle between A-C and B-G')).toThrow(/write "given: angle between A-C and B-G"/)
    expect(() => parseStatement('label: distance from P to line A-B = 3')).toThrow(/write "given: distance from P to line A-B"/)
  })

  it('refuses the angle between two planes, pointing at the dihedral, and a line–plane distance', () => {
    expect(() => parseStatement('given: angle between plane A-B-C and plane A-B-D')).toThrow(/dihedral C-A-B-D/)
    expect(() => parseStatement('given: distance between A-B and plane P-Q-R')).toThrow(/distance from P to plane P-Q-R/)
    expect(() => parseStatement('given: distance between A-B')).toThrow(/Expected "angle between A-B and C-D"/)
  })

  it('reads the common perpendicular of two lines as a two-name construction', () => {
    const s = parseStatement('P, Q = common perpendicular of A-G and B-F')
    expect(s).toMatchObject({ kind: 'construction', names: ['P', 'Q'], body: { kind: 'commonPerpendicular', first: ['A', 'G'], second: ['B', 'F'] } })
    expect(parseStatement('P, Q = common perpendicular line A-G and line B-F')).toMatchObject({ body: { first: ['A', 'G'], second: ['B', 'F'] } })
  })
})

describe('marks with no vertex are refused (phase 10, M8)', () => {
  it('refuses an angle mark between two lines, pointing at the table and at the foot', () => {
    expect(() => parseStatement('angle: between A-B and C-D')).toThrow(/no vertex to draw its mark at.*"given: angle between A-B and C-D".*"angle: A-P-F"/)
    // The ordinary mark still parses.
    expect(parseStatement('angle: A-B-C label: 30°')).toMatchObject({ kind: 'angle', from: 'A', vertex: 'B', to: 'C', label: '30°' })
  })
})

describe('the dihedral mark (phase 10, M3)', () => {
  it('reads "dihedral: C-A-B-D" with its edge in the middle, and the run form', () => {
    expect(parseStatement('dihedral: A-B-F-G')).toMatchObject({ kind: 'dihedral', from: 'A', edge: ['B', 'F'], to: 'G' })
    expect(parseStatement('dihedral: ABFG color: red')).toMatchObject({ kind: 'dihedral', from: 'A', edge: ['B', 'F'], to: 'G', color: 'red' })
    expect(() => parseStatement('dihedral: A-B-C')).toThrow(/four point names/)
  })
})

describe('areas and volumes are refused in words (phase 10, M8)', () => {
  it('refuses "S volume" and "area of ABC" rather than misreading them as point names', () => {
    expect(() => parseStatement('label: S volume')).toThrow(/Areas and volumes are not measured yet — "S volume" cannot be labelled/)
    expect(() => parseStatement('find: area of ABC')).toThrow(/Areas and volumes are not measured yet — "area of ABC" cannot be stated/)
    // A solid's named dimensions still read as before.
    expect(parseStatement('label: S height')).toMatchObject({ subject: { kind: 'solidDimension', solid: 'S', dimension: 'height' } })
  })
})

// ---------------------------------------------------------------------------
// Space's two hooks (S1, K5): what they must leave alone, and what they claim.
// ---------------------------------------------------------------------------

// Expected trees written out by hand, not produced by any parser.
const n = (value: number) => ({ kind: 'num', value })
const v = (name: string) => ({ kind: 'var', name })
const bin = (op: string, left: unknown, right: unknown) => ({ kind: 'binary', op, left, right })
const fnCall = (name: string, ...args: unknown[]) => ({ kind: 'call', name, args })
const plain = { color: null, statementName: null }

describe('space never claims these lines: each parses exactly as before (K5 negatives)', () => {
  const SQUARES = bin('+', bin('^', v('x'), n(2)), bin('^', v('y'), n(2)))
  const BEFORE: [string, unknown][] = [
    ['x^2 + y^2 = 25', { kind: 'implicit', left: SQUARES, right: n(25), ...plain }],
    ['y = x^2', { kind: 'explicit', independent: 'x', body: bin('^', v('x'), n(2)), condition: null, ...plain }],
    ['z = x*y', { kind: 'surface', body: bin('*', v('x'), v('y')), ...plain }],
    ['k(x) = x^2', { kind: 'functionDef', name: 'k', param: 'x', body: bin('^', v('x'), n(2)), ...plain }],
    ['g(z) = z^2', { kind: 'functionDef', name: 'g', param: 'z', body: bin('^', v('z'), n(2)), ...plain }],
    ['A = (1, 2, 3)', { kind: 'point', label: 'A', x: n(1), y: n(2), z: n(3), ...plain }],
    ['k = z + 1', { kind: 'constantDef', name: 'k', value: bin('+', v('z'), n(1)), ...plain }],
    ['M = midpoint A-B', { kind: 'construction', names: ['M'], body: { kind: 'midpoint', from: 'A', to: 'B' }, ...plain }],
    [
      'S = solid prism 8 by 5 by 6',
      { kind: 'solid', name: 'S', primitive: { kind: 'prism', width: n(8), height: n(5), depth: n(6) }, vertices: [], ...plain },
    ],
    [
      'p = plane x + y + z = 4',
      {
        kind: 'planeDef',
        name: 'p',
        plane: { kind: 'equation', left: bin('+', bin('+', v('x'), v('y')), v('z')), right: n(4), source: 'x + y + z = 4' },
        ...plain,
      },
    ],
    ['segment: A-B dashed', { kind: 'namedSegment', from: 'A', to: 'B', style: 'dashed', ...plain }],
    [
      '(cos(t), sin(t)) for t in [0, 6]',
      { kind: 'parametric', fx: fnCall('cos', v('t')), fy: fnCall('sin', v('t')), fz: null, param: 't', from: n(0), to: n(6), ...plain },
    ],
    [
      '(cos(t), sin(t), t) for t in [0, 6]',
      { kind: 'parametric', fx: fnCall('cos', v('t')), fy: fnCall('sin', v('t')), fz: v('t'), param: 't', from: n(0), to: n(6), ...plain },
    ],
    ['plane = 2', { kind: 'constantDef', name: 'plane', value: n(2), ...plain }],
    ['net = 5', { kind: 'constantDef', name: 'net', value: n(5), ...plain }],
    ['z = x*y color: red name: s', { kind: 'surface', body: bin('*', v('x'), v('y')), color: 'red', statementName: 's' }],
  ]
  for (const [line, statement] of BEFORE) {
    it(line, () => {
      expect(parseStatement(line)).toEqual(statement)
    })
  }

  it('plane: A-B-C still throws the phase-8 refusal', () => {
    expect(() => parseStatement('plane: A-B-C')).toThrow(/A plane is not drawn on its own — it is drawn through the section it cuts/)
  })

  // A keyword branch that runs before the hook keeps its line: "triangle"
  // followed by a space is the solved-triangle statement, so this is its
  // error, not a vector constant named "triangle".
  it('triangle = <1, 2, 3> is still the triangle statement’s error', () => {
    expect(() => parseStatement('triangle = <1, 2, 3>')).toThrow(/Expected "triangle ABC:/)
  })
})

describe('space claims its own forms through the full wrapper (K5 positives)', () => {
  const POSITIVE: [string, string][] = [
    ['f(x, y) = x^2 - y^2', 'function'],
    ['F(x, y, z) = <-y, x, 0>', 'vectorFunction'],
    ['r(t) = ⟨cos(t), sin(t), t/4⟩', 'vectorFunction'],
    ['r(t) = (cos(t), sin(t), t)', 'vectorFunction'],
    ['u = <1, 2, 3>', 'vectorFunction'],
    ['z = x*y for x in [0, 1], y in [0, 2]', 'surface'],
    ['z = x + y over x in [0, 1], y in [x^2, x]', 'surface'],
    ['z = 1 over y in [0, 2], x in [0, y/2]', 'surface'],
    ['z = r over r in [0, 2], theta in [0, pi]', 'surface'],
    ['z = 4 - x^2 - y^2 over x^2 + y^2 <= 4', 'surface'],
    ['z = x over 1 <= x^2 + y^2 <= 4 and y >= 0', 'surface'],
    ['z = x^2 opacity: 0.5', 'surface'],
    ['(cos(t), sin(t), t) for t in [0, 6] width: 3', 'curve'],
    ['x^2 + y^2 - z^2 = 1', 'implicitSurface'],
    ['x = y^2 + z^2', 'implicitSurface'],
    ['implicit: x^2 + y^2 = 4', 'implicitSurface'],
  ]
  for (const [line, form] of POSITIVE) {
    it(line, () => {
      const s = parseStatement(line)
      expect(s.kind).toBe('space')
      if (s.kind !== 'space') throw new Error('unreachable')
      expect(s.form.form).toBe(form)
    })
  }

  it('color: and name: land on a space statement', () => {
    const s = parseStatement('z = x over x^2 + y^2 <= 1 color: purple name: s')
    expect(s).toMatchObject({ kind: 'space', color: 'purple', statementName: 's' })
    if (s.kind !== 'space') throw new Error('unreachable')
    expect(s.form).toMatchObject({ form: 'surface', domain: { kind: 'inequality' } })
  })

  it('a style clause is not stripped from a line space does not claim', () => {
    // A 2D curve with "width:" is not a space form, so the shared grammar sees
    // the whole line and refuses it as it always did.
    expect(() => parseStatement('(cos(t), sin(t)) for t in [0, 6] width: 3')).toThrow(/range/)
  })
})

describe('space leaves built-in names and solid-figure words alone (fix round 1, I1 and R2)', () => {
  // Expected trees written out by hand: what the base commit parses.
  const call2 = (name: string, a: string, b: string) => ({ kind: 'call', name, args: [v(a), v(b)] })
  const BEFORE: [string, unknown][] = [
    ['log(y, x) = 2', { kind: 'implicit', left: call2('log', 'y', 'x'), right: n(2), ...plain }],
    ['log(x, y) = 1', { kind: 'implicit', left: call2('log', 'x', 'y'), right: n(1), ...plain }],
    ['sin(x, y) = 1', { kind: 'implicit', left: call2('sin', 'x', 'y'), right: n(1), ...plain }],
    ['plane z = 1', { kind: 'implicit', left: bin('*', v('plane'), v('z')), right: n(1), ...plain }],
    [
      'plane x + y + z = 4',
      { kind: 'implicit', left: bin('+', bin('+', bin('*', v('plane'), v('x')), v('y')), v('z')), right: n(4), ...plain },
    ],
    // "label" with no colon is not the label statement: an implicit product
    ['label z = 3', { kind: 'implicit', left: bin('*', v('label'), v('z')), right: n(3), ...plain }],
    // Still an error, in 2D. "<" is now a token (comparisons, calc P1), so the
    // refusal comes from the parser, not the tokenizer.
    ['pi = <1, 2, 3>', { threw: 'Unexpected token in expression' }],
    ['sin(z) = z^2', { kind: 'functionDef', name: 'sin', param: 'z', body: bin('^', v('z'), n(2)), ...plain }],
  ]
  for (const [line, statement] of BEFORE) {
    it(line, () => {
      let actual: unknown
      try {
        actual = parseStatement(line)
      } catch (err) {
        actual = { threw: (err as Error).message }
      }
      expect(actual).toEqual(statement)
    })
  }
})

describe('a color: or name: left before a style clause gets a legible error (fix round 1, R3)', () => {
  it('z = x color: red opacity: 0.5', () => {
    expect(() => parseStatement('z = x color: red opacity: 0.5')).toThrow(/write color: and name: after the other clauses/)
    expect(() => parseStatement('z = x color: red opacity: 0.5')).not.toThrow(/Unexpected character/)
  })

  it('name: before colormap:, on a surface over a domain', () => {
    expect(() => parseStatement('z = x over x^2 + y^2 <= 1 name: s colormap: height')).toThrow(/write color: and name: after/)
  })

  it('after the other clauses they still work', () => {
    expect(parseStatement('z = x opacity: 0.5 color: red name: s')).toMatchObject({ kind: 'space', color: 'red', statementName: 's' })
  })
})

// calc P1 fix round 1. "!" is a token now, so a line that is split at its first
// "=" by string ("y != 2" -> "y!" and "2") would parse as the factorial equation
// "y! = 2" instead of failing. parseStatement refuses a "!=" that sits outside
// every bracket and before any "if" clause, before any grammar (space's keyword
// and unkeyed hooks included) can split the line.
describe('a bare "!=" is a condition, not an equation', () => {
  const NOT_AN_EQUATION = /"!=" is a condition, not an equation: use it inside an "if" clause or a piecewise \{…\}; for a factorial equation write "n! = 5" with a space/

  const REFUSED = [
    'y != 2',
    'y!=2',
    'n!=5',
    'x^2 + y^2 != 1',
    'x^2 + z^2 != 1',
    'implicit: x^2 + y^2 != 4',
    // space keyword operands: a region's condition, a contour's target and levels, a constraint
    'region: x^2 + y^2 <= 4 and x != 0',
    'contour: x^2 + y^2 != 4 level 1',
    'contour: x^2 + y^2 level 1 != 2',
    'lagrange: max x + y subject to x^2 + y^2 != 1',
    // before an "if" clause it is still bare; with a style clause after it too
    'y != 2 if x > 0',
    'y != 2 color: red',
    'z = x != 2',
    // a bare word "if" is not an "if" clause: a clause comes after the statement's first "=" or comparator
    'if != 2',
    'a + if != 3',
    // a plane measure splits the plane at its first "=" and parses the left side as an expression
    'given: distance from G to plane x + y + z != 1',
    'find: distance from G to plane x != 1',
    'given: angle between A-B and plane x + y != 1',
    'given: angle between A-B and plane P-Q-R = a != b',
    'given: distance from G to plane P-Q-R = x != 3',
    // a given or find line has no "if" clause, so its word "if" opens nothing: the "!=" after it is still bare
    'given: distance from G to plane P-Q-R = 3 if a != 0',
    'find: distance from G to plane P-Q-R = 3 if a != 0',
    'given: angle between A-B and plane P-Q-R = 30 if a != 0',
  ]
  for (const line of REFUSED) {
    it(`refuses ${line}`, () => {
      expect(() => parseStatement(line)).toThrow(NOT_AN_EQUATION)
    })
  }

  it('a given or find plane measure keeps "if" as text where no "!=" is bare', () => {
    expect(parseStatement('given: distance from G to plane P-Q-R = 3 if a > 0')).toMatchObject({
      kind: 'given',
      entry: { kind: 'measure', content: { kind: 'symbol', text: '3 if a > 0' } },
    })
    expect(parseStatement('find: distance from G to plane P-Q-R = 3 if a > 0')).toMatchObject({ kind: 'given', section: 'find' })
  })

  it('leaves a "!=" inside an "if" clause to the clause', () => {
    // the guard does not fire, and the clause reads "!=" as the comparison (calc P1 statements, below)
    expect(parseStatement('y = x if x != 0')).toMatchObject({ kind: 'explicit', condition: null, where: compare('!=', variable('x'), num(0)) })
    expect(parseStatement('y = x^2 if 0 != x and x < 3')).toMatchObject({ kind: 'explicit', condition: null })
    expect(parseStatement('x^2 + y^2 < 9 if x != 0')).toMatchObject({ kind: 'region', where: compare('!=', variable('x'), num(0)) })
  })

  it('accepts a "!=" inside braces, parentheses or brackets', () => {
    expect(parseStatement('y = {x != 0: 1, 2}')).toMatchObject({ kind: 'explicit', body: parseExprString('{x != 0: 1, 2}') })
    expect(() => parseStatement('y = {x < 0: 1, x != 3: 2, 0}')).not.toThrow()
    expect(() => parseStatement('y = f({x != 0: 1, 2})')).not.toThrow(NOT_AN_EQUATION)
  })

  it('still reads "n! = 5", with a space, as the factorial equation', () => {
    expect(parseStatement('n! = 5')).toMatchObject({ kind: 'implicit', left: factorialOf(variable('n')), right: num(5) })
    expect(parseStatement('x! + y! = 7')).toMatchObject({ kind: 'implicit' })
  })

  it('does not touch the text of a table cell, a label or a given', () => {
    expect(parseStatement('row: a | x != 0')).toMatchObject({ kind: 'tableRow', cells: ['a', 'x != 0'] })
    expect(parseStatement('header: x != 0 | y')).toMatchObject({ kind: 'tableHeader', cells: ['x != 0', 'y'] })
    expect(parseStatement('t.row: a | x != 0')).toMatchObject({ kind: 'tableRow', tableName: 't', cells: ['a', 'x != 0'] })
    expect(() => parseStatement('label: AB = x != 3')).not.toThrow()
    expect(() => parseStatement('angle: A-B-C label: x != y')).not.toThrow()
    // a given or find that is not about a plane keeps its text, "!=" and all
    expect(parseStatement('given: AB = x != 3')).toMatchObject({ kind: 'given', entry: { kind: 'measure', content: { kind: 'symbol', text: 'x != 3' } } })
    expect(parseStatement('given: distance from G to line A-B = x != 3')).toMatchObject({ kind: 'given', entry: { kind: 'measure', content: { kind: 'symbol', text: 'x != 3' } } })
    expect(parseStatement('find: distance from G to line A-B = x != 3')).toMatchObject({ kind: 'given', section: 'find' })
  })

  it('counts an "if" only after the first "=" or comparator of the statement', () => {
    expect(() => parseStatement('y = x if x != 0')).not.toThrow(NOT_AN_EQUATION)
    expect(() => parseStatement('y > x if x != 0')).not.toThrow(NOT_AN_EQUATION)
    // an identifier that merely contains "if", or a bracketed one, is not a clause
    expect(() => parseStatement('diff != 2')).toThrow(NOT_AN_EQUATION)
    expect(() => parseStatement('y = f(if) != 2')).toThrow(NOT_AN_EQUATION)
    expect(parseStatement('y = {x != 0: 1, 2}')).toMatchObject({ kind: 'explicit' })
  })

  it('at the expression level n! = 5 and n != 5 are different conditions', () => {
    const factorialEquals = parseExprString('{n! = 5: 1, 0}')
    const notEqual = parseExprString('{n != 5: 1, 0}')
    expect(factorialEquals).toEqual(piecewise([[compare('=', factorialOf(variable('n')), num(5)), num(1)]], num(0)))
    expect(notEqual).toEqual(piecewise([[compare('!=', variable('n'), num(5)), num(1)]], num(0)))
    expect(factorialEquals).not.toEqual(notEqual)
  })
})

describe('calc P1 statements', () => {
  const x = variable('x')
  const y = variable('y')
  const minus = (n: number): Expr => ({ kind: 'unary', op: '-', arg: num(n) })

  it('an old-shape if clause produces exactly the old statement, with no where', () => {
    const s = parseStatement('y = x^2 if x < 0')
    expect(s).toMatchObject({ kind: 'explicit', condition: { kind: 'compare', op: '<' } })
    expect('where' in s).toBe(false)
  })

  it('every old shape of an explicit clause stays the old object, key for key', () => {
    expect(parseStatement('y = x^2 if x < 0')).toStrictEqual({
      kind: 'explicit',
      independent: 'x',
      body: parseExprString('x^2'),
      condition: { kind: 'compare', op: '<', value: num(0) },
      color: null,
      statementName: null,
    })
    expect(parseStatement('y = x if -1 <= x < 1')).toStrictEqual({
      kind: 'explicit',
      independent: 'x',
      body: x,
      condition: { kind: 'range', lowOp: '<=', low: minus(1), highOp: '<', high: num(1) },
      color: null,
      statementName: null,
    })
    expect(parseStatement('x = y^2 if y >= 2')).toStrictEqual({
      kind: 'explicit',
      independent: 'y',
      body: parseExprString('y^2'),
      condition: { kind: 'compare', op: '>=', value: num(2) },
      color: null,
      statementName: null,
    })
    expect(parseStatement('y = x')).toStrictEqual({ kind: 'explicit', independent: 'x', body: x, condition: null, color: null, statementName: null })
  })

  it('a new-shape clause sets where and leaves condition null', () => {
    const s = parseStatement('y = x^2 if x < -1 or x > 1')
    expect(s).toMatchObject({ kind: 'explicit', condition: null, where: or(compare('<', x, minus(1)), compare('>', x, num(1))) })
  })

  it('a clause the old shape cannot express is a where: !=, the variable on the right, a compound, another variable', () => {
    expect(parseStatement('y = x^2 if x != 0')).toMatchObject({ kind: 'explicit', condition: null, where: compare('!=', x, num(0)) })
    expect(parseStatement('y = x if 0 < x')).toMatchObject({ kind: 'explicit', condition: null, where: compare('<', num(0), x) })
    expect(parseStatement('y = x if x > 0 and x < 3')).toMatchObject({ kind: 'explicit', condition: null, where: and(compare('>', x, num(0)), compare('<', x, num(3))) })
    expect(parseStatement('x = y if y != 2')).toMatchObject({ kind: 'explicit', independent: 'y', condition: null, where: compare('!=', y, num(2)) })
    expect(parseStatement('y = x if y > 0')).toMatchObject({ kind: 'explicit', independent: 'x', condition: null, where: compare('>', y, num(0)) })
    // a clause that is not a condition at all is still refused
    expect(() => parseStatement('y = x if x + 1')).toThrow(/comparison/)
  })

  it('if on implicit and region lines', () => {
    expect(parseStatement('x^2 + y^2 = 4 if y > 0')).toMatchObject({ kind: 'implicit', where: compare('>', y, num(0)) })
    expect(parseStatement('x^2 + y^2 < 9 if y > 0 and x > -1')).toMatchObject({
      kind: 'region',
      op: '<',
      where: and(compare('>', y, num(0)), compare('>', x, minus(1))),
    })
    expect(parseStatement('1 < x^2 + y^2 < 4 if x > 0')).toMatchObject({ kind: 'regionChain', where: compare('>', x, num(0)) })
  })

  it('a line without an if clause carries no where key, on every plot form', () => {
    for (const line of ['x^2 + y^2 = 4', 'x^2 + y^2 < 9', '1 < x^2 + y^2 < 4', 'y > x^2']) {
      expect('where' in parseStatement(line)).toBe(false)
    }
  })

  it('the if clause leaves the rest of the line as it would be without it', () => {
    const region = parseStatement('x^2 + y^2 < 9')
    const regionIf = parseStatement('x^2 + y^2 < 9 if y > 0')
    if (region.kind !== 'region' || regionIf.kind !== 'region') throw new Error('unreachable')
    expect(regionIf.left).toEqual(region.left)
    expect(regionIf.right).toEqual(region.right)
    const chain = parseStatement('4 > x^2 + y^2 > 1')
    const chainIf = parseStatement('4 > x^2 + y^2 > 1 if y > 0')
    if (chain.kind !== 'regionChain' || chainIf.kind !== 'regionChain') throw new Error('unreachable')
    expect([chainIf.low, chainIf.lowOp, chainIf.mid, chainIf.highOp, chainIf.high]).toEqual([chain.low, chain.lowOp, chain.mid, chain.highOp, chain.high])
  })

  it('a comparator or "=" inside brackets is not the statement\'s relation', () => {
    expect(parseStatement('y = {x < 0: -1, 1}')).toMatchObject({ kind: 'explicit', body: piecewise([[compare('<', x, num(0)), minus(1)]], num(1)) })
    expect(parseStatement('y < sum(k = 1 to 3, x^k)')).toMatchObject({ kind: 'region', op: '<' })
    expect(parseStatement('f(x) = {x < 0: x^2, x}')).toMatchObject({ kind: 'functionDef', name: 'f' })
  })

  it('a piecewise on either side of a region, and in a chain, is read as an expression', () => {
    expect(parseStatement('y < {x < 0: -1, 1}')).toMatchObject({ kind: 'region', op: '<', right: piecewise([[compare('<', x, num(0)), minus(1)]], num(1)) })
    expect(parseStatement('{x < 0: -1, 1} < y')).toMatchObject({ kind: 'region', op: '<', left: piecewise([[compare('<', x, num(0)), minus(1)]], num(1)), right: y })
    expect(parseStatement('0 < y < {x < 0: 2, 3}')).toMatchObject({ kind: 'regionChain', mid: y, high: piecewise([[compare('<', x, num(0)), num(2)]], num(3)) })
    expect(parseStatement('{x < 0: x, 0} = y')).toMatchObject({ kind: 'implicit', left: piecewise([[compare('<', x, num(0)), x]], num(0)), right: y })
  })

  it('a piecewise body keeps its if clause apart from its own braces', () => {
    expect(parseStatement('y = {x < 0: -1, 1} if x != 3')).toMatchObject({
      kind: 'explicit',
      body: piecewise([[compare('<', x, num(0)), minus(1)]], num(1)),
      condition: null,
      where: compare('!=', x, num(3)),
    })
    expect(parseStatement('y < {x < 0: -1, 1} if x > 2')).toMatchObject({ kind: 'region', where: compare('>', x, num(2)) })
  })

  it('a stray closing bracket before the relation still reports the expression, not "Unrecognized statement"', () => {
    expect(() => parseStatement('y) < 2')).toThrow()
    expect(() => parseStatement('y) < 2')).not.toThrow(/Unrecognized statement/)
    expect(() => parseStatement('y) = 2 if x > 0')).not.toThrow(/Unrecognized statement/)
  })

  it('the chain refusals still read as before', () => {
    expect(() => parseStatement('1 < x < 2 < 3')).toThrow(/only two operators/)
    expect(() => parseStatement('1 < x > 2')).toThrow(/same direction/)
  })

  it('a tuple with a piecewise component still splits at its top-level comma', () => {
    expect(parseStatement('({t < 0: -t, t}, t) for t in [-1, 1]')).toMatchObject({ kind: 'parametric', param: 't' })
  })

  it('a piecewise inside a scatter point or a circle centre does not split it', () => {
    const scatter = parseStatement('scatter: ({1 < 2: 3, 4}, 5), (6, 7)')
    if (scatter.kind !== 'scatter') throw new Error('unreachable')
    expect(scatter.points).toHaveLength(2)
    expect(parseStatement('circle: ({1 < 2: 3, 4}, 0), 2')).toMatchObject({ kind: 'circle', radius: num(2) })
  })
})

describe('T7.7: a parenthesised left side is not a bare point', () => {
  it('(x^2+y^2)^2 = 4(x^2-y^2) is an implicit curve', () => {
    expect(parseStatement('(x^2+y^2)^2 = 4(x^2-y^2)').kind).toBe('implicit')
    expect(parseStatement('(x+y)^2 = 4(x-y)').kind).toBe('implicit')
    expect(parseStatement('(x+y) = 4(x-y)').kind).toBe('implicit')
  })
  it('a bare point and a point with nested parentheses are unchanged', () => {
    expect(parseStatement('(1, 2)').kind).toBe('point')
    expect(parseStatement('((1+2), (3))').kind).toBe('point')
  })
})
