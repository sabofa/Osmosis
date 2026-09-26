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
    expect(foot.body).toEqual({ kind: 'foot', from: 'D', base: { kind: 'plane', points: ['A', 'B', 'C'] } })

    const meet = parseStatement('X = intersect line A-G, plane B-D-E')
    if (meet.kind !== 'construction') throw new Error('unreachable')
    expect(meet.body).toEqual({
      kind: 'intersect',
      left: { kind: 'through', extent: 'infinite', from: 'A', to: 'G' },
      right: { kind: 'plane', points: ['B', 'D', 'E'] },
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
