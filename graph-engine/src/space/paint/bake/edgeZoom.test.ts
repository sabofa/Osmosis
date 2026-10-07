import { describe, expect, it, vi } from 'vitest'
import { paintFrame } from '../model/index'
import { flatColours, paintView, sceneOf, sphereGBuffer, sphereMesh } from '../model/testing'
import { PATH_POINTS, ROLES, type PaintView, type StrokeBatch } from '../types'
import { bakePainting } from './index'
import { framing, fixture, LIGHT, PX, sparse, bytes, TERRACOTTA, type Fixture } from './bakeFixture'
import { frameFromBakeWith, FrameScratch } from './frame'
import { BAKE_EDGE_REFINE, BAKE_PATH_POINTS, isEdgeSizing, SIZING_ALONG } from './types'

vi.setConfig({ testTimeout: 300_000 })

// THE EDGE STROKES AT EVERY ZOOM (the final fix wave's M2). The per-frame model draws an edge stroke at a fixed size and spacing in px at any zoom: a pull of about
// 22 px every ~34 px, a bridge of about 26 px every ~42 px, all of one width. A baked path is fixed in the world; before the fix a pull or a bridge was drawn whole, so it
// grew with the zoom (15, 29, 72 and 113 px on average at ×0.5, ×1, ×3 and ×6 at the same width: a soft or lost edge became a few long hairlines). What a frame draws of a
// baked painting's edge strokes is measured here against what the model draws of the same figure at the same zoom: the sphere (alone: the model's analytic G-buffer has no
// finite table), its particles the model's own, in a view whose G-buffer the model reads at full resolution (800 x 500: the model's analysis decimates a bigger one, and its
// strokes' px with it: model/index.ts analysisStride). EDGE_PRINT=1 prints the table.

const P = PATH_POINTS
const R_EDGE = ROLES.indexOf('edge')
const FRONT_ORTHO = framing(20, 25, true)
const ZOOMS = [0.5, 1, 3, 6] as const
const AZIMUTHS = [20, 80, 140, 200, 260, 320]

const SPHERE = fixture(sceneOf([sphereMesh({ radius: 1, index: 0, nu: 36, nv: 24 })]), flatColours({ 0: TERRACOTTA }), sparse(700), LIGHT, FRONT_ORTHO)

const viewAt = (zoom: number, azimuth = 20, elevation = 25, perspective = false): PaintView => ({
  ...paintView({ width: 800, height: 500, azimuth, elevation, zoom: zoom / PX, magnify: zoom, perspective }),
  lightDir: LIGHT,
})

type Kind = 'crisp' | 'drag' | 'pull' | 'bridge'

// The kind of an edge stroke from what the model gives a stroke of it: the class of its edge (lost: a bridge; soft: a drag or a pull; firm and hard: a crisp stroke), and for
// a soft one the width at the middle of its path (a drag is 2.6 times the role's width, a pull 1.9: 10.4 and 7.6 px).
function kindOf(b: StrokeBatch, o: number): Kind {
  const cls = b.edge[o]
  if (cls >= 2) return 'crisp'
  if (cls === 0) return 'bridge'
  return b.width[P * o + 3] > 8.8 ? 'drag' : 'pull'
}

const lengthOf = (b: StrokeBatch, o: number): number => {
  let len = 0
  for (let k = 1; k < P; k++) len += Math.hypot(b.path[2 * P * o + 2 * k] - b.path[2 * P * o + 2 * k - 2], b.path[2 * P * o + 2 * k + 1] - b.path[2 * P * o + 2 * k - 1])
  return len
}

interface Measured {
  n: number
  length: number
  width: number
  // The mean distance between consecutive strokes of one stretch of one kind along it (a stretch's strokes lie on one edge: the model's share a seed, the baked ones a
  // density rank), px: the extent of a stretch's strokes over their number less one, over the stretches that have two or more (weighted by their gaps); and how many gaps.
  spacing: number
  gaps: number
}

// The strokes of `kind` among the edge strokes of a batch (those `keep` lets through, grouped by `group`: the strokes of one stretch): their mean length and width on the
// screen, and the mean spacing along a stretch.
function measure(b: StrokeBatch, kind: Kind[], group: (o: number) => number, keep: (o: number) => boolean = () => true): Measured {
  const groups = new Map<number, [number, number][]>()
  let n = 0
  let sum = 0
  let wsum = 0
  for (let o = 0; o < b.count; o++) {
    if (b.role[o] !== R_EDGE || !kind.includes(kindOf(b, o)) || !keep(o)) continue
    sum += lengthOf(b, o)
    wsum += b.width[P * o + 3]
    n++
    const key = group(o) * 4 + b.edge[o]
    const at: [number, number] = [(b.path[2 * P * o + 6] + b.path[2 * P * o + 8]) / 2, (b.path[2 * P * o + 7] + b.path[2 * P * o + 9]) / 2]
    const g = groups.get(key)
    if (g) g.push(at)
    else groups.set(key, [at])
  }
  let extent = 0
  let gaps = 0
  for (const g of groups.values()) {
    if (g.length < 2) continue
    let far = 0
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) far = Math.max(far, Math.hypot(g[i][0] - g[j][0], g[i][1] - g[j][1]))
    extent += far
    gaps += g.length - 1
  }
  return { n, length: n ? sum / n : 0, width: n ? wsum / n : 0, spacing: gaps ? extent / gaps : 0, gaps }
}

// Pool the measures of several views: the strokes' and gaps' weights.
function pool(v: Measured[]): Measured {
  const n = v.reduce((s, x) => s + x.n, 0)
  const gaps = v.reduce((s, x) => s + x.gaps, 0)
  return {
    n,
    length: v.reduce((s, x) => s + x.length * x.n, 0) / Math.max(1, n),
    width: v.reduce((s, x) => s + x.width * x.n, 0) / Math.max(1, n),
    spacing: v.reduce((s, x) => s + x.spacing * x.gaps, 0) / Math.max(1, gaps),
    gaps,
  }
}

const modelFrame = (f: Fixture, view: PaintView): StrokeBatch => {
  const g = sphereGBuffer(view.width, view.height, { view, params: f.params, radius: 1, mark: 0 })
  return paintFrame(f.scene, f.particles, view, g, f.params).strokes
}

// What a frame draws of the baked edge strokes (the frame's own silhouette strokes are the model's own rule, and left out).
const bakedArcs = (scr: FrameScratch, f: Fixture) => (o: number): boolean => scr.source[o] >= 0 && isEdgeSizing(f.baked.sizing[scr.source[o]])

describe('the baked edge strokes keep the model’s length, width and spacing at every zoom', () => {
  it('draws a pull or a bridge as long as the model’s (within 15%), as wide (within 10%) and as far apart along its edge (within 20%) at ×0.5, ×1, ×3 and ×6, where the model’s measure has its strokes', () => {
    const rows: string[] = []
    let spacingChecked = 0
    for (const zoom of ZOOMS) {
      const views = AZIMUTHS.map((az) => viewAt(zoom, az))
      const models = views.map((v) => modelFrame(SPHERE, v))
      const baked = views.map((v) => {
        const scr = new FrameScratch()
        return { b: frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, v, SPHERE.params, null), scr }
      })
      for (const kind of ['pull', 'bridge'] as Kind[]) {
        const m = pool(models.map((b) => measure(b, [kind], (o) => b.seed[o])))
        const a = pool(baked.map(({ b, scr }) => measure(b, [kind], (o) => SPHERE.baked.rank[scr.source[o]], bakedArcs(scr, SPHERE))))
        rows.push(
          `zoom ${zoom} ${kind}: model ${m.n} strokes, length ${m.length.toFixed(1)} px, width ${m.width.toFixed(2)}, spacing ${m.spacing.toFixed(1)} (${m.gaps} gaps) | ` +
            `baked ${a.n}, length ${a.length.toFixed(1)} (${((a.length / m.length - 1) * 100).toFixed(0)}%), width ${a.width.toFixed(2)} (${((a.width / m.width - 1) * 100).toFixed(0)}%), ` +
            `spacing ${a.spacing.toFixed(1)} (${a.gaps} gaps${m.gaps >= 12 ? `, ${((a.spacing / m.spacing - 1) * 100).toFixed(0)}%` : ''})`,
        )
        expect(m.n, `${zoom} ${kind}: the model's strokes`).toBeGreaterThan(30)
        expect(a.n, `${zoom} ${kind}: the baked strokes`).toBeGreaterThan(30)
        expect(Math.abs(a.length / m.length - 1), `${zoom} ${kind}: length`).toBeLessThan(0.15)
        expect(Math.abs(a.width / m.width - 1), `${zoom} ${kind}: width`).toBeLessThan(0.1)
        // (the model has a stretch with two strokes or more only where its figure's edges are long enough on the screen: at ×0.5 it has a few)
        if (m.gaps >= 12) {
          spacingChecked++
          expect(Math.abs(a.spacing / m.spacing - 1), `${zoom} ${kind}: spacing`).toBeLessThan(0.2)
        }
      }
    }
    if (process.env.EDGE_PRINT) {
      // (the strokes along an edge, for the report, not asserted: the model's own length follows the length of its runs on the screen, up to its cut at 45 samples)
      for (const zoom of ZOOMS) {
        const views = AZIMUTHS.map((az) => viewAt(zoom, az))
        const m = pool(
          views.map((v) => {
            const b = modelFrame(SPHERE, v)
            return measure(b, ['crisp', 'drag'], (o) => b.seed[o])
          }),
        )
        const a = pool(
          views.map((v) => {
            const scr = new FrameScratch()
            const b = frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, v, SPHERE.params, null)
            return measure(b, ['crisp', 'drag'], (o) => SPHERE.baked.rank[scr.source[o]], bakedArcs(scr, SPHERE))
          }),
        )
        rows.push(`zoom ${zoom} crisp+drag (along): model ${m.n} strokes, length ${m.length.toFixed(1)} px | baked ${a.n}, length ${a.length.toFixed(1)} (${((a.length / m.length - 1) * 100).toFixed(0)}%)`)
      }
      console.log(`EDGE ZOOM TABLE\n${rows.join('\n')}`)
    }
    expect(spacingChecked).toBeGreaterThanOrEqual(5)
  })

  it('does not turn a soft or lost edge into a few long hairlines: no pull or bridge is longer on the screen than the model’s longest (1.2 × 26 px) at any zoom up to the refinement, and there are always many', () => {
    for (const zoom of [1, 2, 4, 8]) {
      const scr = new FrameScratch()
      const b = frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, viewAt(zoom), SPHERE.params, null)
      let n = 0
      let longest = 0
      for (let o = 0; o < b.count; o++) {
        if (!bakedArcs(scr, SPHERE)(o) || !['pull', 'bridge'].includes(kindOf(b, o))) continue
        n++
        longest = Math.max(longest, lengthOf(b, o))
      }
      expect(longest, `zoom ${zoom}`).toBeLessThanOrEqual(1.2 * 26 * 1.05)
      expect(n, `zoom ${zoom}`).toBeGreaterThan(30)
    }
  })

  it('draws every edge stroke as long as its px on the screen wherever its path has the length, at every zoom, and lengthens a pull or a bridge by zoom / refinement beyond the refinement (a crisp edge stays one line)', () => {
    for (const zoom of [0.5, 1, 3, 6, 16]) {
      const scr = new FrameScratch()
      const b = frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, viewAt(zoom), SPHERE.params, null)
      let n = 0
      let full = 0
      let lengthened = 0
      let across = 0
      let along = 0
      let alongRatio = 0
      for (let o = 0; o < b.count; o++) {
        if (!bakedArcs(scr, SPHERE)(o)) continue
        n++
        const want = SPHERE.baked.basePx[2 * scr.source[o]] * scr.bigOf[o]
        const have = lengthOf(b, o)
        if (SPHERE.baked.sizing[scr.source[o]] === SIZING_ALONG) {
          // a stroke ALONG its stretch is drawn z / zl × its px long (zl: the power of two of the cells that tile the stretch at the zoom z, up to the refinement): at a zoom under
          // the refinement 1 to 2 times its px where z is 1 or more, and the stretch's own length where it is less; and it is never shorter than its cell's share of the stretch,
          // so it may be longer than its px where the stretch is less tilted at its place than at the middle
          along++
          const big = scr.bigOf[o]
          expect(big, `zoom ${zoom}: an along stroke`).toBeGreaterThan(0)
          expect(big, `zoom ${zoom}: an along stroke`).toBeLessThanOrEqual(Math.max(2, zoom / BAKE_EDGE_REFINE) + 1e-5)
          if (zoom <= 1) expect(big, `zoom ${zoom}: an along stroke`).toBeLessThanOrEqual(1 + 1e-5)
          alongRatio = Math.max(alongRatio, have / want)
          if (have >= 0.9 * want) full++
          continue
        }
        across++
        // (never much longer than its px: the tilt that lengthens an arc is read once, at its middle, and varies a little along it; shorter where the path or the stretch ends)
        expect(have, `zoom ${zoom}`).toBeLessThanOrEqual(want * 1.12 + 1e-3)
        if (have >= 0.9 * want) full++
        // past the refinement the strokes are lengthened by the zoom over it, with the tilt of their stretch from the view (the cells are as far apart on the screen
        // as the surface lets them be), before it they are not
        if (zoom > BAKE_EDGE_REFINE) {
          expect(scr.bigOf[o]).toBeLessThanOrEqual(zoom / BAKE_EDGE_REFINE + 1e-5)
          expect(scr.bigOf[o]).toBeGreaterThan(1)
          lengthened += scr.bigOf[o]
        } else expect(scr.bigOf[o]).toBe(1)
      }
      // (the model's own stroke along a stretch is as long as the stretch: a stroke along it here is never more than the whole of it, 2.2 times the px of the stretch at the most)
      expect(alongRatio, `zoom ${zoom}`).toBeLessThan(2.2)
      if (zoom > BAKE_EDGE_REFINE) expect(lengthened / across, `zoom ${zoom}`).toBeGreaterThan(0.75 * (zoom / BAKE_EDGE_REFINE))
      expect(n, `zoom ${zoom}`).toBeGreaterThan(40)
      expect(across, `zoom ${zoom}`).toBeGreaterThan(10)
      expect(along, `zoom ${zoom}`).toBeGreaterThan(3)
      if (process.env.EDGE_PRINT) console.log(`zoom ${zoom}: ${across} across, ${along} along, along at most ${alongRatio.toFixed(2)} of its px`)
      // (a stroke of an along cell at an end of its stretch is half the length: the stretch has no more of it; a pull at a border ends at it)
      expect(full / n, `zoom ${zoom}`).toBeGreaterThan(zoom === 0.5 ? 0.5 : 0.65)
    }
  })

  it('draws the same stroke the same at every zoom, and more of them as the view zooms in: a stroke kept at ×1 is kept at ×3 and ×6 where it is on the screen, in the same colour, seed and alpha', () => {
    const run = (zoom: number): { b: StrokeBatch; scr: FrameScratch } => {
      const scr = new FrameScratch()
      return { b: frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, viewAt(zoom), SPHERE.params, null), scr }
    }
    const z1 = run(1)
    const at = (r: { b: StrokeBatch; scr: FrameScratch }): Map<number, number> => {
      const m = new Map<number, number>()
      for (let o = 0; o < r.b.count; o++) if (bakedArcs(r.scr, SPHERE)(o)) m.set(r.scr.source[o], o)
      return m
    }
    const a1 = at(z1)
    let most = 0
    for (const zoom of [3, 6]) {
      const r = run(zoom)
      const a = at(r)
      const m = viewAt(zoom).viewProj
      let kept = 0
      let seen = 0
      for (const [i, o1] of a1) {
        // (on the screen at this zoom: the stroke's middle projects well inside it)
        const q = 3 * 16 * i + 3 * 7
        const x = SPHERE.baked.worldPath[q], y = SPHERE.baked.worldPath[q + 1], z = SPHERE.baked.worldPath[q + 2]
        const sx = ((m[0] * x + m[4] * y + m[8] * z + m[12] + 1) / 2) * 800
        const sy = ((1 - (m[1] * x + m[5] * y + m[9] * z + m[13])) / 2) * 500
        if (sx < 60 || sx > 740 || sy < 60 || sy > 440) continue
        seen++
        const o = a.get(i)
        if (o === undefined) continue
        kept++
        expect(r.b.seed[o]).toBe(z1.b.seed[o1])
        for (let c = 0; c < 3; c++) expect(r.b.colour[3 * o + c]).toBe(z1.b.colour[3 * o1 + c])
        expect(r.b.alpha[o]).toBe(z1.b.alpha[o1])
      }
      expect(seen, `zoom ${zoom}`).toBeGreaterThan(8)
      // (a stroke kept at ×1 stays: its place on the lattice does not move, and the thinning only lets more through)
      expect(kept / seen, `zoom ${zoom}`).toBeGreaterThan(0.97)
      most = Math.max(most, a.size)
    }
    expect(most).toBeGreaterThan(a1.size)
  })
})

// ---- the strokes ALONG an edge (a crisp stroke, a drag): never dropped, and tiling their stretch, at every zoom ----

// The strokes of one stretch (its cells) share one baked path, which is what groups them. What a frame draws of them is read against the path: is any stroke drawn, do
// the strokes drawn cover it from end to end (they should meet, for the model has one stroke along a stretch and a gap in it is paint missing from an edge), and was the
// zoom read once for the stretch (every cell of it drawn at the same `z / zl`).
type FrameFn = typeof frameFromBakeWith
const BP = BAKE_PATH_POINTS
const SAMPLES = 120
const ALONG_ZOOMS = [0.5, 0.75, 1, 1.5, 3, 6]
const SCREEN_W = 800
const SCREEN_H = 500

interface AlongStats {
  // The stretches the density slider keeps whose middle faces the eye and is well on the screen (40 px in), summed over the views, and those not one stroke is drawn of.
  stretches: number
  dropped: number
  // The stretches whose drawn cells were not all drawn at the same `big` (the zoom is read once for the stretch: none).
  split: number
  // The part of the stretches' paths that faces the eye and is on the screen: its length in px, and how much of it lies inside the sub-arc of a stroke drawn (the arc
  // of the baked path a stroke is cut from), the least share over the stretches, and the stretches with a gap of 6 px or more in it with some of it drawn.
  visible: number
  arcCovered: number
  arcLeast: number
  arcHoled: number
  // The same read on the screen, as the baked path is drawn: the length of that part within a px of a stroke's polyline (which has PATH_POINTS points, and cuts a corner of a
  // path that bends sharply), the stretches with a gap of 6 px or more in it with some of it drawn, and the worst gap.
  covered: number
  holed: number
  worstGap: number
  // The strokes drawn along the stretches and their mean length on the screen.
  strokes: number
  meanLength: number
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}

function alongStats(frame: FrameFn, zoom: number, perspective = false, azimuths = AZIMUTHS): AlongStats {
  const B = SPHERE.baked
  const st: AlongStats = { stretches: 0, dropped: 0, split: 0, visible: 0, arcCovered: 0, arcLeast: 1, arcHoled: 0, covered: 0, holed: 0, worstGap: 0, strokes: 0, meanLength: 0 }
  const key = (i: number): string => {
    const q = 3 * BP * i
    return `${B.worldPath[q]},${B.worldPath[q + 1]},${B.worldPath[q + 2]},${B.worldPath[q + 3 * BP - 1]}`
  }
  // the baked path of stroke i at u (0..BP - 1): its world point and the normal there
  const at = (i: number, u: number): { p: number[]; n: number[] } => {
    const t = Math.min(BP - 2, Math.floor(u))
    const f = u - t
    const a = 3 * BP * i + 3 * t
    return {
      p: [0, 1, 2].map((c) => B.worldPath[a + c] + (B.worldPath[a + 3 + c] - B.worldPath[a + c]) * f),
      n: [0, 1, 2].map((c) => B.worldNormal[a + c] + (B.worldNormal[a + 3 + c] - B.worldNormal[a + c]) * f),
    }
  }
  let lengthSum = 0
  for (const az of azimuths) {
    const v = viewAt(zoom, az, 25, perspective)
    const m = v.viewProj
    const ortho = m[3] === 0 && m[7] === 0 && m[11] === 0
    const screen = (p: number[]): [number, number] => {
      const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15]
      return [((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w + 1) * 0.5 * SCREEN_W, (1 - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w) * 0.5 * SCREEN_H]
    }
    // (the part of a path past the horizon is not drawn, and not seen)
    const faces = (p: number[], n: number[]): boolean => {
      let d = 0
      if (ortho) for (let c = 0; c < 3; c++) d -= n[c] * v.viewDir[c]
      else {
        const e = [v.eye[0] - p[0], v.eye[1] - p[1], v.eye[2] - p[2]]
        const l = Math.hypot(e[0], e[1], e[2])
        for (let c = 0; c < 3; c++) d += (n[c] * e[c]) / l
      }
      return d > 0.05
    }
    const scr = new FrameScratch()
    const b = frame(scr, B, SPHERE.scene, v, SPHERE.params, null)
    const drawn = new Map<string, number[]>()
    for (let o = 0; o < b.count; o++) {
      const i = scr.source[o]
      if (i < 0 || B.sizing[i] !== SIZING_ALONG) continue
      const k = key(i)
      const list = drawn.get(k)
      if (list) list.push(o)
      else drawn.set(k, [o])
      st.strokes++
      lengthSum += lengthOf(b, o)
    }
    const seen = new Set<string>()
    for (let i = 0; i < B.count; i++) {
      if (B.sizing[i] !== SIZING_ALONG || B.rank[i] >= SPHERE.params.roles.edge.density) continue
      const k = key(i)
      if (seen.has(k)) continue
      seen.add(k)
      const mid = at(i, (BP - 1) / 2)
      const [mx, my] = screen(mid.p)
      if (!faces(mid.p, mid.n) || mx < 40 || mx > SCREEN_W - 40 || my < 40 || my > SCREEN_H - 40) continue
      st.stretches++
      const mine = drawn.get(k) ?? []
      if (mine.length === 0) st.dropped++
      if (new Set(mine.map((o) => scr.bigOf[o])).size > 1) st.split++
      // the sub-arc of each stroke drawn: where its end points lie on the baked path (the nearest of 2 × SAMPLES points of it, in the world; a stroke's points lie on it)
      const arcs = mine.map((o): [number, number] => {
        const ends = [0, 3 * (P - 1)].map((end) => {
          let best = Infinity
          let bu = 0
          for (let s = 0; s <= 2 * SAMPLES; s++) {
            const u = (s / (2 * SAMPLES)) * (BP - 1)
            const p = at(i, u).p
            const d = Math.hypot(b.worldPath[3 * P * o + end] - p[0], b.worldPath[3 * P * o + end + 1] - p[1], b.worldPath[3 * P * o + end + 2] - p[2])
            if (d < best) {
              best = d
              bu = u
            }
          }
          return bu
        })
        return [Math.min(...ends), Math.max(...ends)]
      })
      const slack = (0.6 * (BP - 1)) / SAMPLES
      let vis = 0
      let arc = 0
      let arcRun = 0
      let arcGap = 0
      let cov = 0
      let run = 0
      let gap = 0
      let prev: [number, number] | null = null
      for (let s = 0; s <= SAMPLES; s++) {
        const u = (s / SAMPLES) * (BP - 1)
        const here = at(i, u)
        const [sx, sy] = screen(here.p)
        const step = prev ? Math.hypot(sx - prev[0], sy - prev[1]) : 0
        prev = [sx, sy]
        if (sx < 0 || sx > SCREEN_W || sy < 0 || sy > SCREEN_H || !faces(here.p, here.n)) continue
        vis += step
        if (arcs.some(([lo, hi]) => u >= lo - slack && u <= hi + slack)) {
          arc += step
          arcRun = 0
        } else {
          arcRun += step
          arcGap = Math.max(arcGap, arcRun)
        }
        let near = Infinity
        for (const o of mine) for (let j = 1; j < P; j++) near = Math.min(near, segDist(sx, sy, b.path[2 * P * o + 2 * j - 2], b.path[2 * P * o + 2 * j - 1], b.path[2 * P * o + 2 * j], b.path[2 * P * o + 2 * j + 1]))
        if (near <= 1) {
          cov += step
          run = 0
        } else {
          run += step
          gap = Math.max(gap, run)
        }
      }
      st.visible += vis
      st.arcCovered += arc
      st.covered += cov
      if (vis > 20) st.arcLeast = Math.min(st.arcLeast, arc / vis)
      if (mine.length > 0 && arc > 0 && arcGap >= 6) st.arcHoled++
      if (mine.length > 0 && cov > 0 && gap >= 6) {
        st.holed++
        st.worstGap = Math.max(st.worstGap, gap)
      }
    }
  }
  st.meanLength = st.strokes ? lengthSum / st.strokes : 0
  return st
}

const alongRow = (zoom: number, a: AlongStats): string =>
  `x${zoom}: ${a.stretches} stretches, ${a.dropped} dropped, on the screen ${((100 * a.covered) / Math.max(1, a.visible)).toFixed(1)}% covered, ${a.holed} holes (worst ${a.worstGap.toFixed(1)} px); ` +
  `on the path ${((100 * a.arcCovered) / Math.max(1, a.visible)).toFixed(1)}% (least ${(100 * a.arcLeast).toFixed(0)}%), ${a.arcHoled} holes; ${a.split} split; ${a.strokes} strokes, mean ${a.meanLength.toFixed(1)} px`

describe('the strokes along an edge (a crisp stroke, a drag) are never dropped, and tile their stretch, at every zoom', () => {
  it('draws a stretch’s own stroke at ×0.5, ×0.75, ×1, ×1.5, ×3 and ×6 (none dropped, the cells of a stretch alike), from one end of it to the other (no gap on its path, 90% of it covered on the screen, few holes where its polyline cuts a bend), orthographic and perspective', () => {
    const rows: string[] = []
    for (const perspective of [false, true]) {
      // (a perspective view is as near the figure as the zoom puts the eye: at ×6 it has nothing of the sphere in it)
      for (const zoom of perspective ? ALONG_ZOOMS.filter((z) => z <= 3) : ALONG_ZOOMS) {
        const a = alongStats(frameFromBakeWith, zoom, perspective)
        const name = `${perspective ? 'perspective' : 'orthographic'} ×${zoom}`
        rows.push(`${name}: ${alongRow(zoom, a)}`)
        expect(a.stretches, name).toBeGreaterThanOrEqual(zoom >= 3 ? 10 : 20)
        // (the old selection dropped a stretch's own stroke where the zoom times the tilt was under 1: 12 of 106 at ×1, 32 at ×0.75, 52 at ×0.5)
        expect(a.dropped, name).toBe(0)
        expect(a.split, name).toBe(0)
        // (the strokes tile the stretch: every part of its path that is seen is inside a stroke's sub-arc, whatever the zoom does between the powers of two)
        expect(a.arcLeast, name).toBeGreaterThanOrEqual(0.9)
        expect(a.arcHoled, name).toBe(0)
        // (a polyline of 8 points cuts the bend of a stretch that turns sharply by a px or two, which is not within a px of the path: a part of the path not covered, by this
        // reading, which a perspective view's bends have more of)
        expect(a.covered / a.visible, name).toBeGreaterThanOrEqual(perspective ? 0.85 : 0.9)
        expect(a.holed / a.stretches, name).toBeLessThanOrEqual(10 / 47)
      }
    }
    if (process.env.EDGE_PRINT) console.log(`ALONG TABLE\n${rows.join('\n')}`)
  })
})

describe('the baked edge strokes do not boil, and are deterministic', () => {
  it('keep at least 95% of the edge strokes drawn through a 1 degree orbit (by seed, which is the stroke), in orthographic and perspective views, at ×1 and ×3, and through a degree of elevation', () => {
    let all = 0
    let allKept = 0
    for (const perspective of [false, true]) {
      for (const zoom of [1, 3]) {
        for (const [az0, el0, az1, el1] of [[20, 25, 21, 25], [140, 25, 141, 25], [20, 25, 20, 26]] as const) {
          const draw = (az: number, el: number): Set<number> => {
            const scr = new FrameScratch()
            const b = frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, viewAt(zoom, az, el, perspective), SPHERE.params, null)
            const seeds = new Set<number>()
            for (let o = 0; o < b.count; o++) if (bakedArcs(scr, SPHERE)(o)) seeds.add(b.seed[o])
            return seeds
          }
          const a = draw(az0, el0)
          const b = draw(az1, el1)
          let kept = 0
          for (const s of a) if (b.has(s)) kept++
          const name = `${perspective ? 'perspective' : 'ortho'} ×${zoom} az ${az0}→${az1} el ${el0}→${el1}`
          if (process.env.EDGE_PRINT) console.log(`no boiling, ${name}: ${kept} of ${a.size} edge strokes kept (${(kept / a.size).toFixed(3)})`)
          expect(a.size, name).toBeGreaterThan(5)
          expect(kept / a.size, name).toBeGreaterThanOrEqual(0.95)
          all += a.size
          allKept += kept
        }
      }
    }
    // (over all of them: a thousand strokes, and in fact the thinning's thresholds and the side tests are all that moves)
    expect(all).toBeGreaterThan(900)
    expect(allKept / all).toBeGreaterThan(0.97)
  })

  it('keeps 94% or more of the edge strokes drawn in the worst of 160 views turned a degree (azimuth or elevation, orthographic and perspective, ×0.75 to ×6), 99% over all of them: the cells of a stretch come and go together where its zoom crosses a power of two, and no more often than that', () => {
    let all = 0
    let kept = 0
    let worst = 1
    let views = 0
    for (const perspective of [false, true]) {
      for (const zoom of [0.75, 1, 2, 3, 6]) {
        for (const az of [10, 55, 100, 145, 190, 235, 280, 325]) {
          for (const [daz, del] of [[1, 0], [0, 1]]) {
            const draw = (a: number, e: number): Set<number> => {
              const scr = new FrameScratch()
              const b = frameFromBakeWith(scr, SPHERE.baked, SPHERE.scene, viewAt(zoom, a, e, perspective), SPHERE.params, null)
              const drawn = new Set<number>()
              for (let o = 0; o < b.count; o++) if (bakedArcs(scr, SPHERE)(o)) drawn.add(scr.source[o])
              return drawn
            }
            const a = draw(az, 25)
            const b = draw(az + daz, 25 + del)
            let k = 0
            for (const i of a) if (b.has(i)) k++
            all += a.size
            kept += k
            // (a view with a handful of edge strokes in it, as a perspective ×6 has, says nothing: one stroke is a tenth of it)
            if (a.size > 10) {
              views++
              worst = Math.min(worst, k / a.size)
            }
          }
        }
      }
    }
    if (process.env.EDGE_PRINT) console.log(`no boiling, ${views} views of 160: ${kept} of ${all} edge strokes kept (${(kept / all).toFixed(3)}), worst view ${worst.toFixed(3)}`)
    expect(views).toBeGreaterThan(100)
    // (the worst view has 130 edge strokes and loses 7 of them, 4 along a stretch and 3 across one: the cells of a stretch come and go together where its zoom crosses a
    // power of two. On these views the selection before this fix had 93.1% in its worst, and reading the zoom per cell 95.3%)
    expect(worst).toBeGreaterThanOrEqual(0.94)
    expect(kept / all).toBeGreaterThan(0.985)
  })

  it('bakes the same arrays, byte for byte, twice (the spacing ranks among them), and draws the same frame from them', () => {
    const again = bakePainting(SPHERE.scene, SPHERE.particles, SPHERE.colours, SPHERE.light, SPHERE.params, SPHERE.authored)
    for (const k of Object.keys(SPHERE.baked) as (keyof typeof SPHERE.baked)[]) {
      const v = SPHERE.baked[k]
      if (ArrayBuffer.isView(v)) expect(bytes(again[k] as unknown as ArrayBufferView), String(k)).toBe(bytes(v))
    }
    expect(again.key).toBe(SPHERE.baked.key)
    let spaced = 0
    for (let i = 0; i < again.count; i++) if (again.spacing[i] > 0) spaced++
    expect(spaced).toBeGreaterThan(500)
    const a = frameFromBakeWith(new FrameScratch(), SPHERE.baked, SPHERE.scene, viewAt(3), SPHERE.params, null)
    const b = frameFromBakeWith(new FrameScratch(), again, SPHERE.scene, viewAt(3), SPHERE.params, null)
    expect(b.count).toBe(a.count)
    for (const k of Object.keys(a) as (keyof StrokeBatch)[]) if (k !== 'count') expect(bytes(b[k] as ArrayBufferView), String(k)).toBe(bytes(a[k] as ArrayBufferView))
  })
})
