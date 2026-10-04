import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { arcMidpoint } from '../scene/geometry/circles'
import { distanceToShape, hitTest } from '../view2d/pointing'
import { authorToView } from './frame'
import { renderFigure } from './render'

function renderSpec(spec: string) {
  const parsed = parseSpec(spec)
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

function renderExample(label: string) {
  const example = EXAMPLES.find((e) => e.label === label)
  if (!example) throw new Error(`no example ${label}`)
  return renderSpec(example.spec)
}

const idOf = (statement: number, object: string | null) => `${statement}/${object ?? ''}`

// Every (statement, object) the markup names, with the statement null where an
// element carries only `data-object` (the givens panel).
function markupIdentities(svg: string): { statement: number | null; object: string }[] {
  const out: { statement: number | null; object: string }[] = []
  for (const tag of svg.match(/<[a-zA-Z][^>]*data-object="[^"]*"[^>]*>/g) ?? []) {
    const object = /data-object="([^"]*)"/.exec(tag)![1]
    const statement = /data-statement="(\d+)"/.exec(tag)
    out.push({ statement: statement ? Number(statement[1]) : null, object })
  }
  return out
}

describe.each(['Square minus its circle', 'Circle vocabulary', 'Cube and its net'])('hit items of "%s"', (label) => {
  const { svg, items } = renderExample(label)

  it('has items, each with at least one target', () => {
    expect(items.length).toBeGreaterThan(0)
    for (const item of items) expect(item.targets.length).toBeGreaterThan(0)
  })

  it('has an item for every data-object in the markup', () => {
    for (const { statement, object } of markupIdentities(svg)) {
      if (object === 'givens') {
        expect(items.some((item) => item.id === 'givens')).toBe(true)
        continue
      }
      const found = items.some((item) =>
        item.targets.some((t) => t.object === object && (statement === null || t.statement === statement))
      )
      expect(found, `no item for statement ${statement} object ${object}`).toBe(true)
    }
  })

  it('puts every point item on its drawn circle', () => {
    const circles = [...svg.matchAll(/<circle[^>]*cx="([^"]+)" cy="([^"]+)"[^>]*data-statement="(\d+)"[^>]*data-object="([^"]*)"/g)]
    let checked = 0
    for (const item of items.filter((i) => i.shape.kind === 'point')) {
      const at = (item.shape as { at: { x: number; y: number } }).at
      const drawn = circles
        .filter((m) => idOf(Number(m[3]), m[4]) === item.id)
        .map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
      // A solid's vertex is lettered, not dotted: it has no circle to match.
      if (drawn.length === 0) {
        expect(svg.includes(`data-object="${item.id.slice(item.id.indexOf('/') + 1)}"`), `nothing drawn for ${item.id}`).toBe(true)
        continue
      }
      checked++
      expect(Math.min(...drawn.map((d) => Math.hypot(d.x - at.x, d.y - at.y)))).toBeLessThan(1e-3)
    }
    if (label !== 'Cube and its net') expect(checked).toBeGreaterThan(0)
  })
})

describe('placed labels', () => {
  const { items } = renderExample('Circle vocabulary')

  it('are rank 0 rect items that share their object id', () => {
    const rects = items.filter((i) => i.shape.kind === 'rect')
    expect(rects.length).toBeGreaterThanOrEqual(3)
    for (const rect of rects) {
      expect(rect.rank).toBe(0)
      // The object it names is an item too: the label lights it up.
      expect(items.some((i) => i.id === rect.id && i.shape.kind !== 'rect')).toBe(true)
      expect(rect.targets).toEqual(items.find((i) => i.id === rect.id && i.shape.kind !== 'rect')!.targets)
    }
    for (const name of ['O', 'P', 'Q']) {
      expect(items.filter((i) => i.shape.kind === 'rect' && i.id.endsWith(`/${name}`)).length).toBe(1)
    }
  })

  it('wins over a line it overlaps', () => {
    // The label of P sits beside the chord and the tangent through P.
    const label = items.find((i) => i.shape.kind === 'rect' && i.id.endsWith('/P'))!
    const rect = (label.shape as { rect: { x: number; y: number; width: number; height: number } }).rect
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
    // A generous tolerance reaches the lines as well; the label still wins.
    expect(hitTest(items, centre, 30)?.id).toBe(label.id)
  })
})

describe('the givens table', () => {
  it('is one rect item with id "givens", targeting the given statements', () => {
    const { items } = renderExample('Square minus its circle')
    const table = items.filter((i) => i.id === 'givens')
    expect(table.length).toBe(1)
    expect(table[0].shape.kind).toBe('rect')
    expect(table[0].rank).toBeUndefined()
    expect(table[0].targets.length).toBeGreaterThan(0)
    expect(table[0].targets.every((t) => t.object === null)).toBe(true)
  })

  it('is absent when the figure has no givens', () => {
    const { items } = renderExample('Circle vocabulary')
    expect(items.some((i) => i.id === 'givens')).toBe(false)
  })
})

describe('marks', () => {
  it('give no items', () => {
    const base = 'polygon: A(0,0), B(4,0), C(2,3)'
    const bare = renderSpec(`@mode: figure\n${base}`)
    const marked = renderSpec(`@mode: figure\n${base}\ntick: A-C\ntick: B-C\nangle: A-B-C label: x°`)
    // The marks are in the markup, and add nothing to the items.
    expect(marked.svg.length).toBeGreaterThan(bare.svg.length)
    expect(marked.items).toEqual(bare.items)
  })
})

describe('shapes', () => {
  it('gives a plane point its author coordinates', () => {
    const { items } = renderSpec('@mode: figure\npolygon: A(0,0), B(4,0), C(1,3)')
    const c = items.find((i) => i.id === '0/C' && i.shape.kind === 'point')!
    expect(c.author).toEqual({ x: 1, y: 3 })
  })

  it('maps an arc onto the drawn arc (view y runs down, so the angles negate)', () => {
    const { items, frame } = renderSpec('@mode: figure\nO = (0, 0)\nk = circle O, 5\nA = (5, 0)\nB = (0, 5)\narc A-B on k minor')
    const arc = items.find((i) => i.shape.kind === 'arc')!
    const shape = arc.shape as { center: { x: number; y: number }; radius: number; start: number; end: number }
    const t = (shape.start + shape.end) / 2
    const sampled = { x: shape.center.x + shape.radius * Math.cos(t), y: shape.center.y + shape.radius * Math.sin(t) }
    const worldMid = arcMidpoint({ center: { x: 0, y: 0 }, radius: 5, start: 0, sweep: Math.PI / 2 })
    const expected = authorToView(frame, { kind: 'plane', x: worldMid.x, y: worldMid.y })!
    expect(Math.hypot(sampled.x - expected.x, sampled.y - expected.y)).toBeLessThan(1e-3)
    expect(distanceToShape(expected, arc.shape)).toBeLessThan(1e-3)
  })

  it('maps a reflex arc through its far side, not its near one', () => {
    const { items, frame } = renderSpec('@mode: figure\nO = (0, 0)\nk = circle O, 5\nA = (5, 0)\nB = (0, 5)\narc A-B on k major')
    const arc = items.find((i) => i.shape.kind === 'arc')!
    const far = authorToView(frame, { kind: 'plane', x: -5 / Math.SQRT2, y: -5 / Math.SQRT2 })!
    expect(distanceToShape(far, arc.shape)).toBeLessThan(1e-3)
    const near = authorToView(frame, { kind: 'plane', x: 5 / Math.SQRT2, y: 5 / Math.SQRT2 })!
    expect(distanceToShape(near, arc.shape)).toBeGreaterThan(10)
  })

  it('gives a filled sector an area on top of its arc', () => {
    const { items } = renderExample('Circle vocabulary')
    expect(items.some((i) => i.shape.kind === 'polygon')).toBe(true)
    expect(items.some((i) => i.shape.kind === 'arc')).toBe(true)
  })

  it('treats a circle as an outline', () => {
    const { items } = renderExample('Circle vocabulary')
    expect(items.some((i) => i.shape.kind === 'circle' && i.id === '1/k')).toBe(true)
  })

  it('leaves a hole in a region a hole', () => {
    const { items, frame } = renderExample('Square minus its circle')
    const area = items.find((i) => i.shape.kind === 'polygon' && i.id === '3/R')!
    // Every probe well off the boundary: inside the square and outside the
    // inscribed circle is the region; inside the circle is the hole.
    let region = 0
    let hole = 0
    for (let x = 0.05; x < 4; x += 0.1) {
      for (let y = 0.05; y < 4; y += 0.1) {
        const radial = Math.hypot(x - 2, y - 2)
        if (Math.abs(radial - 2) < 0.08) continue
        const at = authorToView(frame, { kind: 'plane', x, y })!
        const inside = distanceToShape(at, area.shape) === 0
        expect(inside, `(${x.toFixed(2)}, ${y.toFixed(2)})`).toBe(radial > 2)
        if (radial > 2) region++
        else hole++
      }
    }
    expect(region).toBeGreaterThan(50)
    expect(hole).toBeGreaterThan(500)
  })

  it('clips an infinite line to the viewBox, as the markup does', () => {
    const { items, svg } = renderSpec('@mode: figure\npolygon: A(0,0), B(4,0), C(1,3)\nm = line through C parallel to A-B')
    const box = /viewBox="([^"]+)"/.exec(svg)![1].split(' ').map(Number)
    const [x, y, w, h] = box
    const line = items.find((i) => i.shape.kind === 'segment' && i.id === '1/m')!
    const { a, b } = line.shape as { a: { x: number; y: number }; b: { x: number; y: number } }
    const onEdge = (p: { x: number; y: number }) =>
      Math.abs(p.x - x) < 0.01 || Math.abs(p.x - (x + w)) < 0.01 || Math.abs(p.y - y) < 0.01 || Math.abs(p.y - (y + h)) < 0.01
    expect(onEdge(a)).toBe(true)
    expect(onEdge(b)).toBe(true)
  })

  it('reports solid vertices with space author coordinates that round-trip through the frame', () => {
    const { items, frame } = renderSpec('@mode: figure\nS = solid cube edge 4 vertices ABCDEFGH')
    const vertices = items.filter((i) => i.shape.kind === 'point')
    expect(vertices.length).toBe(8)
    for (const v of vertices) {
      const at = (v.shape as { at: { x: number; y: number } }).at
      const mapped = authorToView(frame, { kind: 'space', x: v.author!.x, y: v.author!.y, z: v.author!.z! })!
      expect(Math.hypot(mapped.x - at.x, mapped.y - at.y)).toBeLessThan(1e-3)
    }
  })

  it('reports a point in space with its author coordinates', () => {
    const { items } = renderSpec('@mode: figure\nS = solid cube edge 4 vertices ABCDEFGH\nP = (1, 2, 3)')
    const p = items.find((i) => i.id === '1/P' && i.shape.kind === 'point')!
    expect(p.author!.x).toBeCloseTo(1, 9)
    expect(p.author!.y).toBeCloseTo(2, 9)
    expect(p.author!.z).toBeCloseTo(3, 9)
  })

  it('gives each solid edge its own polyline under its own object', () => {
    const { items } = renderExample('Cube and its net')
    expect(items.some((i) => i.id === '0/edge-0-1' && i.shape.kind === 'polyline')).toBe(true)
    expect(items.some((i) => i.id === '1/fold-B-F' && i.shape.kind === 'polyline')).toBe(true)
  })
})
