// The CPU shadow caster (the baked painting, plan Task 1): what the renderer's shadow map does for a G-buffer pixel,
// done for a point on the mesh, so the cast shadow is known in the world and does not wait for a frame.
//
// The renderer (gl/shadow.ts, gl/shaders/gbuffer.ts) draws the opaque meshes from the key light into a 1024² orthographic
// depth map fitted to the scene's bounding sphere (× SHADOW_FIT), and a pixel asks it, through a 3×3 PCF, with a slope-
// scaled bias, whether it is lit. Here a point asks the same of the meshes themselves, by ray:
//
//   * the casters are the opaque meshes (opacity 1, as gl/meshes.ts isDrawableMesh draws them), whatever they are: a
//     table casts and receives. A veil neither casts nor is in the shadow map;
//   * five rays toward the light stand for the PCF: the centre, and four displaced by one shadow texel along two axes
//     across the light (the light frame's own right and up), the texel being (2 · bounding radius · SHADOW_FIT) / SHADOW_SIZE;
//   * every ray starts lifted off the surface along the side's normal by texel · (1.2 + 1.6 · slope), the bias of the
//     G-buffer shader, slope = min(sin θ / max(cos θ, 0.1), 6) for θ the angle of the normal to the light;
//   * `vis` is the fraction of rays not blocked; `dist`, the mean distance to the occluder over the rays that were
//     blocked (Infinity when none), for the cast-shadow edge's hardness;
//   * a point INSIDE a closed mesh (a table point under a sphere that rests on it, lifted into the sphere by the bias) is
//     in its shadow at distance 0: a ray whose first hit is the BACK of a closed mesh (by the mesh's own normals) started
//     inside it. An open sheet has no inside, and is hit from either side.
//
// The renderer's flag is `nl <= 0 || visible < 0.5`; the caller makes it from `vis` the same way, and asks for a
// visibility only where nl > 0 (the shader does not look the map up elsewhere).

import type { MeshMark, SpaceScene } from '../../scene/types'
import { bvhOf, intersectBvh, type Bvh, type TriangleHit } from '../../pick/bvh'
import type { Ray } from '../../pick/types'
import { isDrawableMesh, sceneBounds } from '../gl/meshes'
import { lightFrame, SHADOW_FIT, SHADOW_SIZE } from '../gl/shadow'
import { isClosedMesh } from './surface'

export interface ShadowCaster {
  // The fraction of the five rays toward the light that are not blocked, and the mean distance to what blocked the others.
  visibility(x: number, y: number, z: number, nx: number, ny: number, nz: number, out: { vis: number; dist: number }): void
  // The distance to the nearest opaque surface along a ray (direction need not be unit: the distance is in units of it),
  // within (0, sMax], or Infinity: the occlusion rays use it.
  nearest(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, sMax: number): number
  // Whether a point is inside a closed opaque mesh: the first thing a ray from it meets (any distance) is the back of one.
  inside(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean
  // The size of a shadow-map texel in world units, and the bounding radius it was made from.
  readonly texel: number
  readonly radius: number
}

interface Caster {
  mesh: MeshMark
  bvh: Bvh
  closed: boolean
}

// Whether a ray (direction d) meets a triangle from behind, by the mesh's own normals there: it travels along them.
function fromBehind(mesh: MeshMark, hit: TriangleHit, dx: number, dy: number, dz: number): boolean {
  const n = mesh.normals
  const a = 3 * mesh.indices[3 * hit.triangle]
  const b = 3 * mesh.indices[3 * hit.triangle + 1]
  const c = 3 * mesh.indices[3 * hit.triangle + 2]
  const w0 = 1 - hit.b1 - hit.b2
  const x = w0 * n[a] + hit.b1 * n[b] + hit.b2 * n[c]
  const y = w0 * n[a + 1] + hit.b1 * n[b + 1] + hit.b2 * n[c + 1]
  const z = w0 * n[a + 2] + hit.b1 * n[b + 2] + hit.b2 * n[c + 2]
  return x * dx + y * dy + z * dz > 1e-12
}

// The rays' starts are displaced across the light by these multiples of a texel (the centre, then +x, -x, +y, -y).
const PCF = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const

export function makeShadowCaster(scene: SpaceScene, lightDir: readonly number[]): ShadowCaster {
  const casters: Caster[] = []
  for (const mark of scene.marks) if (isDrawableMesh(mark)) casters.push({ mesh: mark, bvh: bvhOf(mark), closed: isClosedMesh(mark) })
  const radius = sceneBounds(scene).radius
  const texel = (2 * radius * SHADOW_FIT) / SHADOW_SIZE
  // (a ray with a component of exactly 0, along an axis, can slip between the triangles of a pole's fan, where the BVH's boxes
  // touch it by less than a rounding: a light that is exactly along an axis is leaned by a billionth)
  const lean = (v: number): number => (v === 0 ? 1e-9 : v)
  const len = Math.hypot(lean(lightDir[0]), lean(lightDir[1]), lean(lightDir[2])) || 1
  const L: [number, number, number] = [lean(lightDir[0]) / len, lean(lightDir[1]) / len, lean(lightDir[2]) / len]
  const frame = lightFrame(L, radius * SHADOW_FIT)
  // a ray that starts on a triangle must not hit it: only what is beyond a hair counts
  const sMin = 1e-7 * radius
  // (one ray, rewritten for every cast)
  const origin: [number, number, number] = [0, 0, 0]
  const direction: [number, number, number] = [0, 0, 0]
  const ray: Ray = { origin, direction }

  // The nearest hit along a ray; `behind` is set when it is the back of a closed mesh (the ray started inside it).
  let behind = false
  const cast = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, sMax: number): number => {
    origin[0] = ox
    origin[1] = oy
    origin[2] = oz
    direction[0] = dx
    direction[1] = dy
    direction[2] = dz
    let best = Infinity
    let limit = sMax
    let bestHit: TriangleHit | null = null
    let bestCaster: Caster | null = null
    for (const c of casters) {
      const hit = intersectBvh(c.bvh, c.mesh.positions, c.mesh.indices, ray, sMin, limit)
      if (hit && hit.s < best) {
        best = hit.s
        limit = hit.s
        bestHit = hit
        bestCaster = c
      }
    }
    behind = bestCaster !== null && bestHit !== null && bestCaster.closed && fromBehind(bestCaster.mesh, bestHit, dx, dy, dz)
    return best
  }
  const nearest = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, sMax: number): number => cast(ox, oy, oz, dx, dy, dz, sMax)
  const inside = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): boolean => cast(ox, oy, oz, dx, dy, dz, Infinity) !== Infinity && behind

  const visibility = (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: { vis: number; dist: number }): void => {
    const cos = nx * L[0] + ny * L[1] + nz * L[2]
    const sin = Math.sqrt(Math.max(1 - cos * cos, 0))
    const slope = Math.min(sin / Math.max(cos, 0.1), 6)
    const lift = texel * (1.2 + 1.6 * slope)
    const bx = x + nx * lift
    const by = y + ny * lift
    const bz = z + nz * lift
    let blocked = 0
    let sum = 0
    for (const [i, j] of PCF) {
      const s = cast(
        bx + texel * (i * frame.right[0] + j * frame.up[0]),
        by + texel * (i * frame.right[1] + j * frame.up[1]),
        bz + texel * (i * frame.right[2] + j * frame.up[2]),
        L[0], L[1], L[2], Infinity,
      )
      if (s !== Infinity) {
        blocked++
        // from the surface point itself, not from the lifted start (and at distance 0 where the start was inside a solid)
        sum += (behind ? 0 : s) + lift * cos
      }
    }
    out.vis = (PCF.length - blocked) / PCF.length
    out.dist = blocked > 0 ? sum / blocked : Infinity
  }

  return { visibility, nearest, inside, texel, radius }
}
