import type { Palette } from '../render/palette'
import type { Vec2 } from '../scene/types'
import type { Chain, Piece } from '../style/path'
import { emptyFigureLayers, figureDocument, figureTheme, type FigureLayer, type Rect } from './document'
import { notationElements, type NotationLayout, type NotationStyle } from './notation'
import {
  ellipticalArcCommand,
  ellipsePoint,
  lineCommand,
  svgArc,
  svgCircle,
  svgCircularSegment,
  svgClosedPaths,
  svgEllipse,
  svgEllipticalArc,
  svgLine,
  svgPolygon,
  svgPolyline,
  svgRect,
  svgSector,
  svgText,
  type SvgAttrs,
} from './svg'

// The figure's drawing seam: a PEN.
//
// render.ts decides WHAT a figure draws — which geometry, in which layer, for
// which statement — and hands each piece to a pen, which decides HOW it looks.
// Every call carries the element's identity (a stable key a styled pen seeds
// its randomness from) and its layer (E1's painting order).
//
// The CLEAN pen, below, forwards every call to the emitter render.ts used to
// call directly, with the same arguments in the same order. That is how
// "clean is today's output, byte for byte" holds: the refactor moved the
// calls, it did not change them. A styled pen (styledPen.ts) runs the same
// calls through style/ instead.
//
// Everything a pen is given is already in DRAWING coordinates (view units, y
// down): the projection is render.ts's business, not the pen's.

// ---------------------------------------------------------------------------
// What a pen draws
// ---------------------------------------------------------------------------

// A stroke. Each kind is one of the shapes the figure draws, named for the
// element the clean pen writes for it; strokeChains turns any of them into
// the abstract chain a line type draws.
export type StrokePath =
  | { kind: 'line'; a: Vec2; b: Vec2 }
  | { kind: 'polyline'; points: Vec2[] }
  | { kind: 'circle'; center: Vec2; radius: number }
  | { kind: 'arc'; center: Vec2; radius: number; start: number; end: number }
  | { kind: 'ellipticalArc'; center: Vec2; rx: number; ry: number; rotation: number; start: number; end: number }

// A filled region. `loops` is a region of one or more closed outlines drawn
// as ONE path (a section's region, a phase 12 shaded region): each loop a
// start point and its line and elliptical-arc pieces, closed back to the
// start by the path's own "Z" (so a last side that returns to the start may
// be left out).
export type FillRegion =
  | { kind: 'polygon'; points: Vec2[] }
  | { kind: 'ellipse'; center: Vec2; rx: number; ry: number; rotation: number }
  | { kind: 'sector'; center: Vec2; radius: number; start: number; end: number }
  | { kind: 'circularSegment'; center: Vec2; radius: number; start: number; end: number }
  | { kind: 'loops'; loops: { start: Vec2; pieces: Piece[] }[] }

export interface FigurePen {
  // A line, curve or outline with no fill of its own.
  stroke(path: StrokePath, attrs: SvgAttrs, id: string, layer: FigureLayer): void
  // A filled region — with its outline too, when `attrs` carries a stroke.
  fill(region: FillRegion, attrs: SvgAttrs, id: string, layer: FigureLayer): void
  // A point's dot.
  mark(at: Vec2, radius: number, attrs: SvgAttrs, id: string, layer: FigureLayer): void
  // A plain label, written at its placed anchor.
  text(at: Vec2, text: string, attrs: SvgAttrs, id: string, layer: FigureLayer): void
  // A label carrying notation (overbars, arcs, arrows), laid out already.
  notation(layout: NotationLayout, origin: Vec2, style: NotationStyle, id: string, layer: FigureLayer): void
  // The givens table's box.
  panel(box: Rect, attrs: SvgAttrs, id: string, layer: FigureLayer): void
  // Lays the paper under everything, covering the view.
  paper(viewBox: Rect): void
  // The finished document.
  svg(viewBox: Rect): string
}

// ---------------------------------------------------------------------------
// The clean pen — today's emitters, unchanged
// ---------------------------------------------------------------------------

export function cleanPen(palette: Palette): FigurePen {
  const theme = figureTheme(palette)
  const layers = emptyFigureLayers()
  return {
    stroke(path, attrs, _id, layer) {
      layers[layer].push(cleanStroke(path, attrs))
    },
    fill(region, attrs, _id, layer) {
      layers[layer].push(cleanFill(region, attrs))
    },
    mark(at, radius, attrs, _id, layer) {
      layers[layer].push(svgCircle(at, radius, attrs))
    },
    text(at, text, attrs, _id, layer) {
      layers[layer].push(svgText(at, text, attrs))
    },
    notation(layout, origin, style, _id, layer) {
      layers[layer].push(...notationElements(layout, origin, style))
    },
    panel(box, attrs, _id, layer) {
      layers[layer].push(svgRect(box, attrs))
    },
    // The clean paper is the one rectangle figureDocument writes itself.
    paper() {},
    svg(viewBox) {
      return figureDocument(layers, viewBox, theme)
    },
  }
}

export function cleanStroke(path: StrokePath, attrs: SvgAttrs): string {
  switch (path.kind) {
    case 'line':
      return svgLine(path.a, path.b, attrs)
    case 'polyline':
      return svgPolyline(path.points, attrs)
    case 'circle':
      return svgCircle(path.center, path.radius, attrs)
    case 'arc':
      return svgArc(path.center, path.radius, path.start, path.end, attrs)
    case 'ellipticalArc':
      return svgEllipticalArc(path.center, path.rx, path.ry, path.rotation, path.start, path.end, attrs)
  }
}

export function cleanFill(region: FillRegion, attrs: SvgAttrs): string {
  switch (region.kind) {
    case 'polygon':
      return svgPolygon(region.points, attrs)
    case 'ellipse':
      return svgEllipse(region.center, region.rx, region.ry, region.rotation, attrs)
    case 'sector':
      return svgSector(region.center, region.radius, region.start, region.end, attrs)
    case 'circularSegment':
      return svgCircularSegment(region.center, region.radius, region.start, region.end, attrs)
    case 'loops':
      return svgClosedPaths(
        region.loops.map((loop) => ({ start: loop.start, commands: loop.pieces.map(pieceCommand) })),
        attrs
      )
  }
}

// One piece of a closed outline as a path command. A region's pieces are
// lines and elliptical arcs (a circle's arc is the ellipse with equal radii),
// which is all the outlines the figure fills are made of.
function pieceCommand(piece: Piece): string {
  switch (piece.kind) {
    case 'line':
      return lineCommand(piece.to)
    case 'ellipticalArc':
      return ellipticalArcCommand(piece.center, piece.rx, piece.ry, piece.rotation, piece.start, piece.end).command
    case 'arc':
      return ellipticalArcCommand(piece.center, piece.radius, piece.radius, 0, piece.start, piece.end).command
    case 'cubic':
      throw new Error('A filled outline has no cubic pieces')
  }
}

// ---------------------------------------------------------------------------
// The abstract view of the same shapes, for a styled pen
// ---------------------------------------------------------------------------

const circlePoint = (center: Vec2, radius: number, angle: number): Vec2 => ({
  x: center.x + radius * Math.cos(angle),
  y: center.y + radius * Math.sin(angle),
})

export function strokeChains(path: StrokePath): Chain[] {
  switch (path.kind) {
    case 'line':
      return [{ pieces: [{ kind: 'line', from: path.a, to: path.b }], closed: false }]
    case 'polyline':
      return [{ pieces: path.points.slice(1).map((to, i) => ({ kind: 'line' as const, from: path.points[i], to })), closed: false }]
    case 'circle':
      return [{ pieces: [{ kind: 'arc', center: path.center, radius: path.radius, start: 0, end: 2 * Math.PI }], closed: true }]
    case 'arc':
      return [{ pieces: [{ kind: 'arc', center: path.center, radius: path.radius, start: path.start, end: path.end }], closed: false }]
    case 'ellipticalArc':
      return [{ pieces: [{ ...path }], closed: false }]
  }
}

// A region's outline as closed chains, each ending where it began (a closing
// side the region left to its "Z" is written out).
export function regionChains(region: FillRegion): Chain[] {
  switch (region.kind) {
    case 'polygon':
      return [closeChain(region.points.slice(1).map((to, i) => ({ kind: 'line' as const, from: region.points[i], to })), region.points[0])]
    case 'ellipse':
      return [{ pieces: [{ kind: 'ellipticalArc', center: region.center, rx: region.rx, ry: region.ry, rotation: region.rotation, start: 0, end: 2 * Math.PI }], closed: true }]
    case 'sector': {
      const from = circlePoint(region.center, region.radius, region.start)
      const to = circlePoint(region.center, region.radius, region.end)
      return [
        {
          pieces: [
            { kind: 'line', from: region.center, to: from },
            { kind: 'arc', center: region.center, radius: region.radius, start: region.start, end: region.end },
            { kind: 'line', from: to, to: region.center },
          ],
          closed: true,
        },
      ]
    }
    case 'circularSegment': {
      const from = circlePoint(region.center, region.radius, region.start)
      const to = circlePoint(region.center, region.radius, region.end)
      return [{ pieces: [{ kind: 'arc', center: region.center, radius: region.radius, start: region.start, end: region.end }, { kind: 'line', from: to, to: from }], closed: true }]
    }
    case 'loops':
      return region.loops.map((loop) => closeChain(loop.pieces, loop.start))
  }
}

export function pieceEnd(piece: Piece): Vec2 {
  switch (piece.kind) {
    case 'line':
    case 'cubic':
      return piece.to
    case 'arc':
      return circlePoint(piece.center, piece.radius, piece.end)
    case 'ellipticalArc':
      return ellipsePoint(piece.center, piece.rx, piece.ry, piece.rotation, piece.end)
  }
}

// Writes out the side back to `start` when the pieces stop short of it.
function closeChain(pieces: Piece[], start: Vec2): Chain {
  const out = [...pieces]
  const end = out.length > 0 ? pieceEnd(out[out.length - 1]) : start
  if (Math.hypot(end.x - start.x, end.y - start.y) > 1e-9) out.push({ kind: 'line', from: end, to: start })
  return { pieces: out, closed: true }
}
