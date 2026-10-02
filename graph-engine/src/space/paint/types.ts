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
}
export const EDGE_CLASSES: readonly EdgeClass[] = ['lost', 'soft', 'firm', 'hard']

// Debug data the model hands the renderer for the lab's debug views.
export interface PaintDebug {
  // The model's final value per G-buffer pixel (0..1, -1 empty): its own
  // lighting from the G-buffer normal and shadow flag, through the light
  // response curve, occlusion and the value curve. The 'value' debug view
  // shows this, not GBuffer.value (the renderer's raw lighting).
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
