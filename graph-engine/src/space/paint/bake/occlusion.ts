// World ambient occlusion (the baked painting, plan Task 1): the screen-space occlusion of the per-frame model
// (model/value.ts computeOcclusion) done on the meshes, so a contact is dark whatever the view.
//
// Eight rays leave the point over the hemisphere about the side's normal, cosine-weighted (more of them near the
// normal, as a diffuse surface sees its surroundings), the directions spread evenly in azimuth and over the sky by the
// golden ratio, each jittered by the seeded stream the caller hands in (drawn in vertex order, so a bake never depends on
// anything but the scene and the seed). A ray counts where an opaque surface is within 2R, the full amount to R and
// fading out to nothing at 2R:
//
//   ao = mean over rays of  hit ? 1 - smooth(R, 2R, hitDistance) : 0
//
// with R the occlusion radius in world units (environment.occlusionRadiusPx × the reference world per px). Like the
// screen version, it takes the cast shadow to its contact value and the bounce away from the form shadow near a contact
// (value.ts planSample reads it as `contact`); it never darkens the light family, a crease it reaches is lit.
//
// A point INSIDE a closed mesh (a table point at the contact of a sphere that rests on it, lifted into the sphere by a
// hair) is fully occluded: there is no sky, whatever the rays' short reach; the caster says so (shadow.ts `inside`).

import type { SpaceScene } from '../../scene/types'
import { smooth, TAU } from '../model/math'
import type { ShadowCaster } from './shadow'

export const AO_RAYS = 8
const GOLDEN = 0.61803398875

// Occlusion 0..1 at (x, y, z) on a surface whose (side) unit normal is (nx, ny, nz). `caster` holds the opaque meshes'
// BVHs; `radius` is R, world units; `rng` yields uniform numbers in [0, 1) (17 are drawn).
export function occlusionAt(
  _scene: SpaceScene, caster: ShadowCaster, x: number, y: number, z: number, nx: number, ny: number, nz: number, radius: number, rng: () => number,
): number {
  if (!(radius > 0)) return 0
  // an orthonormal frame about the normal
  const ax = Math.abs(nx) < 0.9 ? 1 : 0
  const ay = 1 - ax
  let t1x = ay * nz
  let t1y = -ax * nz
  let t1z = ax * ny - ay * nx
  const tl = Math.hypot(t1x, t1y, t1z) || 1
  t1x /= tl
  t1y /= tl
  t1z /= tl
  const t2x = ny * t1z - nz * t1y
  const t2y = nz * t1x - nx * t1z
  const t2z = nx * t1y - ny * t1x
  // start a hair off the surface along the normal, so a ray does not meet the triangle it stands on
  const lift = 1e-3 * radius
  const ox = x + nx * lift
  const oy = y + ny * lift
  const oz = z + nz * lift
  // (the ray that asks is leaned off the normal by a hair: a ray exactly along an axis through a mesh's pole or a box's face can slip between its triangles)
  const ix = nx + 0.0131 * t1x + 0.0071 * t2x
  const iy = ny + 0.0131 * t1y + 0.0071 * t2y
  const iz = nz + 0.0131 * t1z + 0.0071 * t2z
  if (caster.inside(ox, oy, oz, ix, iy, iz)) return 1
  const base = rng() * TAU
  let acc = 0
  for (let k = 0; k < AO_RAYS; k++) {
    const phi = base + (k / AO_RAYS) * TAU + (rng() - 0.5) * 0.4
    const u = (k * GOLDEN + rng() * 0.1) % 1
    const sinT = Math.sqrt(u)
    const cosT = Math.sqrt(1 - u)
    const c = Math.cos(phi) * sinT
    const s = Math.sin(phi) * sinT
    const dx = c * t1x + s * t2x + cosT * nx
    const dy = c * t1y + s * t2y + cosT * ny
    const dz = c * t1z + s * t2z + cosT * nz
    const d = caster.nearest(ox, oy, oz, dx, dy, dz, 2 * radius)
    if (d !== Infinity) acc += 1 - smooth(radius, 2 * radius, d)
  }
  return acc / AO_RAYS
}
