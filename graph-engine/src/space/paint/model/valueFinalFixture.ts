// The frame under test for the value rule in the final picture (valueFinal*.test.ts): a sphere on a table with a line round it,
// its strokes made and packed (the roles that lie on a surface; with `edges`, the contour and plane-edge strokes and the line
// strokes), the lightness each stroke and each underpainting pixel is painted at, and the family of the pixel it stands on.
//
// THE VIEWS are cameras AND lights that differ: the key light is camera-relative in the model's own view (it follows the camera),
// so a set of cameras round one light-and-camera pair is one picture five times. A GridView can fix the light in the world
// instead (`light`: azimuth and elevation of the direction toward it, degrees), which is what the lab's "world-fixed light" will
// be; `viewOf` builds its lightDir independently of the camera.

import { PATH_POINTS, ROLES, type GBuffer, type Oklab, type PaintView } from '../types'
import { resolvePaintParams, type PaintParams } from '../params'
import { lchToLab, linearToOklab } from './colour'
import { contourRuns, edgeStrokes } from './contours'
import { buildContext, buildParticles } from './index'
import { lineStrokes } from './lines'
import { dabStrokes, particleStrokes, scumbleMask } from './roles'
import { packStrokes, type PaintCtx } from './strokes'
import { flatColours, lineMark, makeGBuffer, paintView, pixelRay, sceneOf, sphereGBuffer, sphereMesh, tableMesh, type ViewOpts } from './testing'
import { buildUnderpaintField, underpaintImage } from './underpaint'
import { CAST_FADE, rawLitValue } from './value'
import { gIndex } from './view'

export const CANVAS = lchToLab(0.9, 0.01, 85)
const LINE_COLOUR = lchToLab(0.4, 0.05, 55)

export interface Made {
  an: PaintCtx
  batch: ReturnType<typeof packStrokes>['batch']
  g: GBuffer
  view: PaintView
}

// A ring of line on the table round the sphere: it crosses the light, the cast shadow and the far side.
const RING = lineMark(Array.from({ length: 25 }, (_, k) => [1.5 * Math.cos((k / 24) * 2 * Math.PI), 1.5 * Math.sin((k / 24) * 2 * Math.PI), -0.99] as [number, number, number]), { index: 2 })
export const SCENE = sceneOf([sphereMesh({ radius: 1 }), tableMesh({ z: -1, half: 3, index: 1 }), RING])
const gbuffers = new Map<string, GBuffer>()
const particleSets = new Map<string, ReturnType<typeof buildParticles>>()

type Opts = ViewOpts & { light?: readonly [number, number] }

// The direction toward a light fixed in the world (azimuth, elevation in degrees: z is up).
export function worldLight(azimuth: number, elevation: number): [number, number, number] {
  const a = (azimuth * Math.PI) / 180
  const e = (elevation * Math.PI) / 180
  return [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)]
}

// A view of the sphere's scene: the camera from the options, and the light the camera's (the default) or, with `light`, fixed in the world.
export function viewOf(opts: Opts, size: readonly number[] = [640, 480, 120]): PaintView {
  const { light, ...camera } = opts
  const view = paintView({ width: size[0], height: size[1], zoom: size[2], ...camera })
  return light ? { ...view, lightDir: worldLight(light[0], light[1]) } : view
}

// The strokes of the roles that lie on a surface (and, with `edges`, the contour, plane-edge and line strokes), packed. (The
// particles of a seed and the G-buffer of a view are made once: the grid is the same sphere in many frames, and a flat local colour
// is the same on every particle of the mesh.)
export function made(params: PaintParams, local: Oklab, opts: Opts, edges = false, size: readonly number[] = [640, 480, 120]): Made {
  const view = viewOf(opts, size)
  const key = JSON.stringify([opts, size, params.light])
  let g = gbuffers.get(key)
  if (!g) {
    g = sphereGBuffer(size[0], size[1], { view, params, table: { z: -1, mark: 1 } })
    gbuffers.set(key, g)
  }
  const pkey = JSON.stringify([params.seed, params.particles])
  let set = particleSets.get(pkey)
  if (!set) {
    set = buildParticles(SCENE, flatColours({ 0: local, 1: CANVAS, 2: LINE_COLOUR }), params)
    particleSets.set(pkey, set)
  }
  // the sphere's particles take the local colour (a flat colour is the same on every particle of the mesh)
  for (let i = 0; i < set.count; i++) if (set.mark[i] === 0) set.colour.set(local, 3 * i)
  const an = buildContext(SCENE, set, view, g, params)
  scumbleMask(an)
  particleStrokes(an)
  dabStrokes(an)
  if (edges) {
    edgeStrokes(an, [...an.edges.edges.filter((e) => e.type !== 'silhouette'), ...contourRuns(an)])
    lineStrokes(an)
  }
  return { an, batch: packStrokes(an.drafts, params).batch, g, view }
}

// ---- a small sphere's shadow on a big one ----

type V3 = [number, number, number]
const unit = (a: number[]): V3 => {
  const l = Math.hypot(a[0], a[1], a[2])
  return [a[0] / l, a[1] / l, a[2] / l]
}
const hitSphere = (o: number[], d: number[], c: number[], r: number): number | null => {
  const ox = o[0] - c[0]
  const oy = o[1] - c[1]
  const oz = o[2] - c[2]
  const b = ox * d[0] + oy * d[1] + oz * d[2]
  const disc = b * b - (ox * ox + oy * oy + oz * oz - r * r)
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t > 1e-6 ? t : null
}
const occluded = (p: number[], L: number[], c: number[], r: number): boolean => {
  const ox = p[0] - c[0]
  const oy = p[1] - c[1]
  const oz = p[2] - c[2]
  const b = ox * L[0] + oy * L[1] + oz * L[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  return disc >= 0 && -b + Math.sqrt(disc) > 0 && cc > 0
}

// A big sphere (mark 0), a small one (mark 1) held in the key light so that its shadow falls on the big sphere where N·L is `nlAt`, and a
// table (mark 2): the G-buffer flags a pixel as in shadow where N·L <= 0 or the other sphere is between it and the light, as the renderer does.
export function madeTwoSpheres(params: PaintParams, local: Oklab, nlAt: number, opts: Opts, size: readonly number[] = [640, 480, 110]): Made {
  const view = viewOf(opts, size)
  const L = view.lightDir
  // the point of the big sphere whose N·L is nlAt, on the side facing the camera: n0 = nlAt L + sqrt(1 - nlAt²) t, t the camera's direction
  // made perpendicular to L
  const toCam = unit([-view.viewDir[0], -view.viewDir[1], -view.viewDir[2]])
  const d = toCam[0] * L[0] + toCam[1] * L[1] + toCam[2] * L[2]
  const t = unit([toCam[0] - d * L[0], toCam[1] - d * L[1], toCam[2] - d * L[2]])
  const s = Math.sqrt(1 - nlAt * nlAt)
  const n0 = [nlAt * L[0] + s * t[0], nlAt * L[1] + s * t[1], nlAt * L[2] + s * t[2]]
  const centre: V3 = [n0[0] * 1.05 + L[0] * 0.9, n0[1] * 1.05 + L[1] * 0.9, n0[2] * 1.05 + L[2] * 0.9]
  const radius = 0.32
  const scene = sceneOf([sphereMesh({ radius: 1, index: 0 }), sphereMesh({ radius, centre, index: 1 }), tableMesh({ z: -1, half: 3, index: 2 })])
  const g = makeGBuffer(view, 2, (x, y) => {
    const ray = pixelRay(view, x, y)
    let best: { depth: number; normal: V3; value: number; shadow: boolean; mark: number } | null = null
    let bestDepth = Infinity
    for (const [c, r, mark] of [[[0, 0, 0], 1, 0], [centre, radius, 1]] as [number[], number, number][]) {
      const tt = hitSphere(ray.origin, ray.dir, c, r)
      if (tt === null) continue
      const p = [ray.origin[0] + ray.dir[0] * tt, ray.origin[1] + ray.dir[1] * tt, ray.origin[2] + ray.dir[2] * tt]
      const depth = (p[0] - view.eye[0]) * view.viewDir[0] + (p[1] - view.eye[1]) * view.viewDir[1] + (p[2] - view.eye[2]) * view.viewDir[2]
      if (depth >= bestDepth) continue
      const n: V3 = [(p[0] - c[0]) / r, (p[1] - c[1]) / r, (p[2] - c[2]) / r]
      const shadow = n[0] * L[0] + n[1] * L[1] + n[2] * L[2] <= 0 || (mark === 0 ? occluded(p, L, centre, radius) : occluded(p, L, [0, 0, 0], 1))
      bestDepth = depth
      best = { depth, normal: n, value: rawLitValue(params, n, L, shadow), shadow, mark }
    }
    if (Math.abs(ray.dir[2]) > 1e-9) {
      const tt = (-1 - ray.origin[2]) / ray.dir[2]
      if (tt > 0) {
        const p = [ray.origin[0] + ray.dir[0] * tt, ray.origin[1] + ray.dir[1] * tt, -1]
        const depth = (p[0] - view.eye[0]) * view.viewDir[0] + (p[1] - view.eye[1]) * view.viewDir[1] + (p[2] - view.eye[2]) * view.viewDir[2]
        if (depth < bestDepth) {
          const shadow = occluded(p, L, [0, 0, 0], 1) || occluded(p, L, centre, radius)
          best = { depth, normal: [0, 0, 1], value: rawLitValue(params, [0, 0, 1], L, shadow), shadow, mark: 2 }
        }
      }
    }
    return best
  })
  // (the small sphere moves with nlAt and the view, so its particles are made for each frame)
  const an = buildContext(scene, buildParticles(scene, flatColours({ 0: local, 1: local, 2: CANVAS }), params), view, g, params)
  scumbleMask(an)
  particleStrokes(an)
  dabStrokes(an)
  return { an, batch: packStrokes(an.drafts, params).batch, g, view }
}

// The lightness a stroke is painted at: the colour the renderer gets.
export const lightnessOf = (batch: Made['batch'], i: number): number => linearToOklab(batch.colour[3 * i], batch.colour[3 * i + 1], batch.colour[3 * i + 2])[0]

export interface Spread {
  maxShadow: number
  minLight: number
  nShadow: number
  nLight: number
  // The edge strokes that lie wholly in the shadow family (counted in maxShadow), and the lowest N·L a stroke that carries the canvas's
  // colour (a bridge to it) reaches on the sphere.
  nEdgeShadow: number
  // The lightest of those edge strokes.
  maxShadowEdge: number
  canvasReach: number
  nLine: number
  // The shadow strokes that stand in a cast shadow past the terminator's fade (flagged by the shadow map at N·L > 0), counted in nShadow.
  nCast: number
}

// The darkest light-family stroke against the lightest shadow-family stroke on the sphere (the table's own strokes are of another local colour).
// The terminator's own soft edge, and the fade a cast shadow takes over in, belong to neither. The shadow family includes the edge strokes that
// lie wholly in it; the light family is the surface strokes (a found edge is a painter's dark accent on the lit side, darker than its side).
export function spreadOf(m: Made, params: PaintParams, roles: string[] = []): Spread {
  const ts = params.value.terminatorSoftness
  const s: Spread = { maxShadow: -1, minLight: 2, nShadow: 0, nLight: 0, nEdgeShadow: 0, maxShadowEdge: -1, canvasReach: 9, nLine: 0, nCast: 0 }
  for (let i = 0; i < m.batch.count; i++) {
    const d = m.an.drafts[i]
    const role = ROLES[d.role]
    if (roles.length > 0 && !roles.includes(role)) continue
    if (role === 'line') {
      s.nLine++
      continue
    }
    if (role === 'edge') {
      // the N·L under the stretch of the sphere the stroke lies over: its lowest, and its median
      const nls: number[] = []
      for (let q = 0; q < PATH_POINTS; q++) {
        const gi = gIndex(m.an.fc, d.path[2 * q], d.path[2 * q + 1])
        if (gi >= 0 && m.an.fc.g.mark[gi] === 0) nls.push(m.an.plan.nl[gi])
      }
      if (nls.length === 0) continue
      nls.sort((x, y) => x - y)
      const lo = nls[0]
      const median = nls[nls.length >> 1]
      if (d.colour && (Array.isArray(d.colour.a) || Array.isArray(d.colour.b))) s.canvasReach = Math.min(s.canvasReach, lo)
      // an edge stroke of the figure (the figure's recipe is one of its colours, whatever it is bridged to: the table's own edges, such as a cast
      // shadow's, are the table's colour, a light one) that lies, for the most part, plainly in the shadow (a stroke on the terminator's own edge is no shadow-side stroke)
      const ofFigure = !!d.colour && [d.colour.a, d.colour.b].some((c) => c && !Array.isArray(c) && !(c as { ground: boolean }).ground)
      if (ofFigure && nls.length >= 4 && median <= -ts / 2 - 0.02) {
        s.nEdgeShadow++
        s.maxShadowEdge = Math.max(s.maxShadowEdge, lightnessOf(m.batch, i))
        s.maxShadow = Math.max(s.maxShadow, lightnessOf(m.batch, i))
      }
      continue
    }
    const gi = gIndex(m.an.fc, d.mx, d.my)
    if (gi < 0 || m.an.fc.g.mark[gi] !== 0) continue
    // (a table particle seen at the edge of the sphere is the table's colour, a light one, and not the figure's)
    const own = d.colour?.a
    if (!own || Array.isArray(own) || (own as { ground: boolean }).ground) continue
    const nl = m.an.plan.nl[gi]
    const shadow = m.an.fc.g.shadow[gi] === 1
    const L = lightnessOf(m.batch, i)
    if (nl <= -ts / 2 || (shadow && nl >= ts / 2 + CAST_FADE)) {
      s.nShadow++
      if (nl > 0) s.nCast++
      s.maxShadow = Math.max(s.maxShadow, L)
    } else if (!shadow && nl >= ts / 2) {
      s.nLight++
      s.minLight = Math.min(s.minLight, L)
    }
  }
  return s
}

// The same for the underpainting, per pixel of the sphere: the lightest shadow pixel against the darkest half-tone pixel (outside the
// terminator's own soft band, and the fade a cast shadow takes over in).
export function underpaintSpread(m: Made, params: PaintParams): { maxShadow: number; minLight: number; nShadow: number; nLight: number } {
  const ts = params.value.terminatorSoftness
  const under = underpaintImage(buildUnderpaintField(m.an, m.g), params, m.an.env)
  const L = m.view.lightDir
  const out = { maxShadow: -1, minLight: 2, nShadow: 0, nLight: 0 }
  for (let i = 0; i < m.g.width * m.g.height; i++) {
    if (m.g.mark[i] !== 0 || Number.isNaN(under[3 * i])) continue
    const nl = m.g.normal[3 * i] * L[0] + m.g.normal[3 * i + 1] * L[1] + m.g.normal[3 * i + 2] * L[2]
    const shadow = m.g.shadow[i] === 1
    const lightness = linearToOklab(under[3 * i], under[3 * i + 1], under[3 * i + 2])[0]
    if (nl <= -ts / 2 || (shadow && nl >= ts / 2 + CAST_FADE)) {
      out.nShadow++
      out.maxShadow = Math.max(out.maxShadow, lightness)
    } else if (!shadow && nl >= ts / 2) {
      out.nLight++
      out.minLight = Math.min(out.minLight, lightness)
    }
  }
  return out
}

// How a view lights the sphere: the share of the sphere's pixels that face away from the key light, and how high the light stands over the table.
// Two views that differ in neither are the same picture.
export function viewSignature(opts: Opts, size: readonly number[] = [320, 240, 60]): [number, number] {
  const view = viewOf(opts, size)
  const g = sphereGBuffer(size[0], size[1], { view, table: { z: -1, mark: 1 } })
  const L = view.lightDir
  let sphere = 0
  let away = 0
  for (let i = 0; i < g.width * g.height; i++) {
    if (g.mark[i] !== 0) continue
    sphere++
    if (g.normal[3 * i] * L[0] + g.normal[3 * i + 1] * L[1] + g.normal[3 * i + 2] * L[2] <= 0) away++
  }
  return [away / sphere, L[2]]
}

// ---- the grid ----

// The scenario of the first review: a key light at azimuth 30 degrees and elevation 5 (relative to a camera at elevation 2 degrees),
// where the table is nearly at a graze, a cast shadow stretches far across it, and small slivers of core shadow sit beside the half-tones.
export const SCENARIO = { elevation: 2, lightAzimuth: 30, lightElevation: 5 }

export interface GridView {
  name: string
  opts: Opts
}
// Six views that are six pictures: the default light on the default camera, and five cameras each with its own light fixed in the world (the last
// has the light behind the camera: the figure is lit all over, and the outline has no shadow side).
export const GRID_VIEWS: GridView[] = [
  { name: 'default light, camera 30/25', opts: { azimuth: 30, elevation: 25 } },
  { name: 'world light 30/5, camera 200/2', opts: { azimuth: 200, elevation: 2, light: [30, 5] } },
  { name: 'world light 110/5, camera 20/2', opts: { azimuth: 20, elevation: 2, light: [110, 5] } },
  { name: 'world light 200/10, camera 110/10', opts: { azimuth: 110, elevation: 10, light: [200, 10] } },
  { name: 'world light 260/45, camera 290/6', opts: { azimuth: 290, elevation: 6, light: [260, 45] } },
  { name: 'world light 30/5, camera 20/2 (the light behind the camera)', opts: { azimuth: 20, elevation: 2, light: [30, 5] } },
]
export const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8]
export const LOCALS: [string, Oklab][] = [
  ['terracotta', lchToLab(0.56, 0.14, 38)],
  ['pale yellow', lchToLab(0.9, 0.12, 95)],
  ['dark blue', lchToLab(0.35, 0.12, 260)],
  ['grey', lchToLab(0.6, 0, 0)],
  ['saturated green', lchToLab(0.72, 0.22, 145)],
]

export interface GridResult {
  strokeMargin: number
  strokeAt: string
  underMargin: number
  underAt: string
  // The fewest strokes and pixels of either family in any frame, the lowest N·L a canvas bridge reaches, and the fewest edge and line strokes.
  fewestShadow: number
  fewestLight: number
  fewestUnderShadow: number
  fewestUnderLight: number
  canvasReach: number
  fewestEdgeShadow: number
  fewestLines: number
  // How many frames of each view had both families in strokes and in pixels to compare (the others are all light or all shadow).
  comparedPerView: number[]
}

// The smallest margins of the grid (seeds x views x local colours): the surface and shadow-edge strokes, and the underpainting.
export function gridMargin(overrides: Partial<PaintParams>, seeds: number[], views: GridView[] = GRID_VIEWS): GridResult {
  const r: GridResult = {
    strokeMargin: Infinity, strokeAt: '', underMargin: Infinity, underAt: '', fewestShadow: Infinity, fewestLight: Infinity,
    fewestUnderShadow: Infinity, fewestUnderLight: Infinity, canvasReach: 9, fewestEdgeShadow: Infinity, fewestLines: Infinity, comparedPerView: [],
  }
  for (const seed of seeds) {
    const params = resolvePaintParams({ ...overrides, seed })
    for (const [name, local] of LOCALS) {
      views.forEach((v, vi) => {
        const m = made(params, local, v.opts, true)
        const s = spreadOf(m, params)
        const u = underpaintSpread(m, params)
        r.fewestLines = Math.min(r.fewestLines, s.nLine)
        r.canvasReach = Math.min(r.canvasReach, s.canvasReach)
        r.comparedPerView[vi] ??= 0
        // (a frame with only one family to look at has nothing to compare)
        if (s.nShadow >= 5 && s.nLight >= 5) {
          r.comparedPerView[vi]++
          r.fewestShadow = Math.min(r.fewestShadow, s.nShadow)
          r.fewestLight = Math.min(r.fewestLight, s.nLight)
          r.fewestEdgeShadow = Math.min(r.fewestEdgeShadow, s.nEdgeShadow)
          if (s.minLight - s.maxShadow < r.strokeMargin) {
            r.strokeMargin = s.minLight - s.maxShadow
            r.strokeAt = `seed ${seed}, ${name}, ${v.name}: shadow ${s.maxShadow.toFixed(3)}, half-tone ${s.minLight.toFixed(3)}`
          }
        }
        if (u.nShadow >= 50 && u.nLight >= 50) {
          r.fewestUnderShadow = Math.min(r.fewestUnderShadow, u.nShadow)
          r.fewestUnderLight = Math.min(r.fewestUnderLight, u.nLight)
          if (u.minLight - u.maxShadow < r.underMargin) {
            r.underMargin = u.minLight - u.maxShadow
            r.underAt = `seed ${seed}, ${name}, ${v.name}: shadow ${u.maxShadow.toFixed(3)}, half-tone ${u.minLight.toFixed(3)}`
          }
        }
      })
    }
  }
  return r
}
