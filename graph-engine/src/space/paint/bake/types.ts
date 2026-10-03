// The baked painting (spec 2026-10-02-painted-figures-design.md §14; Ben,
// 2026-10-02: "since it's all seeded maybe it can precompile the full painting,
// then when I move around it's instant"). With the key light fixed in the world
// (light.worldFixed = 1) a stroke's value, colour, role, mix and its path along
// the surface do not depend on the camera, so the whole painting is computed
// once, in world space, and every frame only selects, projects and draws it.
//
// What stays per frame (cheap): which strokes are visible (the renderer's depth
// pre-pass), the screen density (rank against foreshortening), the silhouette
// fade (|n·v|), which side of an open sheet faces the eye, the zoom's stroke
// size (a sub-arc of the baked path, the brush's close-up shape), the painting
// order (view depth), and the silhouette outline strokes, which are
// view-dependent by nature, plus the screen-built shapes of data marks (a
// point's dab, an arrowhead's barbs).
//
// SIZES. Strokes are sized in CSS px exactly as the per-frame model sizes them
// (role lengths and widths, zoom growth, close-up shape); what is baked is the
// PATH, walked on the surface in world units long enough for the most
// zoomed-out view the bake serves (BAKE_ZOOM_MIN). A frame takes the sub-arc
// of the length it needs around the stroke's anchor and resamples it to
// PATH_POINTS.
//
// SIDES. The per-frame model turns every normal toward the viewer, so an open
// sheet (a graph surface seen from below, a veil) is painted from whichever
// side is seen. The bake paints both sides of an open mesh: one stroke per
// particle per side (side +1 is the side the normal points to, -1 the other).
// A closed mesh (no border edges) is painted from its outside only (side 0).

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { GBuffer, PaintView, ParticleSet, SceneColours, StrokeBatch } from '../types'

// Points on a baked path (a frame resamples a sub-arc of it to PATH_POINTS).
export const BAKE_PATH_POINTS = 16
// The most zoomed-out view (PaintView.zoom) whose strokes the baked paths are
// long enough for. Further out, strokes are shorter on screen than the
// per-frame model would make them (the figure is small there).
export const BAKE_ZOOM_MIN = 0.5
// Brush-load cell levels baked (view.ts loadCellLevel 0..BAKE_MIX_LEVELS-1);
// a closer view uses the finest.
export const BAKE_MIX_LEVELS = 4

// How a stroke's size follows the view.
export const SIZING_SURFACE = 0 // role sizes × zoom growth and close-up shape (view.ts zoomGrow, brush.ts)
export const SIZING_FIXED = 1 // CSS px whatever the zoom (edge strokes, data-mark lines)

// A data-mark stroke's hidden style (scene LineStyle hidden): what the
// renderer does where a surface is nearer than the stroke.
export const HIDDEN_NONE = 0 // hidden parts are not drawn (the depth pre-pass)
export const HIDDEN_DASHED = 1 // hidden parts are drawn dashed (the renderer's hidden pass)
export const HIDDEN_NA = 255 // not a data mark
// The dash of a hidden stretch drawn dashed, CSS px: on, off. The per-frame model dashes its hidden runs with it
// (model/lines.ts) and the renderer's hidden pass dashes the hidden parts of a baked frame's data lines the same way
// (gl/depthTest.ts), so both read it from here.
export const HIDDEN_DASH: readonly number[] = [5, 4]

// One mesh mark's surface as the bake refined it (finer than the scene mesh
// where the value plan needs it: the cast shadow on a two-triangle table, the
// terminator band), with the underpainting baked per vertex and the per-vertex
// facts the frame's silhouette strokes read.
export interface BakedSurface {
  mark: number
  positions: Float32Array // 3 per vertex, world
  // 3 per vertex, unit, side +1's normal: the mesh's own times the surface's orientation (bake/surface.ts orient), so
  // side +1 of a closed mesh is its OUTSIDE whatever way the kernel's normals point.
  normals: Float32Array
  indices: Uint32Array
  // Seen from side +1 only: a closed OPAQUE mesh (bake/surface.ts outsideOnly). A closed veil is seen from both sides
  // (its far half through its near half), so it is not `closed` here.
  closed: boolean
  // The underpainting, linear sRGB, 3 per vertex, as seen from side +1 and from
  // side -1 (null when closed); alpha per vertex per side (0 where nothing is
  // underpainted, e.g. lit bare table).
  underFront: Float32Array
  underBack: Float32Array | null
  alphaFront: Float32Array
  alphaBack: Float32Array | null
  // The plan value u (0..1) and family (FAM_LIGHT/FAM_SHADOW) per vertex per side.
  uFront: Float32Array
  uBack: Float32Array | null
  famFront: Uint8Array
  famBack: Uint8Array | null
  // The local colour (OKLab, 3 per vertex): the mark's colour or its colormap at the vertex.
  local: Float32Array
}

// Every particle's stroke (both sides of an open sheet), the baked edge
// strokes and the data marks' strokes, in world space, `count` long,
// structure-of-arrays. Ordered by layer, then by a seeded key, so the order
// never depends on a view (the per-frame depth order is the frame's).
export interface BakedPainting {
  count: number
  // Index into ROLES and LAYER_ORDER.
  role: Uint8Array
  layer: Uint8Array
  mark: Uint32Array
  // The particle the stroke grew from (its rank decides the per-frame
  // density); 0xffffffff for an edge or data-mark stroke (always drawn).
  particle: Uint32Array
  rank: Float32Array
  side: Int8Array // +1, -1, or 0 (closed mesh, edge on a closed mesh, data mark)
  sizing: Uint8Array // SIZING_*
  hidden: Uint8Array // HIDDEN_*
  // 1 when the loaded end is chosen per frame by screen x (the 'hand' start);
  // 0 when the bake chose it (the light end, an edge's run direction).
  handStart: Uint8Array
  // The path walked on the surface, BAKE_PATH_POINTS points (3 each) per
  // stroke, with the unit world normal at each point (the side's normal, so it
  // faces the eye the stroke is drawn for); (0,0,0) normals on data marks.
  worldPath: Float32Array
  worldNormal: Float32Array
  pathLength: Float32Array // world arc length of the baked path
  anchor: Float32Array // arc-length fraction 0..1 of the particle along the path
  // The stroke's size at zoom 1, CSS px: [length, width] (role size × the
  // light/shadow factor, before zoom growth); a SIZING_FIXED stroke's path is
  // its whole baked path and `width` its constant width.
  basePx: Float32Array
  // Final colour (curve, hold, mix) per brush-load level: 3·BAKE_MIX_LEVELS per
  // stroke, linear-light sRGB; level l at offset 3·(BAKE_MIX_LEVELS·i + l).
  colour: Float32Array
  alpha: Float32Array
  load: Float32Array
  impasto: Float32Array
  bristles: Float32Array // at zoom 1 (the frame applies brush.ts sizedBristles)
  bristleVar: Float32Array
  dry: Float32Array
  wet: Float32Array
  endSoft: Float32Array
  edge: Uint8Array // index into EDGE_CLASSES, 255 none
  seed: Uint32Array
  // World units per CSS px at the bake's reference framing (PaintView.zoom 1):
  // what turned the role sizes and px parameters (occlusion radius, plane size,
  // edge reach) into world units for the bake (the AuthoredFraming's worldPerPx).
  referenceWorldPerPx: number
  // World area per particle of each mark (meshArea / particle count), for the
  // per-frame px area of a particle (density and zoom growth); 0 for non-meshes.
  areaPerParticle: Float32Array
  surfaces: (BakedSurface | null)[] // per scene mark; null for non-meshes
  // The focal points of each mark (spec §14: the terminator nearest the AUTHORED eye and the brightest highlight, fixed in the world):
  // 2 per mark, x, y, z and radius R each (8 per mark), NaN where a mark has fewer; the silhouette strokes' focal term reads them.
  focal: Float64Array
  // The colour of each data mark's strokes before the brush-load mix (linear sRGB, 3 per mark, 0 for marks
  // without lines), for the shapes a frame builds on screen (a point's dab, an arrowhead's barbs).
  dataColour: Float32Array
  // A key of everything the bake read (scene identity, params except view-only
  // and colour-only ones, light direction, seed): equal keys, equal paintings.
  key: string
}

// The framing the bake composes for (the lab's authored view at zoom 1): its eye (for an orthographic view, any point
// on the line toward the eye; the direction is -viewDir), whether it is orthographic, and the world size of a CSS px at
// the scene's centre (what the bake's px parameters are measured in: BakedPainting.referenceWorldPerPx).
export interface AuthoredFraming { eye: [number, number, number]; viewDir: [number, number, number]; ortho: boolean; worldPerPx: number }

// Bake once (in the worker) for a scene, its particles, a WORLD light direction
// and the params. `authored` is the framing the picture is composed for (the lab
// computes it from the authored view): its worldPerPx is the world size of a CSS px
// there, and its eye and direction place the edges' focal points (the terminator
// nearest the authored eye, and the brightest highlight; spec §14). Deterministic.
// Never throws past the engine: a failure is reported by the caller's catch.
export type BakePainting = (
  scene: SpaceScene,
  particles: ParticleSet,
  colours: SceneColours,
  lightDir: [number, number, number],
  params: PaintParams,
  authored: AuthoredFraming,
) => BakedPainting

// Colour-only changes (classifyChange 'colour': curve, mix, environment colour,
// adjustment curves) recolour an existing bake in place of re-baking: same
// strokes, new colours (strokes and underpainting). Must equal a full re-bake
// bit for bit. Runs where the bake was made (it keeps the recipes beside it);
// null when `baked` was not made there.
export type RecolourBake = (baked: BakedPainting, params: PaintParams) => BakedPainting | null

// Per frame (main thread, ≤ 5 ms at 50k strokes): select the baked strokes
// this view shows, take each one's sub-arc and project it, size it by the
// zoom, fade by |n·v|, choose the side, order by view depth within a layer,
// and append this view's silhouette outline strokes and data-mark shapes. The
// result is an ordinary StrokeBatch the existing renderer paints (its depth
// pre-pass hides what is behind a surface). `gbuffer` is optional and may be a
// frame old: only the silhouette strokes read it (what lies beyond the
// outline); null reads the canvas there.
export type FrameFromBake = (
  baked: BakedPainting,
  scene: SpaceScene,
  view: PaintView,
  params: PaintParams,
  gbuffer: GBuffer | null,
) => StrokeBatch
