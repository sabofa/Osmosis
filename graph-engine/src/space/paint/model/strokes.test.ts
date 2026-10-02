import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams, type PaintParams } from '../params'
import { PATH_POINTS, ROLES } from '../types'
import { buildContext } from './index'
import { buildParticles } from './particles'
import { packStrokes, pathFromWalk, polylinePath, pressure, roleIndex, walkStroke, type PaintCtx, type StrokeDraft, type Walk, type WalkSpec } from './strokes'
import { flatColours, makeGBuffer, paintView, sceneOf, sphereGBuffer, sphereMesh } from './testing'
import { unproject } from './view'

// Whole frames of the model are heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS

// Two faces side by side (camera straight on): view-space normal (x, y, z) is the world normal (z, x, y).
const LIT_LEFT: [number, number, number] = [-0.5, 0, 0.8660254037844386]
const CORE_RIGHT: [number, number, number] = [0.9, 0, 0.436]
const CORE_RIGHT_2: [number, number, number] = [0.92, 0, 0.392] // 2.5 degrees from CORE_RIGHT, across a normal-cell boundary
// A right face a gentle 36 degrees from the left one, for walking across.
const GENTLE_RIGHT: [number, number, number] = [0.1, 0, 0.995]
// A stroke is walked in 4 steps a side. On a face turned 30 degrees from square to the view, a 15 px step (60 px
// of stroke length a side) is 0.866 of that on the screen.
const STEP = 15 * 0.8660254037844386

function facesContext(left: [number, number, number], right: [number, number, number], params: PaintParams, rightMark = 0): PaintCtx {
  const view = paintView({ width: 400, height: 300, azimuth: 0, elevation: 0, zoom: 100 })
  const toWorld = (n: [number, number, number]) => [n[2], n[0], n[1]]
  // a real folded surface: each face's depth runs along its own slope (nx/nz in view space), meeting at the seam
  const depthOf = (n: [number, number, number], x: number) => 20 + (n[0] / n[2]) * ((x - 200) / 100)
  const g = makeGBuffer(view, 2, (x, y) => {
    if (x < 80 || x >= 320 || y < 60 || y >= 240) return null
    const n = x < 200 ? left : right
    return { depth: depthOf(n, x), normal: toWorld(n), value: 0, mark: x < 200 ? 0 : rightMark }
  })
  const scene = sceneOf([sphereMesh(), sphereMesh({ index: 1 })])
  return buildContext(scene, buildParticles(scene, flatColours({}), params), view, g, params)
}

// A stroke starting on the left face, running screen-right, `length` px long.
function walkRight(an: PaintCtx, x: number, planeRule: boolean, length = 120) {
  const point = [0, 0, 0]
  const y = 150
  const gi = Math.floor(y / 2) * an.fc.g.width + Math.floor(x / 2)
  const depth = an.fc.g.depth[gi]
  unproject(an.fc, x, y, depth, point)
  const spec: WalkSpec = {
    mark: 0,
    translucent: false,
    px: point[0], py: point[1], pz: point[2],
    sx: x, sy: y, depth,
    nx: an.fc.g.normal[3 * gi], ny: an.fc.g.normal[3 * gi + 1], nz: an.fc.g.normal[3 * gi + 2],
    dx: 0, dy: 1, dz: 0, // screen right is world +y
    mode: 'transport',
    rot: 0,
    lengthPx: length,
    bend: 0,
    stopBelow: -1,
    planeId: planeRule ? an.planes.plane[gi] : -1,
    castOnly: false,
  }
  return walkStroke(an, spec)
}

describe('the surface walk', () => {
  const noise = { edges: { noise: 0 }, environment: { occlusion: 0 } }

  it('runs the whole length on a plain surface, in both directions from the start', () => {
    const an = facesContext(LIT_LEFT, LIT_LEFT, resolvePaintParams(noise))
    const w = walkRight(an, 200, true)
    // 4 steps each way, and the start: 9 points. A stroke is 120 px long at head-on scale (60 px a side, 15 px a
    // step); on this face, turned 30 degrees, each step is 0.866 of that on the screen: foreshortened, as a stroke
    // on a surface turned away really is.
    expect(w.n).toBe(9)
    expect(w.endA).toBe(0)
    expect(w.endB).toBe(0)
    expect(w.x[0]).toBeCloseTo(200 - 4 * STEP, 3)
    expect(w.x[8]).toBeCloseTo(200 + 4 * STEP, 3)
    for (let i = 1; i < w.n; i++) expect(w.x[i] - w.x[i - 1]).toBeCloseTo(STEP, 3)
    // the stroke's lateral (n x d) runs up the screen, along the axis the face is turned about: not foreshortened at all
    for (let i = 0; i < w.n; i++) expect(w.fore[i]).toBeCloseTo(1, 2)
  })

  it('stops at a hard edge between planes: 0.46 and above', () => {
    // a sharp crease (94 degrees, hardness 0.70): a stroke starting 20 px left of the seam at x = 200 keeps its first
    // step (13 px) and is stopped before the second crosses (either by the plane rule or because the surface turns away)
    const an = facesContext(LIT_LEFT, CORE_RIGHT, resolvePaintParams(noise))
    const crease = an.edges.edges.find((e) => e.type === 'internal')!
    expect(an.edges.adjHard(crease.a, crease.b)).toBeGreaterThan(0.69)
    const sharp = walkRight(an, 180, true)
    expect(sharp.endB === 1 || sharp.endB === 2).toBe(true)
    expect(sharp.x[sharp.n - 1]).toBeCloseTo(180 + STEP, 3)
    expect(sharp.n).toBe(4 + 1 + 1)
    // the plane rule itself: a gentle crease (36 degrees) the walk can follow, hardness above the stroke's stopAt
    const gentle = facesContext(LIT_LEFT, GENTLE_RIGHT, resolvePaintParams(noise, { edges: { stopAt: 0.1, bleedAt: 0.05 } }))
    const g1 = gentle.edges.adjHard(gentle.planes.plane[75 * 200 + 85], gentle.planes.plane[75 * 200 + 115])
    expect(g1).toBeDefined()
    expect(g1!).toBeGreaterThanOrEqual(0.1)
    const stop = walkRight(gentle, 180, true)
    expect(stop.endB).toBe(1) // stopped by the edge, not by leaving the surface
    expect(stop.n).toBe(4 + 1 + 1)
    expect(stop.x[stop.n - 1]).toBeLessThan(200)
    // the same stroke with the plane rule off runs across
    const across = walkRight(gentle, 180, false)
    expect(across.endB).toBe(0)
    expect(across.n).toBe(9)
    expect(across.x[across.n - 1]).toBeGreaterThan(220)
  })

  it('bleeds across a softer edge for 60% of what is left, and runs on across a lost one', () => {
    // a gentle crease, and a stroke that stops only above 0.95 and bleeds from 0.05: any edge is a bleed
    const bleedParams = resolvePaintParams(noise, { edges: { stopAt: 0.95, bleedAt: 0.05 } })
    const an = facesContext(LIT_LEFT, GENTLE_RIGHT, bleedParams)
    expect(an.edges.adjHard(an.planes.plane[75 * 200 + 95], an.planes.plane[75 * 200 + 110])).toBeDefined()
    const w = walkRight(an, 180, true)
    expect(w.endB).toBe(3)
    // steps of 13 px: the crossing step is the second (206); 60% of the two steps left, floored, is one more
    expect(w.n).toBe(4 + 1 + 2 + 1)
    expect(w.x[4 + 1 + 1]).toBeGreaterThan(200) // the crossing step
    // without the plane rule the stroke runs its whole length
    const free = walkRight(an, 180, false)
    expect(free.n).toBe(9)
    // a lost edge (two planes of equal value) is not an edge at all
    const lost = facesContext(CORE_RIGHT, CORE_RIGHT_2, resolvePaintParams(noise))
    expect(lost.edges.adjHard(lost.planes.plane[75 * 200 + 85], lost.planes.plane[75 * 200 + 115])).toBeLessThan(0.24)
    const l = walkRight(lost, 180, true)
    expect(l.endB).toBe(0)
    expect(l.n).toBe(9)
  })

  it('ends at the border of its own mesh, where another mesh meets it at the same depth', () => {
    // the same face either side of x = 200, but the right half belongs to the next mesh: only the mesh rule can stop it
    // (the plane rule is off and the depth and normals are continuous across the seam)
    const an = facesContext(LIT_LEFT, LIT_LEFT, resolvePaintParams(noise), 1)
    const w = walkRight(an, 180, false)
    expect(w.endB).toBe(2)
    expect(w.n).toBe(4 + 1 + 1) // the first forward step (193) is on the mesh, the second (206) is not
    expect(w.x[w.n - 1]).toBeCloseTo(180 + STEP, 3)
    // one mesh all the way across runs the whole length
    expect(walkRight(facesContext(LIT_LEFT, LIT_LEFT, resolvePaintParams(noise)), 180, false).n).toBe(9)
  })

  it('ends where the surface does: at the rim of a sphere, never past it', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
    const g = sphereGBuffer(400, 300, { view })
    const scene = sceneOf([sphereMesh()])
    const an = buildContext(scene, buildParticles(scene, flatColours({}), P), view, g, P)
    // start 4 px inside the right-hand rim (the sphere's disc has radius 100 about the screen centre) running outward:
    // 74 degrees round the sphere, and a stroke half-length of 40 px is 23 degrees more: past the limb
    const x = 296
    const y = 150
    const gi = Math.floor(y / 2) * g.width + Math.floor(x / 2)
    const pt = [0, 0, 0]
    unproject(an.fc, x, y, g.depth[gi], pt)
    const spec: WalkSpec = {
      mark: 0, translucent: false,
      px: pt[0], py: pt[1], pz: pt[2], sx: x, sy: y, depth: g.depth[gi],
      nx: g.normal[3 * gi], ny: g.normal[3 * gi + 1], nz: g.normal[3 * gi + 2],
      dx: -Math.sin((30 * Math.PI) / 180), dy: Math.cos((30 * Math.PI) / 180), dz: 0, // screen right
      mode: 'transport', rot: 0, lengthPx: 80, bend: 0, stopBelow: -1, planeId: -1, castOnly: false,
    }
    const w = walkStroke(an, spec)
    expect(w.endB).toBe(2)
    // every point the walk kept is on the sphere (inside the disc, with a pixel of slack)
    for (let i = 0; i < w.n; i++) expect(Math.hypot(w.x[i] - 200, w.y[i] - 150)).toBeLessThan(100.5)
    // and the backward half, running inward over the sphere's face, went its whole way
    expect(w.endA).toBe(0)
  })

  it('narrows a stroke where the surface turns away: the width follows the foreshortening', () => {
    const view = paintView({ width: 400, height: 300, azimuth: 30, elevation: 25, zoom: 100 })
    const g = sphereGBuffer(400, 300, { view })
    const scene = sceneOf([sphereMesh()])
    const an = buildContext(scene, buildParticles(scene, flatColours({}), P), view, g, P)
    const lateral = (r: number) => {
      // a point at distance r (px) right of centre; a stroke running round the disc (vertical on screen)
      const x = 200 + r
      const y = 150
      const gi = Math.floor(y / 2) * g.width + Math.floor(x / 2)
      const pt = [0, 0, 0]
      unproject(an.fc, x, y, g.depth[gi], pt)
      // the screen up direction in world
      const m = view.view
      const up = [m[1], m[5], m[9]]
      const spec: WalkSpec = {
        mark: 0, translucent: false,
        px: pt[0], py: pt[1], pz: pt[2], sx: x, sy: y, depth: g.depth[gi],
        nx: g.normal[3 * gi], ny: g.normal[3 * gi + 1], nz: g.normal[3 * gi + 2],
        dx: up[0], dy: up[1], dz: up[2], mode: 'transport', rot: 0, lengthPx: 20, bend: 0, stopBelow: -1, planeId: -1, castOnly: false,
      }
      const w = walkStroke(an, spec)
      // every point of the walk is foreshortened, not only the start (the walk's 9 points are 2.5 px apart here)
      expect(w.n).toBe(9)
      for (const k of [0, 3, 4, 5, 8]) expect(w.fore[k]).toBeCloseTo(w.fore[4], 1)
      return w.fore[8] // the last point: a step, not the start's own value
    }
    // running up the screen, the lateral direction runs toward the viewer's axis at the right of the disc: foreshortened by the facing
    // at r = 0.8R the facing is sqrt(1 - 0.64) = 0.6; at r = 0.95R it is 0.31; at the centre the surface is square to the view
    expect(lateral(0)).toBeGreaterThan(0.95)
    expect(lateral(80)).toBeGreaterThan(0.55)
    expect(lateral(80)).toBeLessThan(0.67)
    expect(lateral(95)).toBeGreaterThan(0.25)
    expect(lateral(95)).toBeLessThan(0.4)
  })
})

describe('strokes: pressure and paths', () => {
  it('shapes the pressure: a loaded start, steady through the middle, a taper over the last 30%', () => {
    // 1 + 0.15·exp(−(t/0.15)²), times 1 − 0.55·smooth(0.7, 1, t)
    expect(pressure(0)).toBeCloseTo(1.15, 9)
    expect(pressure(0.5)).toBeCloseTo(1 + 0.15 * Math.exp(-((0.5 / 0.15) ** 2)), 9)
    expect(pressure(0.7)).toBeCloseTo(1 + 0.15 * Math.exp(-((0.7 / 0.15) ** 2)), 9)
    // t = 0.85 is the middle of the taper: smooth = 0.5, so 1 − 0.275
    expect(pressure(0.85)).toBeCloseTo((1 + 0.15 * Math.exp(-((0.85 / 0.15) ** 2))) * 0.725, 9)
    expect(pressure(1)).toBeCloseTo(0.45, 6)
    expect(pressure(0)).toBeGreaterThan(pressure(0.3))
    expect(pressure(0.3)).toBeGreaterThan(pressure(1))
  })

  it('samples a polyline at equal arc length, every point on it, both ends included', () => {
    const xs = [0, 10, 10]
    const ys = [0, 0, 6]
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const len = polylinePath(xs, ys, 3, 3, false, false, path, width)
    expect(len).toBe(16)
    // eight points over 16: every 16/7 along: (0,0), (2.2857, 0), ... the end (10, 6)
    expect(path[0]).toBe(0)
    expect(path[1]).toBe(0)
    expect(path[2]).toBeCloseTo(16 / 7, 5)
    expect(path[2 * 4]).toBeCloseTo((16 * 4) / 7, 4) // 9.14: still on the first leg
    expect(path[2 * 4 + 1]).toBeCloseTo(0, 6)
    expect(path[2 * 5]).toBe(10) // 11.43 along: round the corner
    expect(path[2 * 5 + 1]).toBeCloseTo((16 * 5) / 7 - 10, 4)
    expect(path[14]).toBe(10)
    expect(path[15]).toBe(6)
    // reversed, it starts at the other end
    const rev = new Float32Array(2 * PATH_POINTS)
    polylinePath(xs, ys, 3, 3, false, true, rev, width)
    expect(rev[0]).toBe(10)
    expect(rev[1]).toBe(6)
    expect(rev[14]).toBe(0)
    // constant width unless tapered; tapered it follows the pressure
    expect(Array.from(width)).toEqual(new Array(PATH_POINTS).fill(3))
    polylinePath(xs, ys, 3, 3, true, false, path, width)
    expect(width[0]).toBeCloseTo(3 * pressure(0), 5)
    expect(width[PATH_POINTS - 1]).toBeCloseTo(3 * pressure(1), 5)
  })

  it('carries the world path: the world points of a polyline are interpolated where its screen points are', () => {
    // the screen polyline (0,0) (10,0) (10,6); its world points (0,0,0) (4,0,2) (4,3,5): the same fractions along each leg
    const xs = [0, 10, 10]
    const ys = [0, 0, 6]
    const ws = [[0, 0, 0], [4, 0, 2], [4, 3, 5]]
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const world = new Float32Array(3 * PATH_POINTS)
    polylinePath(xs, ys, 3, 3, false, false, path, width, world, ws)
    expect(Array.from(world.subarray(0, 3))).toEqual([0, 0, 0])
    expect(Array.from(world.subarray(3 * (PATH_POINTS - 1)))).toEqual([4, 3, 5])
    // the point 4/7 of the way (9.14 of 16: on the first leg at 0.914 of it) is at the same fraction of the first world leg
    expect(world[12]).toBeCloseTo(4 * 0.9142857, 4)
    expect(world[13]).toBeCloseTo(0, 6)
    expect(world[14]).toBeCloseTo(2 * 0.9142857, 4)
    // 5/7 of the way (11.43): 1.43 up the second leg, at 0.238 of it
    expect(world[15]).toBeCloseTo(4, 6)
    expect(world[16]).toBeCloseTo(3 * (1.4285714 / 6), 4)
    expect(world[17]).toBeCloseTo(2 + 3 * (1.4285714 / 6), 4)
    // reversed, it runs from the other end
    const rev = new Float32Array(3 * PATH_POINTS)
    polylinePath(xs, ys, 3, 3, false, true, new Float32Array(2 * PATH_POINTS), width, rev, ws)
    expect(Array.from(rev.subarray(0, 3))).toEqual([4, 3, 5])
    expect(Array.from(rev.subarray(3 * (PATH_POINTS - 1)))).toEqual([0, 0, 0])
  })

  it('carries the world path of a walk: each path point is on the walk where its screen point is, and projects back to it', () => {
    const an = facesContext(LIT_LEFT, LIT_LEFT, resolvePaintParams({ environment: { occlusion: 0 } }))
    const w = walkRight(an, 200, true)
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const world = new Float32Array(3 * PATH_POINTS)
    pathFromWalk(w, 10, false, path, width, world)
    // the ends are the walk's own world points, and the world points project back to the path (an orthographic view: affine)
    expect(world[0]).toBeCloseTo(w.wx[0], 4)
    expect(world[3 * (PATH_POINTS - 1) + 2]).toBeCloseTo(w.wz[w.n - 1], 4)
    const m = an.fc.vp
    for (let q = 0; q < PATH_POINTS; q++) {
      const x = world[3 * q], y = world[3 * q + 1], z = world[3 * q + 2]
      const sx = (((m[0] * x + m[4] * y + m[8] * z + m[12]) / (m[3] * x + m[7] * y + m[11] * z + m[15]) + 1) / 2) * an.fc.W
      const sy = ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13]) / (m[3] * x + m[7] * y + m[11] * z + m[15])) / 2) * an.fc.H
      expect(sx).toBeCloseTo(path[2 * q], 2)
      expect(sy).toBeCloseTo(path[2 * q + 1], 2)
    }
    // reversed, the world path runs the other way
    const back = new Float32Array(3 * PATH_POINTS)
    pathFromWalk(w, 10, true, new Float32Array(2 * PATH_POINTS), width, back)
    expect(back[0]).toBeCloseTo(world[3 * (PATH_POINTS - 1)], 4)
  })

  it('interpolates each world coordinate of a walk by the same fraction as its screen point, either way round', () => {
    // a bent walk whose three world coordinates all change, and not in step with each other, so a coordinate
    // read from the wrong end of a leg (or one that is never interpolated) cannot pass
    const xs = [0, 10, 10, 30]
    const ys = [0, 0, 6, 6]
    const wx = [0, 4, 4, 9]
    const wy = [0, 0, 3, 3]
    const wz = [0, 2, 5, 11]
    const w = { n: 4, x: Float64Array.from(xs), y: Float64Array.from(ys), depth: new Float64Array(4), fore: Float64Array.from([1, 1, 1, 1]), wx: Float64Array.from(wx), wy: Float64Array.from(wy), wz: Float64Array.from(wz), endA: 0, endB: 0 } as Walk
    const legs = [10, 6, 20]
    const total = 36
    const expectAt = (s: number) => {
      let leg = 0
      let from = 0
      while (leg < 2 && from + legs[leg] < s) from += legs[leg++]
      const f = (s - from) / legs[leg]
      const at = (a: number[]) => a[leg] + (a[leg + 1] - a[leg]) * f
      return [at(xs), at(ys), at(wx), at(wy), at(wz)]
    }
    for (const reverse of [false, true]) {
      const path = new Float32Array(2 * PATH_POINTS)
      const world = new Float32Array(3 * PATH_POINTS)
      pathFromWalk(w, 10, reverse, path, new Float32Array(PATH_POINTS), world)
      for (let q = 0; q < PATH_POINTS; q++) {
        const k = reverse ? PATH_POINTS - 1 - q : q
        const [sx, sy, x, y, z] = expectAt((k / (PATH_POINTS - 1)) * total)
        expect(path[2 * q]).toBeCloseTo(sx, 4)
        expect(path[2 * q + 1]).toBeCloseTo(sy, 4)
        expect(world[3 * q]).toBeCloseTo(x, 4)
        expect(world[3 * q + 1]).toBeCloseTo(y, 4)
        expect(world[3 * q + 2]).toBeCloseTo(z, 4)
      }
    }
  })

  it('resamples a walk to PATH_POINTS with the width times the foreshortening', () => {
    const an = facesContext(LIT_LEFT, LIT_LEFT, resolvePaintParams({ environment: { occlusion: 0 } }))
    const w = walkRight(an, 200, true)
    const path = new Float32Array(2 * PATH_POINTS)
    const width = new Float32Array(PATH_POINTS)
    const mean = pathFromWalk(w, 10, false, path, width)
    // from the walk's first to its last point, evenly: seven gaps
    const span = 8 * STEP
    expect(path[0]).toBeCloseTo(200 - 4 * STEP, 3)
    expect(path[14]).toBeCloseTo(200 + 4 * STEP, 3)
    expect(path[2]).toBeCloseTo(200 - 4 * STEP + span / 7, 3)
    expect(mean).toBeGreaterThan(5)
    // the loaded start is the broadest, the taper the thinnest
    expect(width[0]).toBeGreaterThan(width[3])
    expect(width[PATH_POINTS - 1]).toBeLessThan(width[3])
    // reversed: the start is at the right
    pathFromWalk(w, 10, true, path, width)
    expect(path[0]).toBeCloseTo(200 + 4 * STEP, 3)
  })
})

describe('packing the strokes', () => {
  const draft = (role: string, depth: number, order: number, lab: [number, number, number] = [0.5, 0.05, 0.02], cell = order): StrokeDraft => ({
    role: roleIndex(role as never),
    path: new Float32Array(2 * PATH_POINTS).fill(order),
    width: new Float32Array(PATH_POINTS).fill(3),
    depth,
    lab,
    u: 0.6,
    cell,
    mx: 0,
    my: 0,
    colormapped: false,
    alpha: 1,
    load: 1,
    impasto: 1,
    bristles: 6,
    bristleVar: 0.3,
    dry: 0.2,
    wet: 0.1,
    endSoft: 0,
    edge: 255,
    seed: order,
    jit0: 0,
    jit1: 0,
    order,
  })

  it('orders by layer, then back to front by depth, then by creation', () => {
    const drafts = [
      draft('dab', 5, 0),
      draft('block', 3, 1),
      draft('line', 9, 2),
      draft('block', 8, 3),
      draft('form', 1, 4),
      draft('block', 3, 5),
      draft('edge', 2, 6),
    ]
    const { batch, byRole } = packStrokes(drafts, P)
    // layers: block, form, scumble, glaze, reflected, edge, line, dab
    const order = Array.from(batch.seed)
    expect(order).toEqual([3, 1, 5, 4, 6, 2, 0]) // block 8, block 3 (created 1), block 3 (created 5), form, edge, line, dab
    expect(Array.from(batch.role).map((r) => ROLES[r])).toEqual(['block', 'block', 'block', 'form', 'edge', 'line', 'dab'])
    expect(byRole.block).toBe(3)
    expect(byRole.dab).toBe(1)
    expect(byRole.glaze).toBe(0)
    expect(batch.count).toBe(7)
    // the arrays hold each stroke's own path
    expect(batch.path[0]).toBe(3)
    expect(batch.path[2 * PATH_POINTS * 6]).toBe(0)
  })

  it('mixes loads in that order, one role at a time, and writes linear-light colour', () => {
    const drafts: StrokeDraft[] = []
    // lines and edges take the sequential mixer (surface strokes take their cell's mix, one per cell)
    for (let i = 0; i < 40; i++) drafts.push(draft('edge', 100 - i, i, [0.6, 0.1, 0.05], i))
    for (let i = 0; i < 10; i++) drafts.push(draft('line', 100 - i, 100 + i, [0.6, 0.1, 0.05], 100 + i))
    const { batch, loads } = packStrokes(drafts, P)
    // 40 + 10 strokes in loads of 3..8: between 7 and 17 loads
    expect(loads).toBeGreaterThanOrEqual(7)
    expect(loads).toBeLessThanOrEqual(17)
    // every colour is a finite linear sRGB in 0..1 and not all equal (the mix varies them)
    const reds = new Set<number>()
    for (let i = 0; i < batch.count; i++) {
      for (let c = 0; c < 3; c++) {
        expect(batch.colour[3 * i + c]).toBeGreaterThanOrEqual(0)
        expect(batch.colour[3 * i + c]).toBeLessThanOrEqual(1)
      }
      reds.add(batch.colour[3 * i])
    }
    expect(reds.size).toBeGreaterThan(10)
    // with no mix the colour is the target itself: the same for every stroke
    const none = packStrokes(drafts.map((d) => ({ ...d })), resolvePaintParams({ mix: { strength: 0 } }))
    const first = Array.from(none.batch.colour.subarray(0, 3))
    for (let i = 0; i < none.batch.count; i++) expect(Array.from(none.batch.colour.subarray(3 * i, 3 * i + 3))).toEqual(first)
    expect(none.loads).toBe(0)
  })
})
