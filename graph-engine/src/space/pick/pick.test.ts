import { describe, expect, it } from 'vitest'
import { parseSpec } from '../../parser/parseSpec'
import { cameraMatrices, project } from '../camera/projection'
import { worldMap } from '../camera/world'
import { createSpaceKernel } from '../kernel/index'
import type { Box3, LineMark, MeshMark, Vec3 } from '../scene/types'
import { graphMesh, lineMark, parametricMesh, pointMark, scene } from '../testing/marks'
import { authorRay, pickAt, surfaceHit } from './pick'
import { at, boxSpan, clipRay } from './refine'
import type { Ray } from './types'

const saddle = (x0 = -2, x1 = 2, y0 = -2, y1 = 2, n = 32) =>
  graphMesh(
    (x, y) => x * x - y * y,
    (x) => 2 * x,
    (_x, y) => -2 * y,
    x0,
    x1,
    y0,
    y1,
    n,
  )

const BOX: Box3 = { x: { min: -2, max: 2 }, y: { min: -2, max: 2 }, z: { min: -4, max: 4 } }

function hitOn(mark: MeshMark, ray: Ray, box: Box3 = BOX) {
  const clip = clipRay(ray, box)!
  expect(clip).not.toBeNull()
  return surfaceHit(mark, ray, clip[0], clip[1], boxSpan(box))
}

const row = (values: { label: string; value: string }[], label: string) => values.find((r) => r.label === label)?.value

describe('graph surfaces: marching the true f', () => {
  it('hits z = x^2 - y^2 straight down through (0.3, -0.7) at z = -0.4, with f_x = 0.6 and f_y = 1.4', () => {
    const found = hitOn(saddle(), { origin: [0.3, -0.7, 10], direction: [0, 0, -1] })!
    expect(found.hit.kind).toBe('graph')
    const [x, y, z] = found.hit.position
    expect([x, y]).toEqual([0.3, -0.7])
    expect(Math.abs(z - -0.4)).toBeLessThanOrEqual(1e-12)
    expect(row(found.hit.values, '∂f/∂x')).toBe('0.6')
    expect(row(found.hit.values, '∂f/∂y')).toBe('1.4')
    expect(row(found.hit.values, 'z')).toBe('−0.4')
    expect(found.hit.at).toEqual({ kind: 'graph', x: 0.3, y: -0.7 })
  })

  it('refines an oblique hit onto the ray and the surface to 1e-12 of the box span', () => {
    const ray: Ray = { origin: [0.3, -0.7, 10], direction: [0.03, 0.02, -1] }
    const found = hitOn(saddle(), ray)!
    const p = found.hit.position
    const q = at(ray, found.s)
    const span = boxSpan(BOX)
    expect(Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])).toBeLessThanOrEqual(1e-12 * span)
    expect(p[2]).toBe(p[0] * p[0] - p[1] * p[1])
  })

  it('returns the FIRST crossing of a ray that crosses a ridge twice', () => {
    // z = 1 - x^2 along y; a level ray at z = 0.5 from x = -3 meets it at
    // x = -sqrt(1/2) and again at +sqrt(1/2).
    const ridge = graphMesh(
      (x) => 1 - x * x,
      (x) => -2 * x,
      () => 0,
      -3,
      3,
      -1,
      1,
      48,
    )
    const box: Box3 = { x: { min: -3, max: 3 }, y: { min: -1, max: 1 }, z: { min: -8, max: 1 } }
    const found = hitOn(ridge, { origin: [-3, 0, 0.5], direction: [1, 0, 0] }, box)!
    expect(Math.abs(found.hit.position[0] - -Math.SQRT1_2)).toBeLessThanOrEqual(1e-12 * boxSpan(box))
  })

  it('does not hit f where the surface does not cover (x, y): outside its domain', () => {
    // The saddle only over [0, 2] x [-2, 2]; the ray comes down at x = -1.
    const found = hitOn(saddle(0, 2), { origin: [-1, 0.5, 10], direction: [0, 0, -1] })
    expect(found).toBeNull()
  })
})

describe('parametric and implicit surfaces: a BVH hit refined by Newton', () => {
  it('hits the unit sphere (the kernel\'s, with r_u and r_v) from (3, 0.2, 0.1) toward the origin at o/|o| to 1e-12', () => {
    const parsed = parseSpec('(cos(u) sin(v), sin(u) sin(v), cos(v)) for u in [0, 2*pi], v in [0, pi]')
    const mark = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene().marks[0] as MeshMark
    expect(mark.pick?.kind === 'parametric' && typeof mark.pick.ru).toBe('function')
    const o: Vec3 = [3, 0.2, 0.1]
    const box: Box3 = { x: { min: -1.5, max: 1.5 }, y: { min: -1.5, max: 1.5 }, z: { min: -1.5, max: 1.5 } }
    const found = hitOn(mark, { origin: o, direction: [-3, -0.2, -0.1] }, box)!
    const p = found.hit.position
    const n = Math.hypot(...o)
    expect(Math.abs(Math.hypot(...p) - 1)).toBeLessThanOrEqual(1e-12)
    expect(p[0]).toBeGreaterThan(0)
    for (let k = 0; k < 3; k++) expect(Math.abs(p[k] - o[k] / n)).toBeLessThanOrEqual(1e-12)
    // u = atan2(0.2, 3), v = acos(0.1 / |o|), under their own names.
    const hit = found.hit
    expect(hit.at.kind).toBe('parametric')
    if (hit.at.kind === 'parametric') {
      expect(hit.at.u).toBeCloseTo(Math.atan2(0.2, 3), 12)
      expect(hit.at.v).toBeCloseTo(Math.acos(0.1 / n), 12)
    }
    expect(hit.values.map((r) => r.label)).toEqual(['x', 'y', 'z', 'u', 'v'])
  })

  it("gives a polar surface that reads r and theta its r_r and r_theta: at (1.5, pi/6), (cos, sin, r sin 2t) and (-r sin, r cos, r^2 cos 2t)", () => {
    const parsed = parseSpec('z = r^2 sin(2 theta) / 2 over r in [0, 2], theta in [0, 2*pi]')
    const mark = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene().marks[0] as MeshMark
    const pick = mark.pick
    if (pick?.kind !== 'parametric' || !pick.ru || !pick.rv) throw new Error('expected a parametric pick with r_u and r_v')
    const t = Math.PI / 6
    const expectVec = (got: Vec3, want: Vec3) => want.forEach((w, k) => expect(got[k]).toBeCloseTo(w, 12))
    expectVec(pick.ru(1.5, t), [Math.cos(t), Math.sin(t), 1.5 * Math.sin(2 * t)])
    expectVec(pick.rv(1.5, t), [-1.5 * Math.sin(t), 1.5 * Math.cos(t), 2.25 * Math.cos(2 * t)])
  })

  it('hits x^2 + y^2 + z^2 = 4 (F and grad by hand) at |p| = 2 to 1e-12', () => {
    const sphere = parametricMesh(
      (u, v) => [2 * Math.sin(v) * Math.cos(u), 2 * Math.sin(v) * Math.sin(u), 2 * Math.cos(v)],
      (u, v) => [Math.sin(v) * Math.cos(u), Math.sin(v) * Math.sin(u), Math.cos(v)],
      0,
      2 * Math.PI,
      0,
      Math.PI,
      32,
      16,
    )
    const mark: MeshMark = {
      ...sphere,
      pick: { kind: 'implicit', F: (x, y, z) => x * x + y * y + z * z - 4, grad: (x, y, z) => [2 * x, 2 * y, 2 * z] },
    }
    const box: Box3 = { x: { min: -3, max: 3 }, y: { min: -3, max: 3 }, z: { min: -3, max: 3 } }
    const found = hitOn(mark, { origin: [5, 0.3, -0.2], direction: [-1, -0.05, 0.03] }, box)!
    expect(found.hit.kind).toBe('implicit')
    expect(Math.abs(Math.hypot(...found.hit.position) - 2)).toBeLessThanOrEqual(1e-12)
    expect(found.hit.position[0]).toBeGreaterThan(0)
    // |grad F| = 2 |p| = 4.
    expect(row(found.hit.values, '|∇F|')).toBe('4')
  })
})

describe('pickAt: thin things before surfaces', () => {
  const world = worldMap(BOX, [1, 1, 0.7])
  const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
  const P: Vec3 = [0.3, -0.7, -0.4]
  const screenP = project(camera, world.toWorld(P))
  // An author point `px` screen px to the right of P and `back` world units
  // farther from the eye.
  const beside = (px: number, back: number): Vec3 => {
    const w = world.toWorld(P)
    const { right, forward } = camera.basis
    const k = px * camera.worldPerPixel
    return world.toAuthor([w[0] + right[0] * k + forward[0] * back, w[1] + right[1] * k + forward[1] * back, w[2] + right[2] * k + forward[2] * back])
  }
  // A short curve through a point, vertical on screen.
  const verticalThrough = (c: Vec3): LineMark => {
    const w = world.toWorld(c)
    const up = camera.basis.up
    const end = (t: number) => world.toAuthor([w[0] + up[0] * t, w[1] + up[1] * t, w[2] + up[2] * t])
    return lineMark([[end(-0.1), end(0.1)]], { line: 2 })
  }

  it('picks the surface under the cursor when nothing thin is near', () => {
    const hit = pickAt(scene([saddle()]), camera, world, screenP.x, screenP.y)!
    expect(hit.kind).toBe('graph')
    for (let k = 0; k < 3; k++) expect(hit.position[k]).toBeCloseTo(P[k], 9)
  })

  it('lets a curve 5 px from the cursor win over the surface under it, even though the curve is farther', () => {
    const curve = verticalThrough(beside(5, 0.3))
    const hit = pickAt(scene([saddle(), curve]), camera, world, screenP.x, screenP.y)!
    expect(hit.kind).toBe('curve')
    expect(hit.source.line).toBe(2)
  })

  it('ignores a point outside its tolerance (size 8: 4 + 4 px) and takes one inside it', () => {
    const far = pointMark([beside(9, 0)], { line: 3 })
    expect(pickAt(scene([saddle(), far]), camera, world, screenP.x, screenP.y)!.kind).toBe('graph')
    const near = pointMark([beside(7, 0)], { line: 3 })
    expect(pickAt(scene([saddle(), near]), camera, world, screenP.x, screenP.y)!.kind).toBe('point')
  })

  it("re-evaluates a curve's point from pick.r(t), with t and the speed in the readout", () => {
    const parsed = parseSpec('(cos(t), sin(t), t/4) for t in [0, 6]')
    const curve = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines).scene().marks[0] as LineMark
    const target = curve.pick!.r(1.2345)
    const s = project(camera, world.toWorld(target))
    const hit = pickAt(scene([curve]), camera, world, s.x, s.y)!
    expect(hit.kind).toBe('curve')
    expect(hit.at.kind === 'curve' && hit.at.t).toBeCloseTo(1.2345, 3)
    const t = hit.at.kind === 'curve' ? hit.at.t! : NaN
    expect(hit.position).toEqual(curve.pick!.r(t))
    // |r'| = sqrt(1 + 1/16) = 1.0308...
    expect(row(hit.values, 't')).toBe(`${Number(t.toPrecision(4))}`)
    expect(row(hit.values, '|r′|')).toBe('1.031')
  })

  it('casts its ray from the camera in author coordinates', () => {
    const ray = authorRay(camera, world, screenP.x, screenP.y)
    // P lies on the ray through its own pixel.
    const d = ray.direction
    const toP = [P[0] - ray.origin[0], P[1] - ray.origin[1], P[2] - ray.origin[2]]
    const s = (toP[0] * d[0] + toP[1] * d[1] + toP[2] * d[2]) / (d[0] * d[0] + d[1] * d[1] + d[2] * d[2])
    const q = at(ray, s)
    for (let k = 0; k < 3; k++) expect(q[k]).toBeCloseTo(P[k], 9)
  })
})
