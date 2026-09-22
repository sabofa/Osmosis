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
