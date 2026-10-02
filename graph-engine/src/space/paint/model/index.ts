// The paint model's two entry points (spec 2026-10-02-painted-figures-design.md
// §3; the contract is space/paint/types.ts):
//
//   buildParticles(scene, colours, params)  → ParticleSet     once per scene, seed and particle parameters
//   paintFrame(scene, particles, view, gbuffer, params) → PaintFrame   every frame
//
// A frame is: the model's own value from the G-buffer (curves, occlusion), the
// value plan (zones, plateaus), planes, edge hardness; the visible particles
// thinned to a constant screen density; the strokes of each role walked on the
// surface; edge strokes along the silhouettes, creases and plane boundaries;
// the data marks along their exact geometry; then painting order, the brush
// load mix and the packing into one StrokeBatch.
//
// Everything is deterministic: the same scene, parameters, seed and view give a
// byte-identical frame (every random number is seeded through randomFor; nothing
// reads a clock or Math.random).
//
// SPACE. Mark positions and normals are used as given, in the space viewProj,
// eye, viewDir and lightDir are expressed in (the renderer uploads the same
// numbers). A scene in author coordinates with a non-uniform axis scaling must
// be handed to both in world space, or with a view that includes the box map.
//
// OPAQUE ONLY IN THE G-BUFFER. A mesh with opacity under 1 is a veil: it is
// painted as glazes and must NOT be in the G-buffer (so what lies behind it is
// seen and painted first).

import type { SpaceScene } from '../../scene/types'
import type { PaintParams } from '../params'
import type { GBuffer, Oklab, PaintDebug, PaintFrame, PaintFrameFn, PaintView, ParticleSet } from '../types'
import { contourRuns, edgeStrokes } from './contours'
import { labToLch, lchToLab } from './colour'
import { makeCurve, type Curve } from './curve'
import { extractEdges, type EdgeRun } from './edges'
import { lineStrokes } from './lines'
import { sideOf } from './particles'
import { colourOfDraft, type RecipeEnv } from './recipe'
import { segmentPlanes } from './planes'
import { dabStrokes, particleStrokes, scumbleMask } from './roles'
import { packStrokes, type PaintCtx, type StrokeDraft } from './strokes'
import { buildPlanMap, canvasValue } from './value'
import { makeFrameCtx, visibleParticles } from './view'

export { buildParticles } from './particles'

const curves = new WeakMap<PaintParams, Curve>()
function curveFor(params: PaintParams): Curve {
  let c = curves.get(params)
  if (!c) {
    c = makeCurve(params)
    curves.set(params, c)
  }
  return c
}

// The local colour of bare table: the canvas tone run backward through the
// curve at the value of lit canvas, so a lit table is exactly the canvas and
// its cast shadow is the canvas as the curve darkens it.
export function groundLocal(params: PaintParams): Oklab {
  const p = params.curve
  const tone = labToLch(params.canvas.tone)
  const uC = canvasValue(params)
  const bell = p.cBase + p.cPeak * Math.exp(-(((uC - p.cCentre) / p.cWidth) ** 2))
  return lchToLab(tone[0] - p.lSlope * (uC - p.lPivot), tone[1] / bell, tone[2])
}

// What a stroke's colour recipe reads from the parameters of the moment.
function recipeEnv(params: PaintParams, curve: Curve, ground: Oklab): RecipeEnv {
  return { curve, ground, devL: params.curve.devL, devC: params.curve.devC, devH: params.curve.devH }
}

// The analysis (value plan, occlusion, planes, edges, scumble and dab detection)
// is per G-buffer pixel, and a 1280×800 view reads back 256k of them. A G-buffer
// over ANALYSIS_PIXELS is decimated by whole pixels (nearest) before the
// analysis, so it runs on at most about 64k pixels; the strokes are still walked
// and drawn in CSS px. The debug views are handed back at the full size.
export const ANALYSIS_PIXELS = 100_000
// While the camera is being dragged the analysis is coarser still: about 28k pixels (a 1280x800 view
// reads back 256k, so a stride of 3, 6 CSS px a pixel), because the picture is only a sketch of the
// frame that follows on release.
export const DRAG_ANALYSIS_PIXELS = 40_000
export function analysisStride(g: GBuffer, dragging = false): number {
  const n = g.width * g.height
  if (dragging) return n > DRAG_ANALYSIS_PIXELS ? Math.ceil(Math.sqrt(n / 28_000)) : 1
  return n > ANALYSIS_PIXELS ? Math.ceil(Math.sqrt(n / 64_000)) : 1
}

// Every `stride`-th pixel of the G-buffer, taken at the centre of its block.
function decimate(g: GBuffer, stride: number): GBuffer {
  const w = Math.ceil(g.width / stride)
  const h = Math.ceil(g.height / stride)
  const n = w * h
  const out: GBuffer = {
    width: w,
    height: h,
    scale: g.scale * stride,
    depth: new Float32Array(n),
    normal: new Float32Array(3 * n),
    value: new Float32Array(n),
    shadow: new Uint8Array(n),
    mark: new Int32Array(n),
  }
  const half = Math.floor(stride / 2)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(g.height - 1, y * stride + half)
    for (let x = 0; x < w; x++) {
      const sx = Math.min(g.width - 1, x * stride + half)
      const si = sy * g.width + sx
      const i = y * w + x
      out.depth[i] = g.depth[si]
      out.normal[3 * i] = g.normal[3 * si]
      out.normal[3 * i + 1] = g.normal[3 * si + 1]
      out.normal[3 * i + 2] = g.normal[3 * si + 2]
      out.value[i] = g.value[si]
      out.shadow[i] = g.shadow[si]
      out.mark[i] = g.mark[si]
    }
  }
  return out
}

// Everything a frame's analysis produces before a single stroke is made: the
// value plan, planes, edges and the visible particles (exported for the model's
// own tests; the arrays inside are scratch, valid until the next call).
export function buildContext(scene: SpaceScene, particles: ParticleSet, view: PaintView, full: GBuffer, params: PaintParams): PaintCtx {
  const stride = analysisStride(full, view.dragging)
  const gbuffer = stride > 1 ? decimate(full, stride) : full
  const fc = makeFrameCtx(scene, view, gbuffer, params)
  const plan = buildPlanMap(fc)
  const curve = curveFor(params)
  const planes = segmentPlanes(fc, plan, curve)
  const edges = extractEdges(fc, plan, planes)
  const vis = visibleParticles(fc, particles)
  const side = sideOf(particles, scene.marks.length)

  // the mean local colour of what is visible on each plane and each mesh, for the edge strokes
  const nPlanes = planes.planes.length
  const planeColour = new Float32Array(3 * nPlanes)
  const planeCount = new Uint32Array(nPlanes)
  const markColour = new Float32Array(3 * scene.marks.length)
  const markCount = new Uint32Array(scene.marks.length)
  for (let k = 0; k < vis.count; k++) {
    const i = vis.idx[k]
    const pid = planes.plane[vis.gi[k]]
    const m = particles.mark[i]
    // a veil in front of a surface is seen at that surface's pixel, but its colour is not the surface's:
    // only a particle of the mesh the G-buffer shows there says what the plane looks like
    const onPlane = pid >= 0 && particles.opacity[i] >= 1
    for (let c = 0; c < 3; c++) {
      if (onPlane) planeColour[3 * pid + c] += particles.colour[3 * i + c]
      markColour[3 * m + c] += particles.colour[3 * i + c]
    }
    if (onPlane) planeCount[pid]++
    markCount[m]++
  }
  const planeHasColour = new Uint8Array(nPlanes)
  for (let p = 0; p < nPlanes; p++) {
    if (planeCount[p] > 0) {
      for (let c = 0; c < 3; c++) planeColour[3 * p + c] /= planeCount[p]
      planeHasColour[p] = 1
    }
  }
  for (let m = 0; m < scene.marks.length; m++) {
    if (markCount[m] > 0) for (let c = 0; c < 3; c++) markColour[3 * m + c] /= markCount[m]
    else for (let c = 0; c < 3; c++) markColour[3 * m + c] = side.markColour[m]?.[c] ?? 0.5
  }
  const ground = groundLocal(params)
  return {
    fc,
    set: particles,
    side,
    plan,
    planes,
    edges,
    curve,
    vis,
    groundLocal: ground,
    env: recipeEnv(params, curve, ground),
    planeColour,
    planeHasColour,
    markColour,
    scumbleOk: new Uint8Array(gbuffer.width * gbuffer.height),
    drafts: [],
    nextOrder: 0,
    stride,
  }
}

// An analysis array (one entry per analysis pixel) back at the full G-buffer size, nearest.
function upsample<T extends Float32Array | Int32Array | Uint8Array>(src: T, an: PaintCtx, out: T, full: GBuffer): T {
  const stride = an.stride
  if (stride === 1) {
    out.set(src)
    return out
  }
  const aw = an.fc.g.width
  const ah = an.fc.g.height
  for (let y = 0; y < full.height; y++) {
    const ay = Math.min(ah - 1, Math.floor(y / stride))
    for (let x = 0; x < full.width; x++) out[y * full.width + x] = src[ay * aw + Math.min(aw - 1, Math.floor(x / stride))]
  }
  return out
}

export const paintFrame: PaintFrameFn = (scene: SpaceScene, particles: ParticleSet, view: PaintView, gbuffer: GBuffer, params: PaintParams): PaintFrame => {
  const an = buildContext(scene, particles, view, gbuffer, params)
  const { plan, planes, edges } = an
  scumbleMask(an)
  particleStrokes(an)
  dabStrokes(an)
  // edges: the contours of the meshes for silhouettes and creases, the planes' own boundaries inside and at shadows
  const contours = contourRuns(an)
  const edgeRuns: EdgeRun[] = [...edges.edges.filter((e) => e.type !== 'silhouette'), ...contours]
  edgeStrokes(an, edgeRuns)
  lineStrokes(an)

  const drafts = an.drafts
  const { batch, loads, byRole } = packStrokes(drafts, params)

  // the debug views
  let segments = 0
  for (const e of edgeRuns) segments += Math.max(0, e.h.length - 1)
  const edgeSegments = new Float32Array(4 * segments)
  const edgeClass = new Uint8Array(segments)
  let s = 0
  for (const e of edgeRuns) {
    const scale = an.fc.g.scale
    for (let i = 0; i + 1 < e.h.length; i++) {
      edgeSegments[4 * s] = e.pts[2 * i] * scale
      edgeSegments[4 * s + 1] = e.pts[2 * i + 1] * scale
      edgeSegments[4 * s + 2] = e.pts[2 * i + 2] * scale
      edgeSegments[4 * s + 3] = e.pts[2 * i + 3] * scale
      edgeClass[s] = e.cls[i]
      s++
    }
  }
  // The three per-pixel debug arrays are the size of the full G-buffer and only the lab's debug views read
  // them: they are built when first read, from copies of the analysis arrays (which are scratch).
  const size = gbuffer.width * gbuffer.height
  const snapValue = Float32Array.from(plan.value)
  const snapZones = Uint8Array.from(plan.zone)
  const snapPlanes = planes.plane
  let value: Float32Array | undefined
  let zonesFull: Uint8Array | undefined
  let planesFull: Int32Array | undefined
  const debug: PaintDebug = {
    get value() {
      return (value ??= upsample(snapValue, an, new Float32Array(size), gbuffer))
    },
    get planes() {
      return (planesFull ??= upsample(snapPlanes, an, new Int32Array(size), gbuffer))
    },
    get zones() {
      return (zonesFull ??= upsample(snapZones, an, new Uint8Array(size), gbuffer))
    },
    edgeSegments,
    edgeClass,
  }
  const frame: PaintFrame = { strokes: batch, debug, stats: { strokes: batch.count, byRole, loads } }
  retained.set(frame, drafts)
  return frame
}

// The strokes of each frame, as drafts with their colour recipes, kept beside
// the frame so a change of colour parameters can make the colours again.
const retained = new WeakMap<PaintFrame, StrokeDraft[]>()

// The parameters that change a stroke's COLOUR and nothing else: the curve's own
// numbers and adjustment curves, the environment's colour, and the brush-load
// mix (but not the size of its cell, which is the particles'). Everything else
// (the light, the value plan, the strokes' shape, the edges, the particles, the
// canvas tone) changes where strokes go or how they are made, and needs a full frame.
const COLOUR_ONLY = ['curve', 'curves.lAdjust', 'curves.cAdjust', 'curves.hAdjust', 'curves.mixAmount', 'environment.hue', 'environment.chroma', 'environment.absorption', 'mix']
const NOT_COLOUR_ONLY = ['mix.loadCell']

const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// The dotted paths at which a and b differ; an array (a tuple, a curve) is one leaf.
function differingPaths(a: unknown, b: unknown, path: string, out: string[]): void {
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) differingPaths(a[k], b[k], path === '' ? k : `${path}.${k}`, out)
  } else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path)
}

// Does going from `prev` to `next` change colour parameters only? (True also when nothing changed.)
export function isColourOnlyChange(prev: PaintParams, next: PaintParams): boolean {
  const paths: string[] = []
  differingPaths(prev, next, '', paths)
  return paths.every((p) => isColourPath(p))
}

const isColourPath = (p: string): boolean =>
  !NOT_COLOUR_ONLY.some((n) => p === n || p.startsWith(`${n}.`)) && COLOUR_ONLY.some((c) => p === c || p.startsWith(`${c}.`))

// The parameters only the RENDERER reads: the relief light and strength, the canvas's own texture and weave. The
// model's strokes are the same under any of them, and so are their colours; the picture is made again from them.
const RENDER_ONLY = ['impasto', 'canvas.texture', 'canvas.weave']
const isRenderPath = (p: string): boolean => RENDER_ONLY.some((r) => p === r || p.startsWith(`${r}.`))

// What going from `prev` (the parameters a frame was analysed under) to `next` asks of a frame:
//   same     nothing that matters;
//   render   only renderer parameters changed: the strokes are the frame's own, paint them again;
//   colour   colour parameters (and perhaps renderer ones): the strokes' colours again, no analysis;
//   full     anything else: the whole model.
export type Change = 'same' | 'render' | 'colour' | 'full'
export function classifyChange(prev: PaintParams, next: PaintParams): Change {
  const paths: string[] = []
  differingPaths(prev, next, '', paths)
  if (paths.length === 0) return 'same'
  if (paths.every(isRenderPath)) return 'render'
  return paths.every((p) => isColourPath(p) || isRenderPath(p)) ? 'colour' : 'full'
}

// The frame again with new colour parameters, without the analysis, the walks or
// the geometry: only each stroke's colour is made again from its recipe, then
// the brush-load mix and the packing. It is the frame paintFrame would give for
// the same scene, view and G-buffer under `params` (and a test holds it to
// that), provided `isColourOnlyChange(the params of previous, params)`. The strokes
// are new arrays; the debug views are previous's. Null when `previous` was not
// made by paintFrame.
export function recolourFrame(previous: PaintFrame, params: PaintParams): PaintFrame | null {
  const drafts = retained.get(previous)
  if (!drafts) return null
  const curve = curveFor(params)
  const env = recipeEnv(params, curve, groundLocal(params))
  for (const d of drafts) if (d.colour) d.lab = colourOfDraft(d.colour, env)
  const { batch, loads, byRole } = packStrokes(drafts, params)
  const frame: PaintFrame = { strokes: batch, debug: previous.debug, stats: { strokes: batch.count, byRole, loads } }
  retained.set(frame, drafts)
  return frame
}

