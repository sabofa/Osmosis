// pickAt (plan E6, spec SP6 "Probe"): what is under a CSS pixel, read from
// the true functions. Pure: it reads the scene's CPU geometry and compiled
// picks and touches neither GL nor the DOM.
//
// - Thin things (curves, points, arrows) are picked by screen distance
//   (screen.ts); surfaces by a ray, clipped to the axis box, refined on the
//   true function (refine.ts): graphs by marching, parametric and implicit
//   surfaces through a BVH (bvh.ts) and Newton.
// - Priority: a thin thing within its tolerance wins over a surface, since
//   you are pointing at the curve; among thin things the nearest on screen,
//   then the nearest in depth; among surfaces the nearest in depth.
//
// Re-entrancy: a mark's compiled picks share nothing with the kernel's
// sampling closures, but a compiled closure owns one evaluation frame, so
// picking must never run inside a kernel build. It runs only from input
// handlers, and JS is single-threaded.

import { project, rayAt, type CameraMatrices } from '../camera/projection'
import type { WorldMap } from '../camera/world'
import type { MeshMark, SpaceScene, Vec3 } from '../scene/types'
import { bvhOf, intersectBvh } from './bvh'
import { footprintOf } from './heightfield'
import { graphReadout, implicitReadout, parametricReadout } from './readout'
import { at, boxSpan, clipRay, marchGraph, newtonImplicit, newtonParametric } from './refine'
import { thinCandidates, type Candidate } from './screen'
import type { Hit, Ray } from './types'

// The world ray through a CSS pixel, in author coordinates.
export function authorRay(camera: CameraMatrices, world: WorldMap, px: number, py: number): Ray {
  const r = rayAt(camera, px, py)
  const k = world.scale
  return { origin: world.toAuthor(r.origin), direction: [r.direction[0] / k[0], r.direction[1] / k[1], r.direction[2] / k[2]] }
}

function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// A surface's hit along `ray` within [s0, s1], with its ray parameter.
export function surfaceHit(mark: MeshMark, ray: Ray, s0: number, s1: number, span: number): { s: number; hit: Hit } | null {
  const pick = mark.pick
  if (!pick) return null
  if (pick.kind === 'graph') {
    const g = marchGraph(pick.f, ray, s0, s1, span, footprintOf(mark).contains)
    if (!g) return null
    const position: Vec3 = [g.x, g.y, g.z]
    return {
      s: g.s,
      hit: { source: mark.source, kind: 'graph', position, values: graphReadout(position, pick.fx(g.x, g.y), pick.fy(g.x, g.y)), at: { kind: 'graph', x: g.x, y: g.y } },
    }
  }
  const tri = intersectBvh(bvhOf(mark), mark.positions, mark.indices, ray, s0, s1)
  if (!tri) return null
  const onRay = at(ray, tri.s)
  if (pick.kind === 'implicit') {
    const refined = newtonImplicit(pick.F, pick.grad, ray, tri.s)
    // Newton stays with the triangle's crossing, or it is not trusted.
    const s = refined !== null && distance(at(ray, refined), onRay) <= 0.05 * span ? refined : tri.s
    const position = at(ray, s)
    return {
      s,
      hit: { source: mark.source, kind: 'implicit', position, values: implicitReadout(position, pick.grad(...position)), at: { kind: 'implicit', point: position } },
    }
  }
  // Parametric: (u, v) from the triangle's corners, then Newton on the true r.
  const uv = mark.uv
  if (!uv) {
    return { s: tri.s, hit: { source: mark.source, kind: 'parametric', position: onRay, values: parametricReadout(onRay, pick.param, NaN, NaN), at: { kind: 'parametric', u: NaN, v: NaN } } }
  }
  const [a, b, c] = [0, 1, 2].map((k) => mark.indices[3 * tri.triangle + k])
  const w = 1 - tri.b1 - tri.b2
  let u = w * uv[2 * a] + tri.b1 * uv[2 * b] + tri.b2 * uv[2 * c]
  let v = w * uv[2 * a + 1] + tri.b1 * uv[2 * b + 1] + tri.b2 * uv[2 * c + 1]
  let s = tri.s
  if (pick.ru && pick.rv) {
    const refined = newtonParametric({ r: pick.r, ru: pick.ru, rv: pick.rv }, ray, u, v, s)
    if (refined && distance(pick.r(refined.u, refined.v), at(ray, refined.s)) <= 1e-9 * span && distance(at(ray, refined.s), onRay) <= 0.05 * span) {
      ;({ u, v, s } = refined)
    }
  }
  const position = pick.r(u, v)
  return { s, hit: { source: mark.source, kind: 'parametric', position, values: parametricReadout(position, pick.param, u, v), at: { kind: 'parametric', u, v } } }
}

// Thin first; then the nearest on screen, then in depth.
export function choose(candidates: readonly Candidate[]): Candidate | null {
  if (candidates.length === 0) return null
  const sorted = [...candidates].sort((a, b) => Number(b.thin) - Number(a.thin) || a.distance - b.distance || a.depth - b.depth)
  return sorted[0]
}

export function pickAt(scene: SpaceScene, camera: CameraMatrices, world: WorldMap, px: number, py: number): Hit | null {
  const candidates = thinCandidates(scene, camera, world, px, py)
  const ray = authorRay(camera, world, px, py)
  const clip = clipRay(ray, world.box)
  if (clip) {
    const span = boxSpan(world.box)
    for (const mark of scene.marks) {
      if (mark.kind !== 'mesh') continue
      const found = surfaceHit(mark, ray, clip[0], clip[1], span)
      if (found) candidates.push({ thin: false, distance: 0, depth: project(camera, world.toWorld(found.hit.position)).depth, hit: found.hit })
    }
  }
  return choose(candidates)?.hit ?? null
}
