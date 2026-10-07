// A scene as SVG (calc P2): the contact sheet's way of seeing what the engine built, headlessly, as the
// style contact sheet does for figures. It draws what the scene holds and what the viewer draws of it,
// and nothing the viewer does not: the grid and axes, each chain as a polyline, each band as a filled
// path (the viewer fills it at 0.18 as it does a region), each mark as a ring (open) or a dot (filled),
// each asymptote guide dashed and clipped to the view, and points, segments and regions as their plain
// shapes. Pure: a scene and its view in, a string out, no DOM.
//
// It does not sanitise. A number that is not finite in the scene is written as NaN or Infinity, which is
// what the contact-sheet script looks for: a sampler that let one through should be seen to.
import { resolveColor } from '../../parser/colors'
import { clipLineToBounds } from '../../render/clipLine'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../render/palette'
import type { Chain, Scene, Vec2 } from '../../scene/types'
import type { CorpusView } from './corpus'

export interface SvgOptions {
  theme?: 'light' | 'dark'
  // the radius of a mark, in the px of the view (the sheet is scaled down to a cell, so it asks for more than the viewer's 5)
  markRadius?: number
}

const hex = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`
const n = (v: number) => v.toFixed(2)

// A gridline step of 1, 2 or 5 times a power of ten that gives about eight divisions across a span.
function niceStep(span: number): number {
  const raw = span / 8
  const power = 10 ** Math.floor(Math.log10(raw))
  const mantissa = raw / power
  return (mantissa < 1.5 ? 1 : mantissa < 3.5 ? 2 : mantissa < 7.5 ? 5 : 10) * power
}

export function sceneToSvg(scene: Scene, view: CorpusView, options: SvgOptions = {}): string {
  const palette = options.theme === 'dark' ? DARK_PALETTE : LIGHT_PALETTE
  const markRadius = options.markRadius ?? 5
  const { bounds, widthPx, heightPx } = view
  const sx = widthPx / (bounds.xMax - bounds.xMin)
  const sy = heightPx / (bounds.yMax - bounds.yMin)
  const px = (x: number) => (x - bounds.xMin) * sx
  const py = (y: number) => (bounds.yMax - y) * sy
  const point = (p: Vec2) => `${n(px(p.x))},${n(py(p.y))}`
  const colorOf = (name: string | null | undefined, otherwise: number) => hex(name ? resolveColor(name) : otherwise)
  const line = (a: Vec2, b: Vec2, attrs: string) => `<line x1="${n(px(a.x))}" y1="${n(py(a.y))}" x2="${n(px(b.x))}" y2="${n(py(b.y))}" ${attrs}/>`
  const stroke = (color: string, width: number) => `stroke="${color}" stroke-width="${width}" vector-effect="non-scaling-stroke"`
  const polyline = (chain: Chain, color: string, dashed = false) => {
    const points: string[] = []
    for (let i = 0; i < chain.param.length; i++) points.push(point({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] }))
    // a closed chain does not repeat its first vertex (scene/types.ts): the polyline does, to close
    if (chain.closed && points.length > 0) points.push(points[0])
    return `<polyline points="${points.join(' ')}" fill="none" ${stroke(color, 1.6)}${dashed ? ' stroke-dasharray="7 5"' : ''} stroke-linejoin="round" stroke-linecap="round"/>`
  }

  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthPx} ${heightPx}" width="${widthPx}" height="${heightPx}" preserveAspectRatio="xMidYMid meet" role="img">`)
  parts.push(`<rect width="${widthPx}" height="${heightPx}" fill="${hex(palette.background)}"/>`)

  // the grid, and the axes where the view holds them
  const grid: string[] = []
  const stepX = niceStep(bounds.xMax - bounds.xMin)
  const stepY = niceStep(bounds.yMax - bounds.yMin)
  for (let k = Math.ceil(bounds.xMin / stepX); k * stepX <= bounds.xMax && grid.length < 400; k++) grid.push(line({ x: k * stepX, y: bounds.yMin }, { x: k * stepX, y: bounds.yMax }, stroke(hex(k === 0 ? palette.axis : palette.grid), k === 0 ? 1.2 : 1)))
  for (let k = Math.ceil(bounds.yMin / stepY); k * stepY <= bounds.yMax && grid.length < 800; k++) grid.push(line({ x: bounds.xMin, y: k * stepY }, { x: bounds.xMax, y: k * stepY }, stroke(hex(k === 0 ? palette.axis : palette.grid), k === 0 ? 1.2 : 1)))
  parts.push(`<g class="grid">${grid.join('')}</g>`)

  // regions, bands and guides under, curves over, marks on top
  for (const o of scene.objects) {
    if (o.kind === 'band') {
      for (const chain of o.outline) {
        const d = Array.from({ length: chain.param.length }, (_, i) => `${i === 0 ? 'M' : 'L'}${point({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] })}`).join('')
        parts.push(`<path class="band" d="${d}Z" fill="${colorOf(o.color, palette.curve)}" fill-opacity="0.18" stroke="none"/>`)
      }
    } else if (o.kind === 'region') {
      // one path, one subpath per ring, filled even-odd so a ring inside a ring is a hole
      const d = o.outline.map((chain) => Array.from({ length: chain.param.length }, (_, i) => `${i === 0 ? 'M' : 'L'}${point({ x: chain.xy[2 * i], y: chain.xy[2 * i + 1] })}`).join('') + 'Z').join('')
      parts.push(`<path class="region" d="${d}" fill-rule="evenodd" fill="${colorOf(o.color, palette.region)}" fill-opacity="0.18" stroke="none"/>`)
    } else if (o.kind === 'line' || o.kind === 'ray') {
      // a guide, a construction line or a ray: clipped to the view as the viewer clips it
      const through = o.kind === 'line' ? o.through : o.from
      const direction = o.kind === 'line' ? o.direction : { x: o.to.x - o.from.x, y: o.to.y - o.from.y }
      const extent = o.kind === 'line' ? o.extent : 'ray'
      const span = clipLineToBounds(through, direction, extent, bounds)
      if (span === null) continue
      const asymptote = o.kind === 'line' && o.role === 'asymptote'
      const color = colorOf(o.color, palette.muted)
      parts.push(line(span[0], span[1], `${stroke(color, 1.2)}${asymptote ? ' stroke-dasharray="6 5" data-role="asymptote"' : ''}`))
    } else if (o.kind === 'segment') {
      parts.push(line(o.from, o.to, `${stroke(colorOf(o.color, palette.segment), 1.6)}${o.dashed ? ' stroke-dasharray="6 5"' : ''}`))
    } else if (o.kind === 'segments') {
      const color = colorOf(o.color, palette.segment)
      for (const [a, b] of o.pairs) parts.push(line(a, b, `${stroke(color, 1.6)}${o.dashed ? ' stroke-dasharray="6 5"' : ''}`))
    }
  }
  for (const o of scene.objects) {
    if (o.kind === 'curve') for (const chain of o.chains) parts.push(polyline(chain, colorOf(o.color, palette.curve), o.dashed === true))
  }
  for (const o of scene.objects) {
    if (o.kind === 'mark') {
      // open: the curve does not take the value there, a ring; filled: it does, a dot
      const color = colorOf(o.color, palette.curve)
      const common = `cx="${n(px(o.at.x))}" cy="${n(py(o.at.y))}" r="${markRadius}" data-mark="${o.role}"`
      parts.push(o.fill === 'open' ? `<circle ${common} fill="none" ${stroke(color, 1.6)}/>` : `<circle ${common} fill="${color}" stroke="none"/>`)
    } else if (o.kind === 'point') {
      parts.push(`<circle cx="${n(px(o.position.x))}" cy="${n(py(o.position.y))}" r="${markRadius}" fill="${colorOf(o.color, palette.point)}" stroke="none" data-kind="point"/>`)
    }
  }
  parts.push('</svg>')
  return parts.join('')
}
