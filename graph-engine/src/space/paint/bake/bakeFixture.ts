// The fixtures of the baked painting's strokes, underpainting and assembly tests: whole bakes of small scenes as the lab would make them (the
// particles, the world light, the authored framing), made once per test file.

import type { MeshMark, SpaceScene } from '../../scene/types'
import { lchToLab } from '../model/colour'
import { buildParticles } from '../model/particles'
import { flatColours, graphMesh, quadMesh, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import type { Oklab, ParticleSet, SceneColours } from '../types'
import { bakePaintingWithProgress, type BakeProgress } from './index'
import type { AuthoredFraming, BakedPainting } from './types'

export const P = DEFAULT_PAINT_PARAMS
export const PX = 1 / 150 // world units per CSS px
export const LIGHT = worldLight(-35, 39) // the lab's key light
export const TERRACOTTA: Oklab = lchToLab(0.56, 0.14, 38)
export const CANVAS: Oklab = lchToLab(0.9, 0.01, 85)

// The authored framing of an eye 8 away in the direction (azimuth, elevation) from the origin.
export function framing(azimuth: number, elevation: number, ortho = false): AuthoredFraming {
  const e = worldLight(azimuth, elevation)
  return { eye: [e[0] * 8, e[1] * 8, e[2] * 8], viewDir: [-e[0], -e[1], -e[2]], ortho, worldPerPx: PX }
}
export const FRONT = framing(20, 25)

export interface Fixture {
  scene: SpaceScene
  colours: SceneColours
  particles: ParticleSet
  params: PaintParams
  light: [number, number, number]
  authored: AuthoredFraming
  baked: BakedPainting
}

// A scene baked as the lab would.
export function fixture(
  scene: SpaceScene, colours: SceneColours, params: PaintParams = P, light: [number, number, number] = LIGHT, authored: AuthoredFraming = FRONT,
): Fixture {
  const particles = buildParticles(scene, colours, params)
  // (the fixtures keep the bake's plan, planes and edges: the tests read them)
  return { scene, colours, particles, params, light, authored, baked: bakePaintingWithProgress(scene, particles, colours, light, params, authored, undefined, { keepStats: true }) }
}

export const inwardSphere = (index = 0, radius = 1): MeshMark => {
  const m = sphereMesh({ radius, index, nu: 36, nv: 24 })
  return { ...m, normals: m.normals.map((v) => -v) }
}

// A sphere (r 1) on a table at z = -1 (4 across), in terracotta and canvas.
export const sphereScene = (): SpaceScene => sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 }), tableMesh({ z: -1, half: 2, index: 1 })])
export const sphereColours = (): SceneColours => flatColours({ 0: TERRACOTTA, 1: CANVAS })

// An open saddle z = (x² - y²) / 2 over [-1, 1]², lit from above, colour-scaled by height.
export const saddleScene = (): SpaceScene => sceneOf([graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 24, scaled: true, index: 0 })])
export const saddleColours = (): SceneColours => flatColours({ 0: lchToLab(0.6, 0.1, 150) }, (v) => lchToLab(0.45 + 0.4 * v, 0.12, 250 - 120 * v))
export const flatSaddleScene = (): SpaceScene => sceneOf([graphMesh((x, y) => 0.5 * (x * x - y * y), { half: 1, n: 24, scaled: false, index: 0 })])

// A veil: a flat translucent sheet above a sphere.
export const veilScene = (): SpaceScene =>
  sceneOf([sphereMesh({ radius: 0.6, index: 0, nu: 24, nv: 16 }), quadMesh({ origin: [-1, -1, 0.9], e1: [2, 0, 0], e2: [0, 2, 0], n: 8, opacity: 0.5, index: 1 })])

export { bakePaintingWithProgress, type BakeProgress }
// A small particle count keeps a test's bake short (the bake's own scale is the lab's).
export const sparse = (maxPerUnit2 = 700): PaintParams => ({ ...P, particles: { ...P.particles, maxPerUnit2 } })

export const bytes = (a: ArrayBufferView): string => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')
