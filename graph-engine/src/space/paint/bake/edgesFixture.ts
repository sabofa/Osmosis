// The fixtures of the world planes' and edges' tests: a bake of a scene as the lab would make one (the plan, the particles, the planes, the
// edges), the authored framings, and the meshes the tests need (a flat-shaded box, a torus).

import { prepareFigure, keyLightDirection } from '../../../../../review/src/paintLabCamera'
import { makeSceneColours } from '../../../../../review/src/paintLabColours'
import { figureById } from '../../../../../review/src/paintLabFigures'
import { cameraMatrices } from '../../camera/projection'
import type { MeshMark } from '../../scene/types'
import { parametricMesh } from '../../testing/marks'
import { makeCurve } from '../model/curve'
import { buildParticles } from '../model/particles'
import { flatColours, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import { buildWorldEdges, type WorldEdgeOptions, type WorldEdgeRun, type WorldEdges } from './edges'
import { buildWorldPlan, newPlanAt, planAt, type WorldPlan } from './plan'
import { buildWorldPlanes, type WorldPlanes } from './planes'
import { locate, type SurfacePoint } from './surface'
import type { AuthoredFraming } from './types'

export const P = DEFAULT_PAINT_PARAMS
export const PX = 1 / 150 // world units per CSS px
export const LIGHT = worldLight(-35, 39) // the lab's key light
export const COLOURS = flatColours({ 0: [0.56, 0.1, 0.08], 1: [0.9, 0.01, 0.02] })

// The authored framing of an eye in the direction (azimuth, elevation) from the origin, `dist` away (any distance for an orthographic one).
export function framing(azimuth: number, elevation: number, dist = 8, ortho = false): AuthoredFraming {
  const e = worldLight(azimuth, elevation)
  return { eye: [e[0] * dist, e[1] * dist, e[2] * dist], viewDir: [-e[0], -e[1], -e[2]], ortho, worldPerPx: PX }
}
// A view from the front and left of the lab's light, 25 degrees up.
export const FRONT = framing(20, 25)

export type Scene = ReturnType<typeof sceneOf>

export interface Baked {
  scene: Scene
  plan: WorldPlan
  planes: WorldPlanes
  edges: WorldEdges
  authored: AuthoredFraming
}
export function bake(scene: Scene, light: [number, number, number], params: PaintParams = P, authored: AuthoredFraming = FRONT, options: WorldEdgeOptions = {}): Baked {
  const plan = buildWorldPlan(scene, light, params, PX)
  const set = buildParticles(scene, COLOURS, params)
  const planes = buildWorldPlanes(plan, set, COLOURS, makeCurve(params), params)
  return { scene, plan, planes, edges: buildWorldEdges(plan, planes, params, scene, authored, options), authored }
}

// A sphere (r 1) on a table at z = -1.
export const SPHERE_SCENE = sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 }), tableMesh({ z: -1, half: 3, index: 1 })])

export const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')
export const runsOf = (e: WorldEdges, type: WorldEdgeRun['type']) => e.runs.filter((r) => r.type === type)
// The classes (lost, soft, firm, hard) of the samples of some runs.
export const classes = (runs: WorldEdgeRun[]): number[] => {
  const h = [0, 0, 0, 0]
  for (const r of runs) for (const c of r.cls) h[c]++
  return h
}
export const meanH = (runs: WorldEdgeRun[]): number => {
  let s = 0
  let n = 0
  for (const r of runs) for (const h of r.h) {
    s += h
    n++
  }
  return s / n
}
// The plan at sample i of a run.
export const at = (plan: WorldPlan, mark: number, r: WorldEdgeRun, i: number, side: 1 | -1 = 1) => {
  const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
  if (!locate(plan.surfaces[mark]!, r.pts[3 * i], r.pts[3 * i + 1], r.pts[3 * i + 2], 0, 0, 0, 1e-6, p)) throw new Error(`sample ${i} of a run is not on its surface`)
  return planAt(plan, mark, side, p, newPlanAt())
}

// A closed box (flat-shaded: its normals are its faces', so every crease is sharp), lo..hi.
export function boxMesh(lo: number[], hi: number[], index: number): MeshMark {
  const base = sphereMesh({ index })
  const pos: number[] = []
  const nor: number[] = []
  const idx: number[] = []
  const [x0, y0, z0] = lo
  const [x1, y1, z1] = hi
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    const i = pos.length / 3
    for (const v of [a, b, c, d]) {
      pos.push(...v)
      nor.push(...n)
    }
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3)
  }
  quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0])
  quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0])
  quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0])
  quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0])
  quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1])
  quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1])
  return { ...base, positions: Float64Array.from(pos), normals: Float64Array.from(nor), indices: Uint32Array.from(idx), uv: null, scalars: null }
}

// A torus about the z axis, major radius `R`, minor `r`, smooth normals (outward).
export function torusMesh(R: number, r: number, nu = 40, nv = 20): MeshMark {
  return parametricMesh(
    (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)],
    (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
    0, 2 * Math.PI, 0, 2 * Math.PI, nu, nv,
  )
}

// A showcase figure baked as the lab would: its space spec through the kernel, the scene in world coordinates, the lab's key light, the authored
// camera at the Tune stage's size (the authored framing is its eye, direction and world size of a px).
export function bakeFigure(id: string, params: PaintParams = P): Baked & { perPx: number } {
  const camera = cameraMatrices(figure(id).built.authored, figure(id).built.world, { width: 1028, height: 690 }, figure(id).built.projection)
  const { worldScene } = figure(id)
  const light = keyLightDirection(camera.basis, params.light)
  const len = Math.hypot(light[0], light[1], light[2])
  const L: [number, number, number] = [light[0] / len, light[1] / len, light[2] / len]
  const colours = makeSceneColours(worldScene, 'light', null)
  const plan = buildWorldPlan(worldScene, L, params, camera.worldPerPixel)
  const planes = buildWorldPlanes(plan, buildParticles(worldScene, colours, params), colours, makeCurve(params), params)
  const authored: AuthoredFraming = { eye: [...camera.eye], viewDir: [...camera.basis.forward], ortho: figure(id).built.projection === 'orthographic', worldPerPx: camera.worldPerPixel }
  return { scene: worldScene, plan, planes, edges: buildWorldEdges(plan, planes, params, worldScene, authored), authored, perPx: camera.worldPerPixel }
}
const figure = (id: string) => prepareFigure(figureById(id)!)
