// The baked painting (spec 2026-10-02-painted-figures-design.md §14; Ben,
// 2026-10-02: "since it's all seeded maybe it can precompile the full painting,
// then when I move around it's instant"). With the key light fixed in the world
// (light.worldFixed = 1) a stroke's value, colour, role, mix and its path along
// the surface do not depend on the camera, so the whole painting is computed
// once, in world space, and every frame only selects, projects and draws it.
//
// What stays per frame (cheap): which strokes are visible (the renderer's depth
// pre-pass), the screen density (rank against foreshortening), the silhouette
// fade (|n·v|), the zoom's stroke scale, and the silhouette outline strokes,
// which are view-dependent by nature.

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { GBuffer, PaintView, ParticleSet, SceneColours, StrokeBatch } from '../types'

// Every particle's stroke, at the maximum density, in world space, `count`
// long, structure-of-arrays. Ordered by layer, then by a seeded key, so the
// order never depends on a view (the per-frame depth sort is the renderer's).
export interface BakedPainting {
  count: number
  // Index into ROLES and LAYER_ORDER.
  role: Uint8Array
  layer: Uint8Array
  // The particle the stroke grew from (its rank decides the per-frame density).
  particle: Uint32Array
  rank: Float32Array
  // World path, 3·PATH_POINTS per stroke, walked along the surface in world units.
  worldPath: Float32Array
  // World normal at each path point, 3·PATH_POINTS per stroke (silhouette fade, depth bias).
  worldNormal: Float32Array
  // Width at each path point, PATH_POINTS per stroke, in WORLD units (the frame scales to px).
  worldWidth: Float32Array
  colour: Float32Array // 3 per stroke, linear-light sRGB, final (curve + mix)
  alpha: Float32Array
  load: Float32Array
  impasto: Float32Array
  bristles: Float32Array
  bristleVar: Float32Array
  dry: Float32Array
  wet: Float32Array
  endSoft: Float32Array
  edge: Uint8Array // index into EDGE_CLASSES, 255 none
  seed: Uint32Array
  // World units per CSS px at the bake's reference framing: the frame turns
  // world widths into px as worldWidth / (worldPerPx at the current zoom),
  // then applies the zoom's stroke scale (particles.zoomStrokeScale, zoomGrowMax).
  referenceWorldPerPx: number
  // The underpainting, baked per mesh vertex: linear sRGB, 3 per vertex, one
  // array per scene mark (null for marks that are not meshes). Drawn by the
  // renderer as a mesh pass under the strokes, with the brushy coverage mask.
  underpaint: (Float32Array | null)[]
  // A key of everything the bake read (scene identity, params except view-only
  // and colour-only ones, light direction, seed): equal keys, equal paintings.
  key: string
}

// Bake once (in the worker) for a scene, its particles, a WORLD light direction
// and the params. Deterministic. Errors are returned in the result's stats,
// never thrown past the engine.
export type BakePainting = (
  scene: SpaceScene,
  particles: ParticleSet,
  colours: SceneColours,
  lightDir: [number, number, number],
  params: PaintParams,
) => BakedPainting

// Colour-only changes (curve, mix, environment colour, local colours) recolour
// an existing bake in place of re-baking: same strokes, new colours. Must equal
// a full re-bake bit for bit.
export type RecolourBake = (
  baked: BakedPainting,
  scene: SpaceScene,
  particles: ParticleSet,
  colours: SceneColours,
  lightDir: [number, number, number],
  params: PaintParams,
) => BakedPainting

// Per frame (main thread, a few ms): select the baked strokes this view shows,
// project their world paths, turn world widths into px with the zoom's scale,
// fade by |n·v|, and append this view's silhouette outline strokes. The result
// is an ordinary StrokeBatch the existing renderer paints (its depth pre-pass
// hides what is behind a surface). `gbuffer` is optional: the silhouette strokes
// may read its depth; nothing else does.
export type FrameFromBake = (
  baked: BakedPainting,
  scene: SpaceScene,
  view: PaintView,
  params: PaintParams,
  gbuffer: GBuffer | null,
) => StrokeBatch
