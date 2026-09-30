import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import { saturate } from '../style/color'
import { LINES, type Primitive, type Texture } from '../style/lines'
import { dashPolyline, polylineChain, sampleChain, type Chain, type Piece } from '../style/path'
import { hashString, randomFor } from '../style/random'
import { textureFilter } from '../style/textures'
import type { Style } from '../style/tokens'
import { emptyFigureLayers, FIGURE_LAYERS, figureTheme, type FigureLayer } from './document'
import { notationElements } from './notation'
import { cleanFill, regionChains, strokeChains, type FigurePen, type FillRegion } from './pen'
import { fmt, svgCircle, svgEscape, svgGroup, svgPolygon, svgText, type SvgAttrs } from './svg'

// The STYLED pen: the same calls the clean pen gets, drawn in a look.
//
// Every stroke becomes abstract chains (pen.ts), each chain goes through the
// style's line type (style/lines/) with a random source seeded by the
// element's identity and the style's seed, and the primitives that come back
// — strokes, outlines, dots — are written here as SVG, in the element's
// colour (through the style's ink and saturation) and with its identity.
// Textures are filters over whole layers, defined once in <defs>.
//
// Geometry is generated once, in the figure's own drawing coordinates; pan
// and zoom transform the finished SVG, so the wobble never reshuffles.
//
// Ids in <defs> are derived from the figure's content: every reference is
// written with a placeholder and, once the document is complete, the
// placeholder becomes a prefix hashed from the document itself. Two figures
// on one page therefore never share an id, and one figure always gets the
// same ones.

// A private-use character: no author types it, so no label can contain it.
const ID = ''

// The layers a line type's texture lies over: everything drawn with lines.
// Points and labels stay crisp.
const TEXTURED: readonly FigureLayer[] = ['regions', 'auxiliary', 'primary', 'marks']

const numberOf = (value: SvgAttrs[string], fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

// The identity attributes of a call, carried onto every element it becomes.
const identityOf = (attrs: SvgAttrs): SvgAttrs => ({ 'data-statement': attrs['data-statement'], 'data-object': attrs['data-object'] })

function attributes(a: SvgAttrs): string {
  let out = ''
  for (const key of Object.keys(a)) {
    const value = a[key]
    if (value === null || value === undefined) continue
    out += ` ${key}="${typeof value === 'number' ? fmt(value) : svgEscape(value)}"`
  }
  return out
}

// ---------------------------------------------------------------------------
// Pieces as path data
// ---------------------------------------------------------------------------

function arcCommand(rx: number, ry: number, degrees: number, delta: number, to: Vec2): string {
  return `A ${fmt(rx)} ${fmt(ry)} ${fmt(degrees)} ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta >= 0 ? 1 : 0} ${fmt(to.x)} ${fmt(to.y)}`
}

function pieceData(piece: Piece): string {
  switch (piece.kind) {
    case 'line':
      return `L ${fmt(piece.to.x)} ${fmt(piece.to.y)}`
    case 'cubic':
      return `C ${fmt(piece.c1.x)} ${fmt(piece.c1.y)} ${fmt(piece.c2.x)} ${fmt(piece.c2.y)} ${fmt(piece.to.x)} ${fmt(piece.to.y)}`
    case 'arc':
    case 'ellipticalArc': {
      // A sweep of more than half a turn is written as two commands, since
      // one "A" cannot draw a whole turn (its ends would coincide).
      const [rx, ry, rotation] = piece.kind === 'arc' ? [piece.radius, piece.radius, 0] : [piece.rx, piece.ry, piece.rotation]
      const at = (t: number): Vec2 => {
        const cos = Math.cos(rotation)
        const sin = Math.sin(rotation)
        const x = rx * Math.cos(t)
        const y = ry * Math.sin(t)
        return { x: piece.center.x + x * cos - y * sin, y: piece.center.y + x * sin + y * cos }
      }
      const delta = piece.end - piece.start
      const degrees = (rotation * 180) / Math.PI
      if (Math.abs(delta) <= Math.PI) return arcCommand(rx, ry, degrees, delta, at(piece.end))
      const mid = piece.start + delta / 2
      return `${arcCommand(rx, ry, degrees, delta / 2, at(mid))} ${arcCommand(rx, ry, degrees, delta / 2, at(piece.end))}`
    }
  }
}

function pathData(start: Vec2, pieces: readonly Piece[]): string {
  return [`M ${fmt(start.x)} ${fmt(start.y)}`, ...pieces.map(pieceData)].join(' ')
}

// Many dots as one path: each a circle drawn as two half-turn arcs.
function dotsData(dots: readonly { at: Vec2; r: number }[]): string {
  return dots
    .map(({ at, r }) => `M ${fmt(at.x - r)} ${fmt(at.y)} a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(2 * r)} 0 a ${fmt(r)} ${fmt(r)} 0 1 0 ${fmt(-2 * r)} 0`)
    .join(' ')
}

// ---------------------------------------------------------------------------
// The pen
// ---------------------------------------------------------------------------

export function styledPen(style: Style, palette: Palette): FigurePen {
  const theme = figureTheme(palette)
  const layers = emptyFigureLayers()
  const line = LINES[style.line.type]
  const texture: Texture | null = line.texture(style.line)
  const ink = style.colour.ink === 'theme' ? theme.ink : style.colour.ink
  const tint = style.paper.tint === 'theme' ? theme.background : style.paper.tint
  let paperMarkup = ''

  // A colour as the style draws it. The theme's ink becomes the style's ink,
  // the theme's paper the style's paper, and every colour — an author's own
  // "color:" too — takes the style's saturation.
  const colour = (value: SvgAttrs[string]): string | undefined => {
    if (typeof value !== 'string') return undefined
    const role = value === theme.ink ? ink : value === theme.background ? tint : value
    return saturate(role, style.colour.saturation)
  }

  // One primitive, as markup.
  const write = (primitive: Primitive, paint: string, opacity: number, identity: SvgAttrs): string => {
    switch (primitive.kind) {
      case 'stroke':
        return `<path${attributes({
          d: pathData(primitive.start, primitive.pieces),
          fill: 'none',
          stroke: paint,
          'stroke-width': primitive.width,
          'stroke-linecap': primitive.cap,
          'stroke-linejoin': 'round',
          opacity: Math.min(1, primitive.opacity * opacity),
          style: primitive.blend ? `mix-blend-mode:${primitive.blend}` : null,
          ...identity,
        })}/>`
      case 'shape':
        return svgPolygon(primitive.outline, { fill: paint, stroke: 'none', opacity: Math.min(1, primitive.opacity * opacity), ...identity })
      case 'dots':
        return `<path${attributes({ d: dotsData(primitive.dots), fill: paint, stroke: 'none', opacity: Math.min(1, primitive.opacity * opacity), ...identity })}/>`
    }
  }

  // A chain through the line type. `key` is the element's identity plus
  // which piece of it this is — the random source's seed string.
  const drawChain = (chain: Chain, width: number, key: string): Primitive[] =>
    line.draw({ chain, width, settings: style.line, random: randomFor(key, style.seed) })

  // A dashed stroke is cut into dashes first, and each dash drawn in the
  // line type: a sketchy hidden edge is a row of short sketchy strokes. The
  // pattern grows with a thick line so a marker's dashes still read as dashes.
  const dashes = (chain: Chain, pattern: readonly number[]): Chain[] => {
    const scale = Math.max(1, style.line.width)
    return dashPolyline(sampleChain(chain, 1.5), pattern.map((p) => p * scale)).map((points) => polylineChain(points))
  }

  const strokeChainsWith = (chains: readonly Chain[], attrs: SvgAttrs, id: string, layer: FigureLayer) => {
    const paint = colour(attrs.stroke) ?? ink
    const width = numberOf(attrs['stroke-width'], 1) * style.line.width
    const opacity = numberOf(attrs.opacity, 1)
    const pattern = typeof attrs['stroke-dasharray'] === 'string' ? attrs['stroke-dasharray'].split(/[\s,]+/).map(Number).filter(Number.isFinite) : []
    const identity = identityOf(attrs)
    chains.forEach((chain, c) => {
      const parts = pattern.length > 0 ? dashes(chain, pattern) : [chain]
      parts.forEach((part, d) => {
        for (const primitive of drawChain(part, width, `${id}#${c}.${d}`)) layers[layer].push(write(primitive, paint, opacity, identity))
      })
    })
  }

  return {
    stroke(path, attrs, id, layer) {
      strokeChainsWith(strokeChains(path), attrs, id, layer)
    },

    // Flat for now: the region's own path, in the style's fill opacity, with
    // its outline (when it has one) drawn in the line type.
    fill(region: FillRegion, attrs, id, layer) {
      layers[layer].push(
        cleanFill(region, {
          fill: colour(attrs.fill),
          'fill-opacity': style.fill.opacity,
          'fill-rule': attrs['fill-rule'],
          stroke: 'none',
          ...identityOf(attrs),
        })
      )
      if (attrs.stroke !== undefined && attrs.stroke !== 'none') strokeChainsWith(regionChains(region), attrs, `${id}/outline`, layer)
    },

    mark(at, radius, attrs, _id, layer) {
      layers[layer].push(svgCircle(at, radius, { ...attrs, fill: colour(attrs.fill) }))
    },

    text(at, text, attrs, _id, layer) {
      layers[layer].push(svgText(at, text, { ...attrs, fill: colour(attrs.fill) }))
    },

    notation(layout, origin, notationStyle, _id, layer) {
      layers[layer].push(
        ...notationElements(layout, origin, {
          ...notationStyle,
          fill: colour(notationStyle.fill) ?? notationStyle.fill,
          stroke: notationStyle.stroke === undefined ? undefined : (colour(notationStyle.stroke) ?? notationStyle.stroke),
        })
      )
    },

    // The givens table's box: paper-coloured, its edge drawn in the line type.
    panel(box, attrs, id, layer) {
      layers[layer].push(`<rect${attributes({ x: box.x, y: box.y, width: box.width, height: box.height, fill: colour(attrs.fill), stroke: 'none', 'data-object': attrs['data-object'] })}/>`)
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      ]
      const sides = corners.map((corner, i) => polylineChain([corner, corners[(i + 1) % 4]]))
      strokeChainsWith(sides, attrs, id, layer)
    },

    // Clean paper for now: the style's tint over the view.
    paper(viewBox) {
      paperMarkup = `<rect${attributes({ x: viewBox.x, y: viewBox.y, width: viewBox.width, height: viewBox.height, fill: tint, 'data-layer': 'paper' })}/>`
    },

    svg(viewBox) {
      const textureId = texture ? `${ID}${texture.name}` : null
      const groups = FIGURE_LAYERS.map((name) =>
        svgGroup(layers[name], { 'data-layer': name, filter: textureId && TEXTURED.includes(name) && layers[name].length > 0 ? `url(#${textureId})` : null })
      )
      const box = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`
      const region = { x: viewBox.x - viewBox.width, y: viewBox.y - viewBox.height, width: 3 * viewBox.width, height: 3 * viewBox.height }
      const defs = texture && textureId ? [textureFilter(texture, textureId, region)] : []
      const body = (defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '') + paperMarkup + groups.join('')
      // The content hash that names this figure's ids: of the body, with the
      // placeholders still in it, so it depends on nothing but the figure.
      const prefix = `f${hashString(body).toString(36)}-`
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet">${body.split(ID).join(prefix)}</svg>`
    },
  }
}

