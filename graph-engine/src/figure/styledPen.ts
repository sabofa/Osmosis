import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import { DARK_PAGE, deepenFrom, fromOklch, saturate, toOklch } from '../style/color'
import { LINES, type Primitive, type StrokeInput, type Texture } from '../style/lines'
import type { MediumSettings } from '../style/media'
import { dashPolyline, polylineChain, sampleChain, type Chain, type Piece } from '../style/path'
import { hashString, randomFor } from '../style/random'
import { textureFilter } from '../style/textures'
import type { LineSettings, Style } from '../style/tokens'
import { FILLS } from '../style/fills'
import { FACES, tiltFor } from '../style/lettering'
import { PAPERS } from '../style/papers'
import { drawnContrast } from '../style/theme/contrast'
import type { RoleKey, ThemeInput } from '../style/theme/types'
import { emptyFigureLayers, FIGURE_LAYERS, figureTheme, type FigureLayer } from './document'
import { figureMedium, paperColour } from './medium'
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
// COLOUR. A style whose medium is clean draws the colours it is given, as it always has. Any
// other medium (style/media/) draws every role in its own colour: a call's role comes from what
// is being drawn (a stroke in the auxiliary layer is an auxiliary line, one in the marks layer is
// a measure, a dot is a point, a label is a label, the givens table is the givens, a region's
// area is a fill and its hatching its shading), and a colour that is not the role's own is an
// author's, which the medium fits like any other. Each is laid at the medium's opacity
// (figure/medium.ts). For a stroke that opacity is the line type's STRENGTH: it replaces the
// line type's own factor (a pencil pass's 0.8 to 0.95, a marker's 0.82, chalk's 0.85) instead of
// multiplying it, so a medium's contrast floors hold for the stroke as drawn at the style's
// default line opacity. The style's own line and fill opacity still multiply on top: that is the
// author's dial, and no floor is promised below it. A point, a label and the marks the fill draws
// itself (areas, dots, a wash's rim) take the medium's opacity as they are.
//
// THE BACKDROP EXEMPTION. The medium's contrast floors are promised to what a reader has to read: lines,
// auxiliary and hidden lines, labels, points, measures and the givens table, each as drawn (its colour at
// the opacity it carries, over the page). Fills and their shading (hatching, scribbles, stipple, a wash's
// rim), chalk's loose dust and a marker's pooled ends are BACKDROP TEXTURE: they are thinner and fainter
// than a line by design, so that they sit behind the figure, and carry no floor. They are not invisible,
// though: a fill's tint and its shading marks are held to a floor of their own as drawn (FILL_FLOOR,
// below), and the shading of a fill is deepened AWAY FROM THE PAGE (lighter on a dark page).
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
// deeper than the region's colour (away from the page: darker on a light page,
// lighter on a dark one), and a solid area is drawn at this fraction of the
// fill opacity.
const SHADE_DEPTH = 0.7
const AREA_WEIGHT = 0.5
// What a fill's marks are held to, as drawn (the colour at the opacity it is laid at, over the page): a
// tint and a shading mark keep at least FILL_FLOOR:1 with the page; a fill is backdrop, so this is far
// below a line's floor, but a fill that cannot be seen is not a fill. (A wash's rim is a blurred edge
// and a marker's pooled ends are dots of ink: texture, which carries no floor.)
//   - A shading mark (a hatch line, a scribble, a dot) is held by its COLOUR, moved AWAY FROM THE PAGE (lighter
//     on a dark page, darker on a light one) by at most REACH of OKLCH lightness, hue and chroma held. Chalk's
//     marks on a DARK page keep THIN_FLOOR_DARK: a hatch line is a couple of units wide and the chalk's
//     texture knocks out about half of it, so a pastel at 2.5:1 on a slate board is drawn dull and brown.
//   - A tint (the flat area) is held by its OPACITY, raised by at most half again (UPLIFT): a tint's hue is
//     what makes it a tint, and a darker orange is brown. The author's own fill opacity is a dial, and a
//     faint fill is not made loud to make up for it.
const FILL_FLOOR = 1.5
const THIN_FLOOR_DARK = 3.5
const REACH = 0.25
const UPLIFT = 1.5
// Shading lines are sampled this far apart (drawing units): they are many and
// straight, and a figure of hatching would otherwise weigh megabytes.
const SHADING_STEP = 14

const SIX_DIGITS = /^#[0-9a-f]{6}$/

// `hex` moved AWAY FROM THE PAGE (lighter on a dark page, darker on a light one), in steps of 0.01 of
// OKLCH lightness and by at most REACH, until a mark of it laid at `opacity` shows against `page` at
// `floor`:1 as drawn. A colour that already does, and anything that is not a '#rrggbb', is returned
// as it is. Where the floor cannot be reached, the best contrast within REACH is.
function reaching(hex: string, page: string, opacity: number, floor: number): string {
  if (!SIX_DIGITS.test(hex) || !SIX_DIGITS.test(page) || !(opacity > 0)) return hex
  const laid = Math.min(1, opacity)
  let bestRatio = drawnContrast(hex, page, laid)
  if (bestRatio >= floor) return hex
  const base = toOklch(hex)
  const away = toOklch(page).l < DARK_PAGE ? 1 : -1
  let best = hex
  for (let k = 1; k * 0.01 <= REACH + 1e-9; k++) {
    const l = Math.min(1, Math.max(0, base.l + away * k * 0.01))
    const next = fromOklch({ ...base, l })
    const ratio = drawnContrast(next, page, laid)
    if (ratio >= floor) return next
    if (ratio > bestRatio) {
      best = next
      bestRatio = ratio
    }
    if (l === 0 || l === 1) break
  }
  return best
}

// `opacity` raised, in steps of 0.01 and by at most UPLIFT times, until a mark of `hex` laid at it shows
// against `page` at `floor`:1 as drawn. An opacity that already does, or is 0, is returned as it is.
function lifted(hex: string, page: string, opacity: number, floor: number): number {
  if (!SIX_DIGITS.test(hex) || !SIX_DIGITS.test(page) || !(opacity > 0) || drawnContrast(hex, page, Math.min(1, opacity)) >= floor) return opacity
  const most = Math.min(1, opacity * UPLIFT)
  for (let laid = opacity + 0.01; laid < most; laid += 0.01) if (drawnContrast(hex, page, laid) >= floor) return laid
  return most
}

const numberOf = (value: SvgAttrs[string], fallback: number): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) ? n : fallback
}

// The role of a stroke, by the layer it is drawn in: scaffolding (auxiliary lines and hidden edges,
// which share the layer) is auxiliary, an annotation (an angle arc, a tick, a leader) is a
// measure, and everything else is a line. A medium that has only these to go on cannot tell a
// hidden edge from an auxiliary construction line; both are drawn in the auxiliary colour.
const strokeRole = (layer: FigureLayer): RoleKey => (layer === 'auxiliary' ? 'auxiliary' : layer === 'marks' ? 'measure' : 'line')

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

// `theme` is the theme the medium colours from, when the style's medium is not clean (none: the
// default theme for the palette's mode); `mediumSettings` are its settings (figure/medium.ts).
export function styledPen(style: Style, palette: Palette, themeInput?: ThemeInput, mediumSettings?: MediumSettings): FigurePen {
  const theme = figureTheme(palette)
  const medium = figureMedium(style, palette, themeInput, mediumSettings)
  const layers = emptyFigureLayers()
  const line = LINES[style.line.type]
  const texture: Texture | null = line.texture(style.line)
  const ink = style.colour.ink === 'theme' ? theme.ink : style.colour.ink
  // The paper's tint: a tint the style names, else the theme's board when the paper is one (whatever the
  // medium: a board is the same colour in the clean medium), else the host's own page colour.
  const tint = paperColour(style, palette, themeInput) ?? theme.background
  // The colour of the page the figure is drawn on: the medium's surface, else the tint.
  const page = medium ? medium.surface : tint
  const onDark = toOklch(page).l < DARK_PAGE
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

  // A marker's overlaps darken (multiply). That is how ink behaves on a light page; on a dark page a
  // light stroke multiplied over it all but vanishes, so in a medium on a dark surface the strokes
  // are laid normally (their own translucency still builds where they cross).
  const darkPage = medium !== null && toOklch(medium.surface).l < 0.5

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
          style: primitive.blend && !darkPage ? `mix-blend-mode:${primitive.blend}` : null,
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
  const drawChain = (chain: Chain, width: number, key: string, settings: LineSettings = style.line, step?: number, extra: Pick<StrokeInput, 'cap' | 'dash' | 'strength'> = {}): Primitive[] =>
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

  const strokeChainsWith = (chains: readonly Chain[], attrs: SvgAttrs, id: string, layer: FigureLayer, role: RoleKey = strokeRole(layer)) => {
    const drawn = medium ? medium.paint(typeof attrs.stroke === 'string' ? attrs.stroke : theme.ink, role) : undefined
    const paint = drawn ? drawn.hex : (colour(attrs.stroke) ?? ink)
    const width = numberOf(attrs['stroke-width'], 1) * style.line.width
    // The call's own opacity: render.ts fades a hidden or auxiliary line to 0.6. Clean keeps that fade, as
    // it always did. In a medium the fade is dropped: the muted colour and the dashes already mark such a line
    // as secondary, and laid under the medium's opacity as well it would sit below its contrast floor. A
    // medium's opacity is the line type's stroke strength: it replaces the line type's own factor instead of
    // multiplying it (`strength`).
    const opacity = drawn ? 1 : numberOf(attrs.opacity, 1)
    const strength = drawn?.opacity
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
        for (const primitive of drawChain(chain, width, `${id}#${c}`, style.line, undefined, { cap, dash, strength })) layers[layer].push(write(primitive, paint, opacity, identity))
        return
      }
      const parts = pattern.length > 0 ? dashes(chain, pattern) : [chain]
      parts.forEach((part, d) => {
        for (const primitive of drawChain(part, width, `${id}#${c}.${d}`, style.line, undefined, { cap, strength })) layers[layer].push(write(primitive, paint, opacity, identity))
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
      // In a medium the region's tint is its fill colour, the marks that shade it (hatching,
      // scribbles, dots) its shading colour, and a wash's rim its region colour.
      const asked = typeof attrs.fill === 'string' ? attrs.fill : theme.region
      const tone = medium ? medium.paint(asked, 'fill') : undefined
      const shading = medium ? medium.paint(asked, 'shading') : undefined
      const rim = medium ? medium.paint(asked, 'region') : undefined
      const base = tone ? tone.hex : (colour(attrs.fill) ?? ink)
      const identity = identityOf(attrs)
      // Shading lines are drawn by the line type at the medium's strength, which replaces its own factor; the
      // line's own opacity (shadingSettings keeps it) and then the fill's opacity multiply on top, so a shading
      // line is fill opacity x line opacity x the medium's. Dots are the fill's own marks and take the fill's
      // opacity and the medium's (not the line's).
      const opacity = style.fill.opacity
      // A solid area at half the fill opacity: at the same opacity a filled area reads about twice as heavy as
      // hatching. It is the tint, and keeps the floor every fill mark keeps (by its opacity: see UPLIFT).
      const paint = base
      const areaOpacity = lifted(base, page, style.fill.opacity * AREA_WEIGHT * (tone ? tone.opacity : 1), FILL_FLOOR)
      // Shading in lines and dots is drawn a deeper shade of the region's colour: deeper is AWAY FROM THE PAGE
      // (darker on a light page, lighter on a dark one). In a medium it is the medium's shading colour. Held to
      // its floor as drawn (chalk on a dark page to more: THIN_FLOOR_DARK).
      const shade = reaching(shading ? shading.hex : deepenFrom(base, SHADE_DEPTH, page), page, opacity * (shading ? shading.opacity : 1), onDark && texture?.name === 'chalk' ? THIN_FLOOR_DARK : FILL_FLOOR)
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
              for (const primitive of drawChain(chain, shadingWidth, `${id}/fill#${c}`, shadingSettings, SHADING_STEP, { strength: shading?.opacity })) clipped.push(write(primitive, shade, opacity, identity))
            })
            break
          case 'dots':
            if (mark.dots.length > 0) clipped.push(`<path${attributes({ d: dotsData(mark.dots), fill: shade, stroke: 'none', opacity: opacity * (shading ? shading.opacity : 1), ...identity })}/>`)
            break
          case 'edge': {
            const edgeMarkup = cleanFill(region, {
              fill: 'none',
              stroke: rim ? rim.hex : paint,
              'stroke-width': mark.width,
              opacity: Math.min(1, mark.opacity * style.fill.opacity * (rim ? rim.opacity : 1)),
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
      const point = medium && typeof attrs.fill === 'string' ? medium.paint(attrs.fill, 'point') : undefined
      layers[layer].push(svgCircle(at, radius, { ...attrs, fill: point ? point.hex : colour(attrs.fill), ...(point && point.opacity < 1 ? { opacity: point.opacity } : {}) }))
    },

    // A label in the style's face and size, turned by its seeded tilt about
    // its own anchor — the point the label layout placed it at, which stays
    // exactly where it was.
    // (Its size is already the style's: render.ts lays labels out at the
    // lettering size and asks for them at it.)
    text(at, text, attrs, id, layer) {
      const label = medium && typeof attrs.fill === 'string' ? medium.paint(attrs.fill, 'label') : undefined
      const element = svgText(at, text, {
        ...attrs,
        'font-family': FACES[style.lettering.face],
        fill: label ? label.hex : colour(attrs.fill),
        ...(label && label.opacity < 1 ? { opacity: label.opacity } : {}),
      })
      layers[layer].push(turned(element, at, id))
    },

    // A label with notation: the same face, and the same tilt, about the
    // middle of its glyph row. The givens table's rows are not tilted (a
    // table is set straight); their ids are "givens/…" and "…/cell-N"
    // (render.ts).
    notation(layout, origin, notationStyle, id, layer) {
      const inTable = /^givens\/|\/cell-\d+$/.test(id)
      // In a medium, the table is the givens role and every other label a label.
      const role: RoleKey = inTable ? 'givens' : 'label'
      const text = medium ? medium.paint(notationStyle.fill, role) : undefined
      const marks = medium && notationStyle.stroke !== undefined ? medium.paint(notationStyle.stroke, role) : undefined
      const elements = notationElements(layout, origin, {
        ...notationStyle,
        fontFamily: FACES[style.lettering.face],
        fill: text ? text.hex : (colour(notationStyle.fill) ?? notationStyle.fill),
        stroke: notationStyle.stroke === undefined ? undefined : marks ? marks.hex : (colour(notationStyle.stroke) ?? notationStyle.stroke),
      })
      // The medium's opacity: one group around the whole label, outside its tilt.
      const faint = (markup: string): string => (text && text.opacity < 1 ? `<g opacity="${fmt(text.opacity)}">${markup}</g>` : markup)
      if (inTable) layers[layer].push(...(text && text.opacity < 1 ? [faint(elements.join(''))] : elements))
      else layers[layer].push(faint(turned(elements.join(''), { x: origin.x + layout.width / 2, y: origin.y }, id)))
    },

    // The givens table's box: paper-coloured, its edge drawn in the line type.
    panel(box, attrs, id, layer) {
      const boxFill = medium && typeof attrs.fill === 'string' ? medium.paint(attrs.fill, 'givens').hex : colour(attrs.fill)
      layers[layer].push(`<rect${attributes({ x: box.x, y: box.y, width: box.width, height: box.height, fill: boxFill, stroke: 'none', 'data-object': attrs['data-object'] })}/>`)
      const corners = [
        { x: box.x, y: box.y },
        { x: box.x + box.width, y: box.y },
        { x: box.x + box.width, y: box.y + box.height },
        { x: box.x, y: box.y + box.height },
      ]
      const sides = corners.map((corner, i) => polylineChain([corner, corners[(i + 1) % 4]]))
      strokeChainsWith(sides, attrs, id, layer, 'givens')
    },

    // The style's paper (style/papers/), under everything, covering three
    // view boxes beyond the figure on every side.
    paper(viewBox) {
      const laid = PAPERS[style.paper.type].draw({
        settings: style.paper,
        // In a medium the paper is the medium's surface (the page's own colour, saturated).
        tint: medium ? medium.paint(theme.background, 'fill').hex : (colour(tint) ?? tint),
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

