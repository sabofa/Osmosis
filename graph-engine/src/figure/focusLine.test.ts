import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { parseFocus } from '../view2d/focus'
import { authorToView, type FigureFrame } from './frame'
import { centreText, cursorText, focusLineFor, itemForId } from './focusLine'
import type { FigureHitItem } from './hitItems'
import { renderFigure } from './render'

function renderSpec(spec: string) {
  const parsed = parseSpec(spec)
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

// A flat frame by hand: author (x, y) -> view (2x, -2y), so the arithmetic is
// checkable by eye. The pinning against a real drawing is further down.
const PLANE: FigureFrame = { kind: 'plane', scale: 2, centre: { x: 0, y: 0 } }
const TOL = 0.5

describe('cursorText on a flat figure', () => {
  it('is the pointer in the author coordinates, not the drawing units', () => {
    expect(cursorText(PLANE, { x: 6, y: -4 }, null)).toBe('(3, 2)')
  })

  it('follows a frame whose centre is not the origin', () => {
    const frame: FigureFrame = { kind: 'plane', scale: 4, centre: { x: 10, y: 20 } }
    expect(cursorText(frame, { x: 8, y: -4 }, null)).toBe('(12, 21)')
  })

  it('says a dash when there is no pointer', () => {
    expect(cursorText(PLANE, null, null)).toBe('—')
  })

  it('ignores a hovered item: the pointer is the answer on a flat figure', () => {
    const hovered: FigureHitItem = {
      id: '0/A',
      shape: { kind: 'point', at: { x: 0, y: 0 } },
      targets: [],
      author: { x: 99, y: 99 },
    }
    expect(cursorText(PLANE, { x: 6, y: -4 }, hovered)).toBe('(3, 2)')
  })

  it('prints a coordinate that rounds to nothing as 0, never -0', () => {
    expect(cursorText(PLANE, { x: 0.0001, y: 0.0001 }, null)).toBe('(0, 0)')
  })
})

describe('cursorText on a solid figure', () => {
  const frame: FigureFrame = { kind: 'space', scale: 1, centre: { x: 0, y: 0 }, view: 'standard' }
  const vertex: FigureHitItem = {
    id: '0/B',
    shape: { kind: 'point', at: { x: 5, y: 5 } },
    targets: [],
    author: { x: 4, y: 0, z: 2 },
  }

  it("is the hovered item's author (X, Y, Z)", () => {
    expect(cursorText(frame, { x: 5, y: 5 }, vertex)).toBe('(4, 0, 2)')
  })

  it('is the pointer in drawing units, marked as such, when nothing is hovered', () => {
    expect(cursorText(frame, { x: 1.5, y: -2 }, null)).toBe('view (1.5, -2)')
  })

  it('does the same for a hovered item with no author coordinates (an edge)', () => {
    const edge: FigureHitItem = { id: '0/edge-0-1', shape: { kind: 'segment', a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }, targets: [] }
    expect(cursorText(frame, { x: 1.5, y: -2 }, edge)).toBe('view (1.5, -2)')
  })

  it('does the same for a point that has only plane coordinates (a lifted copy has none)', () => {
    const flat: FigureHitItem = { ...vertex, author: { x: 4, y: 0 } }
    expect(cursorText(frame, { x: 1.5, y: -2 }, flat)).toBe('view (1.5, -2)')
  })

  it('says a dash when there is no pointer', () => {
    expect(cursorText(frame, null, vertex)).toBe('—')
  })
})

describe('focusLineFor on a flat figure', () => {
  it('writes the centre in author coordinates, with the zoom', () => {
    expect(focusLineFor(PLANE, { cx: 6, cy: -4, zoom: 4 }, [], TOL)).toBe('@focus: (3, 2) zoom 4')
  })

  it('omits zoom 1, which is the default', () => {
    expect(focusLineFor(PLANE, { cx: 6, cy: -4, zoom: 1 }, [], TOL)).toBe('@focus: (3, 2)')
  })

  it('omits a zoom that prints as 1', () => {
    expect(focusLineFor(PLANE, { cx: 0, cy: 0, zoom: 1.0004 }, [], TOL)).toBe('@focus: (0, 0)')
  })

  it('keeps a fractional zoom', () => {
    expect(focusLineFor(PLANE, { cx: 0, cy: 0, zoom: 0.25 }, [], TOL)).toBe('@focus: (0, 0) zoom 0.25')
  })

  it('is read back by the parser as the same view', () => {
    const line = focusLineFor(PLANE, { cx: 3, cy: -7.5, zoom: 2.5 }, [], TOL)
    const spec = parseFocus(line.replace('@focus: ', ''))
    expect(spec).toEqual({ target: { kind: 'plane', x: 1.5, y: 3.75 }, zoom: 2.5 })
  })
})

describe('focusLineFor on a solid figure', () => {
  const frame: FigureFrame = { kind: 'space', scale: 1, centre: { x: 0, y: 0 }, view: 'standard' }
  const near: FigureHitItem = {
    id: '0/A',
    shape: { kind: 'point', at: { x: 10, y: 10 } },
    targets: [],
    author: { x: 1, y: 2, z: 3 },
  }
  const farther: FigureHitItem = {
    id: '0/B',
    shape: { kind: 'point', at: { x: 10.3, y: 10 } },
    targets: [],
    author: { x: 4, y: 5, z: 6 },
  }

  it('writes the nearest vertex within the tolerance as (X, Y, Z)', () => {
    expect(focusLineFor(frame, { cx: 10.1, cy: 10, zoom: 3 }, [farther, near], TOL)).toBe('@focus: (1, 2, 3) zoom 3')
  })

  it('picks the nearest, whatever the order of the items', () => {
    expect(focusLineFor(frame, { cx: 10.25, cy: 10, zoom: 1 }, [near, farther], TOL)).toBe('@focus: (4, 5, 6)')
  })

  it('falls back to the drawing units when no vertex is within the tolerance', () => {
    expect(focusLineFor(frame, { cx: 12, cy: 10, zoom: 2 }, [near, farther], TOL)).toBe('@focus: view (12, 10) zoom 2')
  })

  it('the tolerance is a distance in drawing units, inclusive at the edge', () => {
    expect(focusLineFor(frame, { cx: 10.5, cy: 10, zoom: 1 }, [near], 0.5)).toBe('@focus: (1, 2, 3)')
    expect(focusLineFor(frame, { cx: 10.5, cy: 10, zoom: 1 }, [near], 0.49)).toBe('@focus: view (10.5, 10)')
  })

  it('ignores items that are not points with space coordinates', () => {
    const edge: FigureHitItem = { id: '0/e', shape: { kind: 'segment', a: { x: 10, y: 10 }, b: { x: 12, y: 10 } }, targets: [] }
    const flat: FigureHitItem = { ...near, author: { x: 1, y: 2 } }
    expect(focusLineFor(frame, { cx: 10, cy: 10, zoom: 1 }, [edge, flat], TOL)).toBe('@focus: view (10, 10)')
  })

  it('is read back by the parser', () => {
    const line = focusLineFor(frame, { cx: 10, cy: 10, zoom: 2 }, [near], TOL)
    expect(parseFocus(line.replace('@focus: ', ''))).toEqual({ target: { kind: 'space', x: 1, y: 2, z: 3 }, zoom: 2 })
    const fallback = focusLineFor(frame, { cx: 7, cy: -1, zoom: 2 }, [], TOL)
    expect(parseFocus(fallback.replace('@focus: ', ''))).toEqual({ target: { kind: 'view', u: 7, v: -1 }, zoom: 2 })
  })
})

describe('centreText', () => {
  it('is the centre alone, as the line would write it', () => {
    expect(centreText(PLANE, { cx: 6, cy: -4, zoom: 4 }, [], TOL)).toBe('(3, 2)')
    const frame: FigureFrame = { kind: 'space', scale: 1, centre: { x: 0, y: 0 }, view: 'standard' }
    expect(centreText(frame, { cx: 7, cy: -1, zoom: 4 }, [], TOL)).toBe('view (7, -1)')
  })
})

describe('itemForId', () => {
  const label: FigureHitItem = { id: '0/A', shape: { kind: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 } }, targets: [], rank: 0 }
  const dot: FigureHitItem = { id: '0/A', shape: { kind: 'point', at: { x: 1, y: 1 } }, targets: [], author: { x: 1, y: 2 } }
  const other: FigureHitItem = { id: '0/B', shape: { kind: 'point', at: { x: 5, y: 5 } }, targets: [] }

  it('prefers the item that knows its author coordinates, because a label shares its object id and comes last', () => {
    expect(itemForId([dot, label, other], '0/A')).toBe(dot)
    expect(itemForId([label, dot, other], '0/A')).toBe(dot)
  })

  it('otherwise gives the first item with that id', () => {
    expect(itemForId([other, label], '0/B')).toBe(other)
  })

  it('is null for no id and for an unknown id', () => {
    expect(itemForId([dot], null)).toBeNull()
    expect(itemForId([dot], 'nope')).toBeNull()
  })
})

// The same arithmetic against a real drawing, so the helpers cannot drift from
// what renderFigure reports.
describe('against real figures', () => {
  it('a flat figure: the view position of an author point reads back as that point', () => {
    const { frame } = renderSpec('@mode: figure\npolygon: A(0,0), B(4,0), C(1,3)')
    const at = authorToView(frame, { kind: 'plane', x: 1, y: 3 })!
    expect(cursorText(frame, at, null)).toBe('(1, 3)')
    expect(focusLineFor(frame, { cx: at.x, cy: at.y, zoom: 4 }, [], TOL)).toBe('@focus: (1, 3) zoom 4')
  })

  it('a flat figure with labels: hovering a labelled vertex still finds its item', () => {
    const { items } = renderSpec('@mode: figure\npolygon: A(0,0), B(4,0), C(1,3)')
    const found = itemForId(items, '0/C')
    expect(found?.author).toEqual({ x: 1, y: 3 })
  })

  it('a solid figure: a vertex under the centre is written as its (X, Y, Z); away from every vertex, as view', () => {
    const { frame, items } = renderSpec('@mode: figure\nS = solid cube edge 4 vertices ABCDEFGH')
    const vertices = items.filter((i) => i.shape.kind === 'point' && i.author?.z !== undefined)
    expect(vertices.length).toBe(8)
    const v = vertices[3]
    const at = (v.shape as { at: { x: number; y: number } }).at
    const a = v.author!
    const written = `(${round(a.x)}, ${round(a.y)}, ${round(a.z!)})`
    expect(focusLineFor(frame, { cx: at.x + 0.01, cy: at.y, zoom: 2 }, items, 0.5)).toBe(`@focus: ${written} zoom 2`)
    expect(cursorText(frame, at, itemForId(items, v.id))).toBe(written)
    expect(focusLineFor(frame, { cx: 1e6, cy: 1e6, zoom: 1 }, items, 0.5)).toBe('@focus: view (1000000, 1000000)')
  })
})

function round(n: number): string {
  const s = n.toFixed(3).replace(/\.?0+$/, '')
  return s === '-0' || s === '' ? '0' : s
}
