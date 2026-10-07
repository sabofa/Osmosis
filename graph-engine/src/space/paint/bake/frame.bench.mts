// A bench, not a test (never a wall-clock assert): the per-frame half of the baked painting, `frameFromBake`, over 60 orbit views around the
// authored one, on the lab's showcase scenes and on a synthetic scene of about 50k baked strokes. Per scene: the median and p95 time of a
// frame (the target is 5 ms at 50k baked strokes), where the time goes (the silhouettes alone, the points and arrowheads), the strokes
// drawn, and what a frame allocates.
//
//   cd graph-engine && npx tsx --expose-gc --max-semi-space-size=256 src/space/paint/bake/frame.bench.mts [rounds] [scene id | synthetic | all]
//
// (--expose-gc lets the bench read the heap between runs; the large semi-space keeps the young-generation collector from running inside the
// measured stretch, so the heap delta is what the frames allocated.) The views are the authored azimuth turned in steps of 6 degrees all the
// way round, at the authored elevation, zoom 1; each is made `rounds` times (default 5) after eight warm-up laps. The scenes are baked as
// index.bench.mts bakes them.

import { cameraMatrices } from '../../camera/projection'
import { buildPaintView, keyLightDirection, prepareFigure } from '../../../../../review/src/paintLabCamera'
import { makeSceneColours } from '../../../../../review/src/paintLabColours'
import { figureById } from '../../../../../review/src/paintLabFigures'
import type { SpaceScene } from '../../scene/types'
import { makeFrameCtx } from '../model/view'
import { buildParticles } from '../model/particles'
import { flatColours, paintView, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import { lchToLab } from '../model/colour'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import type { PaintView, SceneColours } from '../types'
import { bakePainting } from './index'
import { frameFromBakeWith, FrameScratch } from './frame'
import { addSilhouettes } from './silhouettes'
import { StrokeList } from './strokeList'
import type { AuthoredFraming, BakedPainting } from './types'

const SHOWCASE = ['sphere', 'torus', 'saddle', 'tangent-plane', 'helix-sheet', 'level-curves'] as const
const ROUNDS = Math.max(1, Number(process.argv[2]) || 5)
const ONLY = process.argv[3] ?? 'all'
const VIEWPORT = { width: 1028, height: 690 } // the Tune stage
const VIEWS = 60

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const percentile = (a: number[], p: number): number => [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))]
const gc = (globalThis as { gc?: () => void }).gc
const mem = (): { heap: number; buffers: number } => {
  const m = process.memoryUsage()
  return { heap: m.heapUsed, buffers: m.arrayBuffers }
}

interface Setup {
  id: string
  scene: SpaceScene
  baked: BakedPainting
  params: PaintParams
  // The view of step k of 60 (azimuth turned k × 6 degrees), at zoom `zoom`.
  viewAt(k: number, zoom: number): PaintView
  bakeMs: number
}

function showcase(id: string): Setup {
  const figure = figureById(id)
  if (!figure) throw new Error(`no figure ${id}`)
  const { built, worldScene } = prepareFigure(figure)
  const camera = cameraMatrices(built.authored, built.world, VIEWPORT, built.projection)
  const colours = makeSceneColours(worldScene, 'light', null)
  const authored: AuthoredFraming = { eye: [...camera.eye], viewDir: [...camera.basis.forward], ortho: built.projection === 'orthographic', worldPerPx: camera.worldPerPixel }
  const params = DEFAULT_PAINT_PARAMS
  const light = keyLightDirection(camera.basis, params.light)
  const len = Math.hypot(light[0], light[1], light[2])
  const L: [number, number, number] = [light[0] / len, light[1] / len, light[2] / len]
  const particles = buildParticles(worldScene, colours, params)
  const t0 = performance.now()
  const baked = bakePainting(worldScene, particles, colours, L, params, authored)
  const bakeMs = performance.now() - t0
  const viewAt = (k: number, zoom: number): PaintView => {
    const view = { ...built.authored, azimuth: built.authored.azimuth + 6 * k, zoom: built.authored.zoom * zoom }
    return buildPaintView(cameraMatrices(view, built.world, VIEWPORT, built.projection), params.light, 1, false, zoom)
  }
  return { id, scene: worldScene, baked, params, viewAt, bakeMs }
}

// Three spheres and a table, a particle count that gives about 50k baked strokes.
function synthetic(): Setup {
  const scene = sceneOf([
    sphereMesh({ radius: 1, index: 0, nu: 40, nv: 28 }),
    sphereMesh({ radius: 0.6, centre: [1.8, 0.4, -0.4], index: 1, nu: 32, nv: 22 }),
    sphereMesh({ radius: 0.45, centre: [-1.5, -1.0, -0.55], index: 2, nu: 28, nv: 20 }),
    tableMesh({ z: -1, half: 3, index: 3 }),
  ])
  const colours: SceneColours = flatColours({ 0: lchToLab(0.56, 0.14, 38), 1: lchToLab(0.6, 0.12, 250), 2: lchToLab(0.7, 0.1, 140), 3: lchToLab(0.9, 0.01, 85) })
  const params: PaintParams = { ...DEFAULT_PAINT_PARAMS, particles: { ...DEFAULT_PAINT_PARAMS.particles, maxPerUnit2: Number(process.env.SYN_DENSITY) || 700 } }
  const e = [Math.cos(0.436) * Math.cos(0.35), Math.cos(0.436) * Math.sin(0.35), Math.sin(0.436)]
  const authored: AuthoredFraming = { eye: [e[0] * 8, e[1] * 8, e[2] * 8], viewDir: [-e[0], -e[1], -e[2]], ortho: true, worldPerPx: 1 / 150 }
  const particles = buildParticles(scene, colours, params)
  const L: [number, number, number] = [0.5, -0.4, 0.77]
  const len = Math.hypot(L[0], L[1], L[2])
  const t0 = performance.now()
  const baked = bakePainting(scene, particles, colours, [L[0] / len, L[1] / len, L[2] / len], params, authored)
  const bakeMs = performance.now() - t0
  const viewAt = (k: number, zoom: number): PaintView => {
    const v = paintView({ width: VIEWPORT.width, height: VIEWPORT.height, azimuth: 20 + 6 * k, elevation: 25, zoom: 150 * zoom, magnify: zoom })
    return { ...v, lightDir: [L[0] / len, L[1] / len, L[2] / len] }
  }
  return { id: 'synthetic', scene, baked, params, viewAt, bakeMs }
}

const rows: string[][] = []
const printTable = (head: string[], body: string[][]): void => {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
  const line = (cells: string[]): string => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  console.log(line(head))
  for (const r of body) console.log(line(r))
}

function run(s: Setup): void {
  const { scene, baked, params } = s
  const views1 = Array.from({ length: VIEWS }, (_, k) => s.viewAt(k, 1))
  const scr = new FrameScratch()
  // two laps to warm the code
  for (let lap = 0; lap < 8; lap++) for (const v of views1) frameFromBakeWith(scr, baked, scene, v, params, null)
  const times: number[] = []
  // each view's fastest round: what the frame costs when nothing else is running (the machine's other work is in the rounds' median and p95)
  const best = new Float64Array(VIEWS).fill(Infinity)
  const written: number[] = []
  const own: number[] = []
  const sil: number[] = []
  const phase = { own: [] as number[], select: [] as number[], sort: [] as number[], pack: [] as number[] }
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of views1) {
      const t0 = performance.now()
      frameFromBakeWith(scr, baked, scene, v, params, null)
      const ms = performance.now() - t0
      times.push(ms)
      if (ms < best[views1.indexOf(v)]) best[views1.indexOf(v)] = ms
      phase.own.push(scr.stats.msOwn)
      phase.select.push(scr.stats.msSelect)
      phase.sort.push(scr.stats.msSort)
      phase.pack.push(scr.stats.msPack)
      if (r === 0) {
        written.push(scr.stats.written)
        own.push(scr.stats.own)
        sil.push(scr.stats.silhouettes)
      }
    }
  }
  // the silhouettes alone (made, not packed), and the frame's context
  const list = new StrokeList()
  const silTimes: number[] = []
  for (let r = 0; r < Math.max(2, ROUNDS); r++) {
    for (const v of views1) {
      list.clear()
      const fc = makeFrameCtx(scene, v, { width: 0, height: 0, scale: 2, depth: new Float32Array(0), normal: new Float32Array(0), value: new Float32Array(0), shadow: new Uint8Array(0), mark: new Int32Array(0) }, params)
      const t0 = performance.now()
      addSilhouettes(list, baked, scene, v, params, null, fc)
      silTimes.push(performance.now() - t0)
    }
  }
  // what a frame allocates: the output arrays' bytes (exact), the typed-array and heap deltas over a lap, and the scratch arrays made
  gc?.()
  gc?.()
  const made0 = scr.arrays
  const m0 = mem()
  let out = 0
  for (const v of views1) {
    const b = frameFromBakeWith(scr, baked, scene, v, params, null)
    for (const a of Object.values(b)) if (ArrayBuffer.isView(a)) out += a.byteLength
  }
  const m1 = mem()
  const madeNow = scr.arrays - made0
  // a fresh scratch for every frame: what the scratch saves
  gc?.()
  gc?.()
  const f0 = mem()
  for (const v of views1) frameFromBakeWith(new FrameScratch(), baked, scene, v, params, null)
  const f1 = mem()
  // the first frame of a bake, with the code warm: the per-stroke preparation (anchors, kinds) and each surface's vertex index, which are made once per bake
  const firstTimes: number[] = []
  for (let r = 0; r < 3; r++) {
    const fresh: BakedPainting = { ...baked, worldPath: baked.worldPath.slice(), surfaces: baked.surfaces.map((x) => (x ? { ...x, positions: x.positions.slice() } : x)) }
    const t0 = performance.now()
    frameFromBakeWith(new FrameScratch(), fresh, scene, views1[0], params, null)
    firstTimes.push(performance.now() - t0)
  }
  // the output arrays kept in the scratch too (reuseOutput: a caller that does not keep the batch): time and allocation
  const keep = new FrameScratch()
  keep.reuseOutput = true
  for (let lap = 0; lap < 4; lap++) for (const v of views1) frameFromBakeWith(keep, baked, scene, v, params, null)
  const reuseTimes: number[] = []
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of views1) {
      const t0 = performance.now()
      frameFromBakeWith(keep, baked, scene, v, params, null)
      reuseTimes.push(performance.now() - t0)
    }
  }
  gc?.()
  gc?.()
  const k0 = mem()
  const keptMade0 = keep.arrays
  for (const v of views1) frameFromBakeWith(keep, baked, scene, v, params, null)
  const k1 = mem()
  const nWrit = median(written)
  rows.push([
    s.id, String(baked.count), s.bakeMs.toFixed(0), String(Math.round(nWrit)), String(Math.round(median(own))), String(Math.round(median(sil))),
    median(times).toFixed(2), percentile(times, 0.95).toFixed(2), median(Array.from(best)).toFixed(2), median(silTimes).toFixed(2),
    (out / VIEWS / 1e6).toFixed(2), ((m1.buffers - m0.buffers) / VIEWS / 1e6).toFixed(2), ((m1.heap - m0.heap) / VIEWS / 1e3).toFixed(0), String(madeNow),
    ((f1.buffers - f0.buffers) / VIEWS / 1e6).toFixed(2), ((f1.heap - f0.heap) / VIEWS / 1e3).toFixed(0),
  ])
  firstRows.push([s.id, median(firstTimes).toFixed(1)])
  reuseRows.push([s.id, median(reuseTimes).toFixed(2), percentile(reuseTimes, 0.95).toFixed(2), ((k1.buffers - k0.buffers) / VIEWS / 1e6).toFixed(3), ((k1.heap - k0.heap) / VIEWS / 1e3).toFixed(0), String(keep.arrays - keptMade0)])
  phases.push([s.id, median(phase.own).toFixed(2), median(phase.select).toFixed(2), median(phase.sort).toFixed(2), median(phase.pack).toFixed(2)])
  // other zooms (the same 60 views): time and strokes drawn
  const zoomRows: string[][] = []
  for (const zoom of [0.5, 2, 4]) {
    const vz = Array.from({ length: VIEWS }, (_, k) => s.viewAt(k, zoom))
    for (const v of vz) frameFromBakeWith(scr, baked, scene, v, params, null)
    const tz: number[] = []
    const wz: number[] = []
    for (let r = 0; r < Math.max(2, Math.floor(ROUNDS / 2)); r++) {
      for (const v of vz) {
        const t0 = performance.now()
        frameFromBakeWith(scr, baked, scene, v, params, null)
        tz.push(performance.now() - t0)
        wz.push(scr.stats.written)
      }
    }
    zoomRows.push([s.id, String(zoom), String(Math.round(median(wz))), median(tz).toFixed(2), percentile(tz, 0.95).toFixed(2)])
  }
  zooms.push(...zoomRows)
}
const zooms: string[][] = []
const phases: string[][] = []
const reuseRows: string[][] = []
const firstRows: string[][] = []

const ids: string[] = ONLY === 'all' ? [...SHOWCASE, 'synthetic'] : [ONLY]
for (const id of ids) {
  console.error(`${id}: baking...`)
  run(id === 'synthetic' ? synthetic() : showcase(id))
}
printTable(
  ['scene', 'baked', 'bake ms', 'drawn', 'own', 'silh', 'median ms', 'p95 ms', 'quiet ms', 'silh ms', 'out MB/f', 'buf MB/f', 'heap kB/f', 'scratch made', 'fresh-scratch buf MB/f', 'heap kB/f'],
  rows,
)
console.log('')
printTable(['scene', 'first frame of a bake ms (code warm)'], firstRows)
console.log('')
printTable(['scene', 'reuse median ms', 'p95 ms', 'buf MB/f', 'heap kB/f', 'arrays made'], reuseRows)
console.log('')
printTable(['scene', 'own strokes ms', 'select ms', 'order ms', 'pack ms'], phases)
console.log('')
printTable(['scene', 'zoom', 'drawn', 'median ms', 'p95 ms'], zooms)
console.log(`(${ROUNDS} rounds of ${VIEWS} views, after eight warm-up laps; times are one call of frameFromBake with the scratch kept ("quiet" = the median over the views of each view's fastest round); "own" = the frame's own strokes (silhouettes, points, arrowheads), "silh" = the silhouette strokes among them; "out MB/f" = the bytes of the output arrays; "buf"/"heap" = the growth of the typed-array and JS heap per frame over one lap with the scratch kept; "scratch made" = scratch arrays made in that lap; the last two columns with a fresh scratch for every frame)`)
