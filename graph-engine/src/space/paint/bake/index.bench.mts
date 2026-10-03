// A bench, not a test (never a wall-clock assert): the whole bake on the lab's showcase scenes: the time of each phase (taken here, from the
// progress calls: the bake itself reads no clock), the strokes by role and side, and the bytes of the BakedPainting.
//
//   cd graph-engine && node --expose-gc --import tsx src/space/paint/bake/index.bench.mts [runs] [scene id]
//   (with --expose-gc it also reports what a painting KEEPS: its arrays and the colour recipes beside it, with the world plan, planes and edges dropped)
//
// The scenes are built as edges.bench.mts builds them. Each is baked `runs` times (default 3) after one warm-up; the medians are reported.

import { cameraMatrices } from '../../camera/projection'
import { prepareFigure, keyLightDirection } from '../../../../../review/src/paintLabCamera'
import { makeSceneColours } from '../../../../../review/src/paintLabColours'
import { figureById } from '../../../../../review/src/paintLabFigures'
import { buildParticles } from '../model/particles'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { ROLES } from '../types'
import { bakePaintingWithProgress, bakeStats, type BakeProgress } from './index'
import type { AuthoredFraming, BakedPainting } from './types'

const IDS = ['sphere', 'torus', 'saddle', 'tangent-plane', 'helix-sheet', 'level-curves'] as const
const PHASES: BakeProgress['phase'][] = ['plan', 'planes', 'edges', 'strokes', 'underpaint', 'pack']
const RUNS = Math.max(1, Number(process.argv[2]) || 3)
const ONLY = process.argv[3]
const VIEWPORT = { width: 1028, height: 690 } // the Tune stage

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const gc = (globalThis as { gc?: () => void }).gc
const heap = (): number => {
  gc?.()
  gc?.()
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

const bytesOf = (b: BakedPainting): number => {
  let n = 0
  for (const v of Object.values(b)) if (ArrayBuffer.isView(v)) n += v.byteLength
  for (const s of b.surfaces) if (s) for (const v of Object.values(s)) if (ArrayBuffer.isView(v)) n += v.byteLength
  return n
}

const rows: string[][] = []
const roleRows: string[][] = []
for (const id of IDS) {
  if (ONLY && id !== ONLY) continue
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

  const make = () => {
    const at: Record<string, number> = {}
    const ms: Record<string, number> = {}
    const t0 = performance.now()
    const baked = bakePaintingWithProgress(worldScene, particles, colours, L, params, authored, (p) => {
      const now = performance.now()
      if (p.done === 0) at[p.phase] = now
      else if (p.done === 1) ms[p.phase] = now - at[p.phase]
    }, { keepStats: true })
    return { baked, ms, total: performance.now() - t0 }
  }
  // what a painting keeps: the bake made without its plan, planes and edges, held alone, measured before anything else of this scene is made
  let keptMB = Number.NaN
  if (gc) {
    const before = heap()
    const held = bakePaintingWithProgress(worldScene, particles, colours, L, params, authored)
    keptMB = (heap() - before) / 1e6
    void held.count
  }
  make() // warm-up
  const runs = Array.from({ length: RUNS }, make)
  const last = runs[runs.length - 1]
  const per = PHASES.map((p) => median(runs.map((r) => r.ms[p] ?? 0)))
  const total = median(runs.map((r) => r.total))
  const stats = bakeStats(last.baked)!
  const strokesBySide = [0, 0, 0]
  for (let i = 0; i < last.baked.count; i++) strokesBySide[last.baked.side[i] + 1]++
  const verts = last.baked.surfaces.reduce((s, x) => s + (x ? x.positions.length / 3 : 0), 0)
  rows.push([
    id, String(particles.count), String(last.baked.count), strokesBySide.join('/'), String(stats.strokes.dropped), String(verts),
    ...per.map((v) => v.toFixed(0)), total.toFixed(0), (bytesOf(last.baked) / 1e6).toFixed(1), Number.isNaN(keptMB) ? '-' : keptMB.toFixed(1),
  ])
  for (const [r, role] of ROLES.entries()) {
    const c = stats.strokes.byRoleSide[r]
    if (c[0] + c[1] + c[2] > 0) roleRows.push([id, role, String(c[1]), String(c[2]), String(c[0])])
  }
}

const print = (head: string[], body: string[][]) => {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  console.log(line(head))
  for (const r of body) console.log(line(r))
}
print(['scene', 'particles', 'strokes', 'side -1/0/+1', 'dropped', 'vertices', ...PHASES.map((p) => `${p} ms`), 'total ms', 'arrays MB', 'kept MB'], rows)
console.log('')
print(['scene', 'role', 'side 0', 'side +1', 'side -1'], roleRows)
console.log(`(${RUNS} runs each after a warm-up, medians; arrays MB is the typed arrays of the BakedPainting and its surfaces; kept MB the heap a painting holds with its recipes)`)
