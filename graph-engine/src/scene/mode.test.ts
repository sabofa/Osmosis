import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { resolveMode, resolvePanels } from './mode'

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

// ---------------------------------------------------------------------------
// F5 — panels
// ---------------------------------------------------------------------------

function panels(spec: string) {
  const parsed = parseSpec(spec)
  return resolvePanels(parsed.statements, parsed.config)
}

const TABLE = 'header: x | y\nrow: 1 | 2\nrow: 2 | 4'

describe('a table is additive, not exclusive', () => {
  it('renders a figure and a table together', () => {
    expect(panels(`${GEOMETRY_ONLY}\n${TABLE}`)).toEqual({ drawable: 'figure', table: true })
  })

  it('renders a graph and a table together', () => {
    expect(panels(`y = x^2\n${TABLE}`)).toEqual({ drawable: 'graph', table: true })
  })

  it('renders geometry alone as one panel', () => {
    expect(panels(GEOMETRY_ONLY)).toEqual({ drawable: 'figure', table: false })
  })

  it('renders a plotted function alone as one panel', () => {
    expect(panels('y = x^2')).toEqual({ drawable: 'graph', table: false })
  })

  it('counts every kind of table statement, named or not', () => {
    expect(panels(`${GEOMETRY_ONLY}\nscores.header: x | y`).table).toBe(true)
    expect(panels(`${GEOMETRY_ONLY}\nscores.row: 1 | 2`).table).toBe(true)
    expect(panels(`${GEOMETRY_ONLY}\ntable: y = x^2 for x in [0, 3] step 1`).table).toBe(true)
  })
})

describe('@mode: table keeps meaning "table only"', () => {
  // The compatibility promise: nothing already stored changes.
  it('shows only the table even when the spec also draws geometry', () => {
    expect(panels(`@mode: table\n${GEOMETRY_ONLY}\n${TABLE}`)).toEqual({ drawable: null, table: true })
  })

  it('shows only the table for a spec that is nothing but a table', () => {
    expect(panels(`@mode: table\n${TABLE}`)).toEqual({ drawable: null, table: true })
  })

  it('shows only the table even when the spec plots functions', () => {
    expect(panels(`@mode: table\ny = x^2\n${TABLE}`)).toEqual({ drawable: null, table: true })
  })
})

describe('a declared drawable mode still decides the drawing', () => {
  it('leaves @mode: graph drawing a graph, with the table beside it', () => {
    expect(panels(`@mode: graph\n${GEOMETRY_ONLY}\n${TABLE}`)).toEqual({ drawable: 'graph', table: true })
  })

  it('leaves @mode: figure drawing a figure, with the table beside it', () => {
    expect(panels(`@mode: figure\ny = x^2\n${TABLE}`)).toEqual({ drawable: 'figure', table: true })
  })
})

describe('a spec with nothing to draw', () => {
  it('shows the table alone rather than a blank canvas beside it', () => {
    // Undeclared, and nothing drawable in it: there is no drawing to put
    // beside the table, and an empty graph panel is not a second panel.
    expect(panels(TABLE)).toEqual({ drawable: null, table: true })
  })

  it('still draws a declared graph, even an empty one', () => {
    // An explicit @mode is a statement of intent and is not second-guessed.
    expect(panels(`@mode: graph\n${TABLE}`)).toEqual({ drawable: 'graph', table: true })
  })

  it('falls back to a graph for a spec with nothing in it at all', () => {
    expect(panels('')).toEqual({ drawable: 'graph', table: false })
  })
})

describe('the circle vocabulary is geometry', () => {
  const circle = 'C = (0, 0)\nO = circle C, 5\nP = (5, 0)\nQ = (0, 5)\n'

  it('infers a figure for a spec whose drawable content is an arc', () => {
    expect(mode(circle + 'arc P-Q on O ccw')).toBe('figure')
    expect(mode(circle + 'sector P-Q on O ccw')).toBe('figure')
    expect(mode(circle + 'central angle P-Q on O ccw')).toBe('figure')
    expect(mode(circle + 'inscribed angle P-Q-P on O')).toBe('figure')
  })

  it('still becomes a graph the moment something is plotted, as every figure does', () => {
    expect(mode(circle + 'arc P-Q on O ccw\ny = x^2')).toBe('graph')
  })
})
