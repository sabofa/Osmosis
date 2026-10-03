// A self-contained page for the baked painting's renderer (Task 5): a PaintRenderer, a hand-made baked sheet (open,
// two-sided: blue on the side its normal points to, orange on the other) and a baked sphere (closed), and a data line
// behind the sphere that is drawn dashed where the sphere (or the sheet) hides it. Nothing here runs the paint model or
// the bake: the surfaces, the strokes and the view are made by hand, so what is on screen is the renderer's own.
//
//   ?mode=front      the camera on the side the sheet's normal points to: the sheet is blue, the sphere hides part of it
//   ?mode=back       the camera on the other side: the sheet is orange and hides the sphere and the line (dashed whole)
//   ?mode=oblique    a turned perspective view: the side is chosen per fragment
//   ?mode=nobake     a frame with an underpainting IMAGE and no baked surfaces, no `hidden`: what the renderer drew before the
//                    baked passes (the same page, run on that commit, must give the same pixels)
//   ?mode=nobake-reproject   the same, re-projected (the depth pass and the warp)
//
// The result is in the page's status line and in window.__paintBakeGl.

import { HIDDEN_DASHED, HIDDEN_NONE, type BakedSurface } from '../../graph-engine/src/space/paint/bake/types'
import { PaintRenderer } from '../../graph-engine/src/space/paint/gl/PaintRenderer'
import { flatColours, paintView, quadMesh, sceneOf, sphereMesh } from '../../graph-engine/src/space/paint/model/testing'
import { DEFAULT_PAINT_PARAMS } from '../../graph-engine/src/space/paint/params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type PaintView, type StrokeBatch } from '../../graph-engine/src/space/paint/types'
import type { MeshMark } from '../../graph-engine/src/space/scene/types'

type V3 = [number, number, number]

const params = new URLSearchParams(location.search)
const mode = params.get('mode') ?? 'front'
const status = document.getElementById('status') as HTMLPreElement
const canvas = document.getElementById('c') as HTMLCanvasElement
const errors: string[] = []

// --- the scene: a vertical sheet in the x-z plane (normal -y) and a sphere in front of it ---------------------------------

const SHEET = quadMesh({ origin: [-1.5, 0, -0.4], e1: [3, 0, 0], e2: [0, 0, 2.2], n: 8, index: 0 })
const SPHERE_AT: V3 = [0.45, -1.2, 0.7]
const SPHERE = sphereMesh({ centre: SPHERE_AT, radius: 0.55, nu: 28, nv: 18, index: 1 })
const SCENE = sceneOf([SHEET, SPHERE])
const COLOURS = flatColours({ 0: [0.6, -0.05, -0.1], 1: [0.6, -0.1, 0.08] })

const f32 = (a: ArrayLike<number>): Float32Array => Float32Array.from(a)

// The sheet's grid is (n + 1)^2 vertices, (a, b) = (i, j) / n across and up.
function bakedSheet(mesh: MeshMark, n: number): BakedSurface {
  const count = mesh.positions.length / 3
  const front = new Float32Array(3 * count)
  const back = new Float32Array(3 * count)
  const alphaFront = new Float32Array(count)
  const alphaBack = new Float32Array(count)
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const v = j * (n + 1) + i
      const a = i / n
      const b = j / n
      // side +1 (the normal's side): blue towards teal across, darker up the sheet
      front.set([0.1 + 0.05 * a, 0.28 + 0.3 * a - 0.12 * b, 0.62 - 0.1 * a - 0.15 * b], 3 * v)
      // side -1: orange towards red across, paler up the sheet
      back.set([0.8 + 0.1 * a, 0.36 - 0.14 * a + 0.2 * b, 0.07 + 0.1 * b], 3 * v)
      // the first column of the front is uncovered: its coverage ramps in across the first quad
      alphaFront[v] = i === 0 ? 0 : 1
      alphaBack[v] = 1
    }
  }
  return {
    mark: 0,
    positions: f32(mesh.positions),
    normals: f32(mesh.normals),
    indices: Uint32Array.from(mesh.indices),
    closed: false,
    underFront: front,
    underBack: back,
    alphaFront,
    alphaBack,
    uFront: new Float32Array(count),
    uBack: new Float32Array(count),
    famFront: new Uint8Array(count),
    famBack: new Uint8Array(count),
    local: new Float32Array(3 * count),
  }
}

function bakedSphere(mesh: MeshMark, light: V3): BakedSurface {
  const count = mesh.positions.length / 3
  const under = new Float32Array(3 * count)
  for (let v = 0; v < count; v++) {
    const lit = Math.max(0, mesh.normals[3 * v] * light[0] + mesh.normals[3 * v + 1] * light[1] + mesh.normals[3 * v + 2] * light[2])
    under.set([0.05 + 0.3 * lit, 0.2 + 0.55 * lit, 0.06 + 0.2 * lit], 3 * v)
  }
  return {
    mark: 1,
    positions: f32(mesh.positions),
    normals: f32(mesh.normals),
    indices: Uint32Array.from(mesh.indices),
    closed: true,
    underFront: under,
    underBack: null,
    alphaFront: new Float32Array(count).fill(1),
    alphaBack: null,
    uFront: new Float32Array(count),
    uBack: null,
    famFront: new Uint8Array(count),
    famBack: null,
    local: new Float32Array(3 * count),
  }
}

// --- the view and the strokes ---------------------------------------------------------------------------------------------

function viewFor(azimuth: number, elevation: number): PaintView {
  return paintView({ width: 800, height: 600, azimuth, elevation, zoom: 150, target: [0, -0.3, 0.7], perspective: true })
}

// A world point in the view's CSS px (y down) and its view depth.
function toCss(view: PaintView, p: V3): [number, number, number] {
  const m = view.viewProj
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
  const depth = (p[0] - view.eye[0]) * view.viewDir[0] + (p[1] - view.eye[1]) * view.viewDir[1] + (p[2] - view.eye[2]) * view.viewDir[2]
  return [(x / w * 0.5 + 0.5) * view.width, (0.5 - (y / w) * 0.5) * view.height, depth]
}

interface Stroke {
  role: string
  from: V3
  to: V3
  width: number
  colour: V3
  hidden: number
  // no world path: a stroke laid on the glass
  flat?: boolean
}

function batchOf(view: PaintView, strokes: Stroke[], withHidden: boolean): StrokeBatch {
  const n = strokes.length
  const b: StrokeBatch = {
    count: n,
    role: new Uint8Array(n),
    layer: new Uint8Array(n),
    path: new Float32Array(n * 2 * PATH_POINTS),
    width: new Float32Array(n * PATH_POINTS),
    depth: new Float32Array(n),
    colour: new Float32Array(n * 3),
    alpha: new Float32Array(n).fill(1),
    load: new Float32Array(n).fill(0.9),
    impasto: new Float32Array(n).fill(0.3),
    bristles: new Float32Array(n).fill(12),
    bristleVar: new Float32Array(n).fill(0.15),
    dry: new Float32Array(n).fill(0.05),
    wet: new Float32Array(n).fill(0),
    endSoft: new Float32Array(n),
    edge: new Uint8Array(n).fill(255),
    seed: Uint32Array.from({ length: n }, (_, i) => 4001 + i),
    worldPath: new Float32Array(n * 3 * PATH_POINTS),
    worldNormal: new Float32Array(n * 3),
  }
  strokes.forEach((s, i) => {
    b.role[i] = ROLES.indexOf(s.role as (typeof ROLES)[number])
    b.layer[i] = LAYER_ORDER.indexOf(s.role as (typeof LAYER_ORDER)[number])
    b.colour.set(s.colour, 3 * i)
    let mid = 0
    for (let k = 0; k < PATH_POINTS; k++) {
      const t = k / (PATH_POINTS - 1)
      const p: V3 = [s.from[0] + (s.to[0] - s.from[0]) * t, s.from[1] + (s.to[1] - s.from[1]) * t, s.from[2] + (s.to[2] - s.from[2]) * t]
      const [x, y, d] = toCss(view, p)
      b.path[i * 2 * PATH_POINTS + 2 * k] = x
      b.path[i * 2 * PATH_POINTS + 2 * k + 1] = y
      b.width[i * PATH_POINTS + k] = s.width
      if (!s.flat) b.worldPath.set(p, i * 3 * PATH_POINTS + 3 * k)
      if (k === PATH_POINTS >> 1) mid = d
    }
    b.depth[i] = mid
  })
  if (withHidden) b.hidden = Uint8Array.from(strokes.map((s) => s.hidden))
  return b
}

const UMBER: V3 = [0.03, 0.015, 0.01]
// Two data lines behind the sphere (from the front camera), which the sheet is further behind: one dashed where hidden,
// one not drawn where hidden.
const LINES: Stroke[] = [
  { role: 'line', from: [-1.4, -0.55, 0.75], to: [1.4, -0.55, 0.75], width: 3.2, colour: UMBER, hidden: HIDDEN_DASHED },
  { role: 'line', from: [-1.4, -0.55, 0.3], to: [1.4, -0.55, 0.3], width: 3.2, colour: [0.55, 0.3, 0.02], hidden: HIDDEN_NONE },
]
// Three block strokes on the glass, for the plain frames (they are what the layers copy and blend over).
const BLOCKS: Stroke[] = [
  { role: 'block', from: [-1.2, 0, 1.2], to: [-0.2, 0, 1.5], width: 34, colour: [0.2, 0.35, 0.5], hidden: 255, flat: true },
  { role: 'block', from: [0.3, 0, -0.1], to: [1.3, 0, 0.3], width: 28, colour: [0.55, 0.25, 0.1], hidden: 255, flat: true },
  { role: 'form', from: [-0.9, 0, 0.1], to: [-0.1, 0, -0.2], width: 22, colour: [0.3, 0.5, 0.25], hidden: 255, flat: true },
]

function emptyDebug(n: number) {
  return {
    value: new Float32Array(n).fill(0.5),
    planes: new Int32Array(n).fill(-1),
    zones: new Uint8Array(n).fill(255),
    edgeSegments: new Float32Array(0),
    edgeClass: new Uint8Array(0),
  }
}

// An underpainting image at the G-buffer's size: an ellipse of colour on bare canvas (NaN).
function image(gw: number, gh: number): Float32Array {
  const out = new Float32Array(3 * gw * gh).fill(Number.NaN)
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const dx = (x - gw * 0.45) / (gw * 0.3)
      const dy = (y - gh * 0.5) / (gh * 0.35)
      if (dx * dx + dy * dy < 1) out.set([0.15 + 0.3 * (x / gw), 0.3 + 0.2 * (y / gh), 0.55 - 0.2 * (x / gw)], 3 * (y * gw + x))
    }
  }
  return out
}

// --- run ------------------------------------------------------------------------------------------------------------------

function run(): void {
  let renderer: PaintRenderer
  try {
    renderer = new PaintRenderer(canvas, { onError: (m) => errors.push(m) })
  } catch (error) {
    status.textContent = `no renderer: ${error instanceof Error ? error.message : String(error)}`
    return
  }
  renderer.setScene(SCENE, COLOURS)
  const gw = 400
  const gh = 300
  const baked = mode === 'front' || mode === 'back' || mode === 'oblique'
  let view: PaintView
  if (mode === 'back') view = viewFor(90, 12)
  else if (mode === 'oblique') view = viewFor(-55, 22)
  else view = viewFor(-90, 12)
  // (the same light the sphere was baked with, in the world)
  const light: V3 = [0.4, -0.5, 0.77]
  const frame = {
    strokes: baked ? batchOf(view, LINES, true) : batchOf(view, [...BLOCKS, { ...LINES[0], hidden: 255 }], false),
    underpaint: baked ? null : image(gw, gh),
    debug: emptyDebug(gw * gh),
    stats: { strokes: 0, byRole: {} as Record<string, number>, loads: 0 },
  }
  if (baked) renderer.setBakedSurfaces([bakedSheet(SHEET, 8), bakedSphere(SPHERE, light)])
  if (mode === 'nobake-reproject') renderer.paint(frame as never, view, DEFAULT_PAINT_PARAMS, 'none', { from: view, depth: new Float32Array(gw * gh).fill(5) })
  else renderer.paint(frame as never, view, DEFAULT_PAINT_PARAMS, 'none')
  const s = renderer.stats
  const text = `mode=${mode} baked=${s.underpaintBaked} surfaces=${s.bakedSurfaces} strokes=${s.strokes} draws=${s.strokeDraws} depthTested=${s.depthTested}${errors.length ? `\nERRORS: ${errors.join(' | ')}` : ''}`
  status.textContent = text
  ;(window as unknown as { __paintBakeGl: unknown }).__paintBakeGl = { mode, stats: { ...s }, errors }
}

run()
