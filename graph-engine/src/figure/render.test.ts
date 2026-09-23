import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { FIGURE_LAYERS } from './document'
import { estimateTextSize, LABEL_FONT_SIZE } from './labels'
import { renderFigure } from './render'

function render(spec: string): string {
  const parsed = parseSpec(spec)
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
}

// The inner markup of one layer. Layer groups hold no nested <g>, so the
// first closing tag after the opening one is the right one.
function layer(svg: string, name: string): string {
  const selfClosing = `<g data-layer="${name}"/>`
  if (svg.includes(selfClosing)) return ''
  const open = `<g data-layer="${name}">`
  const start = svg.indexOf(open)
  if (start < 0) throw new Error(`no layer "${name}" in output`)
  const from = start + open.length
  const end = svg.indexOf('</g>', from)
  return svg.slice(from, end)
}

function countTags(markup: string, tag: string): number {
  return markup.split(`<${tag}`).length - 1
}

describe('the document', () => {
  it('is a complete, well-formed svg with every layer present', () => {
    const svg = render('A = (0, 0)\nB = (4, 0)\nsegment: A-B')
    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    expect(svg).toContain('viewBox="')
    for (const name of FIGURE_LAYERS) expect(svg).toContain(`data-layer="${name}"`)
  })

  it('reports construction errors instead of throwing them', () => {
    const parsed = parseSpec('X = midpoint of A-B')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.svg.startsWith('<svg ')).toBe(true)
  })
})

describe('E4 — stable element identity', () => {
  it('names the statement and the object behind every drawn element', () => {
    const svg = render('A = (0, 0)\nB = (4, 3)\nsegment: A-B')
    expect(layer(svg, 'points')).toContain('data-statement="0"')
    expect(layer(svg, 'points')).toContain('data-object="A"')
    expect(layer(svg, 'points')).toContain('data-object="B"')
    expect(layer(svg, 'primary')).toContain('data-statement="2"')
    expect(layer(svg, 'labels')).toContain('data-object="A"')
  })
})

describe('each object kind', () => {
  it('draws a labelled point as a dot in the points layer and text in the labels layer', () => {
    const svg = render('P = (1, 2)')
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(1)
    expect(layer(svg, 'labels')).toContain('>P</text>')
  })

  it('draws a segment as a line between its own endpoints', () => {
    const svg = render('A = (0, 0)\nB = (4, 0)\nsegment: A-B')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(1)
  })

  it('draws a circle as a circle, not as a sampled polyline', () => {
    const svg = render('circle: (0, 0), 3')
    expect(countTags(layer(svg, 'primary'), 'circle')).toBe(1)
    expect(countTags(layer(svg, 'primary'), 'polyline')).toBe(0)
  })

  it('draws a constructed circle as a circle too', () => {
    const svg = render('O = (0, 0)\nc = circle O, 2')
    expect(countTags(layer(svg, 'primary'), 'circle')).toBe(1)
  })

  it('draws a triangle as three edges and three labelled vertices', () => {
    const svg = render(['@angle: degrees', 'triangle ABC: angle A = 90, AB = 6, AC = 8'].join('\n'))
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(3)
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(3)
    expect(countTags(layer(svg, 'labels'), 'text')).toBe(3)
  })

  it('draws a polygon as its edges', () => {
    const svg = render('polygon: A(0,0), B(4,0), C(4,3), D(0,3)')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(4)
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(4)
  })

  it('draws an angle mark in the marks layer', () => {
    const svg = render('polygon: A(0,0), B(4,0), C(0,3)\nangle: A-B-C')
    expect(countTags(layer(svg, 'marks'), 'path')).toBe(1)
  })

  it('draws congruence ticks, one stroke per tick', () => {
    const svg = render('polygon: A(0,0), B(4,0), C(0,3)\ntick: A-B count: 2')
    expect(countTags(layer(svg, 'marks'), 'line')).toBe(2)
  })

  it('draws a right-angle mark as a polyline', () => {
    const svg = render('polygon: A(0,0), B(4,0), C(0,3)\nright-angle: B-A-C')
    expect(countTags(layer(svg, 'marks'), 'polyline')).toBe(1)
  })
})

describe('auxiliary lines', () => {
  it('dashes a constructed line and puts it behind the figure', () => {
    const svg = render('A = (0, 0)\nB = (4, 0)\nm = perpendicular bisector of A-B')
    const aux = layer(svg, 'auxiliary')
    expect(countTags(aux, 'line')).toBe(1)
    expect(aux).toContain('stroke-dasharray')
    expect(layer(svg, 'primary')).not.toContain('stroke-dasharray')
  })

  it('dashes a segment the author marked dashed, and leaves a plain one solid', () => {
    const dashed = render('A = (0, 0)\nB = (4, 3)\nsegment: A-B dashed')
    const plain = render('A = (0, 0)\nB = (4, 3)\nsegment: A-B')
    expect(layer(dashed, 'auxiliary')).toContain('stroke-dasharray')
    expect(layer(plain, 'primary')).not.toContain('stroke-dasharray')
    expect(layer(plain, 'auxiliary')).toBe('')
  })
})

describe('infinite lines are clipped at render time', () => {
  it('clips an infinite line to the figure rather than drawing it unbounded', () => {
    const svg = render('A = (0, 0)\nB = (4, 0)\nm = perpendicular bisector of A-B')
    const aux = layer(svg, 'auxiliary')
    const coords = [...aux.matchAll(/(x1|y1|x2|y2)="(-?[\d.]+)"/g)].map((m) => Number(m[2]))
    expect(coords).toHaveLength(4)
    for (const c of coords) expect(Math.abs(c)).toBeLessThan(2000)
  })

  it('re-clips when the bounds change — the same line, a bigger figure', () => {
    const near = render('A = (0, 0)\nB = (4, 0)\nm = perpendicular bisector of A-B')
    const far = render('A = (0, 0)\nB = (4, 0)\nm = perpendicular bisector of A-B\nQ = (4, 40)')

    const ends = (svg: string) => {
      const aux = layer(svg, 'auxiliary')
      return [...aux.matchAll(/(y1|y2)="(-?[\d.]+)"/g)].map((m) => Number(m[2]))
    }
    // The line is the same locus in both, but the second figure is far
    // taller, so the drawn stick must reach further. A stored clip would
    // give the two the same endpoints.
    const nearSpan = Math.abs(ends(near)[0] - ends(near)[1])
    const farSpan = Math.abs(ends(far)[0] - ends(far)[1])
    expect(farSpan).toBeGreaterThan(nearSpan * 1.2)
  })

  it('clips a ray forward only', () => {
    const svg = render(['A = (0, 0)', 'B = (6, 0)', 'C = (0, 6)', 'w = bisector of angle A-B-C'].join('\n'))
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(1)
  })
})

describe('the Phase 1 motivating figure', () => {
  const SPEC = ['@angle: degrees', 'triangle ABC: angle A = 90, AB = 6, AC = 8', 'D = foot A to B-C', 'segment: A-D dashed'].join('\n')

  it('renders as a complete figure with its altitude dashed', () => {
    const parsed = parseSpec(SPEC)
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors).toEqual([])
    const svg = result.svg

    expect(svg.startsWith('<svg ')).toBe(true)
    expect(svg.endsWith('</svg>')).toBe(true)
    // Three triangle edges, and the altitude dashed in the auxiliary layer.
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(3)
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(1)
    expect(layer(svg, 'auxiliary')).toContain('stroke-dasharray')
    // A, B, C and D all labelled, none of them overlapping.
    for (const name of ['A', 'B', 'C', 'D']) expect(layer(svg, 'labels')).toContain(`>${name}</text>`)
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(4)
  })

  it('balances its group tags', () => {
    const svg = render(SPEC)
    const opened = [...svg.matchAll(/<g\b[^>]*?(?<!\/)>/g)].length
    const closed = svg.split('</g>').length - 1
    const selfClosed = [...svg.matchAll(/<g\b[^>]*\/>/g)].length
    expect(opened).toBe(closed)
    expect(opened + selfClosed).toBe(FIGURE_LAYERS.length)
  })
})

describe('determinism', () => {
  const EVERY_KIND = [
    '@angle: degrees',
    'triangle ABC: angle A = 90, AB = 6, AC = 8',
    'D = foot A to B-C',
    'segment: A-D dashed',
    'M = midpoint of B-C',
    'm = perpendicular bisector of A-B',
    'n = line through A parallel to B-C',
    'b = bisector of angle A-B-C',
    'O = circumcenter of ABC',
    'k = circle O, 5',
    'P = (1, 1)',
    'polygon: E(10,0), F(13,0), G(13,4)',
    'angle: A-B-C',
    'tick: A-B count: 2',
    'right-angle: B-A-C',
  ].join('\n')

  it('renders byte-identical svg twice from the same spec', () => {
    expect(render(EVERY_KIND)).toBe(render(EVERY_KIND))
  })

  it('renders byte-identical svg from two separate parses of the same text', () => {
    const a = parseSpec(EVERY_KIND)
    const b = parseSpec(EVERY_KIND)
    expect(renderFigure(a.statements, a.config, LIGHT_PALETTE).svg).toBe(renderFigure(b.statements, b.config, LIGHT_PALETTE).svg)
  })

  it('exercises every object kind in that figure', () => {
    const svg = render(EVERY_KIND)
    expect(countTags(layer(svg, 'primary'), 'line')).toBeGreaterThanOrEqual(6)
    expect(countTags(layer(svg, 'primary'), 'circle')).toBe(1)
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBeGreaterThanOrEqual(4)
    expect(countTags(layer(svg, 'marks'), 'path')).toBe(1)
    expect(countTags(layer(svg, 'marks'), 'polyline')).toBe(1)
    expect(countTags(layer(svg, 'marks'), 'line')).toBe(2)
  })
})

// Verification item 3 of the plan: a dense figure — twenty-plus labelled
// points with intersecting circles and lines — renders with no overlapping
// labels and the layers in the right order. The label search is unit-tested
// in labels.test.ts; this checks the whole path, from spec text to markup.
describe('a dense figure, end to end', () => {
  const DENSE = [
    '@mode: figure',
    'triangle ABC: AB = 7, BC = 8, AC = 6',
    'D = foot A to B-C',
    'M = midpoint of B-C',
    'N = midpoint of A-B',
    'P = midpoint of A-C',
    'G = centroid of ABC',
    'O = circumcenter of ABC',
    'I = incenter of ABC',
    'H = orthocenter of ABC',
    'E = midpoint of A-H',
    'F = midpoint of B-H',
    'J = midpoint of C-H',
    'K = midpoint of O-H',
    'L = midpoint of G-A',
    'Q = midpoint of G-B',
    'S = midpoint of G-C',
    'T = midpoint of D-M',
    'U = midpoint of N-P',
    'V = midpoint of I-O',
    // Four more inside the centre cluster: G, I, K and V already sit
    // within about twenty view units of each other, so these are the
    // points that make label placement actually hard.
    'W = midpoint of G-I',
    'X = midpoint of G-K',
    'Y = midpoint of I-V',
    'Z = midpoint of K-V',
    'c = circle O, 4',
    'k = circle I, 2',
    'm = perpendicular bisector of A-B',
    'n = line through G parallel to B-C',
    'segment: A-D dashed',
    'segment: B-P dashed',
  ].join('\n')

  function placedLabels(svg: string) {
    const labels = layer(svg, 'labels')
    return [...labels.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"[^>]*>([^<]*)<\/text>/g)].map((m) => {
      const size = estimateTextSize(m[3], LABEL_FONT_SIZE)
      return {
        text: m[3],
        x: Number(m[1]) - size.width / 2,
        y: Number(m[2]) - size.height / 2,
        width: size.width,
        height: size.height,
      }
    })
  }

  it('labels at least twenty points', () => {
    const parsed = parseSpec(DENSE)
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors).toEqual([])
    expect(placedLabels(result.svg).length).toBeGreaterThanOrEqual(20)
  })

  it('overlaps none of them', () => {
    const labels = placedLabels(render(DENSE))
    const collisions: string[] = []
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]
        const b = labels[j]
        if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) {
          collisions.push(`${a.text}/${b.text}`)
        }
      }
    }
    expect(collisions).toEqual([])
  })

  it('paints the layers in E1 order, with the intersecting circles and lines all present', () => {
    const svg = render(DENSE)
    const at = (name: string) => svg.indexOf(`data-layer="${name}"`)
    expect(at('regions')).toBeLessThan(at('auxiliary'))
    expect(at('auxiliary')).toBeLessThan(at('primary'))
    expect(at('primary')).toBeLessThan(at('marks'))
    expect(at('marks')).toBeLessThan(at('points'))
    expect(at('points')).toBeLessThan(at('labels'))
    // Two circles, both drawn as circles.
    expect(countTags(layer(svg, 'primary'), 'circle')).toBe(2)
    // Three triangle edges.
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(3)
    // Two construction lines plus two dashed segments.
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(4)
  })

  it('renders byte-identically twice', () => {
    expect(render(DENSE)).toBe(render(DENSE))
  })
})

// ---------------------------------------------------------------------------
// Measure labels
// ---------------------------------------------------------------------------

interface EmittedText {
  x: number
  y: number
  // The centre of the text's box. A plain label is written centred and a
  // notation label from its left edge, so raw x is not comparable between the
  // two and this is what the position tests measure with.
  centreX: number
  text: string
  // Whether the element names an object. Everything drawn on the figure
  // does; a row of the givens box does not, which is how the two are told
  // apart when both live in the labels layer.
  named: boolean
}

// Every <text> in a layer, with the position it was written at.
function texts(markup: string): EmittedText[] {
  const out: EmittedText[] = []
  const pattern = /<text ([^>]*)>([^<]*)<\/text>/g
  for (let m = pattern.exec(markup); m; m = pattern.exec(markup)) {
    const attrs = m[1]
    const x = Number(/(?:^|\s)x="([^"]*)"/.exec(attrs)?.[1])
    const y = Number(/(?:^|\s)y="([^"]*)"/.exec(attrs)?.[1])
    const anchored = /text-anchor="([^"]*)"/.exec(attrs)?.[1]
    const text = m[2]
    const centreX = anchored === 'start' ? x + estimateTextSize(text, LABEL_FONT_SIZE).width / 2 : x
    out.push({ x, y, centreX, text, named: attrs.includes('data-object=') })
  }
  return out
}

const LABEL_HALF_HEIGHT = estimateTextSize('0', LABEL_FONT_SIZE).height / 2

// Whether two emitted labels' boxes touch. Distance between their centres is
// not the same question: two labels can be further apart than a label is tall
// and still overlap, because a label is much wider than it is high.
function boxesOverlap(a: EmittedText, b: EmittedText): boolean {
  const box = (t: EmittedText) => {
    const size = estimateTextSize(t.text, LABEL_FONT_SIZE)
    return { x0: t.centreX - size.width / 2, x1: t.centreX + size.width / 2, y0: t.y - size.height / 2, y1: t.y + size.height / 2 }
  }
  const p = box(a)
  const q = box(b)
  return p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1
}

// Where a named point was actually drawn, read off its own dot. The tests
// need view coordinates for the geometry, and this is the renderer's answer
// rather than a second copy of the projection.
function pointNamed(svg: string, name: string): { x: number; y: number } {
  const pattern = new RegExp(`<circle cx="([^"]*)" cy="([^"]*)"[^>]*data-object="${name}"`)
  const match = pattern.exec(layer(svg, 'points'))
  if (!match) throw new Error(`no drawn point named "${name}"`)
  return { x: Number(match[1]), y: Number(match[2]) }
}

// The angle arc's radius, from render.ts. Duplicated rather than exported:
// the test is asserting the label clears the arc a reader sees, and pinning
// the number here means changing the constant has to be done on purpose.
const ANGLE_ARC_RADIUS = 34

function distanceToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)))
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy))
}

function labelNamed(svg: string, text: string): EmittedText {
  const all = texts(layer(svg, 'labels'))
  const found = all.find((t) => t.text === text)
  if (!found) throw new Error(`no label "${text}" among [${all.map((t) => t.text).join(', ')}]`)
  return found
}

function build(spec: string) {
  const parsed = parseSpec(spec)
  return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
}

describe('measure labels', () => {
  // A 3-4-5 right triangle, placed so that nothing lands on a round view
  // coordinate by accident.
  // "triangle: ABC" is not a statement — the solved form is
  // "triangle ABC: <measurements>" — so a polygon is what draws a triangle
  // from plain coordinates.
  const triangle = 'polygon: A(0, 0), B(8, 0), C(8, 6)\n'

  it('prints the computed length of a segment', () => {
    const svg = render('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB')
    expect(labelNamed(svg, '8').text).toBe('8')
  })

  it('prints a length the author never stated, computed from the figure', () => {
    // The hypotenuse: nothing in the spec says 10.
    const svg = render(triangle + 'label: AC')
    expect(labelNamed(svg, '10').text).toBe('10')
  })

  it('prints an angle measure in the unit @angle selects', () => {
    const degrees = render('@angle: degrees\n' + triangle + 'label: angle ABC')
    expect(labelNamed(degrees, '90°').text).toBe('90°')
    const radians = render('@angle: radians\n' + triangle + 'label: angle ABC')
    expect(labelNamed(radians, '1.571').text).toBe('1.571')
  })

  it('places a length label beside the middle of its own segment', () => {
    // Deliberately without a drawn segment: the label must sit *beside* the
    // line AB because that is where a measure belongs, not because a stroke
    // happened to be in the way. This is what the outward push buys — with
    // no obstacle to escape, the layout's own first choice is straight
    // right, which lands the number on the line it is measuring.
    const svg = render('A = (0, 0)\nB = (8, 0)\nlabel: AB')
    const label = labelNamed(svg, '8')
    // A and B project symmetrically about the origin, so their midpoint is
    // at view (0, 0) and the label belongs near it horizontally...
    expect(Math.abs(label.centreX)).toBeLessThan(2 * LABEL_FONT_SIZE)
    // ...and off the line joining them vertically.
    expect(Math.abs(label.y)).toBeGreaterThan(LABEL_HALF_HEIGHT)
  })

  it('places an angle label somewhere other than the vertex label', () => {
    const svg = render('@angle: degrees\n' + triangle + 'angle: A-B-C\nlabel: angle ABC')
    const label = labelNamed(svg, '90°')
    const vertex = labelNamed(svg, 'B')
    expect(Math.hypot(label.x - vertex.x, label.y - vertex.y)).toBeGreaterThan(LABEL_FONT_SIZE)
  })

  it('goes through the collision layout rather than being placed directly', () => {
    // Two measures on one segment share an anchor exactly. Placed directly
    // they would be written on top of each other; laid out, the second has
    // to find somewhere else to be.
    const svg = render('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB\nlabel: AB = x')
    expect(boxesOverlap(labelNamed(svg, '8'), labelNamed(svg, 'x'))).toBe(false)
  })

  it('is laid out together with the point labels, not in a pass of its own', () => {
    // G is the centroid, and a triangle's name is anchored at the centroid
    // too, so both labels start from the same point. A separate layout pass
    // for measures would see only its own rectangles and write one over the
    // other.
    const svg = render('polygon: A(0, 0), B(8, 0), C(2, 6)\nG = centroid ABC\nlabel: triangle ABC')
    expect(boxesOverlap(labelNamed(svg, 'G'), labelNamed(svg, '△ABC'))).toBe(false)
  })

  it('stands an angle label out past the arc that marks the angle', () => {
    // The arc has a view-space radius the label layout cannot see — it is
    // not an obstacle, it is a mark — so the anchor is pushed out past it
    // before the layout runs. Without that the number sits inside its own arc.
    const svg = render('@angle: degrees\n' + triangle + 'angle: A-B-C\nlabel: angle ABC')
    const vertex = pointNamed(svg, 'B')
    const label = labelNamed(svg, '90°')
    const distance = Math.hypot(label.centreX - vertex.x, label.y - vertex.y)
    // Outside the arc...
    expect(distance).toBeGreaterThan(ANGLE_ARC_RADIUS)
    // ...and clear of it, rather than written across the stroke.
    expect(distance - ANGLE_ARC_RADIUS).toBeGreaterThan(LABEL_HALF_HEIGHT)
  })

  it('writes an angle measure inside the angle it measures', () => {
    // A number floating on the far side of the vertex names nothing. The
    // bisector hint is what puts it in the opening between the two arms.
    const svg = render('@angle: degrees\n' + triangle + 'angle: A-B-C\nlabel: angle ABC')
    const [a, b, c] = ['A', 'B', 'C'].map((name) => pointNamed(svg, name))
    const label = labelNamed(svg, '90°')
    const cross = (p: { x: number; y: number }, q: { x: number; y: number }) => p.x * q.y - p.y * q.x
    const arm = (p: { x: number; y: number }) => ({ x: p.x - b.x, y: p.y - b.y })
    const u = arm(a)
    const v = arm(c)
    const w = arm({ x: label.centreX, y: label.y })
    // Inside the wedge: turning from one arm to the label and from the label
    // to the other arm both go the same way round as the angle itself.
    expect(Math.sign(cross(u, w))).toBe(Math.sign(cross(u, v)))
    expect(Math.sign(cross(w, v))).toBe(Math.sign(cross(u, v)))
  })

  it('keeps a vertex name off an angle arc too', () => {
    // The arc became an obstacle for the whole layout, not just for measure
    // labels: a vertex name written across its own angle mark was already
    // wrong before this phase.
    const svg = render('@angle: degrees\npolygon: A(0, 0), B(8, 0), C(8, 6)\nangle: A-B-C')
    const vertex = pointNamed(svg, 'B')
    const label = labelNamed(svg, 'B')
    const distance = Math.hypot(label.centreX - vertex.x, label.y - vertex.y)
    expect(Math.abs(distance - ANGLE_ARC_RADIUS)).toBeGreaterThan(LABEL_HALF_HEIGHT)
  })

  it('puts each side label on the outside of the shape, with no polygon to go by', () => {
    // A quadrilateral drawn as four segments has no interior the layout can
    // penalise a label for sitting in — "inside" is a property of a polygon
    // item, and there is none here. The outward perpendicular is what keeps
    // the four measures from landing in the middle of the shape.
    const svg = render(
      [
        'P = (0, 0)',
        'Q = (10, 0)',
        'R = (9, 6)',
        'S = (1, 7)',
        'segment: P-Q',
        'segment: Q-R',
        'segment: R-S',
        'segment: S-P',
        'label: PQ',
        'label: QR',
        'label: RS',
        'label: SP',
      ].join('\n')
    )
    const corners = ['P', 'Q', 'R', 'S'].map((name) => pointNamed(svg, name))
    const middle = {
      x: corners.reduce((sum, c) => sum + c.x, 0) / corners.length,
      y: corners.reduce((sum, c) => sum + c.y, 0) / corners.length,
    }
    const sides: [number, number, string][] = [
      [0, 1, '10'],
      [1, 2, '6.083'],
      [2, 3, '8.062'],
      [3, 0, '7.071'],
    ]
    for (const [i, j, text] of sides) {
      const a = corners[i]
      const b = corners[j]
      const side = (p: { x: number; y: number }) => Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
      const label = labelNamed(svg, text)
      expect(side({ x: label.centreX, y: label.y })).toBe(-side(middle))
    }
  })

  it('stands a side label clear of the edges the figure draws', () => {
    // What the outward push buys, and the reason it is not left to the
    // layout's own escape rings: a number touching the line it measures is
    // exactly what inline labelling gets wrong.
    const svg = render('polygon: A(0, 0), B(8, 0), C(2, 5)\nlabel: AB\nlabel: BC\nlabel: AC')
    const edges = [...layer(svg, 'primary').matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g)].map(
      (m) => ({ a: { x: Number(m[1]), y: Number(m[2]) }, b: { x: Number(m[3]), y: Number(m[4]) } })
    )
    expect(edges).toHaveLength(3)
    for (const text of ['8', '7.81', '5.385']) {
      const label = labelNamed(svg, text)
      const clearance = Math.min(
        ...edges.map((edge) => distanceToSegment({ x: label.centreX, y: label.y }, edge.a, edge.b))
      )
      expect(clearance).toBeGreaterThan(LABEL_HALF_HEIGHT)
    }
  })

  it('prints a stated value that agrees with the figure, and reports nothing', () => {
    const result = build('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB = 8')
    expect(result.errors).toEqual([])
    expect(labelNamed(result.svg, '8').text).toBe('8')
  })

  it('fails a stated value that contradicts the figure, naming both numbers', () => {
    const result = build('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB = 99')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('99')
    expect(result.errors[0].message).toContain('8')
    expect(result.errors[0].message).toContain('AB')
    // The figure still draws: an author fixing the error needs to see it.
    expect(result.svg.startsWith('<svg ')).toBe(true)
  })

  it('fails an angle assertion the same way', () => {
    const result = build('@angle: degrees\n' + triangle + 'label: angle ABC = 60')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('60')
    expect(result.errors[0].message).toContain('90')
  })

  it('suppresses the check, and prints the stated value, under @scale: false', () => {
    const result = build('@scale: false\nA = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB = 99')
    expect(result.errors).toEqual([])
    expect(labelNamed(result.svg, '99').text).toBe('99')
  })

  it('asserts nothing for a symbolic value, and prints it as written', () => {
    const result = build('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AB = x')
    expect(result.errors).toEqual([])
    expect(labelNamed(result.svg, 'x').text).toBe('x')
  })

  it('reports an unknown point instead of dropping the label silently', () => {
    const result = build('A = (0, 0)\nB = (8, 0)\nsegment: A-B\nlabel: AZ')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('Z')
  })

  it('is deterministic', () => {
    const spec = triangle + 'label: AB = 8\nlabel: segment AC\nlabel: angle ABC'
    expect(render(spec)).toBe(render(spec))
  })
})

describe('notation in a figure', () => {
  const segment = 'A = (0, 0)\nB = (8, 0)\nsegment: A-B\n'

  it('writes a named segment with an overbar above the glyphs', () => {
    const labels = layer(render(segment + 'label: segment AB'), 'labels')
    const name = texts(labels).find((t) => t.text === 'AB')
    if (!name) throw new Error('expected an "AB" label')
    // The bar is geometry, and sits a fixed fraction of the font size above
    // the row the glyphs are on (0.46 em, per notation.ts).
    const bars = [...labels.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g)]
    const bar = bars.find((m) => Math.abs(Number(m[2]) - (name.y - 0.46 * LABEL_FONT_SIZE)) < 1e-3)
    if (!bar) throw new Error(`no overbar above the label at y=${name.y}`)
    // ...and covers the glyphs it belongs to.
    expect(Number(bar[1])).toBeLessThan(name.x)
    expect(Number(bar[3])).toBeGreaterThan(name.x + estimateTextSize('AB', LABEL_FONT_SIZE).width - 1e-9)
    // A horizontal rule, not a diagonal.
    expect(Number(bar[4])).toBeCloseTo(Number(bar[2]), 9)
  })

  it('draws a ray arrow and a line double-arrow as polylines', () => {
    const rayMarkup = layer(render(segment + 'label: ray AB'), 'labels')
    const lineMarkup = layer(render(segment + 'label: line AB'), 'labels')
    expect(countTags(rayMarkup, 'polyline')).toBe(1)
    expect(countTags(lineMarkup, 'polyline')).toBe(2)
  })

  it('writes a triangle name with the triangle sign and no overbar', () => {
    const labels = layer(render('polygon: A(0, 0), B(8, 0), C(8, 6)\nlabel: triangle ABC'), 'labels')
    expect(labels).toContain('△')
    expect(countTags(labels, 'line')).toBe(0)
  })

  it('leaves a plain measure unmarked — "AB = 8" bars AB and not the value', () => {
    expect(countTags(layer(render(segment + 'label: AB = 8'), 'labels'), 'line')).toBe(0)
  })

  it('draws no notation geometry in a figure that asks for none', () => {
    // The guard on every assertion above: these figures have always emitted
    // text only, and this phase must not add strokes to the labels layer of
    // a figure that never asked for notation.
    expect(countTags(layer(render(segment), 'labels'), 'line')).toBe(0)
  })
})

describe('the givens box in a figure', () => {
  const square = 'polygon: A(0, 0), B(6, 0), C(6, 6), D(0, 6)\n'

  function boxRect(svg: string) {
    // The box is the only rect in the labels layer; the paper is its own
    // element outside every layer.
    const match = /<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/.exec(layer(svg, 'labels'))
    if (!match) throw new Error('no givens box in the labels layer')
    return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }
  }

  function viewBoxOf(svg: string) {
    const match = /viewBox="([^"]*)"/.exec(svg)
    if (!match) throw new Error('no viewBox')
    const [x, y, width, height] = match[1].split(' ').map(Number)
    return { x, y, width, height }
  }

  function contains(outer: { x: number; y: number; width: number; height: number }, inner: { x: number; y: number; width: number; height: number }) {
    return (
      outer.x <= inner.x &&
      outer.y <= inner.y &&
      outer.x + outer.width >= inner.x + inner.width &&
      outer.y + outer.height >= inner.y + inner.height
    )
  }

  it('draws a box listing the given, with the name in notation and the value plain', () => {
    const svg = render(square + 'given: AB = 6')
    const labels = layer(svg, 'labels')
    expect(boxRect(svg).width).toBeGreaterThan(0)
    const row = texts(labels).find((t) => t.text === 'AB')
    if (!row) throw new Error('expected the name "AB" in the box')
    expect(labels).toContain('= 6')
    // One overbar: over AB, not over the value.
    expect(countTags(labels, 'line')).toBe(1)
  })

  it('never overlaps the drawing', () => {
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right']) {
      const svg = render(`@givens: ${position}\n` + square + 'given: AB = 6\ngiven: BC = 6')
      const box = boxRect(svg)
      const edges = [...layer(svg, 'primary').matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g)]
      expect(edges.length).toBeGreaterThan(0)
      for (const edge of edges) {
        for (const [px, py] of [
          [Number(edge[1]), Number(edge[2])],
          [Number(edge[3]), Number(edge[4])],
        ]) {
          const inside = px >= box.x && px <= box.x + box.width && py >= box.y && py <= box.y + box.height
          expect(inside).toBe(false)
        }
      }
    }
  })

  it('puts the box where @givens says, not always in the same corner', () => {
    const at = (position: string) => boxRect(render(`@givens: ${position}\n` + square + 'given: AB = 6'))
    expect(at('top-left').y).toBeLessThan(at('bottom-left').y)
    expect(at('left').x).toBeLessThan(at('right').x)
    expect(at('top-left').x).toBeLessThan(at('top-right').x)
  })

  it('clears the labels too, not just the geometry', () => {
    // The box is laid out against the finished drawing — the geometry *and*
    // the labels already placed around it. Adding a measure above the top
    // edge therefore pushes a top-corner box further out; laid out against
    // the bare geometry it would not move at all, and would end up sitting
    // on the labels it did not look at.
    const bare = boxRect(render(square + 'given: AB = 6'))
    const labelled = boxRect(render(square + 'label: DC\ngiven: AB = 6'))
    expect(labelled.y).toBeLessThan(bare.y)
    // Never overlapping anything drawn on the figure, in either case.
    for (const svg of [render(square + 'given: AB = 6'), render(square + 'label: DC\ngiven: AB = 6')]) {
      const box = boxRect(svg)
      // Box rows carry no data-object; every label on the drawing does.
      const drawn = texts(layer(svg, 'labels')).filter((t) => t.named)
      expect(drawn.length).toBeGreaterThan(0)
      for (const label of drawn) {
        const size = estimateTextSize(label.text, LABEL_FONT_SIZE)
        const overlap =
          label.centreX - size.width / 2 < box.x + box.width &&
          box.x < label.centreX + size.width / 2 &&
          label.y - size.height / 2 < box.y + box.height &&
          box.y < label.y + size.height / 2
        expect(overlap).toBe(false)
      }
    }
  })

  it('grows the viewBox to hold the box as well as the drawing', () => {
    for (const position of ['top-left', 'bottom-right', 'left', 'right']) {
      const svg = render(`@givens: ${position}\n` + square + 'given: AB = 6\ngiven: angle ABC = 90')
      expect(contains(viewBoxOf(svg), boxRect(svg))).toBe(true)
    }
  })

  it('lists the givens in the order the spec states them', () => {
    const svg = render(square + 'given: AB = 6\ngiven: BC = 6\ngiven: angle ABC = 90')
    const rows = texts(layer(svg, 'labels')).filter((t) => t.text === 'AB' || t.text === 'BC' || t.text === '∠ABC')
    expect(rows.map((r) => r.text)).toEqual(['AB', 'BC', '∠ABC'])
    expect(rows[0].y).toBeLessThan(rows[1].y)
    expect(rows[1].y).toBeLessThan(rows[2].y)
  })

  it('writes a relation with both names in notation', () => {
    const svg = render(square + 'given: AB parallel CD')
    const labels = layer(svg, 'labels')
    expect(labels).toContain('∥')
    // A bar over each of the two names.
    expect(countTags(labels, 'line')).toBe(2)
  })

  it('checks a stated given exactly as an inline label does', () => {
    const wrong = build(square + 'given: AB = 99')
    expect(wrong.errors).toHaveLength(1)
    expect(wrong.errors[0].message).toContain('99')
    expect(wrong.errors[0].message).toContain('6')
  })

  it('is suppressed by @scale: false, like every other check', () => {
    const result = build('@scale: false\n' + square + 'given: AB = 99')
    expect(result.errors).toEqual([])
    expect(layer(result.svg, 'labels')).toContain('= 99')
  })

  it('coexists with inline labelling, per label', () => {
    const svg = render(square + 'label: BC\ngiven: AB = 6')
    // The inline measure is out on the figure; the given is in the box.
    const box = boxRect(svg)
    const inline = labelNamed(svg, '6')
    const insideBox = inline.x >= box.x && inline.x <= box.x + box.width
    expect(insideBox).toBe(false)
  })

  it('draws no box at all when the spec states no givens', () => {
    // The guard for every figure that existed before this phase.
    expect(layer(render(square), 'labels')).not.toContain('<rect')
  })

  it('is deterministic', () => {
    const spec = square + 'given: AB = 6\ngiven: AB parallel CD'
    expect(render(spec)).toBe(render(spec))
  })
})

// ---------------------------------------------------------------------------
// The circle vocabulary
// ---------------------------------------------------------------------------

describe('circles — arcs, fills, tangents and secants', () => {
  // One circle of radius 5 about the origin, with four points that lie on it
  // exactly, so nothing below argues with a tolerance:
  //   P (5, 0) at 0 deg, Q (0, 5) at 90, R (-3, 4) at 126.87, S (-5, 0) at 180
  const base =
    '@mode: figure\n@angle: degrees\nC = (0, 0)\nO = circle C, 5\n' +
    'P = (5, 0)\nQ = (0, 5)\nR = (-3, 4)\nS = (-5, 0)\nX = (13, 0)\n'

  function build(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  function paths(markup: string): string[] {
    return [...markup.matchAll(/<path d="([^"]*)"/g)].map((m) => m[1])
  }

  // "A rx ry rotation large-arc sweep x y" — the two flags are what say which
  // of the four arcs joining two points on a circle was drawn.
  function arcFlags(d: string): { largeArc: string; sweep: string } {
    const match = /A [^ ]+ [^ ]+ 0 ([01]) ([01])/.exec(d)
    if (!match) throw new Error(`not an arc path: ${d}`)
    return { largeArc: match[1], sweep: match[2] }
  }

  it('draws an arc as an SVG path arc, not as a sampled polyline', () => {
    const svg = render(base + 'arc P-Q on O ccw')
    const primary = layer(svg, 'primary')
    expect(countTags(primary, 'polyline')).toBe(0)
    const drawn = paths(primary)
    expect(drawn).toHaveLength(1)
    expect(drawn[0]).toMatch(/^M [^ ]+ [^ ]+ A /)
  })

  it('draws the arc the direction names, and a different one for the other direction (G1)', () => {
    const ccw = paths(layer(render(base + 'arc P-Q on O ccw'), 'primary'))[0]
    const cw = paths(layer(render(base + 'arc P-Q on O cw'), 'primary'))[0]
    expect(ccw).not.toBe(cw)
    // The quarter turn is the small one; the other way round is the big one.
    expect(arcFlags(ccw).largeArc).toBe('0')
    expect(arcFlags(cw).largeArc).toBe('1')
    expect(arcFlags(ccw).sweep).not.toBe(arcFlags(cw).sweep)
  })

  it('draws a major arc as the long way round', () => {
    expect(arcFlags(paths(layer(render(base + 'arc P-Q on O major'), 'primary'))[0]).largeArc).toBe('1')
    expect(arcFlags(paths(layer(render(base + 'arc P-Q on O minor'), 'primary'))[0]).largeArc).toBe('0')
  })

  it('refuses an arc between opposite ends of a diameter rather than picking one (G1)', () => {
    const result = build(base + 'arc P-S on O minor')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/semicircle/)
    expect(layer(result.svg, 'primary')).not.toContain('<path')
  })

  it('refuses an endpoint that is not on the circle, naming the gap', () => {
    const result = build(base + 'T = (6, 0)\narc P-T on O ccw')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('"T"')
    expect(result.errors[0].message).toContain('1')
  })

  it('says which circle it cannot find when the spec never named one', () => {
    const result = build('@mode: figure\nP = (5, 0)\nQ = (0, 5)\narc P-Q on O ccw')
    expect(result.errors[0].message).toMatch(/Unknown circle "O"/)
  })

  it('puts a sector and a circular segment in the regions layer, behind the lines (E1)', () => {
    for (const shape of ['sector', 'segment']) {
      const svg = render(base + `${shape} P-Q on O ccw`)
      expect(paths(layer(svg, 'regions'))).toHaveLength(1)
      expect(paths(layer(svg, 'primary'))).toHaveLength(0)
      expect(layer(svg, 'regions')).toContain('fill-opacity')
    }
  })

  it('closes a sector through the centre and a segment along its chord', () => {
    const svg = render(base + 'sector P-Q on O ccw')
    const sector = paths(layer(svg, 'regions'))[0]
    const segment = paths(layer(render(base + 'segment P-Q on O ccw'), 'regions'))[0]
    const circle = /<circle cx="([^"]*)" cy="([^"]*)"/.exec(layer(svg, 'primary'))
    if (!circle) throw new Error('no circle drawn')
    // The wedge starts at the centre and runs out to the arc; the segment
    // starts on the circle and closes straight back across its own chord.
    expect(sector.startsWith(`M ${circle[1]} ${circle[2]} L `)).toBe(true)
    expect(sector.endsWith(' Z')).toBe(true)
    expect(segment).not.toContain(' L ')
    expect(segment.endsWith(' Z')).toBe(true)
  })

  it('draws a chord, a radius and a diameter as segments', () => {
    const svg = render(base + 'chord P-Q on O\nradius O to R\ndiameter P-S on O')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(3)
  })

  it('draws the tangent at a point of the circle, touching it once', () => {
    const svg = render(base + 't = tangent at P on O')
    // An infinite line is clipped to the view, so it is one line in the
    // auxiliary layer — every constructed line is scaffolding.
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(1)
  })

  it('draws both tangents from an external point, and binds them in order', () => {
    // Drawn to their touch points, so each one is a segment whose length is
    // the tangent length — the quantity the problem is usually about — and
    // therefore part of the figure rather than scaffolding.
    const svg = render(base + 't, u = tangent from X to O')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(2)
    expect(render(base + 't, u = tangent from X to O')).toBe(svg)
  })

  it('refuses tangents from a point inside the circle', () => {
    const result = build(base + 'T = (1, 1)\nt, u = tangent from T to O')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/inside/)
  })

  it('draws a secant, and refuses a line that does not cut the circle twice', () => {
    expect(countTags(layer(render(base + 'k = secant P-Q on O'), 'auxiliary'), 'line')).toBe(1)
    const missed = build(base + 'U = (0, 9)\nV = (9, 9)\nk = secant U-V on O')
    expect(missed.errors).toHaveLength(1)
    expect(missed.errors[0].message).toMatch(/secant cuts the circle/)
  })
})

describe('G2 — an arc and its central angle print one number', () => {
  const base =
    '@mode: figure\n@angle: degrees\nC = (0, 0)\nO = circle C, 5\nP = (5, 0)\nQ = (0, 5)\n'

  function textFor(svg: string, object: string): string {
    const match = new RegExp(`<text [^>]*data-object="${object}"[^>]*>([^<]*)</text>`).exec(layer(svg, 'labels'))
    if (!match) throw new Error(`no label for "${object}"`)
    return match[1]
  }

  // Both numbers come out of the rendered figure, and neither is recomputed
  // here: a test that works the expected value out the same way the renderer
  // does proves only that the arithmetic is repeatable.
  for (const [mode, direction, expected] of [
    ['degrees', 'minor', '90°'],
    ['degrees', 'major', '270°'],
    ['radians', 'minor', '1.571'],
    ['radians', 'major', '4.712'],
  ] as const) {
    it(`agrees for a ${direction} arc in ${mode}`, () => {
      const svg = render(base + `@angle: ${mode}\nlabel: arc PQ on O ${direction}\ncentral angle P-Q on O ${direction}`)
      const arc = textFor(svg, 'arc PQ')
      const central = textFor(svg, 'O')
      expect(arc).toBe(central)
      expect(arc).toBe(expected)
    })
  }

  it('draws the central angle mark as an arc, reflex when the arc is major', () => {
    const marks = (spec: string) => [...layer(render(spec), 'marks').matchAll(/A [^ ]+ [^ ]+ 0 ([01]) [01]/g)].map((m) => m[1])
    expect(marks(base + 'central angle P-Q on O minor')).toEqual(['0'])
    expect(marks(base + 'central angle P-Q on O major')).toEqual(['1'])
  })

  it('marks an inscribed angle at its vertex, printing what it measures', () => {
    // P (5,0) and S (-5,0) are ends of a diameter, so the angle at any other
    // point of the circle is a right angle — Thales, and a figure that got
    // this wrong would be visibly wrong.
    const svg = render(base + 'S = (-5, 0)\nR = (-3, 4)\ninscribed angle P-R-S on O')
    expect(textFor(svg, 'R')).toBe('90°')
    expect(countTags(layer(svg, 'marks'), 'path')).toBe(1)
  })

  it('refuses an inscribed angle whose vertex is not on the circle', () => {
    const parsed = parseSpec(base + 'T = (1, 1)\nS = (-5, 0)\ninscribed angle P-T-S on O')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/inscribed angle's vertex/)
  })

  it('checks a stated arc measure against the figure, like every other label', () => {
    const parsed = parseSpec(base + 'label: arc PQ on O minor = 120')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toContain('120')
    expect(result.errors[0].message).toContain('90')
  })
})

describe('a worked circle figure', () => {
  // The picture the phase exists for: a circle with a chord, the minor arc on
  // that chord shaded as a circular segment, the tangent at one end of the
  // chord, and a secant cutting the circle through the other.
  const spec =
    '@mode: figure\n@angle: degrees\n' +
    'C = (0, 0)\nO = circle C, 5\n' +
    'P = (5, 0)\nQ = (0, 5)\nR = (-3, 4)\nX = (13, 0)\n' +
    'chord P-Q on O\n' +
    'segment P-Q on O minor\n' +
    't = tangent at P on O\n' +
    'k = secant Q-R on O\n' +
    'label: arc PQ on O minor\n'

  it('draws every piece, in the right layer', () => {
    const svg = render(spec)
    // The circle itself.
    expect(countTags(layer(svg, 'primary'), 'circle')).toBe(1)
    // The chord.
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(1)
    // The shaded segment, behind everything.
    expect(countTags(layer(svg, 'regions'), 'path')).toBe(1)
    // The tangent and the secant, both constructed lines, both clipped.
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(2)
    // Every named point: the centre, the three on the circle, and the
    // external point the secant is aimed from.
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(5)
    expect(layer(svg, 'labels')).toContain('>90°</text>')
  })

  it('reports no errors at all', () => {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    expect(renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).errors).toEqual([])
  })

  it('keeps the whole figure inside the viewBox', () => {
    const svg = render(spec)
    const view = /viewBox="([^"]*)"/.exec(svg)
    if (!view) throw new Error('no viewBox')
    const [x, y, width, height] = view[1].split(' ').map(Number)
    const circle = /<circle cx="([^"]*)" cy="([^"]*)" r="([^"]*)"/.exec(layer(svg, 'primary'))
    if (!circle) throw new Error('no circle')
    const [cx, cy, r] = circle.slice(1).map(Number)
    expect(cx - r).toBeGreaterThanOrEqual(x)
    expect(cy - r).toBeGreaterThanOrEqual(y)
    expect(cx + r).toBeLessThanOrEqual(x + width)
    expect(cy + r).toBeLessThanOrEqual(y + height)
  })

  it('renders byte-identically twice', () => {
    expect(render(spec)).toBe(render(spec))
  })
})
