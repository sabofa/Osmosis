import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import { makeCurve } from '../model/curve'
import { stepValue, type PlaneMap } from '../model/planes'
import { buildParticles } from '../model/particles'
import { flatColours, graphMesh, quadMesh, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { worldLight } from '../model/valueFinalFixture'
import { zoneFamily, Z_CAST, Z_CORE, Z_HALF, Z_LIGHT, Z_REFLECTED } from '../model/value'
import type { Oklab, ParticleSet } from '../types'
import { buildWorldPlan } from './plan'
import { buildWorldPlanes, lonCell, PLANE_MIN_TRIANGLES, stepValueWorld, triangleZone, GROUND_BAND_PX, type WorldPlanes } from './planes'
import { parametricMesh } from '../../testing/marks'
import { locate, type SurfacePoint } from './surface'

// A plan over a refined surface is heavy and the test machine is shared: give every test room.
vi.setConfig({ testTimeout: 120_000 })

const P = DEFAULT_PAINT_PARAMS
const PX = 1 / 150 // world units per CSS px
const LIGHT = worldLight(-35, 39) // the lab's key light
const COLOURS = flatColours({ 0: [0.56, 0.1, 0.08], 1: [0.9, 0.01, 0.02] })
const CURVE = makeCurve(P)

// A sphere (r 1) on a table at z = -1.
const SCENE = sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 }), tableMesh({ z: -1, half: 3, index: 1 })])
const PLAN = buildWorldPlan(SCENE, LIGHT, P, PX)
const SET = buildParticles(SCENE, COLOURS, P)
const PLANES = buildWorldPlanes(PLAN, SET, COLOURS, CURVE, P)

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64')

// The planes of one mark and side.
const planesOn = (planes: WorldPlanes, mark: number, side: 1 | -1 | 0) => planes.planes.filter((p) => p.mark === mark && p.side === side)

// A torus about the z axis, major radius R, minor r, smooth outward normals.
const torusMesh = (R: number, r: number, nu: number, nv: number) =>
  parametricMesh(
    (u, v) => [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)],
    (u, v) => [Math.cos(v) * Math.cos(u), Math.cos(v) * Math.sin(u), Math.sin(v)],
    0, 2 * Math.PI, 0, 2 * Math.PI, nu, nv,
  )

describe('triangleZone', () => {
  const zones = Uint8Array.from([Z_LIGHT, Z_LIGHT, Z_CORE, Z_HALF, Z_CORE, Z_REFLECTED])
  const u = Float32Array.from([0.9, 0.8, 0.2, 0.6, 0.25, 0.3])
  it('is the zone most of the vertices have', () => {
    expect(triangleZone(zones, u, 0, 1, 2)).toBe(Z_LIGHT)
    expect(triangleZone(zones, u, 2, 0, 1)).toBe(Z_LIGHT)
    expect(triangleZone(zones, u, 2, 4, 0)).toBe(Z_CORE)
    expect(triangleZone(zones, u, 3, 2, 4)).toBe(Z_CORE)
  })
  it('is, on a three-way tie, the zone of the vertex whose value is the median', () => {
    // light 0.9, half 0.6, core 0.2: the half-tone's is the middle one, whatever the order
    expect(triangleZone(zones, u, 0, 3, 2)).toBe(Z_HALF)
    expect(triangleZone(zones, u, 2, 0, 3)).toBe(Z_HALF)
    expect(triangleZone(zones, u, 3, 2, 0)).toBe(Z_HALF)
    // core 0.2, reflected 0.3, half 0.6: the reflected light's
    expect(triangleZone(zones, u, 2, 5, 3)).toBe(Z_REFLECTED)
    expect(triangleZone(zones, u, 3, 5, 2)).toBe(Z_REFLECTED)
  })
})

describe('buildWorldPlanes: the sphere under the lab’s light', () => {
  const sphere = planesOn(PLANES, 0, 0)

  it('makes planes of the closed sphere on its outside (side 0) and none on a second side, and numbers them from 0', () => {
    expect(PLANES.planes.every((p, i) => p.id === i)).toBe(true)
    expect(PLANES.planeOf[0][0]).not.toBeNull()
    expect(PLANES.planeOf[0][1]).toBeNull()
    expect(PLANES.planeOf[1][0]).not.toBeNull()
    expect(PLANES.planeOf[1][1]).not.toBeNull() // the table is an open sheet: both sides
    expect(PLANES.planes.filter((p) => p.mark === 0).every((p) => p.side === 0)).toBe(true)
    expect(planesOn(PLANES, 1, 1).length).toBeGreaterThan(0)
    expect(planesOn(PLANES, 1, -1).length).toBeGreaterThan(0)
    // every triangle has a plane, of its own mark and side
    const s = PLAN.surfaces[0]!
    const ids = PLANES.planeOf[0][0]!
    expect(ids.length).toBe(s.indices.length / 3)
    for (const id of ids) expect(PLANES.planes[id].mark).toBe(0)
  })

  it('has planes enough for a form turned through 26 degree cells and its zones, not one per triangle: 68 cells of normals, split by the zone bands', () => {
    // a latitude-longitude cell of 26 degrees on the whole sphere is about 68 of them; the zone bands (light, half-tone, core, reflected)
    // cut some of them in two. (The per-frame model sees one hemisphere of it.)
    expect(sphere.length).toBeGreaterThan(40)
    expect(sphere.length).toBeLessThan(150)
    expect(sphere.length).toBeLessThan(PLAN.surfaces[0]!.indices.length / 3 / 20)
  })

  it('makes every plane of one family: every triangle’s zone is of the plane’s family, and the plane’s own zone and family agree', () => {
    const sp = PLAN.front[0]!
    const s = PLAN.surfaces[0]!
    const ids = PLANES.planeOf[0][0]!
    const famOf = (t: number) => zoneFamily(triangleZone(sp.zone, sp.u, s.indices[3 * t], s.indices[3 * t + 1], s.indices[3 * t + 2]))
    for (let t = 0; t < ids.length; t++) expect(famOf(t), `triangle ${t}`).toBe(PLANES.planes[ids[t]].fam)
    for (const p of sphere) expect(zoneFamily(p.zone)).toBe(p.fam)
    // and both families are there
    expect(sphere.some((p) => p.fam === 0)).toBe(true)
    expect(sphere.some((p) => p.fam === 1)).toBe(true)
  })

  it('merges the small pieces into a neighbour of their own family: a plane under the minimum area that is not ground has no neighbour of its family', () => {
    const s = PLAN.surfaces[0]!
    const ids = PLANES.planeOf[0][0]!
    const minArea = Math.max(P.edges.planeMinPx, PLANE_MIN_TRIANGLES * 72) * PX * PX // (planeMinPx, or three triangles of a 12 px cell)
    const small = new Set(sphere.filter((p) => p.area < minArea).map((p) => p.id))
    // (a piece smaller than the minimum is kept only where no neighbour is of its family)
    const neighbours = new Map<number, Set<number>>()
    for (let t = 0; t < ids.length; t++) {
      for (let e = 0; e < 3; e++) {
        const u = s.adj[3 * t + e]
        if (u < 0 || ids[u] === ids[t]) continue
        if (!neighbours.has(ids[t])) neighbours.set(ids[t], new Set())
        neighbours.get(ids[t])!.add(ids[u])
      }
    }
    for (const id of small) for (const q of neighbours.get(id) ?? []) expect(PLANES.planes[q].fam, `plane ${id} next to ${q}`).not.toBe(PLANES.planes[id].fam)
    // a larger minimum merges more: fewer planes, still of one family each
    const big: PaintParams = { ...P, edges: { ...P.edges, planeMinPx: 4000 } }
    const merged = buildWorldPlanes(PLAN, SET, COLOURS, CURVE, big)
    const mergedSphere = planesOn(merged, 0, 0)
    expect(mergedSphere.length).toBeLessThan(sphere.length)
    const sp = PLAN.front[0]!
    const mids = merged.planeOf[0][0]!
    for (let t = 0; t < mids.length; t++) {
      const z = triangleZone(sp.zone, sp.u, s.indices[3 * t], s.indices[3 * t + 1], s.indices[3 * t + 2])
      expect(zoneFamily(z)).toBe(merged.planes[mids[t]].fam)
    }
    // and no minimum merges nothing that is a component of its own
    const none = buildWorldPlanes(PLAN, SET, COLOURS, CURVE, { ...P, edges: { ...P.edges, planeMinPx: 0 } })
    expect(planesOn(none, 0, 0).length).toBeGreaterThanOrEqual(sphere.length)
  })

  it('gives each plane its statistics: the area sums to the surface’s, the mean normal is a unit vector at the centroid’s direction, the mean value is between its triangles’', () => {
    const s = PLAN.surfaces[0]!
    let total = 0
    for (let t = 0; t < s.area.length; t++) total += s.area[t]
    expect(sphere.reduce((a, p) => a + p.area, 0)).toBeCloseTo(total, 9)
    // (a sphere: the outside normal at a point is the point's direction)
    for (const p of sphere) {
      expect(Math.hypot(p.nx, p.ny, p.nz)).toBeCloseTo(1, 9)
      const r = Math.hypot(p.cx, p.cy, p.cz)
      expect(r).toBeGreaterThan(0.5)
      // the centroid of a piece of the sphere's surface, and its mean normal, point the same way (the normal is the outward one: side +1 of a closed mesh)
      expect((p.nx * p.cx + p.ny * p.cy + p.nz * p.cz) / r).toBeGreaterThan(0.95)
      expect(p.u).toBeGreaterThan(0.2)
      expect(p.u).toBeLessThan(0.95)
      expect(p.ground).toBe(false)
      expect(p.cast).toBe(false)
      const step = CURVE.planeStep(p.nx, p.ny, p.nz)
      expect(p.hOff).toBe(step[0])
      expect(p.cOff).toBe(step[1])
    }
    // the lit planes are lighter than the shadow ones, and the lightest of all faces the light
    const light = sphere.filter((p) => p.fam === 0)
    const shadow = sphere.filter((p) => p.fam === 1)
    expect(Math.min(...light.map((p) => p.u))).toBeGreaterThan(Math.max(...shadow.map((p) => p.u)))
    const brightest = light.reduce((a, b) => (b.u > a.u ? b : a))
    expect(brightest.nx * LIGHT[0] + brightest.ny * LIGHT[1] + brightest.nz * LIGHT[2]).toBeGreaterThan(0.85)
  })

  it('is in WORLD directions: the planes do not depend on where a camera is, and the light changes them (a different light, different planes)', () => {
    // no view argument at all
    expect(buildWorldPlanes.length).toBe(5)
    const plan2 = buildWorldPlan(SCENE, worldLight(120, 25), P, PX)
    const planes2 = buildWorldPlanes(plan2, SET, COLOURS, CURVE, P)
    const zonesOf = (pl: WorldPlanes) => planesOn(pl, 0, 0).map((p) => `${p.zone}:${p.cx.toFixed(2)},${p.cy.toFixed(2)},${p.cz.toFixed(2)}`).join('|')
    expect(zonesOf(planes2)).not.toBe(zonesOf(PLANES))
    // the cells themselves are the normals' (the light only cuts them by zone): the brightest plane under each light faces its light
    const lit = (pl: WorldPlanes, L: readonly number[]) => {
      const light = planesOn(pl, 0, 0).filter((p) => p.fam === 0)
      const best = light.reduce((a, b) => (b.u > a.u ? b : a))
      return best.nx * L[0] + best.ny * L[1] + best.nz * L[2]
    }
    expect(lit(planes2, worldLight(120, 25))).toBeGreaterThan(0.8)
  })
})

describe('the longitude cells', () => {
  // a sweep of longitudes: the cell of each, per latitude band
  const sweep = (latI: number, cell: number): number[] => Array.from({ length: 7200 }, (_, k) => lonCell(latI, -Math.PI + ((k + 0.5) / 7200) * 2 * Math.PI, cell))

  for (const deg of [26, 10, 45, 30]) {
    it(`give every latitude band of ${deg} degrees a whole number of equal cells, none partial at ±π, and the bands that reach a pole one cell`, () => {
      const cell = (deg * Math.PI) / 180
      const bands = Math.ceil(Math.PI / cell - 1e-9)
      for (let latI = 0; latI < bands; latI++) {
        const cells = sweep(latI, cell)
        const n = Math.max(...cells) + 1
        const centre = (latI + 0.5) * cell - Math.PI / 2
        const polar = Math.abs(Math.abs(centre) - Math.PI / 2) <= cell / 2 + 1e-9
        if (polar) {
          expect(n, `band ${latI}`).toBe(1)
          continue
        }
        // as many cells as the model's widening toward the poles says, to a whole number
        expect(n, `band ${latI}`).toBe(Math.max(1, Math.round((2 * Math.PI * Math.max(0.35, Math.cos(centre))) / cell)))
        // every cell from 0 to n - 1 is there, in order, and as wide as the others (the last is not a remainder)
        const counts = new Array<number>(n).fill(0)
        let prev = 0
        for (const c of cells) {
          expect(c).toBeGreaterThanOrEqual(prev)
          prev = c
          counts[c]++
        }
        for (const c of counts) expect(Math.abs(c - 7200 / n), `band ${latI}`).toBeLessThanOrEqual(1)
      }
    })
  }
})

describe('buildWorldPlanes: the lat/lon binning leaves no seam sliver and no pinwheel at the pole', () => {
  const trianglesNear = (planes: WorldPlanes, plan: ReturnType<typeof buildWorldPlan>, mark: number, test: (cx: number, cy: number, cz: number, nz: number) => boolean): Set<number> => {
    const s = plan.surfaces[mark]!
    const ids = planes.planeOf[mark][0]!
    const out = new Set<number>()
    for (let t = 0; t < ids.length; t++) {
      const a = 3 * s.indices[3 * t]
      const b = 3 * s.indices[3 * t + 1]
      const c = 3 * s.indices[3 * t + 2]
      const nz = (s.normals[a + 2] + s.normals[b + 2] + s.normals[c + 2]) * s.orient / 3
      if (test((s.positions[a] + s.positions[b] + s.positions[c]) / 3, (s.positions[a + 1] + s.positions[b + 1] + s.positions[c + 1]) / 3, (s.positions[a + 2] + s.positions[b + 2] + s.positions[c + 2]) / 3, nz)) out.add(ids[t])
    }
    return out
  }
  const torus = (() => {
    const scene = sceneOf([torusMesh(1, 0.4, 40, 20)])
    const plan = buildWorldPlan(scene, LIGHT, P, PX)
    return { plan, planes: buildWorldPlanes(plan, buildParticles(scene, COLOURS, P), COLOURS, CURVE, P) }
  })()

  for (const [name, get] of [['the sphere', () => ({ plan: PLAN, planes: PLANES })], ['the torus', () => torus]] as const) {
    it(`has no plane of ${name} under three minimum areas that borders longitude ±π`, () => {
      const { plan, planes } = get()
      const nearSeam = trianglesNear(planes, plan, 0, (cx, cy) => Math.abs(Math.atan2(cy, cx)) > Math.PI - 0.15)
      const minArea = 3 * P.edges.planeMinPx * PX * PX
      const slivers = [...nearSeam].filter((id) => planes.planes[id].area < minArea)
      expect(slivers, `planes ${slivers.join(',')}`).toEqual([])
      // and the seam is there to border: planes do border it
      expect(nearSeam.size).toBeGreaterThan(3)
    })
  }

  it('has at most 2 planes within 10 degrees of the pole of the sphere (it was 7: a pinwheel of wedges), and at most 4 along the crest of the torus (it was 16)', () => {
    const cap = Math.cos((10 * Math.PI) / 180)
    expect(trianglesNear(PLANES, PLAN, 0, (_x, _y, _z, nz) => nz > cap).size).toBeLessThanOrEqual(2)
    expect(trianglesNear(torus.planes, torus.plan, 0, (_x, _y, _z, nz) => nz > cap).size).toBeLessThanOrEqual(4)
  })

  it('merges the slivers of a cell’s jag into their neighbours: no plane under three triangles of the plan’s cells that has a neighbour of its family', () => {
    const minArea = PLANE_MIN_TRIANGLES * 72 * PX * PX
    for (const [plan, planes] of [[PLAN, PLANES], [torus.plan, torus.planes]] as const) {
      const s = plan.surfaces[0]!
      const ids = planes.planeOf[0][0]!
      const small = new Set(planes.planes.filter((p) => p.mark === 0 && p.area < minArea).map((p) => p.id))
      for (let t = 0; t < ids.length; t++) {
        for (let e = 0; e < 3; e++) {
          const u = s.adj[3 * t + e]
          if (u < 0 || ids[u] === ids[t] || !small.has(ids[t])) continue
          expect(planes.planes[ids[u]].fam).not.toBe(planes.planes[ids[t]].fam)
        }
      }
    }
  })
})

describe('buildWorldPlanes: the table', () => {
  it('splits the bare table by the shadow and by the distance from what casts it: the lit table one plane, the cast shadow in bands of 26 and 64 px', () => {
    const top = planesOn(PLANES, 1, 1)
    expect(top.every((p) => p.ground)).toBe(true)
    const lit = top.filter((p) => !p.cast)
    const cast = top.filter((p) => p.cast)
    expect(lit.length).toBeGreaterThanOrEqual(1)
    expect(cast.length).toBeGreaterThanOrEqual(3)
    // ground planes have no hue or chroma step, and a lit table is light-family bare canvas
    for (const p of top) {
      expect(p.hOff).toBe(0)
      expect(p.cOff).toBe(0)
      expect(p.nz).toBeCloseTo(1, 9)
    }
    for (const p of lit) {
      expect(p.fam).toBe(0)
      expect(p.zone).toBe(Z_LIGHT)
      // (bare canvas: a triangle of the lit plane may have a vertex in the shadow's edge, which pulls the mean down a hair)
      expect(p.u).toBeCloseTo(PLAN.uCanvas, 2)
    }
    for (const p of cast) {
      expect(p.zone).toBe(Z_CAST)
      expect(p.fam).toBe(1)
    }
    // the bands: a cast triangle's mean occluder distance in px tells its plane, and each band of cast planes lies in its own range
    const s = PLAN.surfaces[1]!
    const sp = PLAN.front[1]!
    const ids = PLANES.planeOf[1][0]!
    const bandOf = (px: number) => (px < GROUND_BAND_PX[0] ? 0 : px < GROUND_BAND_PX[1] ? 1 : 2)
    const seen = [0, 0, 0]
    for (let t = 0; t < ids.length; t++) {
      const pl = PLANES.planes[ids[t]]
      if (!pl.cast) continue
      const vs = [s.indices[3 * t], s.indices[3 * t + 1], s.indices[3 * t + 2]]
      const d = vs.map((v) => sp.shadowDist[v]).filter((x) => Number.isFinite(x))
      const px = d.length > 0 ? d.reduce((a, b) => a + b, 0) / d.length / PX : Infinity
      seen[bandOf(px)]++
    }
    expect(seen.every((n) => n > 0)).toBe(true)
    // near the contact the shadow is in the first band, far out in the last: the darkest cast plane is the one under the sphere
    const nearest = cast.reduce((a, b) => (Math.hypot(b.cx, b.cy) < Math.hypot(a.cx, a.cy) ? b : a))
    const farthest = cast.reduce((a, b) => (Math.hypot(b.cx, b.cy) > Math.hypot(a.cx, a.cy) ? b : a))
    expect(nearest.u).toBeLessThan(farthest.u)
  })

  it('makes the underside of the table a plane of its own: the whole of it in shadow, a cast plane on side -1', () => {
    const under = planesOn(PLANES, 1, -1)
    expect(under.length).toBe(1)
    expect(under[0].cast).toBe(true)
    expect(under[0].nz).toBeCloseTo(-1, 9)
  })
})

describe('buildWorldPlanes: other surfaces', () => {
  it('has planes on both sides of an open sheet, the side -1 normal turned', () => {
    const sheet = graphMesh((x, y) => 0.3 * x * x - 0.2 * y * y + 0.5, { half: 1, n: 12, index: 0 })
    const plan = buildWorldPlan(sceneOf([sheet]), LIGHT, P, PX)
    const set = buildParticles(sceneOf([sheet]), COLOURS, P)
    const planes = buildWorldPlanes(plan, set, COLOURS, CURVE, P)
    const front = planesOn(planes, 0, 1)
    const back = planesOn(planes, 0, -1)
    expect(front.length).toBeGreaterThan(2)
    expect(back.length).toBeGreaterThan(0)
    expect(planes.planeOf[0][0]).not.toBeNull()
    expect(planes.planeOf[0][1]).not.toBeNull()
    // the back's mean normals point down, the front's up
    expect(front.every((p) => p.nz > 0)).toBe(true)
    expect(back.every((p) => p.nz < 0)).toBe(true)
    // the sheet lit from above: its front in the light family, its back in the shadow family
    expect(front.every((p) => p.fam === 0)).toBe(true)
    expect(back.every((p) => p.fam === 1)).toBe(true)
  })

  it('gives a veil no planes (the per-frame model has none: a veil is not in the G-buffer), and a stroke on it no step', () => {
    const veil = quadMesh({ origin: [-1, -1, 1], e1: [2, 0, 0], e2: [0, 2, 0.4], n: 6, opacity: 0.4, index: 0 })
    const scene = sceneOf([veil, tableMesh({ z: 0, half: 3, index: 1 })])
    const plan = buildWorldPlan(scene, [0.1, 0.05, 1], P, PX)
    const set = buildParticles(scene, COLOURS, P)
    const planes = buildWorldPlanes(plan, set, COLOURS, CURVE, P)
    expect(planes.planeOf[0]).toEqual([null, null])
    expect(planes.planes.every((p) => p.mark === 1)).toBe(true)
    expect(stepValueWorld(planes, -1, 0.7, 0.45)).toBe(0.7)
  })
})

describe('buildWorldPlanes: the colour of a plane', () => {
  // a colour-scaled mesh: the local colour of a particle follows the height
  const scaled = graphMesh((x, y) => 0.6 * (x * x + y * y), { half: 1, n: 16, scaled: true, index: 0 })
  const scene = sceneOf([scaled])
  const colours = flatColours({ 0: [0.5, 0, 0] }, (v) => [0.4 + 0.3 * v, 0.1 * v, -0.05 * v] as Oklab)
  const plan = buildWorldPlan(scene, LIGHT, P, PX)
  const set = buildParticles(scene, colours, P)
  // (finer cells, so that a small bowl has planes enough)
  const fine: PaintParams = { ...P, edges: { ...P.edges, planeCellDeg: 8 } }
  const planes = buildWorldPlanes(plan, set, colours, CURVE, fine)

  it('is the mean local colour of the particles that stand on it, a particle on the plane of the refined triangle it locates on, on each side of an open mesh', () => {
    expect(set.count).toBeGreaterThan(500)
    const s = plan.surfaces[0]!
    const sum = new Float64Array(3 * planes.planes.length)
    const count = new Uint32Array(planes.planes.length)
    const p: SurfacePoint = { tri: 0, b1: 0, b2: 0 }
    for (let i = 0; i < set.count; i++) {
      expect(locate(s, set.position[3 * i], set.position[3 * i + 1], set.position[3 * i + 2], set.normal[3 * i], set.normal[3 * i + 1], set.normal[3 * i + 2], 1e-4, p)).toBe(true)
      for (let k = 0; k < 2; k++) {
        const id = planes.planeOf[0][k]![p.tri]
        for (let c = 0; c < 3; c++) sum[3 * id + c] += set.colour[3 * i + c]
        count[id]++
      }
    }
    let compared = 0
    for (const pl of planes.planes) {
      if (count[pl.id] === 0) continue
      compared++
      for (let c = 0; c < 3; c++) expect(pl.colour[c]).toBeCloseTo(sum[3 * pl.id + c] / count[pl.id], 9)
    }
    expect(compared).toBeGreaterThan(5)
    // a colour scale colours the planes differently
    const l = planes.planes.map((pl) => pl.colour[0])
    expect(Math.max(...l) - Math.min(...l)).toBeGreaterThan(0.05)
  })

  it('is the mark’s colour where no particle stands on the plane', () => {
    const empty: ParticleSet = { ...set, count: 0 }
    const none = buildWorldPlanes(plan, empty, colours, CURVE, fine)
    expect(none.planes.length).toBe(planes.planes.length)
    for (const pl of none.planes) expect(pl.colour).toEqual([0.5, 0, 0])
  })
})

describe('stepValueWorld', () => {
  it('is the model’s stepValue: the plane’s mean plus the plane gradient of the stroke’s own, the plan’s own value off a plane, and the band’s follow toward it', () => {
    const map = { planes: [{ u: 0.4 }, { u: 0.8 }] } as unknown as PlaneMap
    const wp = { planes: [{ u: 0.4 }, { u: 0.8 }] } as unknown as WorldPlanes
    for (const id of [-1, 0, 1]) {
      for (const u of [0.1, 0.5, 0.93]) {
        for (const g of [0, 0.45, 1]) {
          for (const follow of [0, 0.3, 1]) expect(stepValueWorld(wp, id, u, g, follow)).toBe(stepValue(map, id, u, g, follow))
          expect(stepValueWorld(wp, id, u, g)).toBe(stepValue(map, id, u, g))
        }
      }
    }
    expect(stepValueWorld(wp, 0, 0.7, 0.45)).toBeCloseTo(0.4 + 0.45 * 0.3, 12)
  })
})

describe('buildWorldPlanes: determinism', () => {
  it('gives byte-identical planes on two bakes', () => {
    const plan = buildWorldPlan(SCENE, LIGHT, P, PX)
    const again = buildWorldPlanes(plan, SET, COLOURS, CURVE, P)
    expect(again.planes.length).toBe(PLANES.planes.length)
    expect(JSON.stringify(again.planes)).toBe(JSON.stringify(PLANES.planes))
    PLANES.planeOf.forEach((arrays, m) => arrays.forEach((a, k) => expect(a === null ? null : bytes(again.planeOf[m][k]!), `mark ${m} side ${k}`).toBe(a === null ? null : bytes(a))))
  })
})
