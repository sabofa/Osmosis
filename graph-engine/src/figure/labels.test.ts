import { describe, expect, it } from 'vitest'
import { centroid, circumcenter, incenter, orthocenter } from '../scene/geometry/centres'
import { foot, midpoint } from '../scene/geometry/derive'
import { infiniteLine } from '../scene/geometry/objects'
import type { Vec2 } from '../scene/types'
import { fitProjection, type Rect } from './document'
import { estimateTextSize, layoutLabels, LABEL_FONT_SIZE, noObstacles, type LabelAnchor, type LabelObstacles } from './labels'

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function anchor(id: string, at: Vec2, text = id): LabelAnchor {
  return { id, text, at, fontSize: LABEL_FONT_SIZE, prefer: null }
}

function obstacles(partial: Partial<LabelObstacles>): LabelObstacles {
  return { ...noObstacles(), ...partial }
}

describe('text measurement', () => {
  it('estimates from character count and font size, monotonically in both', () => {
    const one = estimateTextSize('A', 12)
    const four = estimateTextSize('ABCD', 12)
    expect(four.width).toBeGreaterThan(one.width)
    expect(estimateTextSize('A', 24).width).toBeCloseTo(one.width * 2, 9)
    expect(estimateTextSize('A', 24).height).toBeCloseTo(one.height * 2, 9)
  })

  it('charges narrow and wide glyphs differently rather than averaging everything', () => {
    expect(estimateTextSize('i', 12).width).toBeLessThan(estimateTextSize('M', 12).width)
    expect(estimateTextSize('1', 12).width).toBeLessThan(estimateTextSize('W', 12).width)
  })

  it('gives an empty label no width but still a line height', () => {
    expect(estimateTextSize('', 12).width).toBe(0)
    expect(estimateTextSize('', 12).height).toBeGreaterThan(0)
  })
})

describe('avoiding other labels', () => {
  it('keeps two labels apart when their points nearly coincide', () => {
    const placed = layoutLabels([anchor('A', { x: 0, y: 0 }), anchor('B', { x: 4, y: 3 })], noObstacles())
    expect(placed).toHaveLength(2)
    expect(overlaps(placed[0].rect, placed[1].rect)).toBe(false)
  })

  it('keeps all of a tight cluster apart', () => {
    const cluster: LabelAnchor[] = []
    for (let i = 0; i < 8; i++) {
      cluster.push(anchor(`P${i}`, { x: Math.cos((i * Math.PI) / 4) * 6, y: Math.sin((i * Math.PI) / 4) * 6 }))
    }
    const placed = layoutLabels(cluster, noObstacles())
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlaps(placed[i].rect, placed[j].rect)).toBe(false)
      }
    }
  })
})

describe('avoiding drawn geometry', () => {
  it('does not land a label on a line passing close to its anchor', () => {
    // A horizontal line running right through the anchor: every candidate to
    // the left or right sits on the stroke, so the label has to go up or down.
    const line: [Vec2, Vec2] = [
      { x: -200, y: 0 },
      { x: 200, y: 0 },
    ]
    const [placed] = layoutLabels([anchor('A', { x: 0, y: 0 })], obstacles({ segments: [line] }))
    const rect = placed.rect
    const crosses = rect.y < 0 && rect.y + rect.height > 0
    expect(crosses).toBe(false)
  })

  it('does not land a label on a circle passing close to its anchor', () => {
    // The anchor sits where the circle's tangent is horizontal, so the
    // default "go right" placement lands squarely on the stroke — the label
    // has to notice the circle to get off it.
    const circle = { center: { x: 0, y: 0 }, radius: 100 }
    const [placed] = layoutLabels([anchor('P', { x: 0, y: -100 })], obstacles({ circles: [circle] }))
    // The placed box must not straddle the circle's stroke.
    const corners = [
      { x: placed.rect.x, y: placed.rect.y },
      { x: placed.rect.x + placed.rect.width, y: placed.rect.y },
      { x: placed.rect.x, y: placed.rect.y + placed.rect.height },
      { x: placed.rect.x + placed.rect.width, y: placed.rect.y + placed.rect.height },
    ]
    const distances = corners.map((c) => Math.hypot(c.x, c.y) - circle.radius)
    const inside = distances.every((d) => d < 0)
    const outside = distances.every((d) => d > 0)
    expect(inside || outside).toBe(true)
  })

  it('puts a vertex label outside its polygon, not inside it', () => {
    // A diamond rather than an axis-aligned square, and the reason is that
    // the square's default placement lands *on* an edge, where "inside" is
    // ambiguous and the edge-avoidance rule would move the label anyway. At
    // a diamond's left vertex the nearest candidate to the right is well
    // clear of both edges and squarely inside the shape — so only a rule
    // about the shape's interior, not about its strokes, moves it out.
    const R = 140
    const diamond: Vec2[] = [
      { x: 0, y: -R },
      { x: R, y: 0 },
      { x: 0, y: R },
      { x: -R, y: 0 },
    ]
    const edges: [Vec2, Vec2][] = diamond.map((p, i) => [p, diamond[(i + 1) % diamond.length]])
    const placed = layoutLabels(
      diamond.map((p, i) => anchor('ABCD'[i], p)),
      obstacles({ polygons: [diamond], segments: edges })
    )
    for (const label of placed) {
      // |x| + |y| > R is exactly "outside the diamond".
      expect(Math.abs(label.at.x) + Math.abs(label.at.y)).toBeGreaterThan(R)
    }
  })
})

// The case the plan says is the one that matters: a genuine dense
// configuration, not twenty points in a row. This is a scalene triangle with
// its full centre/midpoint/foot/Euler-point apparatus — the points that
// actually crowd each other in a competition figure.
function densePoints(): { id: string; at: Vec2 }[] {
  const A = { x: -4, y: -1 }
  const B = { x: 6, y: -1 }
  const C = { x: 1, y: 5 }
  const H = orthocenter(A, B, C)
  const O = circumcenter(A, B, C)
  const G = centroid(A, B, C)
  const I = incenter(A, B, C)
  const N = midpoint(O, H)
  const points: { id: string; at: Vec2 }[] = [
    { id: 'A', at: A },
    { id: 'B', at: B },
    { id: 'C', at: C },
    { id: 'H', at: H },
    { id: 'O', at: O },
    { id: 'G', at: G },
    { id: 'I', at: I },
    { id: 'N', at: N },
    { id: 'Ma', at: midpoint(B, C) },
    { id: 'Mb', at: midpoint(C, A) },
    { id: 'Mc', at: midpoint(A, B) },
    { id: 'Fa', at: foot(A, infiniteLine(B, C)) },
    { id: 'Fb', at: foot(B, infiniteLine(C, A)) },
    { id: 'Fc', at: foot(C, infiniteLine(A, B)) },
    { id: 'Ea', at: midpoint(A, H) },
    { id: 'Eb', at: midpoint(B, H) },
    { id: 'Ec', at: midpoint(C, H) },
    { id: 'Ja', at: midpoint(G, A) },
    { id: 'Jb', at: midpoint(G, B) },
    { id: 'Jc', at: midpoint(G, C) },
  ]
  return points
}

function denseCase(): { anchors: LabelAnchor[]; obstacles: LabelObstacles } {
  const raw = densePoints()
  const projection = fitProjection({ minX: -5, minY: -2, maxX: 7, maxY: 6 })
  const anchors = raw.map((p) => anchor(p.id, projection.toView(p.at)))
  const A = projection.toView(raw[0].at)
  const B = projection.toView(raw[1].at)
  const C = projection.toView(raw[2].at)
  const O = projection.toView(raw[4].at)
  const N = projection.toView(raw[7].at)
  return {
    anchors,
    obstacles: obstacles({
      segments: [
        [A, B],
        [B, C],
        [C, A],
        [A, projection.toView(raw[11].at)],
        [B, projection.toView(raw[12].at)],
        [C, projection.toView(raw[13].at)],
      ],
      circles: [
        { center: O, radius: Math.hypot(A.x - O.x, A.y - O.y) },
        { center: N, radius: Math.hypot(A.x - O.x, A.y - O.y) / 2 },
      ],
      polygons: [[A, B, C]],
    }),
  }
}

describe('the twenty-label case', () => {
  it('places twenty labels on a dense configuration with no two overlapping', () => {
    const { anchors, obstacles: obs } = denseCase()
    expect(anchors).toHaveLength(20)
    const placed = layoutLabels(anchors, obs)
    expect(placed).toHaveLength(20)
    const collisions: string[] = []
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        if (overlaps(placed[i].rect, placed[j].rect)) collisions.push(`${placed[i].id}/${placed[j].id}`)
      }
    }
    expect(collisions).toEqual([])
  })

  it('keeps every label attached to its own point', () => {
    const { anchors, obstacles: obs } = denseCase()
    const placed = layoutLabels(anchors, obs)
    for (const label of placed) {
      const source = anchors.find((a) => a.id === label.id)!
      const distance = Math.hypot(label.at.x - source.at.x, label.at.y - source.at.y)
      // Bounded by the escape ladder: a label may be pushed out, but never
      // so far that it reads as belonging to something else.
      expect(distance).toBeLessThan(120)
    }
  })

  it('places the same input identically every time', () => {
    const first = layoutLabels(denseCase().anchors, denseCase().obstacles)
    const second = layoutLabels(denseCase().anchors, denseCase().obstacles)
    expect(second).toEqual(first)
  })

  it('does not depend on object identity — a structurally equal input places the same', () => {
    const { anchors, obstacles: obs } = denseCase()
    const copy = anchors.map((a) => ({ ...a, at: { ...a.at } }))
    expect(layoutLabels(copy, obs)).toEqual(layoutLabels(anchors, obs))
  })
})

describe('preferred direction', () => {
  it('follows the hint when nothing is in the way', () => {
    const [placed] = layoutLabels([{ id: 'A', text: 'A', at: { x: 0, y: 0 }, fontSize: LABEL_FONT_SIZE, prefer: { x: -1, y: 0 } }], noObstacles())
    expect(placed.at.x).toBeLessThan(0)
  })

  it('abandons the hint rather than colliding', () => {
    const anchors: LabelAnchor[] = [
      { id: 'A', text: 'A', at: { x: 0, y: 0 }, fontSize: LABEL_FONT_SIZE, prefer: { x: 1, y: 0 } },
      { id: 'B', text: 'B', at: { x: 3, y: 0 }, fontSize: LABEL_FONT_SIZE, prefer: { x: 1, y: 0 } },
    ]
    const placed = layoutLabels(anchors, noObstacles())
    expect(overlaps(placed[0].rect, placed[1].rect)).toBe(false)
  })
})
