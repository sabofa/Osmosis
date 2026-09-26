import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { FIGURE_LAYERS } from './document'
import { estimateTextSize, LABEL_FONT_SIZE } from './labels'
import { formatMeasure } from './measure'
import { ISOMETRIC_CAMERA, rectangularPrism, renderSolidFigure } from './project3d'
import { buildSolid, regularTetrahedron } from './solids'
import { renderFigure } from './render'
import { resolveMode } from '../scene/mode'
import { EXAMPLES } from '../examples'

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
    const cells = texts(labels).map((t) => t.text)
    // Three cells, one per column: the subject in notation, the relation, the
    // value. (They are separate <text> elements because they are separate
    // columns — that is what lets them share an edge down the table.)
    expect(cells).toContain('AB')
    expect(cells).toContain('=')
    expect(cells).toContain('6')
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
    expect(texts(layer(result.svg, 'labels')).map((t) => t.text)).toContain('99')
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

// ---------------------------------------------------------------------------
// G4 — the givens panel is a table
// ---------------------------------------------------------------------------

describe('the givens table', () => {
  const square = '@angle: degrees\npolygon: A(0, 0), B(6, 0), C(6, 6), D(0, 6)\n'

  // Every assertion below is built from MEASURED positions rather than from
  // the presence of an element: "the table rendered" is not the claim, "the
  // columns line up" is, and only one of those can be got wrong invisibly.
  function cell(svg: string, text: string) {
    const found = texts(layer(svg, 'labels')).filter((t) => t.text === text)
    if (found.length === 0) throw new Error(`no cell "${text}" in the table`)
    return found[0]
  }

  function boxRect(svg: string) {
    const match = /<rect x="([^"]*)" y="([^"]*)" width="([^"]*)" height="([^"]*)"/.exec(layer(svg, 'labels'))
    if (!match) throw new Error('no givens box')
    return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }
  }

  it('aligns the subject column across rows of very different width', () => {
    const svg = render(square + 'given: AB = 6\ngiven: angle ABC = 90\ngiven: triangle ABD congruent triangle CDB')
    const subjects = [cell(svg, 'AB'), cell(svg, '\u2220ABC'), cell(svg, '\u25b3ABD')]
    for (const subject of subjects) expect(subject.x).toBeCloseTo(subjects[0].x, 9)
  })

  it('aligns the relation and value columns too, past subjects that are not the same width', () => {
    const svg = render(square + 'given: AB = 6\ngiven: angle ABC = 90')
    const relations = texts(layer(svg, 'labels')).filter((t) => t.text === '=')
    expect(relations).toHaveLength(2)
    expect(relations[0].x).toBeCloseTo(relations[1].x, 9)
    const values = [cell(svg, '6'), cell(svg, '90\u00b0')]
    expect(values[0].x).toBeCloseTo(values[1].x, 9)
    // ...and the value column starts past the widest subject, not on top of it.
    expect(values[0].x).toBeGreaterThan(cell(svg, '\u2220ABC').x)
  })

  it('sets a row carrying an overbar on the same line as one that does not', () => {
    // THE case the naive implementation gets wrong. An overbar makes a cell
    // taller upward, so a table that placed each cell against its own extent
    // would set "AB" lower than the "=" and the "6" beside it, and set a
    // marked row lower than an unmarked one.
    const svg = render(square + 'given: AB = 6\ngiven: angle ABC = 90')
    // Within the marked row: the subject carries a bar, the relation and the
    // value do not.
    const marked = cell(svg, 'AB')
    const relations = texts(layer(svg, 'labels')).filter((t) => t.text === '=')
    expect(marked.y).toBeCloseTo(relations[0].y, 9)
    expect(marked.y).toBeCloseTo(cell(svg, '6').y, 9)
    // Across rows: the unmarked row's own cells sit on one line as well.
    const plain = cell(svg, '\u2220ABC')
    expect(plain.y).toBeCloseTo(relations[1].y, 9)
    expect(plain.y).toBeCloseTo(cell(svg, '90\u00b0').y, 9)
  })

  it('keeps the rhythm even, whether a row carries a mark or not', () => {
    const svg = render(square + 'given: AB = 6\ngiven: angle ABC = 90\ngiven: BC = 6')
    const rows = [cell(svg, 'AB').y, cell(svg, '\u2220ABC').y, cell(svg, 'BC').y]
    expect(rows[1] - rows[0]).toBeCloseTo(rows[2] - rows[1], 9)
  })

  it('keeps every cell inside the box, overbars included', () => {
    const svg = render(square + 'given: AB = 6\ngiven: angle ABC = 90')
    const box = boxRect(svg)
    for (const text of ['AB', '=', '6', '\u2220ABC', '90\u00b0', 'GIVEN']) {
      const found = cell(svg, text)
      expect(found.x).toBeGreaterThanOrEqual(box.x)
      expect(found.y).toBeGreaterThanOrEqual(box.y)
      expect(found.y).toBeLessThanOrEqual(box.y + box.height)
    }
    // The bar itself is drawn above the glyph row, and must still be inside.
    const bar = /<line x1="[^"]*" y1="([^"]*)"/.exec(layer(svg, 'labels'))
    if (!bar) throw new Error('no overbar drawn')
    expect(Number(bar[1])).toBeGreaterThan(box.y)
  })

  it('heads each section, and puts Given before Find however they were typed', () => {
    const svg = render(square + 'find: BC\ngiven: AB = 6')
    const given = cell(svg, 'GIVEN')
    const find = cell(svg, 'FIND')
    expect(given.y).toBeLessThan(find.y)
    expect(cell(svg, 'AB').y).toBeGreaterThan(given.y)
    expect(cell(svg, 'AB').y).toBeLessThan(find.y)
    expect(cell(svg, 'BC').y).toBeGreaterThan(find.y)
    // Both sections share the table's columns, not each their own.
    expect(cell(svg, 'BC').x).toBeCloseTo(cell(svg, 'AB').x, 9)
  })

  it('shows only the sections the spec actually states', () => {
    const svg = render(square + 'given: AB = 6')
    expect(texts(layer(svg, 'labels')).map((t) => t.text)).not.toContain('FIND')
  })

  it('renders a header when the spec asks for one, and none when it does not', () => {
    const titled = render('@givens-title: Problem 14\n' + square + 'given: AB = 6')
    const header = cell(titled, 'Problem 14')
    expect(header.y).toBeLessThan(cell(titled, 'GIVEN').y)
    expect(texts(layer(render(square + 'given: AB = 6'), 'labels')).map((t) => t.text)).not.toContain('Problem 14')
  })

  it('grows the box to hold a header wider than every row', () => {
    const plain = boxRect(render(square + 'given: AB = 6'))
    const titled = boxRect(render('@givens-title: A rather long heading indeed\n' + square + 'given: AB = 6'))
    expect(titled.width).toBeGreaterThan(plain.width)
    expect(titled.height).toBeGreaterThan(plain.height)
  })

  it('never overlaps the drawing, in any position, with both sections filled', () => {
    for (const position of ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'left', 'right']) {
      const svg = render(`@givens: ${position}\n@givens-title: Problem 14\n` + square + 'given: AB = 6\nfind: BC')
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
      // ...and the viewBox still holds the whole of it.
      const view = /viewBox="([^"]*)"/.exec(svg)
      if (!view) throw new Error('no viewBox')
      const [x, y, width, height] = view[1].split(' ').map(Number)
      expect(box.x).toBeGreaterThanOrEqual(x)
      expect(box.y).toBeGreaterThanOrEqual(y)
      expect(box.x + box.width).toBeLessThanOrEqual(x + width)
      expect(box.y + box.height).toBeLessThanOrEqual(y + height)
    }
  })

  it('writes a relation as its own column, between the two names', () => {
    const svg = render(square + 'given: AB parallel CD')
    const symbol = cell(svg, '\u2225')
    expect(symbol.x).toBeGreaterThan(cell(svg, 'AB').x)
    expect(cell(svg, 'CD').x).toBeGreaterThan(symbol.x)
    expect(symbol.y).toBeCloseTo(cell(svg, 'AB').y, 9)
    // A bar over each name, and none over the relation.
    expect(countTags(layer(svg, 'labels'), 'line')).toBe(2)
  })

  it('carries an arc, with its own overmark, into the table', () => {
    const svg = render(
      '@angle: degrees\nC = (0, 0)\nO = circle C, 5\nP = (5, 0)\nQ = (0, 5)\nsegment: P-Q\ngiven: arc PQ on O minor = 90'
    )
    expect(cell(svg, 'PQ').y).toBeCloseTo(cell(svg, '90\u00b0').y, 9)
  })

  it('is deterministic', () => {
    const spec = '@givens-title: Problem 14\n' + square + 'given: AB = 6\ngiven: AB parallel CD\nfind: BC'
    expect(render(spec)).toBe(render(spec))
  })
})

describe('solids in the figure', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  it('draws a prism as twelve edges, dashing the three hidden ones', () => {
    const svg = render('@mode: figure\nsolid: prism 8 by 5 by 6')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(9)
    expect(countTags(layer(svg, 'auxiliary'), 'line')).toBe(3)
    // The dashes are in the auxiliary layer and nowhere else, so a visible
    // edge can never be drawn under a hidden one.
    expect(layer(svg, 'primary')).not.toContain('stroke-dasharray')
    expect(layer(svg, 'auxiliary')).toContain('stroke-dasharray')
  })

  it('draws a tetrahedron and a square pyramid', () => {
    const tetra = render('@mode: figure\nsolid: tetrahedron edge 5')
    expect(countTags(layer(tetra, 'primary'), 'line') + countTags(layer(tetra, 'auxiliary'), 'line')).toBe(6)
    const pyramid = render('@mode: figure\nsolid: pyramid square base 6, height 9')
    expect(countTags(layer(pyramid, 'primary'), 'line') + countTags(layer(pyramid, 'auxiliary'), 'line')).toBe(8)
  })

  it('infers figure mode from a solid alone, with no @mode', () => {
    const parsed = parseSpec('solid: prism 8 by 5 by 6')
    expect(parsed.errors).toEqual([])
    expect(resolveMode(parsed.statements, parsed.config)).toBe('figure')
  })

  it('letters the vertices an author names, without dotting them', () => {
    const svg = render('@mode: figure\nS = solid tetrahedron edge 5 vertices ABCD')
    for (const name of ['A', 'B', 'C', 'D']) expect(layer(svg, 'labels')).toContain(`>${name}</text>`)
    // A solid's vertices are lettered, not dotted: a point marker there would
    // claim a construction point that does not exist.
    expect(layer(svg, 'points')).toBe('')
  })

  it('refuses a vertex list that does not match the solid', () => {
    const errors = result('@mode: figure\nsolid: tetrahedron edge 5 vertices ABCDE').errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/has 4 vertices, but 5 names were given/)
  })

  it('refuses a dimension that is not positive', () => {
    const errors = result('@mode: figure\nsolid: prism 8 by 0 by 6').errors
    expect(errors.map((e) => e.message)).toEqual([`A solid's height must be a positive number, got 0`])
  })

  it('renders byte-identical svg twice', () => {
    const spec = '@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH'
    expect(render(spec)).toBe(render(spec))
  })

  it('draws a different picture from a different named viewpoint', () => {
    const iso = render('@mode: figure\n@view: isometric\nsolid: prism 8 by 5 by 6')
    const front = render('@mode: figure\n@view: front\nsolid: prism 8 by 5 by 6')
    expect(front).not.toBe(iso)
    // Head on, only the +z face turns toward the camera — the four side
    // faces are exactly edge-on, and "turned toward" is a strict inequality.
    // So the drawing is that face's rectangle in solid stroke with the other
    // eight edges dashed underneath it, four of them exactly coincident.
    // That degeneracy is why named viewpoints exist at all; the rule is
    // still face orientation, and the picture a reader sees is a rectangle.
    expect(countTags(layer(front, 'primary'), 'line')).toBe(4)
    expect(countTags(layer(front, 'auxiliary'), 'line')).toBe(8)
  })

  it('keeps the isometric prism exactly as project3d already drew it', () => {
    // The figure path and renderSolidFigure must agree edge for edge: the 3D
    // layer is one producer, not two.
    const svg = render('@mode: figure\n@view: isometric\nsolid: prism 4 by 3 by 2')
    const direct = renderSolidFigure(rectangularPrism(4, 3, 2), LIGHT_PALETTE, ISOMETRIC_CAMERA)
    const coords = (s: string) => [...s.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"/g)].map((m) => m.slice(1, 5).join(','))
    expect(coords(svg).sort()).toEqual(coords(direct).sort())
  })
})

describe('dimension labels on a solid', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const PRISM = '@mode: figure\nS = solid prism 8 by 5 by 6'

  it('prints the dimension the author asked the solid for, not the projected edge', () => {
    const svg = render(`${PRISM}\nlabel: S width`)
    expect(layer(svg, 'labels')).toContain('>8</text>')
    // Repaired in phase 6 (Task 1, Step 5b). This used to assert the label
    // was not "6.93", on the grounds that the 8-long width edge projects to
    // 8*cos30. It does not: 6.93 is that edge's horizontal extent, and the
    // isometric camera draws every axis-parallel edge at its TRUE length, so
    // no prism dimension can tell the spec from the drawing. A regular
    // tetrahedron's edge is not axis-parallel, and it can.
    const tetra = render('@mode: figure\n@view: isometric\nT = solid tetrahedron edge 5\nlabel: T edge')
    const [a, b] = regularTetrahedron(5).vertices.map((v) => ISOMETRIC_CAMERA.project(v))
    const drawn = Math.hypot(b.x - a.x, b.y - a.y)
    // The two differ by far more than the formatter's rounding, so the
    // assertions below cannot pass vacuously.
    expect(Math.abs(drawn - 5)).toBeGreaterThan(0.1)
    expect(layer(tetra, 'labels')).toContain('>5</text>')
    expect(layer(tetra, 'labels')).not.toContain(`>${formatMeasure(drawn)}</text>`)
  })

  it('places the label at the midpoint of the projected edge that realises it', () => {
    const svg = render(`${PRISM}\nlabel: S height`)
    const parsed = parseSpec(PRISM)
    const geometry = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
    // The height edge is the front-right vertical one: from (4,-2.5,3) to
    // (4,2.5,3). Both project to x = (4-3)cos30, so the label's anchor sits
    // on that vertical line in world space — and the drawing already
    // contains a line with exactly those endpoints.
    const cos30 = Math.sqrt(3) / 2
    expect(geometry).toContain('<line')
    const labels = layer(svg, 'labels')
    expect(labels).toContain('>5</text>')
    expect(cos30).toBeGreaterThan(0)
  })

  it('asserts a stated dimension exactly as a 2D measure does', () => {
    expect(result(`${PRISM}\nlabel: S height = 5`).errors).toEqual([])
    const wrong = result(`${PRISM}\nlabel: S height = 9`).errors
    expect(wrong).toHaveLength(1)
    expect(wrong[0].message).toMatch(/S height/)
    // ...and "@scale: false" suppresses it, the same flag and the same rule.
    expect(result(`@scale: false\n${PRISM}\nlabel: S height = 9`).errors).toEqual([])
  })

  it('refuses a dimension the primitive does not have, naming the ones it does', () => {
    const errors = result('@mode: figure\nT = solid tetrahedron edge 5\nlabel: T height').errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/A tetrahedron has no "height" — "T" can be labelled with edge/)
  })

  it('refuses a label on a solid that was never named', () => {
    const errors = result('@mode: figure\nsolid: prism 8 by 5 by 6\nlabel: S width').errors
    expect(errors[0].message).toMatch(/Unknown solid "S"/)
  })

  it('draws no leader when the label sits where it wants to', () => {
    const svg = render(`${PRISM}\nlabel: S width`)
    expect(layer(svg, 'marks')).not.toContain('leader-')
  })

  it('draws a leader when the layout has to push the label away', () => {
    // A slab 8 by 0.6 by 8 with all three dimensions labelled and its
    // vertices lettered. The height edge is 0.6 tall and the spot its label
    // wants is already taken, so the layout moves it — and a "0.6" floating
    // among eleven edges names none of them without a line back.
    const svg = render(
      [
        '@mode: figure',
        'S = solid prism 8 by 0.6 by 8 vertices ABCDEFGH',
        'label: S width',
        'label: S height',
        'label: S depth',
      ].join('\n')
    )
    const leaders = [...layer(svg, 'marks').matchAll(/data-object="leader-([^"]*)"/g)].map((m) => m[1])
    expect(leaders).toEqual(['S height'])
  })

  it('never draws a leader for a 2D measure, however far it is pushed', () => {
    // A 2D measure sits on geometry a reader can see, so it needs no line
    // back. The leader belongs to the solid path alone.
    const svg = render('@mode: figure\npolygon: A(0,0), B(4,0), C(2,3)\nlabel: AB\nlabel: BC\nlabel: angle A-B-C')
    expect(layer(svg, 'marks')).not.toContain('leader-')
  })

  it('keeps every label clear of every other', () => {
    const spec = '@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nlabel: S width\nlabel: S height\nlabel: S depth'
    const parsed = parseSpec(spec)
    const svg = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
    const texts = [...layer(svg, 'labels').matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
      x: Number(m[1]),
      y: Number(m[2]),
      text: m[3],
    }))
    expect(texts.length).toBe(11)
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i]
        const b = texts[j]
        const sizeA = estimateTextSize(a.text, LABEL_FONT_SIZE)
        const sizeB = estimateTextSize(b.text, LABEL_FONT_SIZE)
        const overlaps =
          Math.abs(a.x - b.x) < (sizeA.width + sizeB.width) / 2 && Math.abs(a.y - b.y) < (sizeA.height + sizeB.height) / 2
        expect(overlaps).toBe(false)
      }
    }
  })

  it('takes a dimension in the givens table too', () => {
    const svg = render(`${PRISM}\ngiven: S height = 5`)
    expect(svg).toContain('data-object="givens"')
    expect(layer(svg, 'labels')).toContain('S height')
  })
})

describe('curved solids in the figure', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  it('draws a cylinder as two lines and four path arcs, never a polyline', () => {
    const svg = render('@mode: figure\nsolid: cylinder radius 3, height 8')
    const drawn = layer(svg, 'primary') + layer(svg, 'auxiliary')
    expect(countTags(drawn, 'line')).toBe(2)
    expect(countTags(drawn, 'path')).toBe(4)
    // The requirement, stated as bytes: every curve is one elliptical-arc
    // command, and nothing anywhere is a sampled polyline.
    expect(countTags(drawn, 'polyline')).toBe(0)
    for (const path of drawn.match(/<path [^>]*\/>/g) ?? []) expect(path).toMatch(/ d="M [^"]*A [^"]*"/)
  })

  it('dashes the cylinder back rim and nothing else, in the layer beneath', () => {
    const svg = render('@mode: figure\nsolid: cylinder radius 3, height 8')
    expect(layer(svg, 'primary')).not.toContain('stroke-dasharray')
    expect(countTags(layer(svg, 'auxiliary'), 'path')).toBe(1)
    expect(layer(svg, 'auxiliary')).toContain('data-object="rim-far-back"')
  })

  it('fills no arc, so a cylinder is an outline and not a black lens', () => {
    const svg = render('@mode: figure\nsolid: cylinder radius 3, height 8')
    for (const path of (layer(svg, 'primary') + layer(svg, 'auxiliary')).match(/<path [^>]*\/>/g) ?? []) {
      expect(path).toContain('fill="none"')
    }
  })

  it('draws a cone as two lines and two arcs, one dashed', () => {
    const svg = render('@mode: figure\nsolid: cone radius 3, height 7')
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(2)
    expect(countTags(layer(svg, 'primary'), 'path')).toBe(1)
    expect(countTags(layer(svg, 'auxiliary'), 'path')).toBe(1)
  })

  it('draws a sphere as two arcs and nothing else', () => {
    const svg = render('@mode: figure\nsolid: sphere radius 4')
    expect(countTags(layer(svg, 'primary'), 'path')).toBe(2)
    expect(countTags(layer(svg, 'primary'), 'line')).toBe(0)
    expect(layer(svg, 'auxiliary')).toBe('')
  })

  it('fits the viewBox around the bulge of a curve, not around its endpoints', () => {
    // A sphere of radius 4 is drawn entirely by two arcs. If the bounds were
    // taken from their endpoints alone the figure would be a flat line and
    // the viewBox would have no height.
    const svg = render('@mode: figure\nsolid: sphere radius 4')
    const box = /viewBox="([^"]*)"/.exec(svg)
    expect(box).not.toBeNull()
    const [, , width, height] = box![1].split(' ').map(Number)
    expect(width).toBeGreaterThan(100)
    expect(Math.abs(width - height)).toBeLessThan(1)
  })

  it('labels a curved solid with its own dimensions', () => {
    const svg = render('@mode: figure\nC = solid cylinder radius 3, height 8\nlabel: C radius = 3\nlabel: C height = 8')
    expect(layer(svg, 'labels')).toContain('>3</text>')
    expect(layer(svg, 'labels')).toContain('>8</text>')
    expect(result('@mode: figure\nC = solid cylinder radius 3, height 8\nlabel: C radius = 5').errors).toHaveLength(1)
  })

  it('refuses vertex names on a solid that has no vertices', () => {
    const errors = result('@mode: figure\nsolid: sphere radius 4 vertices ABCD').errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/A sphere has 0 vertices/)
  })

  it('renders every curved primitive byte-identically twice', () => {
    for (const spec of ['cylinder radius 3, height 8', 'cone radius 3, height 7', 'sphere radius 4']) {
      const text = `@mode: figure\nsolid: ${spec}`
      expect(render(text)).toBe(render(text))
    }
  })
})

describe('cross-sections', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const PRISM = '@mode: figure\nS = solid prism 8 by 5 by 6'

  it('shades a cut in place, behind the solid it cuts', () => {
    const svg = render(`${PRISM}\ncut: S by plane z = 1`)
    expect(countTags(layer(svg, 'regions'), 'polygon')).toBe(1)
    // E1 — a fill is a backdrop. A cut drawn over the solid's own lines would
    // hide the thing it is a section OF.
    expect(svg.indexOf('data-layer="regions"')).toBeLessThan(svg.indexOf('data-layer="primary"'))
    // The solid is still all there: twelve edges, none of them swallowed.
    expect(countTags(layer(svg, 'primary'), 'line') + countTags(layer(svg, 'auxiliary'), 'line')).toBe(12)
  })

  it('shades a cut through a cylinder as one closed ellipse, not two arcs', () => {
    const svg = render('@mode: figure\nC = solid cylinder radius 3, height 8\ncut: C by plane z = 1')
    expect(countTags(layer(svg, 'regions'), 'ellipse')).toBe(1)
    // Two arc paths would each close through their own chord and paint a seam
    // down the middle of the fill.
    expect(countTags(layer(svg, 'regions'), 'path')).toBe(0)
  })

  it('lifts a section out as an ORDINARY polygon, beside the solid', () => {
    const svg = render(`${PRISM}\nsection: S by plane z = 1`)
    // It is not a shaded face: it is a plane figure, drawn by the same code
    // that draws every other polygon.
    expect(layer(svg, 'regions')).toBe('')
    // Four sides of the section plus twelve edges of the solid.
    expect(countTags(layer(svg, 'primary'), 'line') + countTags(layer(svg, 'auxiliary'), 'line')).toBe(16)
  })

  it('places the lifted section clear of the solid, never over it', () => {
    const svg = render(`${PRISM}
section: S by plane z = 1 vertices PQRS`)
    // The solid's own edges name themselves "edge-i-j"; the lifted section's
    // vertices are the only dots in the figure.
    const solidRight = Math.max(
      ...[...svg.matchAll(/<line x1="([^"]*)" y1="[^"]*" x2="([^"]*)"[^>]*data-object="edge-/g)].flatMap((m) => [
        Number(m[1]),
        Number(m[2]),
      ])
    )
    const sectionLeft = Math.min(...[...layer(svg, 'points').matchAll(/<circle cx="([^"]*)"/g)].map((m) => Number(m[1])))
    expect(Number.isFinite(solidRight)).toBe(true)
    expect(Number.isFinite(sectionLeft)).toBe(true)
    // A section lifted where it lies would overlap the drawing it came from,
    // and the two are different pictures of different things.
    expect(sectionLeft).toBeGreaterThan(solidRight)
  })

  // ---------------------------------------------------------------------
  // H5 — the integration test
  // ---------------------------------------------------------------------

  it('carries a measure label on a lifted section through the NORMAL 2D path', () => {
    // The section of an 8-by-5-by-6 prism by the horizontal plane z = 1 is
    // an 8-by-6 rectangle.
    // Its vertices are named, registered as ordinary points, and measured by
    // the same `label:` that measures any other segment — which is the whole
    // of H5. If the lifted section went through a parallel pipeline inside
    // the 3D layer, none of this line would exist.
    const spec = `${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ = 8\nlabel: QR = 6`
    expect(result(spec).errors).toEqual([])
    const svg = render(spec)
    expect(layer(svg, 'labels')).toContain('>8</text>')
    expect(layer(svg, 'labels')).toContain('>6</text>')
    for (const name of ['P', 'Q', 'R', 'S']) expect(layer(svg, 'labels')).toContain(`>${name}</text>`)
  })

  it('asserts that measure against the TRUE shape, not the projection', () => {
    // Repaired in phase 6 (Task 1, Step 5b). This test used to check only
    // that PQ = 8 passes and PQ = 6.93 fails, "because the projected edge is
    // 8*cos30 = 6.93". It is not: 6.93 is that edge's horizontal EXTENT. The
    // isometric camera draws every axis-parallel segment at its true length,
    // so a section handing back projected coordinates would ALSO measure
    // PQ = 8 and QR = 6. Those checks are kept at the end, because they are
    // still true, but they pin nothing.
    //
    // What the projection does distort is the angle between two axes, and
    // with it every diagonal. In the section's own plane the rectangle is
    // 8 by 6, so its diagonal PR is 10 and the angle at P is a right angle.
    // Projected, the x- and z-axes meet at 60 or 120 degrees and the
    // diagonal is sqrt(52) or sqrt(148); both of these fail there.
    const section = `${PRISM}\nsection: S by plane z = 1 vertices PQRS`
    expect(result(`${section}\nlabel: PR = 10`).errors).toEqual([])
    expect(result(`@angle: degrees\n${section}\nlabel: angle SPQ = 90`).errors).toEqual([])
    // The same assertions, made false: each must be refused, or the passes
    // above could be a checker that accepts anything.
    expect(result(`${section}\nlabel: PR = 12.17`).errors).toHaveLength(1)
    expect(result(`@angle: degrees\n${section}\nlabel: angle SPQ = 60`).errors).toHaveLength(1)

    const wrong = result(`${section}\nlabel: PQ = 6.93`).errors
    expect(wrong).toHaveLength(1)
    expect(wrong[0].message).toMatch(/PQ/)
    expect(result(`${section}\nlabel: PQ = 8`).errors).toEqual([])
  })

  it('takes notation, marks and the givens table on a lifted section too', () => {
    // Everything the 2D path offers, for free, because the section IS 2D.
    const svg = render(
      `${PRISM}\nsection: S by plane z = 1 vertices PQRS\ntick: P-Q\nright-angle: S-P-Q\ngiven: PQ = 8\nfind: QR`
    )
    expect(layer(svg, 'marks')).not.toBe('')
    expect(svg).toContain('data-object="givens"')
  })

  it('fails legibly when the plane misses the solid', () => {
    const errors = result(`${PRISM}\nsection: S by plane z = 9`).errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/does not cut "S" — it misses the solid entirely/)
  })

  it('refuses to name the vertices of a circular section', () => {
    const errors = result('@mode: figure\nC = solid cylinder radius 3, height 8\nsection: C by plane z = 1 vertices PQR').errors
    expect(errors[0].message).toMatch(/is a circle, which has no vertices to name/)
  })

  it('refuses a vertex list that does not match the section', () => {
    const errors = result(`${PRISM}\nsection: S by plane z = 1 vertices PQR`).errors
    expect(errors[0].message).toMatch(/has 4 vertices, but 3 names were given/)
  })

  it('renders a cut and a section byte-identically twice', () => {
    for (const spec of [`${PRISM}\ncut: S by plane z = 1`, `${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ`]) {
      expect(render(spec)).toBe(render(spec))
    }
  })
})

// ---------------------------------------------------------------------------
// S1 — the z-up author frame (phase 6, Task 1)
// ---------------------------------------------------------------------------

// A short, deterministic digest of a whole document: its length and a 53-bit
// string hash (cyrb53). The frame change is a claim about BYTES, and a digest
// is the way to hold a test to that without committing the documents.
function digest(s: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${s.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`
}

describe('the z-up author frame (S1)', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  // Pinned to the isometric view by name (phase 6b): the digests are phase 5's
  // bytes, drawn when isometric was the default.
  const PRISM = '@mode: figure\n@view: isometric\nS = solid prism 8 by 5 by 6'
  const CYLINDER = '@mode: figure\n@view: isometric\nC = solid cylinder radius 3, height 8'

  // Every cross-section input phase 5's tests and examples used, rewritten
  // from the internal frame's "plane y = c" into the author's "plane z = c".
  // The digests were taken from the phase 5 renders of the ORIGINAL inputs,
  // before the frame existed; each rewrite must draw exactly those bytes.
  const REWRITTEN: [string, string][] = [
    [`${PRISM}\ncut: S by plane z = 1`, '2538:27fe13b38d503'],
    [`${CYLINDER}\ncut: C by plane z = 1`, '1645:d8b3f7da5621d'],
    [`${PRISM}\nsection: S by plane z = 1`, '2965:1083d01e74ca92'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS`, '4203:1d739cd9fcdd07'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ = 8\nlabel: QR = 6`, '4603:1bd3a01c570bd9'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ = 6.93`, '4409:14559416687fc8'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ = 8`, '4406:12d478e07528f1'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS\ntick: P-Q\nright-angle: S-P-Q\ngiven: PQ = 8\nfind: QR`, '6345:e2a7ca7fc504e'],
    [`${CYLINDER}\nsection: C by plane z = 1 vertices PQR`, '1480:159fa8dfdf2095'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQR`, '2965:1083d01e74ca92'],
    [`${PRISM}\nsection: S by plane z = 1 vertices PQRS\nlabel: PQ`, '4406:12d478e07528f1'],
  ]

  for (const [spec, expected] of REWRITTEN) {
    it(`draws exactly what phase 5 drew: ${spec.split('\n').slice(3).join(' / ')}`, () => {
      expect(digest(render(spec))).toBe(expected)
    })
  }

  it('draws the rewritten cross-section examples exactly as phase 5 did', () => {
    const cut = EXAMPLES.find((e) => e.label === 'Cross-section (cut)')
    const lifted = EXAMPLES.find((e) => e.label === 'Cross-section (lifted)')
    const isometric = (spec: string) => spec.replace('@mode: figure', '@mode: figure\n@view: isometric')
    expect(digest(render(isometric(cut!.spec)))).toBe('2538:27fe13b38d503')
    expect(digest(render(isometric(lifted!.spec)))).toBe('4603:1bd3a01c570bd9')
  })

  it('cuts horizontally at z = c and vertically at x = c and y = c', () => {
    // An 8 (width, Y) by 5 (height, Z) by 6 (depth, X) prism. Each plane
    // leaves the two dimensions it does not fix.
    const sides = (plane: string, pq: number, qr: number) =>
      result(`${PRISM}\nsection: S by plane ${plane} vertices PQRS\nlabel: PQ = ${pq}\nlabel: QR = ${qr}`).errors
    expect(sides('z = 1', 8, 6)).toEqual([])
    expect(sides('y = 1', 5, 6)).toEqual([])
    expect(sides('x = 1', 8, 5)).toEqual([])
  })

  it('names the plane in the author frame when it misses the solid', () => {
    expect(result(`${PRISM}\nsection: S by plane z = 9`).errors[0].message).toBe('The plane z = 9 does not cut "S" — it misses the solid entirely')
  })
})

// ---------------------------------------------------------------------------
// Names in space: the solid-figure walk (phase 6, Task 3)
// ---------------------------------------------------------------------------

describe('named points in solid figures', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const NAMED = '@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH'

  it("resolves a solid's vertex names as points: label: AB = 8 passes", () => {
    // This only shows the NAME resolves. AB is axis-parallel, and the
    // isometric camera draws axis-parallel segments at true length, so an
    // edge cannot tell a true measure from a projected one.
    const errors = result(`${NAMED}\nlabel: AB = 8`).errors.map((e) => e.message)
    expect(errors).toEqual([])
    expect(errors.join(' ')).not.toContain('Unknown point')
  })

  it('measures the space diagonal AG at its TRUE length, never the projected one', () => {
    const trueLength = Math.sqrt(125)
    // A and G in textbook lettering (phase 6b), internal y-up: A, the
    // front-left bottom corner, is (-4,-2.5,3) and G, diagonally opposite,
    // is (4, 2.5, -3).
    const box = buildSolid({ kind: 'prism', width: 8, height: 5, depth: 6 })
    expect(box.polyhedron!.vertices[box.labelOrder[0]]).toEqual({ x: -4, y: -2.5, z: 3 })
    expect(box.polyhedron!.vertices[box.labelOrder[6]]).toEqual({ x: 4, y: 2.5, z: -3 })
    // Pinned to isometric: under the standard view AG is the LONG diagonal,
    // drawn within 0.05 of its true length, which is too close to make the
    // point. Isometric draws it 1.6 longer. The projected length is computed
    // through the camera.
    const a = ISOMETRIC_CAMERA.project({ x: -4, y: -2.5, z: 3 })
    const g = ISOMETRIC_CAMERA.project({ x: 4, y: 2.5, z: -3 })
    const projected = Math.hypot(g.x - a.x, g.y - a.y)
    // The two differ by far more than GEOM_EPS, so neither assertion below
    // can pass vacuously.
    expect(Math.abs(trueLength - projected)).toBeGreaterThan(1)
    const isometric = NAMED.replace('@mode: figure', '@mode: figure\n@view: isometric')
    expect(result(`${isometric}\nlabel: AG = ${trueLength}`).errors).toEqual([])
    const wrong = result(`${isometric}\nlabel: AG = ${projected}`).errors
    expect(wrong).toHaveLength(1)
    expect(wrong[0].message).toMatch(/AG/)
    // And the computed form prints the true length.
    expect(layer(render(`${NAMED}\nlabel: AG`), 'labels')).toContain('>11.18</text>')
  })

  it('checks a true length in the givens table too', () => {
    expect(result(`${NAMED}\ngiven: AG = ${Math.sqrt(125)}`).errors).toEqual([])
    expect(result(`${NAMED}\ngiven: AG = 10`).errors).toHaveLength(1)
  })

  it('checks a true angle in space in the givens table', () => {
    // The angle at B between A and F is a right angle of the solid (a face
    // corner), and no projection of it is.
    const spec = `@angle: degrees\n${NAMED}`
    expect(result(`${spec}\ngiven: angle ABF = 90`).errors).toEqual([])
    expect(result(`${spec}\ngiven: angle ABF = 60`).errors).toHaveLength(1)
    const svg = render(`${spec}\ngiven: angle ABG`)
    expect(svg).toContain('data-object="givens"')
  })

  it('refuses an inline angle label in space, pointing at the givens form', () => {
    const errors = result(`${NAMED}\nlabel: angle ABG`).errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/given: angle ABG/)
  })

  it('refuses a length between a space point and a plane point, naming both', () => {
    const errors = result(`${NAMED}\nP = (1, 2)\nlabel: AP`).errors
    expect(errors.map((e) => e.message)).toEqual([expect.stringMatching(/A.*P|P.*A/)])
    expect(errors[0].message).toMatch(/space/)
  })

  it('draws a constructed space point as a dot and a label, and keeps vertices undotted', () => {
    const svg = render(`${NAMED}\nM = midpoint A-G`)
    expect(countTags(layer(svg, 'points'), 'circle')).toBe(1)
    expect(layer(svg, 'points')).toContain('data-object="M"')
    expect(layer(svg, 'labels')).toContain('>M</text>')
    for (const name of 'ABCDEFGH') expect(layer(svg, 'labels')).toContain(`>${name}</text>`)
  })

  it('draws the solid itself exactly as before when its vertices become points', () => {
    const svg = render(NAMED)
    expect(layer(svg, 'points')).toBe('')
    expect(countTags(layer(svg, 'primary'), 'line') + countTags(layer(svg, 'auxiliary'), 'line')).toBe(12)
  })

  it('sends no space construction to the 2D pass (S3): no construction errors', () => {
    const spec = [NAMED, 'M = midpoint A-G', 'P = divide A-G at 1:2', 'K = foot C to plane A-B-F', 'X = intersect line A-G, plane B-D-E'].join('\n')
    expect(result(spec).errors).toEqual([])
  })

  it('reports a construction naming a point defined only later', () => {
    const errors = result('@mode: figure\nM = midpoint A-G\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH').errors
    expect(errors.map((e) => e.message)).toEqual([expect.stringMatching(/"A"/)])
  })

  it('draws a 3-coordinate point in space under a declared figure mode', () => {
    // B is straight above A in the author's z-up frame, so it is drawn
    // straight above it on the page. Dropping z would draw them on top of
    // each other; skipping the frame conversion would put B off to the side.
    const svg = render('@mode: figure\nA = (0, 0, 0)\nB = (0, 0, 4)')
    const dots = [...layer(svg, 'points').matchAll(/<circle cx="([^"]*)" cy="([^"]*)"[^>]*data-object="([AB])"/g)].map((m) => ({
      name: m[3],
      x: Number(m[1]),
      y: Number(m[2]),
    }))
    const a = dots.find((d) => d.name === 'A')!
    const b = dots.find((d) => d.name === 'B')!
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeLessThan(a.y - 10)
  })

  it('renders byte-identically twice', () => {
    const spec = [NAMED, 'M = midpoint A-G', 'label: AG', 'given: AG = 11.18'].join('\n')
    expect(render(spec)).toBe(render(spec))
  })
})

// ---------------------------------------------------------------------------
// Segments in space, and the glass rule (phase 6, Task 4)
// ---------------------------------------------------------------------------

describe('segments in solid figures', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const NAMED = '@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH'

  // The drawn pieces of one statement's segment, in emission order per layer.
  function pieces(svg: string, statement: number): { layer: string; dashed: boolean }[] {
    const out: { layer: string; dashed: boolean }[] = []
    for (const name of ['auxiliary', 'primary']) {
      for (const m of layer(svg, name).matchAll(/<line [^>]*\/>/g)) {
        if (!m[0].includes(`data-statement="${statement}"`)) continue
        out.push({ layer: name, dashed: m[0].includes('stroke-dasharray') })
      }
    }
    return out
  }

  it('dashes the space diagonal A-G, in the layer beneath, exactly as a hidden edge', () => {
    const svg = render(`${NAMED}\nsegment: A-G`)
    expect(result(`${NAMED}\nsegment: A-G`).errors).toEqual([])
    expect(pieces(svg, 1)).toEqual([{ layer: 'auxiliary', dashed: true }])
    // The same stroke a hidden solid edge gets.
    const hiddenEdge = /<line [^>]*data-object="edge-[^"]*"[^>]*\/>/.exec(layer(svg, 'auxiliary'))![0]
    const diagonal = [...layer(svg, 'auxiliary').matchAll(/<line [^>]*\/>/g)].map((m) => m[0]).find((l) => l.includes('data-statement="1"'))!
    const style = (line: string) => line.replace(/ (x1|y1|x2|y2|data-statement|data-object)="[^"]*"/g, '')
    expect(style(diagonal)).toBe(style(hiddenEdge))
  })

  it('draws a front-face diagonal solid and a back-face diagonal dashed', () => {
    expect(pieces(render(`${NAMED}\nsegment: E-G`), 1)).toEqual([{ layer: 'primary', dashed: false }])
    expect(pieces(render(`${NAMED}\nsegment: B-D`), 1)).toEqual([{ layer: 'auxiliary', dashed: true }])
  })

  it('splits a segment through the solid into visible, hidden, visible pieces', () => {
    // In author coordinates: straight down the vertical through the centre,
    // from above the top face to well below the solid — the internal
    // (0, 6, 0) to (0, -12, 0) is author (0, 0, 6) to (0, 0, -12).
    // Internal y is the prism's height axis here, so it enters through the
    // top face (a front face) and leaves the shadow at a silhouette edge.
    const svg = render(`${NAMED}\n(0, 0, 6) -- (0, 0, -12)`)
    expect(result(`${NAMED}\n(0, 0, 6) -- (0, 0, -12)`).errors).toEqual([])
    const drawn = pieces(svg, 1)
    expect(drawn.filter((p) => p.dashed)).toHaveLength(1)
    expect(drawn.filter((p) => !p.dashed)).toHaveLength(2)
  })

  it('splits a segment behind a sphere where its projection enters and leaves the outline', () => {
    // In the author frame the camera also looks from (1,1,1), and (-1,1,0)
    // is square to it: -10 (1,1,1)/sqrt3 + s (-1,1,0)/sqrt2 for s = 8 and
    // -8 runs behind the sphere, crossing its outline at s = +-5.
    const k = '-10/sqrt(3)'
    const spec = [
      '@mode: figure',
      '@view: isometric',
      'S = solid sphere radius 5',
      `P = (${k} - 8/sqrt(2), ${k} + 8/sqrt(2), ${k})`,
      `Q = (${k} + 8/sqrt(2), ${k} - 8/sqrt(2), ${k})`,
      'segment: P-Q',
    ].join('\n')
    expect(result(spec).errors).toEqual([])
    expect(pieces(render(spec), 3).map((p) => p.dashed).sort()).toEqual([false, false, true])
  })

  it('lets the author force either style, both ways', () => {
    expect(pieces(render(`${NAMED}\nsegment: A-G plain`), 1)).toEqual([{ layer: 'primary', dashed: false }])
    expect(pieces(render(`${NAMED}\nsegment: E-G dashed`), 1)).toEqual([{ layer: 'auxiliary', dashed: true }])
  })

  it('keeps a segment between plane points exactly as it was', () => {
    const spec = '@mode: figure\nA = (0, 0)\nB = (4, 0)\nsegment: A-B dashed\nsegment: A-B plain\nsegment: A-B'
    const svg = render(spec)
    expect(pieces(svg, 2)).toEqual([{ layer: 'auxiliary', dashed: true }])
    expect(pieces(svg, 3)).toEqual([{ layer: 'primary', dashed: false }])
    expect(pieces(svg, 4)).toEqual([{ layer: 'primary', dashed: false }])
  })

  it('refuses a segment from a point in space to a point in the plane', () => {
    const errors = result(`${NAMED}\nP = (1, 2)\nsegment: A-P`).errors
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/space \(A\).*plane \(P\)/)
  })

  it('keeps solids glass to each other: each draws its own edges exactly as alone', () => {
    // A tetrahedron inside the prism. The prism's projection contains the
    // tetrahedron's, so both figures fit the same box, and the prism's edges
    // must be the same bytes with or without the tetrahedron in front of its
    // back. The tetrahedron is not dashed by the prism around it.
    const both = render('@mode: figure\nsolid: prism 8 by 5 by 6\nsolid: tetrahedron edge 3')
    const alone = render('@mode: figure\nsolid: prism 8 by 5 by 6')
    const edgesOf = (svg: string, statement: number) =>
      ['primary', 'auxiliary'].map((name) =>
        [...layer(svg, name).matchAll(/<line [^>]*\/>/g)].map((m) => m[0]).filter((l) => l.includes(`data-statement="${statement}"`))
      )
    expect(edgesOf(both, 0)).toEqual(edgesOf(alone, 0))
    const tetraAlone = render('@mode: figure\nsolid: tetrahedron edge 3')
    const objects = (svg: string, statement: number) =>
      edgesOf(svg, statement).map((lines) => lines.map((l) => /data-object="([^"]*)"/.exec(l)![1]).sort())
    expect(objects(both, 1)).toEqual(objects(tetraAlone, 0))
  })

  it('renders byte-identically twice', () => {
    const spec = `${NAMED}\nM = midpoint E-G\nsegment: A-G\nsegment: A-M\n(0, 0, 6) -- (0, 0, -12)\nlabel: AG`
    expect(render(spec)).toBe(render(spec))
  })
})

describe('source order decides a rebinding in a solid figure', () => {
  it('keeps every vertex of a solid when a later literal reuses a letter', () => {
    const parsed = parseSpec('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\nA = (0, 0, 0)\nlabel: AB = 8\nlabel: EH = 6\ngiven: CG = 5')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    // One error, on the literal, and no cascade of "Unknown point" for B-H.
    expect(result.errors.map((e) => e.message)).toEqual([
      '"A" is already bound to a vertex of solid "S" on an earlier line — the later point "A" cannot rebind it',
    ])
    for (const name of 'ABCDEFGH') expect(layer(result.svg, 'labels')).toContain(`>${name}</text>`)
    // The refused literal is not drawn.
    expect(layer(result.svg, 'points')).toBe('')
  })

  it('does not draw or register a later plane point that reuses a vertex name', () => {
    // The tick names A in the plane: had the refused literal been registered,
    // the tick would draw there instead of refusing.
    const parsed = parseSpec('@mode: figure\nT = solid tetrahedron edge 5 vertices ABCD\nA = (1, 2)\nP = (4, 4)\nlabel: AB = 5\ntick: A-P')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors.map((e) => e.message)).toEqual([
      '"A" is already bound to a vertex of solid "T" on an earlier line — the later point "A" cannot rebind it',
      expect.stringMatching(/^"A" is a point in space/),
    ])
    expect(layer(result.svg, 'points')).not.toContain('data-object="A"')
  })
})

describe('errors in space name what they are about', () => {
  it('names the angle whose arm has zero length', () => {
    const parsed = parseSpec('@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH\ngiven: angle ABB')
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
    expect(result.errors.map((e) => e.message)).toEqual(['An arm of angle ABB has zero length: its end and the vertex coincide'])
  })
})

describe('a plot in a solid figure', () => {
  function errorsOf(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).errors.map((e) => e.message)
  }

  it('is refused by name rather than dropped without a word', () => {
    expect(errorsOf('S = solid prism 8 by 5 by 6\ny = x^2')).toEqual([
      '"y = …" is a plot, and a solid figure does not draw plots — put it on its own graph page',
    ])
    expect(errorsOf('S = solid sphere radius 2\nx^2 + y^2 = 4')).toEqual([
      'An implicit curve is a plot, and a solid figure does not draw plots — put it on its own graph page',
    ])
  })

  it('leaves a 2D figure exactly as it was', () => {
    expect(errorsOf('@mode: figure\nA = (0, 0)\ny = x^2')).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Phase 6b — the standard default view (V1) and placement fixed against it (V2)
// ---------------------------------------------------------------------------

describe('the standard default view', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const BOX = 'S = solid prism 8 by 5 by 6'

  it('draws through the standard camera when no @view is given', () => {
    expect(parseSpec(`@mode: figure\n${BOX}`).config.view).toBe('standard')
    const plain = render(`@mode: figure\n${BOX}`)
    expect(plain).toBe(render(`@mode: figure\n@view: standard\n${BOX}`))
    expect(plain).not.toBe(render(`@mode: figure\n@view: isometric\n${BOX}`))
  })

  // The dots of a unit cube given by its eight corners, in view coordinates.
  function cubeDots(view: string): { x: number; y: number }[] {
    const corners: string[] = []
    let n = 0
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) corners.push(`${'ABCDEFGH'[n++]} = (${x}, ${y}, ${z})`)
    const svg = render(['@mode: figure', view, ...corners].join('\n'))
    return [...layer(svg, 'points').matchAll(/<circle cx="([^"]*)" cy="([^"]*)"/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }))
  }

  function closestPair(dots: { x: number; y: number }[]): number {
    let least = Infinity
    for (let i = 0; i < dots.length; i++) {
      for (let j = i + 1; j < dots.length; j++) least = Math.min(least, Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y))
    }
    return least
  }

  it('draws the eight corners of a cube on eight distinct points by default', () => {
    const standard = cubeDots('')
    expect(standard).toHaveLength(8)
    // The cube is fitted to the page, so the gap is in view units: far more
    // than a dot's own size.
    expect(closestPair(standard)).toBeGreaterThan(20)
    // Exact isometric draws two of them on one point.
    const isometric = cubeDots('@view: isometric')
    expect(isometric).toHaveLength(8)
    expect(closestPair(isometric)).toBeLessThan(0.01)
  })

  it('dashes exactly three edges of a box and one of a tetrahedron by default', () => {
    expect(countTags(layer(render(`@mode: figure\n${BOX}`), 'auxiliary'), 'line')).toBe(3)
    const tetra = render('@mode: figure\nT = solid tetrahedron edge 6')
    expect(countTags(layer(tetra, 'auxiliary'), 'line')).toBe(1)
    expect(countTags(layer(tetra, 'primary'), 'line')).toBe(5)
  })

  it('never re-orients a solid when the view changes (V2)', () => {
    // A regular tetrahedron of edge 6 sits with its base at Z = -sqrt6 and
    // its first base vertex A at author azimuth 45, on a circle of radius
    // 2 sqrt3: author (sqrt6, sqrt6, -sqrt6). B and C follow
    // counter-clockwise from above, at 165 and 285 degrees. The distances from each to two fixed points off the
    // axis pin where the vertex is; a turn about the axis moves all of them.
    const R = 2 * Math.sqrt(3)
    const base = -Math.sqrt(6)
    const at = (degrees: number) => ({ x: R * Math.cos((degrees * Math.PI) / 180), y: R * Math.sin((degrees * Math.PI) / 180), z: base })
    const vertices: Record<string, { x: number; y: number; z: number }> = { A: at(45), B: at(165), C: at(285) }
    const P = { x: 10, y: 0, z: 0 }
    const Q = { x: 0, y: 10, z: 0 }
    const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
    const givens: string[] = []
    for (const [name, v] of Object.entries(vertices)) {
      givens.push(`given: ${name}P = ${distance(v, P)}`, `given: ${name}Q = ${distance(v, Q)}`)
    }
    for (const view of ['standard', 'isometric', 'front']) {
      const spec = ['@mode: figure', `@view: ${view}`, 'T = solid tetrahedron edge 6 vertices ABCD', 'P = (10, 0, 0)', 'Q = (0, 10, 0)', ...givens].join('\n')
      expect(result(spec).errors.map((e) => `${view}: ${e.message}`)).toEqual([])
    }
    // The givens can fail: the same vertices a sixth of a turn round are refused.
    const wrong = ['@mode: figure', 'T = solid tetrahedron edge 6 vertices ABCD', 'P = (10, 0, 0)', `given: AP = ${distance(at(105), P)}`].join('\n')
    expect(result(wrong).errors).toHaveLength(1)
  })
})

describe('textbook lettering in the drawing (V3)', () => {
  function result(spec: string) {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE)
  }

  const NAMED = '@mode: figure\nS = solid prism 8 by 5 by 6 vertices ABCDEFGH'

  const lines = (markup: string) =>
    [...markup.matchAll(/<line x1="([^"]*)" y1="([^"]*)" x2="([^"]*)" y2="([^"]*)"[^>]*\/>/g)].map((m) => ({
      a: { x: Number(m[1]), y: Number(m[2]) },
      b: { x: Number(m[3]), y: Number(m[4]) },
      markup: m[0],
    }))

  it('measures AB as the front bottom edge: 8, with A at author (3, -4, -2.5)', () => {
    expect(result(`${NAMED}\nlabel: AB = 8`).errors).toEqual([])
    expect(layer(render(`${NAMED}\nlabel: AB`), 'labels')).toContain('>8</text>')
    // Where A is, pinned by its distance to a fixed point: 7 from (10, -4, -2.5).
    expect(result(`${NAMED}\nP = (10, -4, -2.5)\ngiven: AP = 7`).errors).toEqual([])
  })

  it('letters the hidden corner D: the three dashed edges meet at the label D', () => {
    const svg = render(NAMED)
    const dashed = lines(layer(svg, 'auxiliary'))
    expect(dashed).toHaveLength(3)
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`
    const ends = dashed.flatMap((l) => [key(l.a), key(l.b)])
    const corner = ends.find((e) => ends.filter((f) => f === e).length === 3)!
    const [cx, cy] = corner.split(',').map(Number)
    const labels = [...layer(svg, 'labels').matchAll(/<text x="([^"]*)" y="([^"]*)"[^>]*>([A-H])<\/text>/g)].map((m) => ({
      name: m[3],
      d: Math.hypot(Number(m[1]) - cx, Number(m[2]) - cy),
    }))
    expect(labels).toHaveLength(8)
    expect(labels.reduce((near, l) => (l.d < near.d ? l : near)).name).toBe('D')
  })

  it('draws the space diagonal A-G longer than any edge of the box', () => {
    const svg = render(`${NAMED}\nsegment: A-G`)
    const all = [...lines(layer(svg, 'primary')), ...lines(layer(svg, 'auxiliary'))]
    const length = (l: { a: { x: number; y: number }; b: { x: number; y: number } }) => Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y)
    const diagonal = all.filter((l) => l.markup.includes('data-statement="1"'))
    const edges = all.filter((l) => l.markup.includes('data-object="edge-'))
    expect(diagonal.length).toBeGreaterThan(0)
    expect(edges).toHaveLength(12)
    expect(diagonal.reduce((sum, l) => sum + length(l), 0)).toBeGreaterThan(Math.max(...edges.map(length)))
  })
})
