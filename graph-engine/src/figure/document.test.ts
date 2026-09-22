import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE, DARK_PALETTE } from '../render/palette'
import {
  boundsOf,
  cssColor,
  FIGURE_LAYERS,
  figureDocument,
  figureTheme,
  fitProjection,
  growRect,
  rectAround,
  unionRects,
  type FigureLayers,
} from './document'
import { svgCircle, svgLine, svgPolygon, svgText } from './svg'

function emptyLayers(): FigureLayers {
  return { regions: [], auxiliary: [], primary: [], marks: [], points: [], labels: [] }
}

describe('layer order (E1)', () => {
  it('names the six layers in painting order', () => {
    expect([...FIGURE_LAYERS]).toEqual(['regions', 'auxiliary', 'primary', 'marks', 'points', 'labels'])
  })

  it('emits a fill before a line before a label, by position in the output', () => {
    const layers = emptyLayers()
    layers.regions.push(svgPolygon([{ x: 0, y: 0 }], { fill: 'r', 'data-probe': 'fill' }))
    layers.primary.push(svgLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { 'data-probe': 'line' }))
    layers.labels.push(svgText({ x: 0, y: 0 }, 'A', { 'data-probe': 'label' }))

    const out = figureDocument(layers, { x: 0, y: 0, width: 10, height: 10 }, figureTheme(LIGHT_PALETTE))
    const fill = out.indexOf('data-probe="fill"')
    const line = out.indexOf('data-probe="line"')
    const label = out.indexOf('data-probe="label"')

    expect(fill).toBeGreaterThan(-1)
    expect(line).toBeGreaterThan(fill)
    expect(label).toBeGreaterThan(line)
  })

  it('paints in the fixed layer order regardless of the order the layers were filled in', () => {
    // The input object's own key order is reversed. If the document simply
    // walked the object it was handed, this would come out backwards — which
    // is the whole reason E1 fixes the order in the renderer rather than
    // leaving it to emission sequence.
    const reversed = {
      labels: [svgText({ x: 0, y: 0 }, 'A', { 'data-probe': 'label' })],
      points: [],
      marks: [],
      primary: [svgLine({ x: 0, y: 0 }, { x: 1, y: 1 }, { 'data-probe': 'line' })],
      auxiliary: [svgLine({ x: 0, y: 0 }, { x: 2, y: 2 }, { 'data-probe': 'aux' })],
      regions: [svgPolygon([{ x: 0, y: 0 }], { 'data-probe': 'fill' })],
    } as FigureLayers

    const out = figureDocument(reversed, { x: 0, y: 0, width: 10, height: 10 }, figureTheme(LIGHT_PALETTE))
    const at = (probe: string) => out.indexOf(`data-probe="${probe}"`)
    expect(at('fill')).toBeLessThan(at('aux'))
    expect(at('aux')).toBeLessThan(at('line'))
    expect(at('line')).toBeLessThan(at('label'))
  })

  it('emits every layer group even when empty, so a later pass can address one', () => {
    const out = figureDocument(emptyLayers(), { x: 0, y: 0, width: 10, height: 10 }, figureTheme(LIGHT_PALETTE))
    for (const layer of FIGURE_LAYERS) expect(out).toContain(`data-layer="${layer}"`)
  })

  it('carries a themed paper background rather than a transparent one', () => {
    const light = figureDocument(emptyLayers(), { x: 0, y: 0, width: 10, height: 10 }, figureTheme(LIGHT_PALETTE))
    const dark = figureDocument(emptyLayers(), { x: 0, y: 0, width: 10, height: 10 }, figureTheme(DARK_PALETTE))
    expect(light).toContain(cssColor(LIGHT_PALETTE.background))
    expect(dark).toContain(cssColor(DARK_PALETTE.background))
    expect(light).not.toBe(dark)
  })

  it('writes the viewBox it was given, and locks aspect', () => {
    const out = figureDocument(emptyLayers(), { x: -5, y: -2.5, width: 20, height: 10 }, figureTheme(LIGHT_PALETTE))
    expect(out).toContain('viewBox="-5 -2.5 20 10"')
    expect(out).toContain('preserveAspectRatio="xMidYMid meet"')
  })
})

describe('theme', () => {
  it('takes every colour from the palette rather than hardcoding one', () => {
    const theme = figureTheme(DARK_PALETTE)
    expect(theme.background).toBe(cssColor(DARK_PALETTE.background))
    expect(theme.ink).toBe(cssColor(DARK_PALETTE.axis))
    expect(theme.point).toBe(cssColor(DARK_PALETTE.point))
    expect(theme.region).toBe(cssColor(DARK_PALETTE.region))
  })

  it('writes a six-digit css hex, zero-padded', () => {
    expect(cssColor(0x00ff00)).toBe('#00ff00')
    expect(cssColor(0x000001)).toBe('#000001')
  })
})

describe('projection — world to view, 1:1', () => {
  it('uses the same scale on both axes, so a square stays square', () => {
    // A wide, short box: scaled by its width, the height must not stretch.
    const p = fitProjection({ minX: 0, minY: 0, maxX: 10, maxY: 2 })
    const a = p.toView({ x: 0, y: 0 })
    const b = p.toView({ x: 1, y: 0 })
    const c = p.toView({ x: 0, y: 1 })
    expect(Math.abs(b.x - a.x)).toBeCloseTo(Math.abs(c.y - a.y), 9)
  })

  it('flips y, because SVG counts downward and geometry counts up', () => {
    const p = fitProjection({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
    const low = p.toView({ x: 0, y: 0 })
    const high = p.toView({ x: 0, y: 10 })
    expect(high.y).toBeLessThan(low.y)
  })

  it('centres the content on the origin, so the output does not depend on where in the plane the figure sits', () => {
    const near = fitProjection({ minX: 0, minY: 0, maxX: 10, maxY: 10 })
    const far = fitProjection({ minX: 1000, minY: 1000, maxX: 1010, maxY: 1010 })
    expect(far.toView({ x: 1005, y: 1005 })).toEqual(near.toView({ x: 5, y: 5 }))
  })

  it('survives degenerate bounds — a single point has no span to scale by', () => {
    const p = fitProjection({ minX: 3, minY: 3, maxX: 3, maxY: 3 })
    const v = p.toView({ x: 3, y: 3 })
    expect(Number.isFinite(v.x)).toBe(true)
    expect(Number.isFinite(v.y)).toBe(true)
    expect(Number.isFinite(p.scale)).toBe(true)
    expect(p.scale).toBeGreaterThan(0)
  })
})

describe('auto-fit including labels (E3)', () => {
  it('contains geometry that extends asymmetrically', () => {
    const box = unionRects([rectAround({ x: 0, y: 0 }, 0, 0), rectAround({ x: 100, y: -40 }, 0, 0)])
    expect(box).toEqual({ x: 0, y: -40, width: 100, height: 40 })
  })

  it('expands to contain a label hanging off the right edge', () => {
    const geometry = { x: 0, y: 0, width: 100, height: 100 }
    const label = rectAround({ x: 110, y: 50 }, 20, 10)
    const fitted = unionRects([geometry, label])
    expect(fitted.x + fitted.width).toBeGreaterThanOrEqual(120)
    expect(fitted.x).toBeLessThanOrEqual(0)
  })

  it('applies padding on all four sides', () => {
    const padded = growRect({ x: 0, y: 0, width: 100, height: 50 }, 8)
    expect(padded).toEqual({ x: -8, y: -8, width: 116, height: 66 })
  })

  it('a label-free fit and a label-included fit differ — the second pass is not decorative', () => {
    const geometry = { x: 0, y: 0, width: 100, height: 100 }
    const withLabel = unionRects([geometry, rectAround({ x: 140, y: 50 }, 24, 12)])
    expect(withLabel).not.toEqual(geometry)
  })

  it('boundsOf spans every point it is given, and is null for none', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        { x: 1, y: 5 },
        { x: -2, y: 3 },
        { x: 4, y: -1 },
      ])
    ).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 5 })
  })
})

describe('determinism', () => {
  it('renders byte-identical markup twice from the same input', () => {
    const build = () => {
      const layers = emptyLayers()
      const p = fitProjection({ minX: -1 / 3, minY: -2 / 7, maxX: Math.PI, maxY: Math.E })
      layers.primary.push(svgLine(p.toView({ x: 0, y: 0 }), p.toView({ x: 1 / 3, y: 2 / 7 }), { stroke: 'k' }))
      layers.points.push(svgCircle(p.toView({ x: 1 / 9, y: 1 / 11 }), 3, { fill: 'p' }))
      layers.labels.push(svgText(p.toView({ x: 1 / 9, y: 1 / 11 }), 'A & B', { 'font-size': 13 }))
      const box = growRect(unionRects([rectAround(p.toView({ x: 0, y: 0 }), 10, 6)]), 12)
      return figureDocument(layers, box, figureTheme(LIGHT_PALETTE))
    }
    expect(build()).toBe(build())
  })
})
