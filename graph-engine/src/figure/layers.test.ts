import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../examples'
import { parseSpec } from '../parser/parseSpec'
import { LIGHT_PALETTE } from '../render/palette'
import { FIGURE_LAYER_SPECS, splitFigureSvg, type LayerSpec } from './layers'
import { renderFigure } from './render'

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-style="ink">${body}</svg>`
const group = (name: string, inner = '<path d="M0 0"/>') => `<g data-layer="${name}">${inner}</g>`
const names = (parts: { name: string }[]) => parts.map((p) => p.name)

describe('FIGURE_LAYER_SPECS', () => {
  it('is paper, shading, drawing, bottom to top, and every renderer group belongs to one', () => {
    expect(names([...FIGURE_LAYER_SPECS])).toEqual(['paper', 'shading', 'drawing'])
    const owned = FIGURE_LAYER_SPECS.flatMap((s) => s.groups)
    for (const g of ['paper', 'regions', 'auxiliary', 'primary', 'marks', 'points', 'labels']) expect(owned).toContain(g)
    expect(new Set(owned).size).toBe(owned.length)
  })
})

describe('splitFigureSvg', () => {
  const body =
    '<defs><filter id="f"/></defs>' +
    group('paper') +
    group('regions', '<g><g><path/></g></g>') +
    group('auxiliary') +
    group('primary') +
    group('labels', '<text>a</text>')

  it('makes one svg per layer that has anything, in layer order, each marked with its layer', () => {
    const parts = splitFigureSvg(svg(body))
    expect(names(parts)).toEqual(['paper', 'shading', 'drawing'])
    parts.forEach((p) => {
      expect(p.svg.startsWith('<svg ')).toBe(true)
      expect(p.svg.endsWith('</svg>')).toBe(true)
      expect(p.svg).toContain(`data-figure-layer="${p.name}"`)
      expect(p.svg).toContain('viewBox="0 0 10 10"')
      expect(p.svg).toContain('data-style="ink"')
    })
  })

  it('gives each layer its own groups, whole, with nested groups intact', () => {
    const [paper, shading, drawing] = splitFigureSvg(svg(body)).map((p) => p.svg)
    expect(paper).toContain('data-layer="paper"')
    expect(paper).not.toContain('data-layer="regions"')
    expect(shading).toContain('<g data-layer="regions"><g><g><path/></g></g></g>')
    expect(shading).not.toContain('data-layer="primary"')
    for (const g of ['auxiliary', 'primary', 'labels']) expect(drawing).toContain(`data-layer="${g}"`)
    expect(drawing).toContain('<text>a</text>')
  })

  it('gives every layer a copy of the defs, so a layer can use what the figure defined', () => {
    for (const p of splitFigureSvg(svg(body))) expect(p.svg).toContain('<defs><filter id="f"/></defs>')
  })

  it('leaves out a layer with nothing in it (a clean figure has no paper)', () => {
    const parts = splitFigureSvg(svg(group('regions') + group('primary')))
    expect(names(parts)).toEqual(['shading', 'drawing'])
  })

  it('puts a group no layer claims in the last layer, so nothing is lost', () => {
    const parts = splitFigureSvg(svg(group('primary') + group('mystery', '<circle r="1"/>')))
    expect(names(parts)).toEqual(['drawing'])
    expect(parts[0].svg).toContain('data-layer="mystery"')
  })

  it('keeps the order of groups inside a layer as the renderer wrote them', () => {
    const [drawing] = splitFigureSvg(svg(group('labels') + group('primary'))).map((p) => p.svg)
    expect(drawing.indexOf('data-layer="labels"')).toBeLessThan(drawing.indexOf('data-layer="primary"'))
  })

  it('makes a fourth layer with one more entry', () => {
    const specs: LayerSpec[] = [
      { name: 'paper', groups: ['paper'], commit: 'motion', overscan: 0.3 },
      { name: 'notes', groups: ['labels'], commit: 'motion', overscan: 0.3 },
      { name: 'drawing', groups: ['primary'], commit: 'motion', overscan: 0.3 },
    ]
    const parts = splitFigureSvg(svg(group('paper') + group('primary') + group('labels')), specs)
    expect(names(parts)).toEqual(['paper', 'notes', 'drawing'])
  })

  it('returns the markup whole, as the last layer, when it is not an svg it can split', () => {
    const parts = splitFigureSvg('not an svg')
    expect(parts).toEqual([{ name: 'drawing', svg: 'not an svg', spec: FIGURE_LAYER_SPECS[2] }])
  })

  it('does not count a self-closing group or escaped text as nesting', () => {
    const parts = splitFigureSvg(svg('<g data-layer="paper"/>' + group('primary', '<text>a &lt; b</text>')))
    expect(names(parts)).toEqual(['paper', 'drawing'])
  })
})

describe('splitFigureSvg on real figures', () => {
  const square = EXAMPLES.find((e) => e.label === 'Square minus its circle')!.spec
  const render = (spec: string) => {
    const parsed = parseSpec(spec)
    expect(parsed.errors).toEqual([])
    return renderFigure(parsed.statements, parsed.config, LIGHT_PALETTE).svg
  }
  const tags = (markup: string) => (markup.match(/</g) ?? []).length

  for (const [label, spec] of [
    ['clean', square],
    ['ink crosshatch on rough graph paper', `@style: ink
@style-fill: crosshatch
@style-paper: rough-graph
${square}`],
    ['chalk hatch', `@style: pencil
@style-line: chalk
@style-fill: hatch
${square}`],
  ] as const) {
    it(`loses and repeats nothing: ${label}`, () => {
      const whole = render(spec)
      const parts = splitFigureSvg(whole)
      expect(parts.length).toBeGreaterThan(0)
      // Each part is a root (open and close) and the defs, around its own
      // groups; so everything but those repeats is the original, once.
      const defs = /<defs>.*?<\/defs>/s.exec(whole)?.[0] ?? ''
      const repeated = 2 + tags(defs)
      const total = parts.reduce((sum, part) => sum + tags(part.svg), 0)
      expect(total - (parts.length - 1) * repeated).toBe(tags(whole))
      // And every renderer group is in exactly one part.
      for (const group of ['paper', 'regions', 'auxiliary', 'primary', 'marks', 'points', 'labels']) {
        const inWhole = whole.includes(`data-layer="${group}"`)
        expect(parts.filter((part) => part.svg.includes(`data-layer="${group}"`)).length).toBe(inWhole ? 1 : 0)
      }
    })
  }

  it('puts the shading of a styled figure in its own layer, apart from the drawing', () => {
    const parts = splitFigureSvg(render(`@style: ink
@style-fill: crosshatch
${square}`))
    const shading = parts.find((part) => part.name === 'shading')
    const drawing = parts.find((part) => part.name === 'drawing')
    expect(shading?.svg).toContain('data-layer="regions"')
    expect(drawing?.svg).not.toContain('data-layer="regions"')
    expect(shading?.spec.commit).toBe('rest')
  })
})
