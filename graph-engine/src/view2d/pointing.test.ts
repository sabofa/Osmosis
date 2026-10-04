import { describe, expect, it } from 'vitest'
import { distanceToShape, hitTest, PointerSelection, shapeRank, type HitItem, type HitShape } from './pointing'

const at = (x: number, y: number) => ({ x, y })

describe('distanceToShape', () => {
  it('a point: 3-4-5', () => {
    expect(distanceToShape(at(3, 4), { kind: 'point', at: at(0, 0) })).toBe(5)
  })

  it('a segment: perpendicular to the middle, and to an endpoint beyond the end', () => {
    const s: HitShape = { kind: 'segment', a: at(0, 0), b: at(10, 0) }
    expect(distanceToShape(at(4, 3), s)).toBe(3)
    expect(distanceToShape(at(13, 4), s)).toBe(5)
    expect(distanceToShape(at(-3, -4), s)).toBe(5)
    expect(distanceToShape(at(5, 0), s)).toBe(0)
  })

  it('a degenerate segment is a point', () => {
    expect(distanceToShape(at(3, 4), { kind: 'segment', a: at(0, 0), b: at(0, 0) })).toBe(5)
  })

  it('a polyline: the nearest of its segments; closed adds the last-to-first edge', () => {
    const pts = [at(0, 0), at(10, 0), at(10, 10)]
    expect(distanceToShape(at(5, 2), { kind: 'polyline', points: pts, closed: false })).toBe(2)
    // (2,8) is 8 from both open edges, and |2 - 8| / sqrt 2 from the closing diagonal y = x
    expect(distanceToShape(at(2, 8), { kind: 'polyline', points: pts, closed: false })).toBeCloseTo(8)
    expect(distanceToShape(at(2, 8), { kind: 'polyline', points: pts, closed: true })).toBeCloseTo(6 / Math.SQRT2)
  })

  it('a circle is its outline: inside and outside measure to the rim', () => {
    const c: HitShape = { kind: 'circle', center: at(0, 0), radius: 5 }
    expect(distanceToShape(at(8, 0), c)).toBe(3)
    expect(distanceToShape(at(2, 0), c)).toBe(3)
    expect(distanceToShape(at(0, 0), c)).toBe(5)
    expect(distanceToShape(at(3, 4), c)).toBeCloseTo(0)
  })

  it('an arc measures to the arc only, so the far side of its circle does not count', () => {
    // Angles 0 .. pi: the half of the circle with y >= 0.
    const a: HitShape = { kind: 'arc', center: at(0, 0), radius: 5, start: 0, end: Math.PI }
    expect(distanceToShape(at(0, 8), a)).toBeCloseTo(3) // on the arc's side
    expect(distanceToShape(at(0, -5), a)).toBeCloseTo(Math.hypot(5, 5)) // the full circle would say 0
    expect(distanceToShape(at(0, -8), a)).toBeCloseTo(Math.hypot(5, 8))
    expect(distanceToShape(at(7, 0), a)).toBeCloseTo(2) // at an end of the arc
  })

  it('an arc wraps past 2 pi, and an end below the start sweeps the other way', () => {
    const wrap: HitShape = { kind: 'arc', center: at(0, 0), radius: 5, start: 1.5 * Math.PI, end: 2.5 * Math.PI }
    expect(distanceToShape(at(8, 0), wrap)).toBeCloseTo(3) // angle 0 is inside (3pi/2 .. 5pi/2)
    expect(distanceToShape(at(-5, 0), wrap)).toBeGreaterThan(5)
    const back: HitShape = { kind: 'arc', center: at(0, 0), radius: 5, start: 0, end: -Math.PI / 2 }
    expect(distanceToShape(at(0, -8), back)).toBeCloseTo(3) // angle -pi/2 is the end of the sweep
    expect(distanceToShape(at(0, 8), back)).toBeGreaterThan(5)
  })

  it('an arc sweeping a full turn is the whole circle', () => {
    const a: HitShape = { kind: 'arc', center: at(0, 0), radius: 5, start: 0, end: 2 * Math.PI }
    expect(distanceToShape(at(-5, 0), a)).toBeCloseTo(0)
  })

  it('a polygon: 0 inside, the distance to the nearest edge outside', () => {
    const sq: HitShape = { kind: 'polygon', points: [at(0, 0), at(10, 0), at(10, 10), at(0, 10)] }
    expect(distanceToShape(at(5, 5), sq)).toBe(0)
    expect(distanceToShape(at(13, 5), sq)).toBe(3)
    expect(distanceToShape(at(13, 14), sq)).toBe(5)
  })

  it('a concave polygon: the notch is outside', () => {
    const l: HitShape = {
      kind: 'polygon',
      points: [at(0, 0), at(10, 0), at(10, 4), at(4, 4), at(4, 10), at(0, 10)],
    }
    expect(distanceToShape(at(2, 8), l)).toBe(0)
    expect(distanceToShape(at(8, 8), l)).toBe(4)
  })

  it('a rect: 0 inside, the distance to the edge or corner outside', () => {
    const r: HitShape = { kind: 'rect', rect: { x: 10, y: 20, width: 30, height: 10 } }
    expect(distanceToShape(at(25, 25), r)).toBe(0)
    expect(distanceToShape(at(5, 25), r)).toBe(5)
    expect(distanceToShape(at(25, 33), r)).toBe(3)
    expect(distanceToShape(at(43, 34), r)).toBe(5)
  })
})

describe('shapeRank', () => {
  it('points 0, lines 1, areas 2', () => {
    expect(shapeRank({ kind: 'point', at: at(0, 0) })).toBe(0)
    expect(shapeRank({ kind: 'segment', a: at(0, 0), b: at(1, 1) })).toBe(1)
    expect(shapeRank({ kind: 'polyline', points: [], closed: false })).toBe(1)
    expect(shapeRank({ kind: 'circle', center: at(0, 0), radius: 1 })).toBe(1)
    expect(shapeRank({ kind: 'arc', center: at(0, 0), radius: 1, start: 0, end: 1 })).toBe(1)
    expect(shapeRank({ kind: 'polygon', points: [] })).toBe(2)
    expect(shapeRank({ kind: 'rect', rect: { x: 0, y: 0, width: 1, height: 1 } })).toBe(2)
  })
})

describe('hitTest', () => {
  const point = (id: string, x: number, y: number): HitItem => ({ id, shape: { kind: 'point', at: at(x, y) } })
  const line = (id: string, ax: number, ay: number, bx: number, by: number): HitItem => ({
    id,
    shape: { kind: 'segment', a: at(ax, ay), b: at(bx, by) },
  })
  const area = (id: string, x: number, y: number, w: number, h: number): HitItem => ({
    id,
    shape: { kind: 'rect', rect: { x, y, width: w, height: h } },
  })

  it('a point beats a line that lies nearer', () => {
    const items = [line('line', -50, 0, 50, 0), point('pt', 0, 6)]
    expect(hitTest(items, at(0, 0), 8)?.id).toBe('pt')
    expect(hitTest([...items].reverse(), at(0, 0), 8)?.id).toBe('pt')
  })

  it('a line beats an area, even one the pointer is inside', () => {
    const items = [area('area', -50, -50, 100, 100), line('line', -50, 5, 50, 5)]
    expect(hitTest(items, at(0, 0), 8)?.id).toBe('line')
    expect(hitTest([...items].reverse(), at(0, 0), 8)?.id).toBe('line')
  })

  it('within a rank the nearer wins', () => {
    const items = [point('far', 5, 0), point('near', 2, 0)]
    expect(hitTest(items, at(0, 0), 8)?.id).toBe('near')
    expect(hitTest([...items].reverse(), at(0, 0), 8)?.id).toBe('near')
  })

  it('with equal rank and distance the later item wins', () => {
    const items = [point('under', 3, 0), point('over', -3, 0)]
    expect(hitTest(items, at(0, 0), 8)?.id).toBe('over')
    expect(hitTest([...items].reverse(), at(0, 0), 8)?.id).toBe('under')
  })

  it('nothing within the tolerance gives null; the tolerance itself still hits', () => {
    expect(hitTest([point('a', 9, 0)], at(0, 0), 8)).toBeNull()
    expect(hitTest([point('a', 8, 0)], at(0, 0), 8)?.id).toBe('a')
    expect(hitTest([], at(0, 0), 8)).toBeNull()
  })

  it('an area is hit anywhere inside it', () => {
    expect(hitTest([area('a', 0, 0, 100, 100)], at(50, 50), 8)?.id).toBe('a')
  })

  it('an explicit rank overrides the shape default', () => {
    // A label rect (an area) ranked 0 beats a nearer point.
    const label: HitItem = {
      id: 'label',
      shape: { kind: 'rect', rect: { x: -5, y: -5, width: 10, height: 10 } },
      rank: 0,
    }
    expect(hitTest([label, point('pt', 1, 0)], at(0, 0), 8)?.id).toBe('label')
    // Without the override the point wins.
    const plain: HitItem = { id: 'label', shape: label.shape }
    expect(hitTest([plain, point('pt', 1, 0)], at(0, 0), 8)?.id).toBe('pt')
  })
})

describe('PointerSelection', () => {
  it('starts with nothing hovered or selected', () => {
    const s = new PointerSelection()
    expect(s.hovered).toBeNull()
    expect(s.selected).toBeNull()
  })

  it('hover reports whether it changed', () => {
    const s = new PointerSelection()
    expect(s.hover('a')).toBe(true)
    expect(s.hover('a')).toBe(false)
    expect(s.hovered).toBe('a')
    expect(s.hover(null)).toBe(true)
    expect(s.hover(null)).toBe(false)
  })

  it('click selects, a re-click of the same id changes nothing, another id replaces it', () => {
    const s = new PointerSelection()
    expect(s.click('a')).toBe(true)
    expect(s.selected).toBe('a')
    expect(s.click('a')).toBe(false)
    expect(s.selected).toBe('a')
    expect(s.click('b')).toBe(true)
    expect(s.selected).toBe('b')
  })

  it('click(null) and clear() clear the selection', () => {
    const s = new PointerSelection()
    s.click('a')
    expect(s.click(null)).toBe(true)
    expect(s.selected).toBeNull()
    expect(s.click(null)).toBe(false)
    s.click('a')
    expect(s.clear()).toBe(true)
    expect(s.selected).toBeNull()
    expect(s.clear()).toBe(false)
  })

  it('hovering and selecting are independent', () => {
    const s = new PointerSelection()
    s.click('a')
    s.hover('b')
    expect(s.selected).toBe('a')
    expect(s.hovered).toBe('b')
    s.clear()
    expect(s.hovered).toBe('b')
  })
})
