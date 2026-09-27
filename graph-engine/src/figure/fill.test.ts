import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { parseStatement } from '../parser/parseStatement'
import { LIGHT_PALETTE } from '../render/palette'
import { buildScene } from '../scene/buildScene'
import { resolveMode } from '../scene/mode'
import { renderFigure } from './render'

// Phase 12, task 2 — "fill:": shaded regions and their booleans, drawn (F4,
// F5). What is asserted is the path itself: one element, segments as "L",
// arcs as "A" (never a polyline), one "Z" per loop, holes by the even-odd
// rule, in the regions layer, with no stroke of its own.

function rendered(spec: string) {
  const parsed = parseSpec(spec)
  expect(parsed.errors).toEqual([])
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function errorsOf(spec: string): string[] {
  return rendered(spec).errors.map((e) => e.message)
}

// The inner markup of one layer.
function layer(svg: string, name: string): string {
  const selfClosing = `<g data-layer="${name}"/>`
  if (svg.includes(selfClosing)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open)
  if (start < 0) throw new Error(`no layer "${name}" in output`)
  const from = start + open.length
  return svg.slice(from, svg.indexOf('</g>', from))
}

function paths(markup: string): string[] {
  return markup.match(/<path\b[^>]*\/>/g) ?? []
}

function attribute(element: string, name: string): string | null {
  const found = new RegExp(` ${name}="([^"]*)"`).exec(element)
  return found ? found[1] : null
}

// The subpaths of a path's d, each as its command letters: "MLLLZ".
function subpaths(element: string): string[] {
  const d = attribute(element, 'd') ?? ''
  return d
    .split('Z')
    .map((part) => part.replace(/[^MLAZ]/g, ''))
    .filter((part) => part !== '')
    .map((part) => `${part}Z`)
}

// A square of side 4 about the origin, lettered counter-clockwise from the
// bottom left, and the circle of radius 2 inscribed in it (named O; its
// centre is M, because a circle and a point share one namespace).
const SQUARE_AND_CIRCLE = `@mode: figure
A = (-2, -2)
B = (2, -2)
C = (2, 2)
D = (-2, 2)
M = (0, 0)
O = circle M, 2`

describe('a fill is one path (F5)', () => {
  it('square ABCD minus circle O: one path, the square in M/L and the circle as two A arcs, even-odd, no stroke', () => {
    const svg = rendered(`${SQUARE_AND_CIRCLE}\nfill: square ABCD minus circle O`).svg
    const regions = paths(layer(svg, 'regions'))
    expect(regions).toHaveLength(1)
    const [fill] = regions
    // The square: its start and three sides, closed by Z (the fourth side).
    // The circle: a whole turn as two arcs, never a polyline.
    expect(subpaths(fill).sort()).toEqual(['MAAZ', 'MLLLZ'])
    expect(attribute(fill, 'fill-rule')).toBe('evenodd')
    expect(attribute(fill, 'data-statement')).toBe('6')
    expect(attribute(fill, 'stroke')).toBeNull()
    expect(attribute(fill, 'stroke-width')).toBeNull()
  })

  it('an annulus renders its hole by the even-odd rule', () => {
    const svg = rendered(`@mode: figure
M = (0, 0)
O = circle M, 3
P = circle M, 2
fill: circle O minus circle P`).svg
    const [fill] = paths(layer(svg, 'regions'))
    expect(subpaths(fill)).toEqual(['MAAZ', 'MAAZ'])
    expect(attribute(fill, 'fill-rule')).toBe('evenodd')
  })

  it('names the region it draws with the name: clause', () => {
    const svg = rendered(`${SQUARE_AND_CIRCLE}\nfill: circle O name: R`).svg
    expect(attribute(paths(layer(svg, 'regions'))[0], 'data-object')).toBe('R')
  })

  it('draws two fills in statement order, each in its own colour', () => {
    const svg = rendered(`${SQUARE_AND_CIRCLE}
fill: triangle ABD color: red
fill: triangle BCD color: blue
fill: circle O`).svg
    const regions = paths(layer(svg, 'regions'))
    expect(regions.map((p) => attribute(p, 'data-statement'))).toEqual(['6', '7', '8'])
    const colours = regions.map((p) => attribute(p, 'fill'))
    expect(new Set(colours).size).toBe(3)
    // The uncoloured fill is the theme's region colour, as a sector's is.
    const sector = rendered(`${SQUARE_AND_CIRCLE}\nP = (2, 0)\nQ = (0, 2)\nsector P-Q on O minor`).svg
    expect(colours[2]).toBe(attribute(paths(layer(sector, 'regions'))[0], 'fill'))
  })

  it('takes part in the bounds, arcs included, even when nothing else draws the circle', () => {
    const viewBox = (svg: string) => (/viewBox="([^"]*)"/.exec(svg) as RegExpExecArray)[1].split(' ').map(Number)
    const spec = `@mode: figure
@hide: k
M = (0, 0)
O = circle M, 5 name: k`
    const alone = viewBox(rendered(spec).svg)
    const filled = viewBox(rendered(`${spec}\nfill: circle O`).svg)
    // The point alone is a speck; the disk of radius 5 is what the figure
    // is fitted to now.
    expect(filled[2]).toBeGreaterThan(alone[2])
    expect(errorsOf(`${spec}\nfill: circle O`)).toEqual([])
  })
})

describe('the grammar (F4)', () => {
  it('parses every operand form', () => {
    const region = (line: string) => {
      const statement = parseStatement(line)
      if (statement.kind !== 'fill') throw new Error(`not a fill: ${statement.kind}`)
      return statement.region
    }
    expect(region('fill: A-B-C')).toEqual({ kind: 'polygon', shape: 'polygon', points: ['A', 'B', 'C'], source: 'A-B-C' })
    expect(region('fill: polygon A-B-C-D')).toMatchObject({ kind: 'polygon', shape: 'polygon', points: ['A', 'B', 'C', 'D'] })
    expect(region('fill: triangle ABC')).toMatchObject({ kind: 'polygon', shape: 'triangle', points: ['A', 'B', 'C'] })
    expect(region('fill: square ABCD')).toMatchObject({ kind: 'polygon', shape: 'square', points: ['A', 'B', 'C', 'D'] })
    expect(region('fill: rectangle A-B-C-D')).toMatchObject({ kind: 'polygon', shape: 'rectangle', points: ['A', 'B', 'C', 'D'] })
    expect(region('fill: circle O')).toEqual({ kind: 'disk', circle: 'O', source: 'circle O' })
    expect(region('fill: sector P-Q on O minor')).toMatchObject({ kind: 'sector', circle: 'O', from: 'P', to: 'Q', direction: 'minor' })
    expect(region('fill: segment P-Q on O cw')).toMatchObject({ kind: 'segment', circle: 'O', from: 'P', to: 'Q', direction: 'cw' })
    expect(region('fill: R')).toEqual({ kind: 'named', name: 'R', source: 'R' })
  })

  it('reads the operator words, left to right', () => {
    const statement = parseStatement('fill: circle O or circle P minus triangle ABC and circle Q')
    if (statement.kind !== 'fill') throw new Error('not a fill')
    expect(statement.region).toMatchObject({
      kind: 'combine',
      op: 'intersection',
      left: { kind: 'combine', op: 'difference', left: { kind: 'combine', op: 'union' } },
      right: { kind: 'disk', circle: 'Q' },
    })
    for (const [word, op] of [
      ['minus', 'difference'],
      ['and', 'intersection'],
      ['intersect', 'intersection'],
      ['or', 'union'],
      ['union', 'union'],
    ]) {
      expect(parseStatement(`fill: circle O ${word} circle P`)).toMatchObject({ region: { kind: 'combine', op } })
    }
  })

  it('groups with parentheses', () => {
    const statement = parseStatement('fill: circle Q minus (circle O or circle P)')
    expect(statement).toMatchObject({
      kind: 'fill',
      region: {
        kind: 'combine',
        op: 'difference',
        left: { kind: 'disk', circle: 'Q' },
        right: { kind: 'combine', op: 'union', source: '(circle O or circle P)' },
        source: 'circle Q minus (circle O or circle P)',
      },
    })
  })

  it('keeps the color: and name: clauses', () => {
    expect(parseStatement('fill: circle O color: red name: R')).toMatchObject({ kind: 'fill', color: 'red', statementName: 'R' })
  })

  it('refuses what it cannot shade, legibly', () => {
    expect(() => parseStatement('fill: A-B')).toThrow(/at least three points/)
    expect(() => parseStatement('fill: sector P-Q on O')).toThrow(/names two different arcs/)
    expect(() => parseStatement('fill: (circle O or circle P')).toThrow(/never closed/)
    expect(() => parseStatement('fill: circle O minus')).toThrow(/Expected a region/)
    expect(() => parseStatement('fill: ellipse E')).toThrow(/segments and circle arcs/)
    expect(() => parseStatement('fill: circle O hatched')).toThrow(/Hatching is not drawn yet/)
    expect(() => parseStatement('fill A-B-C')).toThrow('A fill is written with a colon — "fill: A-B-C"')
  })

  it('reads fill as a name exactly as before', () => {
    expect(parseStatement('fill = 3')).toMatchObject({ kind: 'constantDef', name: 'fill' })
    expect(parseStatement('fill(x) = x^2')).toMatchObject({ kind: 'functionDef', name: 'fill', param: 'x' })
    expect(parseStatement('fill + x = y')).toMatchObject({ kind: 'implicit' })
  })
})

describe('parentheses draw the right loops', () => {
  // Two unit circles 1 apart (centres K and L), united, minus a small
  // triangle inside both: the union's outline (one arc of each circle) and
  // the triangle as a hole.
  it('(circle O or circle P) minus triangle ABC', () => {
    const svg = rendered(`@mode: figure
K = (0, 0)
L = (1, 0)
O = circle K, 1
P = circle L, 1
A = (0.2, -0.2)
B = (0.8, -0.2)
C = (0.5, 0.3)
fill: (circle O or circle P) minus triangle ABC`).svg
    const [fill] = paths(layer(svg, 'regions'))
    expect(subpaths(fill).sort()).toEqual(['MAAZ', 'MLLZ'])
  })
})

describe('shape assertions (F4)', () => {
  const RECTANGLE = `@mode: figure
A = (0, 0)
B = (4, 0)
C = (4, 2)
D = (0, 2)`

  it('refuses a square that is not one, with its true sides', () => {
    const result = rendered(`${RECTANGLE}\nfill: square ABCD`)
    expect(result.errors.map((e) => e.message)).toEqual([
      'square ABCD is not a square — its sides are AB = 4, BC = 2, CD = 4 and DA = 2 (set "@scale: false" to draw it anyway)',
    ])
    expect(paths(layer(result.svg, 'regions'))).toHaveLength(0)
  })

  it('draws it under @scale: false', () => {
    const result = rendered(`@scale: false\n${RECTANGLE}\nfill: square ABCD`)
    expect(result.errors).toEqual([])
    expect(paths(layer(result.svg, 'regions'))).toHaveLength(1)
  })

  it('refuses a rectangle without four right angles, with its true angles', () => {
    expect(
      errorsOf(`@mode: figure
A = (0, 0)
B = (4, 0)
C = (5, 2)
D = (1, 2)
fill: rectangle ABCD`)
    ).toEqual([
      'rectangle ABCD is not a rectangle — its angles are A = 63.435°, B = 116.565°, C = 63.435° and D = 116.565° (set "@scale: false" to draw it anyway)',
    ])
    expect(errorsOf(`${RECTANGLE}\nfill: rectangle ABCD`)).toEqual([])
  })
})

describe('refusals (F4, F7)', () => {
  it('refuses points in space', () => {
    expect(
      errorsOf(`@mode: figure
A = (0, 0, 0)
B = (1, 0, 0)
C = (0, 1, 0)
fill: A-B-C`)
    ).toEqual(['"A" is a point in space — fills are drawn in the plane'])
  })

  it('refuses a fill in a graph', () => {
    const parsed = parseSpec(`@mode: graph
A = (0, 0)
B = (1, 0)
C = (0, 1)
fill: A-B-C`)
    const scene = buildScene(parsed.statements, { xMin: -5, xMax: 5, yMin: -5, yMax: 5 }, parsed.config)
    expect(scene.errors.map((e) => e.message)).toEqual(['fill: draws in figures — declare @mode: figure'])
  })

  it('refuses an unknown circle and an empty result', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nfill: circle Q`)[0]).toMatch(/^Unknown circle "Q"/)
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nfill: square ABCD minus square ABCD`)).toEqual(['square ABCD minus square ABCD leaves nothing to shade'])
  })

  it('refuses a polygon that crosses itself, in the author\'s names', () => {
    expect(errorsOf(`${SQUARE_AND_CIRCLE}\nfill: A-C-B-D`)).toEqual(['The polygon A-C-B-D crosses itself — its sides A-C and B-D cross'])
  })
})

describe('mode (F4)', () => {
  it('a fill is figure content', () => {
    expect(resolveMode(parseSpec('fill: A-B-C').statements, parseSpec('fill: A-B-C').config)).toBe('figure')
    const parsed = parseSpec('A = (0, 0)\nB = (1, 0)\nC = (0, 1)\nfill: A-B-C')
    expect(resolveMode(parsed.statements, parsed.config)).toBe('figure')
  })
})
