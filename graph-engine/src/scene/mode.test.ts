import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { resolveMode } from './mode'

function mode(spec: string) {
  const parsed = parseSpec(spec)
  return resolveMode(parsed.statements, parsed.config)
}

const GEOMETRY_ONLY = ['triangle ABC: angle A = 90, AB = 6, AC = 8', 'D = foot A to B-C', 'segment: A-D dashed'].join('\n')

describe('an explicit @mode always wins (E5)', () => {
  it('takes figure when the spec says figure', () => {
    expect(mode(`@mode: figure\n${GEOMETRY_ONLY}`)).toBe('figure')
  })

  it('takes figure even for a spec full of plotted functions', () => {
    expect(mode('@mode: figure\ny = x^2\ny = sin(x)')).toBe('figure')
  })

  it('takes graph for a geometry-only spec — the migration escape hatch', () => {
    // A stored v1 question that drew geometry on the graphing canvas gets
    // its old presentation back by declaring the mode it always meant.
    expect(mode(`@mode: graph\n${GEOMETRY_ONLY}`)).toBe('graph')
    expect(mode('@mode: graph\npolygon: A(0,0), B(4,0), C(2,3)')).toBe('graph')
  })

  it('takes table when the spec says table, geometry or not', () => {
    expect(mode('@mode: table\nheader Values: x, y\nrow Values: 1, 2')).toBe('table')
    expect(mode(`@mode: table\n${GEOMETRY_ONLY}`)).toBe('table')
  })
})

describe('inference, when nothing is declared', () => {
  it('infers figure for a spec whose drawable content is entirely geometry', () => {
    expect(mode(GEOMETRY_ONLY)).toBe('figure')
    expect(mode('polygon: A(0,0), B(4,0), C(2,3)\nangle: A-B-C')).toBe('figure')
    expect(mode('A = (1, 2)\nB = (3, 4)\nsegment: A-B')).toBe('figure')
    expect(mode('circle: (0, 0), 3')).toBe('figure')
  })

  it('flips to graph the moment one plotted function is added', () => {
    expect(mode(`${GEOMETRY_ONLY}\ny = x^2`)).toBe('graph')
  })

  it('takes graph for every plotted kind, constructions included', () => {
    const plotted = [
      'y = x^2',
      'x^2 + y^2 = 9',
      'y < x',
      'r = 2*cos(theta)',
      'field: dy/dx = x + y',
      'scatter: (1,2), (3,4)',
      '(cos(t), sin(t)) for t in [0, 6]',
    ]
    for (const line of plotted) {
      expect(mode(`A = (0, 0)\nB = (1, 1)\nsegment: A-B\n${line}`)).toBe('graph')
    }
  })

  it('takes graph for anything with depth, rather than flattening it onto paper', () => {
    expect(mode('A = (1, 2, 3)')).toBe('graph')
    expect(mode('z = x^2 + y^2')).toBe('graph')
  })

  it('takes graph for a spec with nothing drawable at all', () => {
    expect(mode('')).toBe('graph')
    expect(mode('f(x) = x + 1')).toBe('graph')
  })

  it('does not let a definition or a directive make a figure a graph', () => {
    // A constant used by the construction is not plotted content.
    expect(mode(`@grid: off\nk = 6\n${GEOMETRY_ONLY}`)).toBe('figure')
  })
})
