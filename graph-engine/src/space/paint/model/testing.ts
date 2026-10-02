// Synthetic scenes, views and G-buffers for the paint model's tests, and for
// the renderer's and the lab's (Tasks 3, 5 and 6): nothing here needs WebGL.
//
// A G-buffer is analytic: every pixel is an orthographic (or perspective) ray
// against a sphere or a plane, shaded with the SAME raw lit-value formula the
// renderer writes (value.ts rawLitValue), so a model test sees what the real
// pass would give for a simple figure.

import { invert, lookFrom, multiply, ortho, perspective } from '../../camera/mat4'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import type { ArrowMark, LineMark, MeshMark, PointMark, SpaceScene } from '../../scene/types'
import type { GBuffer, Oklab, PaintView, SceneColours } from '../types'
import { rawLitValue } from './value'
import { D2R, vnorm, type V3 } from './math'

export interface ViewOpts {
  width?: number
  height?: number
  // The camera's turntable azimuth and elevation, degrees.
  azimuth?: number
  elevation?: number
  // CSS pixels per world unit at the target.
  zoom?: number
  // PaintView.zoom: how far in the view is against the framing the strokes' sizes were tuned at (absent: 1).
  magnify?: number
  target?: V3
  // The key light relative to the camera: azimuth (+ = to the viewer's left) and elevation, degrees.
  lightAzimuth?: number
  lightElevation?: number
  perspective?: boolean
  dragging?: boolean
  pixelRatio?: number
}

// A PaintView for an orthographic (default) or perspective camera on the
// turntable (space/camera/turntable.ts): z is up, the camera looks at `target`.
export function paintView(opts: ViewOpts = {}): PaintView {
  const width = opts.width ?? 400
  const height = opts.height ?? 300
  const az = (opts.azimuth ?? 30) * D2R
  const el = (opts.elevation ?? 25) * D2R
  const zoom = opts.zoom ?? 100
  const target = opts.target ?? [0, 0, 0]
  const back: V3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]
  const right: V3 = [-Math.sin(az), Math.cos(az), 0]
  const forward: V3 = [-back[0], -back[1], -back[2]]
  const up: V3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ]
  const halfH = height / (2 * zoom)
  const halfW = width / (2 * zoom)
  let dist = 20
  let proj: Float64Array
  if (opts.perspective) {
    const fovY = (30 * Math.PI) / 180
    dist = halfH / Math.tan(fovY / 2)
    proj = perspective(fovY, width / height, dist * 0.1, dist * 4)
  } else {
    proj = ortho(-halfW, halfW, -halfH, halfH, dist - 12, dist + 12)
  }
  const eye: V3 = [target[0] + back[0] * dist, target[1] + back[1] * dist, target[2] + back[2] * dist]
  const view = lookFrom(eye, right, up, back)
  const vp = multiply(proj, view)
  // the light, camera-relative: x right, y up, z toward the viewer
  const la = (opts.lightAzimuth ?? DEFAULT_PAINT_PARAMS.light.azimuth) * D2R
  const le = (opts.lightElevation ?? DEFAULT_PAINT_PARAMS.light.elevation) * D2R
  const lc: V3 = [-Math.sin(la) * Math.cos(le), Math.sin(le), Math.cos(la) * Math.cos(le)]
  const lightDir = vnorm([
    right[0] * lc[0] + up[0] * lc[1] + back[0] * lc[2],
    right[1] * lc[0] + up[1] * lc[1] + back[1] * lc[2],
    right[2] * lc[0] + up[2] * lc[1] + back[2] * lc[2],
  ])
  return {
    viewProj: new Float32Array(vp),
    view: new Float32Array(view),
    eye,
    viewDir: forward,
    lightDir,
    width,
    height,
    pixelRatio: opts.pixelRatio ?? 1,
    dragging: opts.dragging ?? false,
    ...(opts.magnify !== undefined ? { zoom: opts.magnify } : {}),
  }
}

const inverses = new WeakMap<PaintView, Float64Array>()

// The world ray through CSS pixel (x, y): an origin on the near plane and a
// unit direction away from the eye.
export function pixelRay(view: PaintView, x: number, y: number): { origin: V3; dir: V3 } {
  let inv = inverses.get(view)
  if (!inv) {
    inv = invert(new Float64Array(view.viewProj)) ?? new Float64Array(16)
    inverses.set(view, inv)
  }
  const nx = (x / view.width) * 2 - 1
  const ny = 1 - (y / view.height) * 2
  const at = (z: number): V3 => {
    const w = inv[3] * nx + inv[7] * ny + inv[11] * z + inv[15]
    return [
      (inv[0] * nx + inv[4] * ny + inv[8] * z + inv[12]) / w,
      (inv[1] * nx + inv[5] * ny + inv[9] * z + inv[13]) / w,
      (inv[2] * nx + inv[6] * ny + inv[10] * z + inv[14]) / w,
    ]
  }
  const a = at(-1)
  const b = at(1)
  return { origin: a, dir: vnorm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]) }
}

export interface GPixel {
  depth: number
  normal: readonly number[]
  value: number
  shadow?: boolean
  mark: number
}

// A G-buffer for `view`, one pixel per `scale` CSS px, from a function of the
// pixel's centre in CSS px. Return null for an empty pixel.
export function makeGBuffer(view: PaintView, scale: number, pixel: (x: number, y: number) => GPixel | null): GBuffer {
  const width = Math.ceil(view.width / scale)
  const height = Math.ceil(view.height / scale)
  const n = width * height
  const g: GBuffer = {
    width,
    height,
    scale,
    depth: new Float32Array(n).fill(Number.POSITIVE_INFINITY),
    normal: new Float32Array(3 * n),
    value: new Float32Array(n).fill(-1),
    shadow: new Uint8Array(n),
    mark: new Int32Array(n).fill(-1),
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = pixel((x + 0.5) * scale, (y + 0.5) * scale)
      if (!p) continue
      const i = y * width + x
      g.depth[i] = p.depth
      g.normal[3 * i] = p.normal[0]
      g.normal[3 * i + 1] = p.normal[1]
      g.normal[3 * i + 2] = p.normal[2]
      g.value[i] = p.value
      g.shadow[i] = p.shadow ? 1 : 0
      g.mark[i] = p.mark
    }
  }
  return g
}

function hitSphere(o: V3, d: V3, c: readonly number[], r: number): number | null {
  const ox = o[0] - c[0]
  const oy = o[1] - c[1]
  const oz = o[2] - c[2]
  const b = ox * d[0] + oy * d[1] + oz * d[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  if (disc < 0) return null
  const t = -b - Math.sqrt(disc)
  return t
}

const depthOf = (view: PaintView, p: readonly number[]): number =>
  (p[0] - view.eye[0]) * view.viewDir[0] + (p[1] - view.eye[1]) * view.viewDir[1] + (p[2] - view.eye[2]) * view.viewDir[2]

export interface SphereGOpts {
  view?: PaintView
  params?: PaintParams
  // CSS px per G-buffer pixel (the renderer reads back at 2).
  scale?: number
  centre?: V3
  radius?: number
  // The mark index of the sphere (default 0).
  mark?: number
  // A horizontal table under it, which the sphere shadows.
  table?: { z: number; mark: number }
}

// A sphere (and optionally the table it sits on), as the renderer's G-buffer
// would hold it.
export function sphereGBuffer(width: number, height: number, opts: SphereGOpts = {}): GBuffer {
  const view = opts.view ?? paintView({ width, height })
  const params = opts.params ?? DEFAULT_PAINT_PARAMS
  const c = opts.centre ?? [0, 0, 0]
  const r = opts.radius ?? 1
  const mark = opts.mark ?? 0
  return makeGBuffer(view, opts.scale ?? 2, (x, y) => {
    const ray = pixelRay(view, x, y)
    const t = hitSphere(ray.origin, ray.dir, c, r)
    let best: GPixel | null = null
    let bestDepth = Number.POSITIVE_INFINITY
    if (t !== null) {
      const p: V3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t]
      const n: V3 = [(p[0] - c[0]) / r, (p[1] - c[1]) / r, (p[2] - c[2]) / r]
      bestDepth = depthOf(view, p)
      best = { depth: bestDepth, normal: n, value: rawLitValue(params, n, view.lightDir, false), mark }
    }
    if (opts.table) {
      const tz = opts.table.z
      if (Math.abs(ray.dir[2]) > 1e-9) {
        const tt = (tz - ray.origin[2]) / ray.dir[2]
        const p: V3 = [ray.origin[0] + ray.dir[0] * tt, ray.origin[1] + ray.dir[1] * tt, tz]
        const d = depthOf(view, p)
        if (d < bestDepth) {
          const shadow = shadowedBySphere(p, view.lightDir, c, r)
          best = { depth: d, normal: [0, 0, 1], value: rawLitValue(params, [0, 0, 1], view.lightDir, shadow), shadow, mark: opts.table.mark }
        }
      }
    }
    return best
  })
}

function shadowedBySphere(p: V3, L: readonly number[], c: readonly number[], r: number): boolean {
  const ox = p[0] - c[0]
  const oy = p[1] - c[1]
  const oz = p[2] - c[2]
  const b = ox * L[0] + oy * L[1] + oz * L[2]
  const cc = ox * ox + oy * oy + oz * oz - r * r
  const disc = b * b - cc
  return disc >= 0 && -b + Math.sqrt(disc) > 0 && cc > 0
}

export interface PlaneGOpts {
  view?: PaintView
  params?: PaintParams
  scale?: number
  // A point on the plane and its unit normal (default: the horizontal plane z = 0).
  point?: V3
  normal?: V3
  mark?: number
  // A sphere that casts a shadow on it.
  occluder?: { centre: V3; radius: number }
  // Restrict the plane to a disc about `point`, in world units (otherwise it fills the screen).
  extent?: number
}

// A plane, optionally shadowed by a sphere.
export function planeGBuffer(width: number, height: number, opts: PlaneGOpts = {}): GBuffer {
  const view = opts.view ?? paintView({ width, height })
  const params = opts.params ?? DEFAULT_PAINT_PARAMS
  const p0 = opts.point ?? [0, 0, 0]
  const n = opts.normal ?? [0, 0, 1]
  const mark = opts.mark ?? 0
  return makeGBuffer(view, opts.scale ?? 2, (x, y) => {
    const ray = pixelRay(view, x, y)
    const denom = n[0] * ray.dir[0] + n[1] * ray.dir[1] + n[2] * ray.dir[2]
    if (Math.abs(denom) < 1e-9) return null
    const t = ((p0[0] - ray.origin[0]) * n[0] + (p0[1] - ray.origin[1]) * n[1] + (p0[2] - ray.origin[2]) * n[2]) / denom
    const p: V3 = [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t]
    if (opts.extent !== undefined && Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]) > opts.extent) return null
    const shadow = opts.occluder ? shadowedBySphere(p, view.lightDir, opts.occluder.centre, opts.occluder.radius) : false
    return { depth: depthOf(view, p), normal: n, value: rawLitValue(params, n, view.lightDir, shadow), shadow, mark }
  })
}

export interface MeshGOpts {
  view?: PaintView
  params?: PaintParams
  scale?: number
}

// A software rasteriser: the G-buffer of real triangle meshes (a graph surface,
// a flat quad, a torus), one pixel per `scale` CSS px, nearest wins. Normals
// are interpolated and turned toward the viewer, as a two-sided surface is
// lit; the mark of each pixel is its mesh's index in the scene. Opaque meshes
// only (a veil is not in the G-buffer).
export function meshGBuffer(width: number, height: number, meshes: { mesh: MeshMark; mark: number }[], opts: MeshGOpts = {}): GBuffer {
  const view = opts.view ?? paintView({ width, height })
  const params = opts.params ?? DEFAULT_PAINT_PARAMS
  const scale = opts.scale ?? 2
  const gw = Math.ceil(view.width / scale)
  const gh = Math.ceil(view.height / scale)
  const n = gw * gh
  const g: GBuffer = {
    width: gw,
    height: gh,
    scale,
    depth: new Float32Array(n).fill(Number.POSITIVE_INFINITY),
    normal: new Float32Array(3 * n),
    value: new Float32Array(n).fill(-1),
    shadow: new Uint8Array(n),
    mark: new Int32Array(n).fill(-1),
  }
  const m = view.viewProj
  const toEye = (px: number, py: number, pz: number): V3 => {
    const ortho = m[3] === 0 && m[7] === 0 && m[11] === 0
    if (ortho) return [-view.viewDir[0], -view.viewDir[1], -view.viewDir[2]]
    return vnorm([view.eye[0] - px, view.eye[1] - py, view.eye[2] - pz])
  }
  for (const { mesh, mark } of meshes) {
    const pos = mesh.positions
    const nv = pos.length / 3
    const sx = new Float64Array(nv)
    const sy = new Float64Array(nv)
    const sw = new Float64Array(nv)
    const sd = new Float64Array(nv)
    for (let i = 0; i < nv; i++) {
      const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]
      const w = m[3] * x + m[7] * y + m[11] * z + m[15]
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12]
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13]
      sw[i] = w
      sx[i] = ((cx / w + 1) / 2) * view.width
      sy[i] = ((1 - cy / w) / 2) * view.height
      sd[i] = (x - view.eye[0]) * view.viewDir[0] + (y - view.eye[1]) * view.viewDir[1] + (z - view.eye[2]) * view.viewDir[2]
    }
    for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
      const a = mesh.indices[t], b = mesh.indices[t + 1], c = mesh.indices[t + 2]
      if (sw[a] <= 0 || sw[b] <= 0 || sw[c] <= 0) continue
      const area = (sx[b] - sx[a]) * (sy[c] - sy[a]) - (sx[c] - sx[a]) * (sy[b] - sy[a])
      if (Math.abs(area) < 1e-12) continue
      const minX = Math.max(0, Math.floor(Math.min(sx[a], sx[b], sx[c]) / scale - 1))
      const maxX = Math.min(gw - 1, Math.ceil(Math.max(sx[a], sx[b], sx[c]) / scale + 1))
      const minY = Math.max(0, Math.floor(Math.min(sy[a], sy[b], sy[c]) / scale - 1))
      const maxY = Math.min(gh - 1, Math.ceil(Math.max(sy[a], sy[b], sy[c]) / scale + 1))
      for (let gy = minY; gy <= maxY; gy++) {
        for (let gx = minX; gx <= maxX; gx++) {
          const px = (gx + 0.5) * scale
          const py = (gy + 0.5) * scale
          const w0 = ((sx[b] - px) * (sy[c] - py) - (sx[c] - px) * (sy[b] - py)) / area
          const w1 = ((sx[c] - px) * (sy[a] - py) - (sx[a] - px) * (sy[c] - py)) / area
          const w2 = 1 - w0 - w1
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue
          // perspective-correct weights
          const q0 = w0 / sw[a], q1 = w1 / sw[b], q2 = w2 / sw[c]
          const qs = q0 + q1 + q2
          const p0 = q0 / qs, p1 = q1 / qs, p2 = q2 / qs
          const depth = p0 * sd[a] + p1 * sd[b] + p2 * sd[c]
          const i = gy * gw + gx
          if (depth >= g.depth[i]) continue
          let nx = p0 * mesh.normals[3 * a] + p1 * mesh.normals[3 * b] + p2 * mesh.normals[3 * c]
          let ny = p0 * mesh.normals[3 * a + 1] + p1 * mesh.normals[3 * b + 1] + p2 * mesh.normals[3 * c + 1]
          let nz = p0 * mesh.normals[3 * a + 2] + p1 * mesh.normals[3 * b + 2] + p2 * mesh.normals[3 * c + 2]
          const nl = Math.hypot(nx, ny, nz) || 1
          nx /= nl
          ny /= nl
          nz /= nl
          const wx = p0 * pos[3 * a] + p1 * pos[3 * b] + p2 * pos[3 * c]
          const wy = p0 * pos[3 * a + 1] + p1 * pos[3 * b + 1] + p2 * pos[3 * c + 1]
          const wz = p0 * pos[3 * a + 2] + p1 * pos[3 * b + 2] + p2 * pos[3 * c + 2]
          const ve = toEye(wx, wy, wz)
          if (nx * ve[0] + ny * ve[1] + nz * ve[2] < 0) {
            nx = -nx
            ny = -ny
            nz = -nz
          }
          g.depth[i] = depth
          g.normal[3 * i] = nx
          g.normal[3 * i + 1] = ny
          g.normal[3 * i + 2] = nz
          g.value[i] = rawLitValue(params, [nx, ny, nz], view.lightDir, false)
          g.mark[i] = mark
        }
      }
    }
  }
  return g
}

// ---- scenes ----

const source = (i: number) => ({ line: i + 1, statement: null, object: `s${i + 1}` })
const style = (opacity = 1, colorScale: number | null = null) => ({
  color: { author: null, slot: 0 },
  opacity,
  colorScale,
  meshLines: null,
})

// A latitude-longitude sphere as a MeshMark, with (u, v) = (longitude, latitude).
export function sphereMesh(opts: { centre?: V3; radius?: number; nu?: number; nv?: number; opacity?: number; index?: number } = {}): MeshMark {
  const c = opts.centre ?? [0, 0, 0]
  const r = opts.radius ?? 1
  const nu = opts.nu ?? 48
  const nv = opts.nv ?? 32
  const verts = (nu + 1) * (nv + 1)
  const positions = new Float64Array(3 * verts)
  const normals = new Float64Array(3 * verts)
  const uv = new Float64Array(2 * verts)
  let k = 0
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const phi = (i / nu) * Math.PI * 2
      const lat = Math.PI * (j / nv - 0.5)
      const n = [Math.cos(lat) * Math.cos(phi), Math.cos(lat) * Math.sin(phi), Math.sin(lat)]
      positions.set([c[0] + r * n[0], c[1] + r * n[1], c[2] + r * n[2]], 3 * k)
      normals.set(n, 3 * k)
      uv.set([phi, lat], 2 * k)
      k++
    }
  }
  const indices = new Uint32Array(nu * nv * 6)
  let t = 0
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i
      const b = a + 1
      const cc = a + nu + 1
      const d = cc + 1
      indices.set([a, b, cc, b, d, cc], t)
      t += 6
    }
  }
  return { kind: 'mesh', source: source(opts.index ?? 0), positions, normals, indices, scalars: null, uv, style: style(opts.opacity ?? 1), pick: null }
}

// A flat rectangle in the plane z = `z`, x in [-half, half], y in [-half, half], normal +z.
export function tableMesh(opts: { z?: number; half?: number; index?: number } = {}): MeshMark {
  const z = opts.z ?? -1
  const h = opts.half ?? 3
  const n = 8
  const verts = (n + 1) * (n + 1)
  const positions = new Float64Array(3 * verts)
  const normals = new Float64Array(3 * verts)
  const uv = new Float64Array(2 * verts)
  let k = 0
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -h + (2 * h * i) / n
      const y = -h + (2 * h * j) / n
      positions.set([x, y, z], 3 * k)
      normals.set([0, 0, 1], 3 * k)
      uv.set([x, y], 2 * k)
      k++
    }
  }
  const indices = new Uint32Array(n * n * 6)
  let t = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      indices.set([a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1], t)
      t += 6
    }
  }
  return { kind: 'mesh', source: source(opts.index ?? 1), positions, normals, indices, scalars: null, uv, style: style(), pick: null }
}

// A flat parallelogram origin + a·e1 + b·e2 (a, b in 0..1), n×n quads, normal e1 × e2.
export function quadMesh(opts: { origin: V3; e1: V3; e2: V3; n?: number; opacity?: number; index?: number }): MeshMark {
  const n = opts.n ?? 6
  const verts = (n + 1) * (n + 1)
  const positions = new Float64Array(3 * verts)
  const normals = new Float64Array(3 * verts)
  const uv = new Float64Array(2 * verts)
  const nrm = vnorm([
    opts.e1[1] * opts.e2[2] - opts.e1[2] * opts.e2[1],
    opts.e1[2] * opts.e2[0] - opts.e1[0] * opts.e2[2],
    opts.e1[0] * opts.e2[1] - opts.e1[1] * opts.e2[0],
  ])
  let k = 0
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const a = i / n
      const b = j / n
      positions.set(
        [
          opts.origin[0] + a * opts.e1[0] + b * opts.e2[0],
          opts.origin[1] + a * opts.e1[1] + b * opts.e2[1],
          opts.origin[2] + a * opts.e1[2] + b * opts.e2[2],
        ],
        3 * k,
      )
      normals.set(nrm, 3 * k)
      uv.set([a, b], 2 * k)
      k++
    }
  }
  const indices = new Uint32Array(n * n * 6)
  let t = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      indices.set([a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1], t)
      t += 6
    }
  }
  return { kind: 'mesh', source: source(opts.index ?? 0), positions, normals, indices, scalars: null, uv, style: style(opts.opacity ?? 1), pick: null }
}

// A graph surface z = f(x, y) over [-half, half]², (u, v) = (x, y), with the
// height as the scalar when `scaled`.
export function graphMesh(
  f: (x: number, y: number) => number,
  opts: { half?: number; n?: number; scaled?: boolean; index?: number } = {},
): MeshMark {
  const h = opts.half ?? 1
  const n = opts.n ?? 24
  const verts = (n + 1) * (n + 1)
  const positions = new Float64Array(3 * verts)
  const normals = new Float64Array(3 * verts)
  const uv = new Float64Array(2 * verts)
  const scalars = new Float64Array(verts)
  const eps = 1e-5
  let k = 0
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -h + (2 * h * i) / n
      const y = -h + (2 * h * j) / n
      const z = f(x, y)
      const fx = (f(x + eps, y) - f(x - eps, y)) / (2 * eps)
      const fy = (f(x, y + eps) - f(x, y - eps)) / (2 * eps)
      positions.set([x, y, z], 3 * k)
      normals.set(vnorm([-fx, -fy, 1]), 3 * k)
      uv.set([x, y], 2 * k)
      scalars[k] = z
      k++
    }
  }
  const indices = new Uint32Array(n * n * 6)
  let t = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i
      indices.set([a, a + 1, a + n + 1, a + 1, a + n + 2, a + n + 1], t)
      t += 6
    }
  }
  return {
    kind: 'mesh',
    source: source(opts.index ?? 0),
    positions,
    normals,
    indices,
    scalars: opts.scaled ? scalars : null,
    uv,
    style: style(1, opts.scaled ? 0 : null),
    pick: null,
  }
}

// A polyline as a LineMark.
export function lineMark(points: V3[], opts: { index?: number; hidden?: 'dashed' | 'none'; dash?: number[] | null; width?: number } = {}): LineMark {
  const positions = new Float64Array(points.flat())
  return {
    kind: 'lines',
    source: source(opts.index ?? 0),
    positions,
    starts: new Uint32Array([0]),
    params: null,
    style: { color: { author: null, slot: 1 }, width: opts.width ?? 2, dash: opts.dash ?? null, hidden: opts.hidden ?? 'none' },
    pick: null,
  }
}

// Points as a PointMark (diameter `size` CSS px).
export function pointMark(points: V3[], opts: { index?: number; size?: number } = {}): PointMark {
  return {
    kind: 'points',
    source: source(opts.index ?? 0),
    positions: new Float64Array(points.flat()),
    style: { color: { author: null, slot: 2 }, size: opts.size ?? 8, shape: 'dot' },
  }
}

// One arrow from `tail` along `vector`.
export function arrowMark(tail: V3, vector: V3, opts: { index?: number; hidden?: 'dashed' | 'none'; headSize?: number } = {}): ArrowMark {
  return {
    kind: 'arrows',
    source: source(opts.index ?? 0),
    tails: new Float64Array(tail),
    vectors: new Float64Array(vector),
    style: { color: { author: null, slot: 3 }, shaftWidth: 2, headSize: opts.headSize ?? 10, hidden: opts.hidden ?? 'none' },
  }
}

export function sceneOf(marks: SpaceScene['marks']): SpaceScene {
  return { marks, labels: [], colorScales: [], extent: null, boxSpanning: { x: false, y: false, z: false }, errors: [] }
}

// Colours by mark index (OKLab); a mark not listed gets a mid grey. `scale`
// colours a colour-scaled mark by value, light to dark.
export function flatColours(byMark: Record<number, Oklab>, scale?: (v: number) => Oklab): SceneColours {
  return {
    markColour: (i) => byMark[i] ?? [0.6, 0, 0],
    scaleColour: (_id, v) => (scale ? scale(v) : null),
  }
}
