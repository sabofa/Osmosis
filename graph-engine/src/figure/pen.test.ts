import { describe, expect, it } from 'vitest'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import type { FigureLayer } from './document'
import { cleanPen, type FigurePen, type FillRegion, type StrokePath } from './pen'
import { drawFigure, renderFigure } from './render'
import type { SvgAttrs } from './svg'

// The pen is the figure renderer's one drawing seam: every element a figure
// draws goes through it, carrying its identity and its layer. The clean pen
// is today's output; a styled pen (style/) draws the same calls another way.

interface Call {
  method: 'stroke' | 'fill' | 'mark' | 'text' | 'notation' | 'panel'
  kind?: string
  id: string
  layer: FigureLayer
}

// A test double that records what it is asked to draw and draws nothing.
function recordingPen(): FigurePen & { calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    stroke: (path: StrokePath, _attrs: SvgAttrs, id, layer) => void calls.push({ method: 'stroke', kind: path.kind, id, layer }),
    fill: (region: FillRegion, _attrs: SvgAttrs, id, layer) => void calls.push({ method: 'fill', kind: region.kind, id, layer }),
    mark: (_at, _radius, _attrs, id, layer) => void calls.push({ method: 'mark', id, layer }),
    text: (_at, _text, _attrs, id, layer) => void calls.push({ method: 'text', id, layer }),
    notation: (_layout, _origin, _style, id, layer) => void calls.push({ method: 'notation', id, layer }),
    panel: (_box, _attrs, id, layer) => void calls.push({ method: 'panel', id, layer }),
    paper: () => {},
    svg: () => '<svg/>',
  }
}

const SPEC = [
  'A = (0, 0)',
  'B = (4, 0)',
  'C = (0, 3)',
  'segment: A-B',
  'segment: B-C',
  'circle: (0, 0), 1',
  'fill: A-B-C',
  'angle: B-A-C',
  'label: AB',
].join('\n')

describe('drawing through a pen', () => {
  it('sends a known figure as the expected calls, with identity and layer', () => {
    const parsed = parseSpec(SPEC)
    const pen = recordingPen()
    const { errors } = drawFigure(parsed.statements, parsed.config, LIGHT_PALETTE, pen)
    expect(errors).toEqual([])
    const geometry = pen.calls.filter((c) => c.method === 'stroke' || c.method === 'fill' || c.method === 'mark')
    expect(geometry).toEqual([
      { method: 'mark', id: '0/A', layer: 'points' },
      { method: 'mark', id: '1/B', layer: 'points' },
      { method: 'mark', id: '2/C', layer: 'points' },
      // A segment names no object of its own; an angle mark names its vertex.
      { method: 'stroke', kind: 'line', id: '3/null', layer: 'primary' },
      { method: 'stroke', kind: 'line', id: '4/null', layer: 'primary' },
      { method: 'stroke', kind: 'circle', id: '5/null', layer: 'primary' },
      { method: 'fill', kind: 'loops', id: '6/null', layer: 'regions' },
      { method: 'stroke', kind: 'arc', id: '7/A', layer: 'marks' },
    ])
    // Labels come after the geometry: the three point names and the measure.
    const labels = pen.calls.filter((c) => c.method === 'text' || c.method === 'notation')
    expect(labels.map((c) => c.layer)).toEqual(['labels', 'labels', 'labels', 'labels'])
    expect(labels.filter((c) => c.method === 'notation')).toHaveLength(1)
  })

  it('draws a solid’s edges with their own names, hidden ones beneath', () => {
    const parsed = parseSpec('S = solid prism 8 by 5 by 6')
    const pen = recordingPen()
    drawFigure(parsed.statements, parsed.config, LIGHT_PALETTE, pen)
    const strokes = pen.calls.filter((c) => c.method === 'stroke')
    expect(strokes.length).toBe(12)
    for (const call of strokes) expect(call.id).toMatch(/^0\/edge-\d+-\d+$/)
    expect(new Set(strokes.map((c) => c.layer))).toEqual(new Set(['primary', 'auxiliary']))
  })

  it('writes today’s bytes through the clean pen', () => {
    const parsed = parseSpec(SPEC)
    const pen = cleanPen(LIGHT_PALETTE)
    const { viewBox } = drawFigure(parsed.statements, parsed.config, LIGHT_PALETTE, pen)
    pen.paper(viewBox)
    expect(pen.svg(viewBox)).toBe(renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg)
  })
})

describe('a base style from the host', () => {
  it('is reported, not thrown, when it is bad, and the figure still draws', () => {
    const parsed = parseSpec(SPEC)
    const result = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, { preset: 'crayon' } as never)
    expect(result.errors.map((e) => e.message)).toEqual([expect.stringMatching(/clean, ink, pencil, marker/)])
    expect(result.svg).toBe(renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg)
  })

  it('draws clean through the clean pen when it resolves to clean', () => {
    const parsed = parseSpec(SPEC)
    const clean = renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
    expect(renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, { preset: 'clean', seed: 5 }).svg).toBe(clean)
    expect(renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE, {}).svg).toBe(clean)
  })
})

// The seam is only a seam if nothing goes round it.
const RENDER_SOURCE = import.meta.glob('./render.ts', { query: '?raw', import: 'default', eager: true })['./render.ts'] as string

describe('render.ts emits nothing itself', () => {
  const imports = RENDER_SOURCE.match(/^import[\s\S]*?from '[^']+'/gm) ?? []

  it('imports no SVG emitter', () => {
    const fromSvg = imports.filter((line) => /from '\.\/svg'/.test(line))
    for (const line of fromSvg) expect(line).not.toMatch(/\bsvg[A-Z]\w*|\bfmt\b|lineCommand|ellipticalArcCommand/)
    const all = imports.join('\n')
    expect(all).not.toMatch(/\bdrawEdge\b|\bdrawClosedEdges\b|\bnotationElements\b|\bfigureDocument\b/)
  })

  it('writes no markup by hand', () => {
    const code = RENDER_SOURCE.replace(/\/\/.*$/gm, '')
    expect(code).not.toMatch(/`<rect|'<rect|`<path|`<g/)
  })
})
