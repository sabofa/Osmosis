import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import { deepen, saturate } from '../style/color'
import { LINES, type Primitive, type StrokeInput, type Texture } from '../style/lines'
import { dashPolyline, polylineChain, sampleChain, type Chain, type Piece } from '../style/path'
import { hashString, randomFor } from '../style/random'
import { textureFilter } from '../style/textures'
import type { LineSettings, Style } from '../style/tokens'
import { FILLS } from '../style/fills'
import { FACES, tiltFor } from '../style/lettering'
import { PAPERS } from '../style/papers'
import { emptyFigureLayers, FIGURE_LAYERS, figureTheme, type FigureLayer } from './document'
import { notationElements } from './notation'
import { cleanFill, regionChains, strokeChains, type FigurePen, type FillRegion } from './pen'
import { fmt, svgCircle, svgEscape, svgGroup, svgText, type SvgAttrs } from './svg'

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

// Fill weights (see the pen's fill): shading lines and dots are this much
// darker than the region's colour, and a solid area is drawn at this
// fraction of the fill opacity.
const SHADE_DEPTH = 0.7
const AREA_WEIGHT = 0.5
// Shading lines are sampled this far apart (drawing units): they are many and
// straight, and a figure of hatching would otherwise weigh megabytes.
const SHADING_STEP = 14

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

// Styled geometry is written to two decimals: a hundredth of a drawing unit
// is far below a pixel, and a hand-drawn figure has thousands of points, so
// the third decimal clean keeps would only add weight. Still fixed precision,
// so still byte-stable.
function dp(n: number): string {
  return fmt(Math.round(n * 100) / 100)
}

function points(list: readonly Vec2[]): string {
  return list.map((p) => `${dp(p.x)},${dp(p.y)}`).join(' ')
}

function arcCommand(rx: number, ry: number, degrees: number, delta: number, to: Vec2): string {
  return `A ${dp(rx)} ${dp(ry)} ${dp(degrees)} ${Math.abs(delta) > Math.PI ? 1 : 0} ${delta >= 0 ? 1 : 0} ${dp(to.x)} ${dp(to.y)}`
}

function pieceData(piece: Piece): string {
  switch (piece.kind) {
    case 'line':
      return `L ${dp(piece.to.x)} ${dp(piece.to.y)}`
    case 'cubic':
      return `C ${dp(piece.c1.x)} ${dp(piece.c1.y)} ${dp(piece.c2.x)} ${dp(piece.c2.y)} ${dp(piece.to.x)} ${dp(piece.to.y)}`
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
  return [`M ${dp(start.x)} ${dp(start.y)}`, ...pieces.map(pieceData)].join(' ')
}

// Many dots as one path: each a circle drawn as two half-turn arcs.
function dotsData(dots: readonly { at: Vec2; r: number }[]): string {
  return dots
    .map(({ at, r }) => `M ${dp(at.x - r)} ${dp(at.y)} a ${dp(r)} ${dp(r)} 0 1 0 ${dp(2 * r)} 0 a ${dp(r)} ${dp(r)} 0 1 0 ${dp(-2 * r)} 0`)
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
  let paperDefs: string[] = []

  // A label's group, turned by its seeded tilt (at most 4 degrees) about
  // `anchor`, which the turn does not move.
  const turned = (markup: string, anchor: Vec2, id: string): string => {
    const tilt = tiltFor(style.lettering.tilt, randomFor(`${id}/tilt`, style.seed))
    return tilt === 0 ? markup : `<g transform="rotate(${fmt(tilt)} ${fmt(anchor.x)} ${fmt(anchor.y)})">${markup}</g>`
  }

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
          d: pathData(primitive.start, primitive.pieces) + (primitive.closed ? ' Z' : ''),
          fill: 'none',
          stroke: paint,
          'stroke-width': primitive.width,
          'stroke-linecap': primitive.cap,
          'stroke-linejoin': primitive.join,
          'stroke-dasharray': primitive.dash ? primitive.dash.map(dp).join(' ') : null,
          opacity: Math.min(1, primitive.opacity * opacity),
          style: primitive.blend ? `mix-blend-mode:${primitive.blend}` : null,
          ...identity,
        })}/>`
      case 'shape':
        return `<polygon${attributes({ points: points(primitive.outline), fill: paint, stroke: 'none', opacity: Math.min(1, primitive.opacity * opacity), ...identity })}/>`
      case 'dots':
        return `<path${attributes({ d: dotsData(primitive.dots), fill: paint, stroke: 'none', opacity: Math.min(1, primitive.opacity * opacity), ...identity })}/>`
    }
  }

  // A chain through the line type. `key` is the element's identity plus
  // which piece of it this is — the random source's seed string.
  const drawChain = (chain: Chain, width: number, key: string, settings: LineSettings = style.line, step?: number, extra: Pick<StrokeInput, 'cap' | 'dash'> = {}): Primitive[] =>
    line.draw({ chain, width, settings, random: randomFor(key, style.seed), step, ...extra })

  // Textures a fill asks for (a wash's blotches, its soft rim), and the clip
  // paths that keep fill marks inside their regions — all written into
  // <defs> once the document is finished.
  const fillTextures = new Map<string, Texture>()
  const clipDefs: string[] = []
  // Keyed by name AND strength: a wash's own texture is always the same
  // strength, but the mark carries its own now (mottle's is the fill's own
  // roughness), so two different strengths of one name must not collide on
  // one id.
  const textureUrl = (texture: Texture): string => {
    const name = `${ID}${texture.name}-${dp(texture.strength)}`
    fillTextures.set(name, texture)
    return `url(#${name})`
  }

  // Hatch lines and scribbles are drawn in the current line type, a little
  // finer than an edge, with half its looseness, a single pass and less
  // grain: a shading stroke is quicker and lighter than an outline (and a
  // region of chalk hatching would otherwise be mostly dust).
  const shadingSettings: LineSettings = { ...style.line, looseness: style.line.looseness * 0.5, passes: 1, grain: style.line.grain * 0.3 }
  const shadingWidth = 1.1 * style.line.width

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
    const linecap = attrs['stroke-linecap']
    const cap = linecap === 'round' || linecap === 'butt' || linecap === 'square' ? linecap : undefined
    chains.forEach((chain, c) => {
      // A line type that dashes natively (technical) gets the whole chain and
      // the pattern, and keeps the caller's ends; every other is handed its
      // dashes one by one.
      if (line.nativeDash) {
        const dash = pattern.length > 0 ? pattern.map((p) => p * Math.max(1, style.line.width)) : undefined
        for (const primitive of drawChain(chain, width, `${id}#${c}`, style.line, undefined, { cap, dash })) layers[layer].push(write(primitive, paint, opacity, identity))
        return
      }
      const parts = pattern.length > 0 ? dashes(chain, pattern) : [chain]
      parts.forEach((part, d) => {
        for (const primitive of drawChain(part, width, `${id}#${c}.${d}`, style.line, undefined, { cap })) layers[layer].push(write(primitive, paint, opacity, identity))
      })
    })
  }

  return {
    stroke(path, attrs, id, layer) {
      strokeChainsWith(strokeChains(path), attrs, id, layer)
    },

    // A region through the style's fill (style/fills/). An area is the
    // region's own exact path; every other mark — hatch lines and scribbles
    // in the line type, stipple dots, a wash's rim — sits in a group clipped
    // to that same exact path, so nothing spills over an edge or into a hole.
    // The outline, when the region has one, is drawn in the line type.
    fill(region: FillRegion, attrs, id, layer) {
      const paint = colour(attrs.fill) ?? ink
      // Shading in lines and dots is drawn a deeper shade of the region's
      // colour, and a solid area at half the fill opacity: at the same
      // opacity a filled area reads about twice as heavy as hatching.
      const shade = deepen(paint, SHADE_DEPTH)
      const identity = identityOf(attrs)
      const opacity = style.fill.opacity
      const areaOpacity = opacity * AREA_WEIGHT
      const evenOdd = attrs['fill-rule'] === 'evenodd'
      const outline = regionChains(region)
      const { marks } = FILLS[style.fill.type].draw({ outline, settings: style.fill, random: randomFor(`${id}/fill`, style.seed) })
      const clipped: string[] = []
      for (const mark of marks) {
        switch (mark.kind) {
          case 'area': {
            const areaMarkup = cleanFill(region, {
              fill: paint,
              'fill-opacity': areaOpacity,
              'fill-rule': attrs['fill-rule'],
              stroke: 'none',
              filter: mark.texture ? textureUrl({ name: mark.texture, strength: mark.strength ?? 0.5 }) : null,
              ...identity,
            })
            // Off register (roughness): the tint drawn translated, clipped
            // back to the region's exact outline so it misses the true line
            // on one side and never spills past it on the other. Today's
            // behaviour — no shift — draws the area exactly as before.
            if (mark.shift) {
              const clip = `${ID}clip-${clipDefs.length}`
              clipDefs.push(`<clipPath id="${clip}">${cleanFill(region, { 'clip-rule': evenOdd ? 'evenodd' : null })}</clipPath>`)
              layers[layer].push(`<g clip-path="url(#${clip})"><g transform="translate(${dp(mark.shift.x)} ${dp(mark.shift.y)})">${areaMarkup}</g></g>`)
            } else {
              layers[layer].push(areaMarkup)
            }
            break
          }
          case 'lines':
            mark.chains.forEach((chain, c) => {
              for (const primitive of drawChain(chain, shadingWidth, `${id}/fill#${c}`, shadingSettings, SHADING_STEP)) clipped.push(write(primitive, shade, opacity, identity))
            })
            break
          case 'dots':
            if (mark.dots.length > 0) clipped.push(`<path${attributes({ d: dotsData(mark.dots), fill: shade, stroke: 'none', opacity, ...identity })}/>`)
            break
          case 'edge': {
            const edgeMarkup = cleanFill(region, {
              fill: 'none',
              stroke: paint,
              'stroke-width': mark.width,
              opacity: Math.min(1, mark.opacity * opacity),
              filter: textureUrl({ name: 'soften', strength: 0.5 }),
              ...identity,
            })
            // Moves with its area's own off-register shift, so the rim and
            // the tint it darkens stay together.
            clipped.push(mark.shift ? `<g transform="translate(${dp(mark.shift.x)} ${dp(mark.shift.y)})">${edgeMarkup}</g>` : edgeMarkup)
            break
          }
        }
      }
      if (clipped.length > 0) {
        const clip = `${ID}clip-${clipDefs.length}`
        clipDefs.push(`<clipPath id="${clip}">${cleanFill(region, { 'clip-rule': evenOdd ? 'evenodd' : null })}</clipPath>`)
        layers[layer].push(`<g clip-path="url(#${clip})"${attributes(identity)}>${clipped.join('')}</g>`)
      }
      if (attrs.stroke !== undefined && attrs.stroke !== 'none') strokeChainsWith(outline, attrs, `${id}/outline`, layer)
    },

    mark(at, radius, attrs, _id, layer) {
      layers[layer].push(svgCircle(at, radius, { ...attrs, fill: colour(attrs.fill) }))
    },

    // A label in the style's face and size, turned by its seeded tilt about
    // its own anchor — the point the label layout placed it at, which stays
    // exactly where it was.
    // (Its size is already the style's: render.ts lays labels out at the
    // lettering size and asks for them at it.)
    text(at, text, attrs, id, layer) {
      const element = svgText(at, text, { ...attrs, 'font-family': FACES[style.lettering.face], fill: colour(attrs.fill) })
      layers[layer].push(turned(element, at, id))
    },

    // A label with notation: the same face, and the same tilt, about the
    // middle of its glyph row. The givens table's rows are not tilted (a
    // table is set straight); their ids are "givens/…" and "…/cell-N"
    // (render.ts).
    notation(layout, origin, notationStyle, id, layer) {
      const inTable = /^givens\/|\/cell-\d+$/.test(id)
      const elements = notationElements(layout, origin, {
        ...notationStyle,
        fontFamily: FACES[style.lettering.face],
        fill: colour(notationStyle.fill) ?? notationStyle.fill,
        stroke: notationStyle.stroke === undefined ? undefined : (colour(notationStyle.stroke) ?? notationStyle.stroke),
      })
      if (inTable) layers[layer].push(...elements)
      else layers[layer].push(turned(elements.join(''), { x: origin.x + layout.width / 2, y: origin.y }, id))
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

    // The style's paper (style/papers/), under everything, covering three
    // view boxes beyond the figure on every side.
    paper(viewBox) {
      const laid = PAPERS[style.paper.type].draw({
        settings: style.paper,
        tint: colour(tint) ?? tint,
        view: viewBox,
        id: (name) => `${ID}paper-${name}`,
        colour: (hex) => saturate(hex, style.colour.saturation),
        random: randomFor('paper', style.seed),
      })
      paperDefs = laid.defs
      paperMarkup = laid.background.length > 0 ? `<g data-layer="paper">${laid.background.join('')}</g>` : ''
    },

    svg(viewBox) {
      const textureId = texture ? `${ID}${texture.name}` : null
      const groups = FIGURE_LAYERS.map((name) =>
        svgGroup(layers[name], { 'data-layer': name, filter: textureId && TEXTURED.includes(name) && layers[name].length > 0 ? `url(#${textureId})` : null })
      )
      const box = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`
      const region = { x: viewBox.x - viewBox.width, y: viewBox.y - viewBox.height, width: 3 * viewBox.width, height: 3 * viewBox.height }
      const defs = [
        ...(texture && textureId ? [textureFilter(texture, textureId, region)] : []),
        ...[...fillTextures].map(([name, used]) => textureFilter(used, name, region)),
        ...clipDefs,
        ...paperDefs,
      ]
      const body = (defs.length > 0 ? `<defs>${defs.join('')}</defs>` : '') + paperMarkup + groups.join('')
      // The content hash that names this figure's ids: of the body, with the
      // placeholders still in it, so it depends on nothing but the figure.
      const prefix = `f${hashString(body).toString(36)}-`
      // `data-style` marks a styled figure: FigureView scales its strokes
      // with the zoom, as its filled outlines already do (a clean figure's
      // strokes keep their width).
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" preserveAspectRatio="xMidYMid meet" data-style="${style.line.type}">${body.split(ID).join(prefix)}</svg>`
    },
  }
}

