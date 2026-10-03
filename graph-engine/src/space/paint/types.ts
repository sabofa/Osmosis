// The painter's contract (spec 2026-10-02-painted-figures-design.md, §3–§6).
// The paint model (space/paint/model/) is pure TypeScript and turns a space
// scene plus a G-buffer readback into a stroke batch; the paint renderer
// (space/paint/gl/) draws the G-buffer, reads it back, and paints the batch;
// the Paint Lab (review/src/paintLab.tsx) drives both. These types are the
// only coupling between them.

import type { SpaceScene } from '../scene/types'
import type { PaintParams } from './params'

export type Role = 'block' | 'form' | 'scumble' | 'glaze' | 'reflected' | 'dab' | 'edge' | 'line'
export const ROLES: readonly Role[] = ['block', 'form', 'scumble', 'glaze', 'reflected', 'dab', 'edge', 'line']
// Painting order (§3.7): layers paint in this order, back to front by depth
// within a layer.
export const LAYER_ORDER: readonly Role[] = ['block', 'form', 'scumble', 'glaze', 'reflected', 'edge', 'line', 'dab']

export type EdgeClass = 'lost' | 'soft' | 'firm' | 'hard'
export type Zone = 'light' | 'half' | 'core' | 'reflected' | 'cast'

export type Oklab = [number, number, number]

// How a scene's marks get their local colour: the lab resolves these from the
// theme (space/theme.ts) and the colormaps (space/colormaps.ts).
export interface SceneColours {
  // The flat local colour of mark `markIndex` (index into scene.marks).
  markColour(markIndex: number): Oklab
  // The colormap colour of scale `scaleId` at value `v`, or null if the mark
  // has no colour scale.
  scaleColour(scaleId: number, v: number): Oklab | null
}

// Seeded surface particles (§3.1), structure-of-arrays, `count` long.
export interface ParticleSet {
  count: number
  // Index into scene.marks of the mesh each particle lies on.
  mark: Uint32Array
  position: Float32Array // 3 per particle, world
  normal: Float32Array // 3 per particle, unit, world
  tangent: Float32Array // 3 per particle, unit, world: the stroke direction
  colour: Float32Array // 3 per particle, OKLab local colour
  colormapped: Uint8Array // 1 when the local colour came from a colour scale
  opacity: Float32Array // the mesh's opacity (glazes below 1)
  rank: Float32Array // seeded, [0, 1)
  cell: Uint32Array // surface cell id for brush loads (§3.5)
  seed: Uint32Array
  // Where each particle was seeded, for the bake and its diagnostics (bake/types.ts): the source triangle (index into the
  // mark's `indices / 3`) and its barycentric weights b1 and b2 of the triangle's second and third vertices (the first's is
  // 1 - b1 - b2, as TriangleHit in space/pick/bvh.ts). Absent on a set made before they existed.
  tri?: Uint32Array
  bary?: Float32Array // 2 per particle
}

// The camera and light for one frame. Matrices are column-major Float32Array(16).
export interface PaintView {
  viewProj: Float32Array
  view: Float32Array
  // World-space eye position and unit view direction (eye toward target).
  eye: [number, number, number]
  viewDir: [number, number, number]
  // World-space unit direction toward the key light (from light.azimuth/elevation).
  lightDir: [number, number, number]
  // Canvas size in CSS px, and device pixels per CSS px.
  width: number
  height: number
  pixelRatio: number
  // 1 while the user drags (density may drop to particles.dragDensity).
  dragging: boolean
  // How far in the view is, relative to the framing the roles' stroke sizes (CSS px) were tuned at (the
  // figure's authored camera): 1 there, 3 for a 3x close-up. Absent means 1. The strokes follow it by
  // particles.zoomStrokeScale. (Contract extension, paint-zoom.)
  zoom?: number
}

// The renderer's G-buffer, read back at reduced resolution (§4). Row 0 is the
// TOP of the image. Pixel (x, y) covers CSS px (x·scale, y·scale).
export interface GBuffer {
  width: number
  height: number
  scale: number // CSS px per G-buffer pixel
  // View depth (distance along viewDir), +Infinity where nothing is drawn.
  depth: Float32Array
  // World normal, 3 per pixel (0,0,0 where empty).
  normal: Float32Array
  // Raw lit value u in 0..1 (key light, ambient, sky, bounce, shadow), -1 where
  // empty. The model recomputes its own value from `normal` and `shadow` (so
  // the curves apply); this one is the renderer's reference.
  value: Float32Array
  // 1 where the pixel is in the key light's cast or self shadow.
  shadow: Uint8Array
  // Index into scene.marks of the mesh drawn there, -1 where empty.
  mark: Int32Array
}

// One frame's strokes (§3.7, §4), structure-of-arrays, `count` long. Every
// stroke is a ribbon through PATH_POINTS points in CSS px.
export const PATH_POINTS = 8
// The most bristles a stroke can have (StrokeBatch.bristles is clamped to it; the stroke shader reads up to this many).
export const MAX_BRISTLES = 48
export interface StrokeBatch {
  count: number
  role: Uint8Array // index into ROLES
  layer: Uint8Array // index into LAYER_ORDER
  path: Float32Array // 2·PATH_POINTS per stroke, CSS px, y down
  width: Float32Array // PATH_POINTS per stroke, CSS px (pressure and taper applied)
  depth: Float32Array // view depth for back-to-front order within a layer
  colour: Float32Array // 3 per stroke, linear-light sRGB 0..1 (final, after curve and mix)
  alpha: Float32Array // coverage multiplier (fades, glazes)
  load: Float32Array // paint load (opacity and height of the loaded start)
  impasto: Float32Array // relief height multiplier
  bristles: Float32Array // bristle count
  bristleVar: Float32Array
  dry: Float32Array // dry-brush tail fraction 0..1
  wet: Float32Array // wet pickup 0..1 (samples the layer beneath)
  endSoft: Float32Array // 0 crisp end .. 1 dissolved end (edge class)
  edge: Uint8Array // index into EDGE_CLASSES of the governing edge, 255 if none
  seed: Uint32Array
  // The stroke's path before it was projected, in world space (3 per path point, 3·PATH_POINTS per stroke), so a
  // new view can put the same stroke on screen without the model: project each point through the view's viewProj
  // and the path is `path` again, under the view the batch was made for. A line's points are exactly on its 3D
  // polyline; a surface stroke's are on the walked surface; an edge's are the screen path lifted to one depth (a
  // flat decal on the surface it follows). A stroke built on screen alone (an arrowhead's barbs, a point's dab)
  // repeats its anchor for every point: it moves with it and does not turn.
  worldPath: Float32Array
  // The unit world normal at the stroke's anchor, turned toward the viewer the stroke was made for, 3 per stroke;
  // (0, 0, 0) for a stroke that has none (lines, edges). A view turned away from it fades the stroke out.
  worldNormal: Float32Array
  // Per stroke, what the renderer does where a surface is nearer (bake/types.ts HIDDEN_*): only a baked frame
  // fills it (data-mark lines drawn dashed where hidden); the per-frame model leaves it undefined and makes its
  // own hidden runs.
  hidden?: Uint8Array
}
export const EDGE_CLASSES: readonly EdgeClass[] = ['lost', 'soft', 'firm', 'hard']

// Debug data the model hands the renderer for the lab's debug views.
export interface PaintDebug {
  // The model's value plan per G-buffer pixel (0..1, -1 empty): the painter's
  // plan from the G-buffer normal (N·L) and shadow flag (spec §12: two
  // families divided by the terminator, a core shadow, reflected light kept
  // under the half-tones), through the light response curve, occlusion and
  // the value curve. The 'value' debug view shows this, not GBuffer.value
  // (the renderer's raw lighting).
  value: Float32Array
  // Plane id per G-buffer pixel (-1 empty), same size as the G-buffer.
  planes: Int32Array
  // Zone per G-buffer pixel: index into ZONES, 255 empty.
  zones: Uint8Array
  // Edge polylines in CSS px: segment endpoints (x0,y0,x1,y1) and a class each.
  edgeSegments: Float32Array
  edgeClass: Uint8Array
}
export const ZONES: readonly Zone[] = ['light', 'half', 'core', 'reflected', 'cast']

export type PaintDebugMode = 'none' | 'value' | 'zones' | 'planes' | 'edges' | 'roles' | 'grey' | 'paint-only'

export interface PaintFrame {
  strokes: StrokeBatch
  // The underpainting (contract extension, paint-zoom): the curve colour of every covered pixel of a
  // form, 3 per G-buffer pixel (same size and row order as the G-buffer), linear-light sRGB, NaN where
  // nothing is drawn. The renderer lays it first, under the block-in, so a gap between strokes inside
  // a form shows this colour and never bare canvas.
  underpaint: Float32Array
  debug: PaintDebug
  // Counts for the lab readout.
  stats: { strokes: number; byRole: Record<Role, number>; loads: number }
}

// The model's two entry points (implemented in space/paint/model/index.ts).
export type BuildParticles = (scene: SpaceScene, colours: SceneColours, params: PaintParams) => ParticleSet
export type PaintFrameFn = (
  scene: SpaceScene,
  particles: ParticleSet,
  view: PaintView,
  gbuffer: GBuffer,
  params: PaintParams,
) => PaintFrame
