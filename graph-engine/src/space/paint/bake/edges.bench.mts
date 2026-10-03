// A bench, not a test (never a wall-clock assert): the time of buildWorldPlanes and buildWorldEdges on top of buildWorldPlan on the lab's
// showcase scenes, and what they made: plane counts, edge runs by type, and the classes of the terminator at the default terminator
// softness and at 1.0.
//
//   cd graph-engine && npx tsx src/space/paint/bake/edges.bench.mts [runs]
//
// The scenes are built as plan.bench.mts builds them (the figure through the kernel, the scene in world coordinates, the lab's key light,
// the authored camera's world size of a px at the Tune stage's size). Each is made `runs` times (default 3) after one warm-up, and the median
// of each stage reported.

import { cameraMatrices } from '../../camera/projection'
import { prepareFigure, keyLightDirection } from '../../../../../review/src/paintLabCamera'
import { makeSceneColours } from '../../../../../review/src/paintLabColours'
import { figureById } from '../../../../../review/src/paintLabFigures'
import { makeCurve } from '../model/curve'
import { buildParticles } from '../model/particles'
import { DEFAULT_PAINT_PARAMS, type PaintParams } from '../params'
import { buildWorldEdges, type WorldEdgeType, type WorldEdges } from './edges'
import { buildWorldPlan } from './plan'
import type { AuthoredFraming } from './types'
import { buildWorldPlanes } from './planes'

const IDS = ['sphere', 'torus', 'saddle', 'tangent-plane', 'helix-sheet', 'level-curves'] as const
const RUNS = Math.max(1, Number(process.argv[2]) || 3)
const VIEWPORT = { width: 1028, height: 690 } // the Tune stage
const TYPES: WorldEdgeType[] = ['terminator', 'shadow', 'plane', 'crease', 'border']

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

// The classes (lost, soft, firm, hard) of the samples of the terminator's runs.
const terminatorClasses = (edges: WorldEdges): number[] => {
  const h = [0, 0, 0, 0]
  for (const r of edges.runs) if (r.type === 'terminator') for (const c of r.cls) h[c]++
  return h
}

const rows: string[][] = []
const histRows: string[][] = []
for (const id of IDS) {
  const figure = figureById(id)
  if (!figure) throw new Error(`no figure ${id}`)
  const { built, worldScene } = prepareFigure(figure)
  const camera = cameraMatrices(built.authored, built.world, VIEWPORT, built.projection)
  const perPx = camera.worldPerPixel
  const colours = makeSceneColours(worldScene, 'light', null)

  // the framing the bake composes for: the authored view at zoom 1 (what the lab will pass: Task 6)
  const authored: AuthoredFraming = { eye: [...camera.eye], viewDir: [...camera.basis.forward], ortho: built.projection === 'orthographic', worldPerPx: perPx }
  const make = (params: PaintParams) => {
    const light = keyLightDirection(camera.basis, params.light)
    const len = Math.hypot(light[0], light[1], light[2])
    const L: [number, number, number] = [light[0] / len, light[1] / len, light[2] / len]
    const particles = buildParticles(worldScene, colours, params)
    const t0 = performance.now()
    const plan = buildWorldPlan(worldScene, L, params, perPx)
    const t1 = performance.now()
    const planes = buildWorldPlanes(plan, particles, colours, makeCurve(params), params)
    const t2 = performance.now()
    const edges = buildWorldEdges(plan, planes, params, worldScene, authored)
    const t3 = performance.now()
    return { plan, planes, edges, ms: [t1 - t0, t2 - t1, t3 - t2], particles: particles.count }
  }

  make(DEFAULT_PAINT_PARAMS) // warm-up
  const times: number[][] = [[], [], []]
  let last = make(DEFAULT_PAINT_PARAMS)
  for (let r = 0; r < RUNS; r++) {
    last = make(DEFAULT_PAINT_PARAMS)
    last.ms.forEach((v, k) => times[k].push(v))
  }
  const runCount = (edges: WorldEdges) => {
    const by = new Map<WorldEdgeType, { runs: number; samples: number }>(TYPES.map((t) => [t, { runs: 0, samples: 0 }]))
    for (const r of edges.runs) {
      const b = by.get(r.type)!
      b.runs++
      b.samples += r.h.length
    }
    return TYPES.map((t) => `${by.get(t)!.runs}/${by.get(t)!.samples}`).join(' ')
  }
  const ground = last.plan.ground
  const nPlanes = last.planes.planes.length
  const nGround = last.planes.planes.filter((p) => ground[p.mark] === 1).length
  rows.push([
    id, String(last.particles), String(last.plan.stats.triangles), String(nPlanes), String(nGround), runCount(last.edges),
    median(times[0]).toFixed(0), median(times[1]).toFixed(0), median(times[2]).toFixed(0), (median(times[1]) + median(times[2])).toFixed(0),
  ])

  // the terminator's classes at the default softness and at 1.0
  const soft1: PaintParams = { ...DEFAULT_PAINT_PARAMS, value: { ...DEFAULT_PAINT_PARAMS.value, terminatorSoftness: 1 } }
  const h0 = terminatorClasses(last.edges)
  const h1 = terminatorClasses(make(soft1).edges)
  // (and the same, reading the sides' values at the probes instead of the planes' means: WorldEdgeOptions.sideValues)
  const probes = buildWorldEdges(last.plan, last.planes, DEFAULT_PAINT_PARAMS, worldScene, authored, { sideValues: 'probes' })
  const planeContrast = (e: WorldEdges): string => {
    let s = 0
    let n = 0
    for (const r of e.runs) if (r.type === 'plane') {
      s += r.contrast * r.h.length
      n += r.h.length
    }
    return n > 0 ? (s / n).toFixed(3) : '-'
  }
  // (and with the model's depth term measured from the authored eye: WorldEdgeOptions.authoredDepth)
  const deep = buildWorldEdges(last.plan, last.planes, DEFAULT_PAINT_PARAMS, worldScene, authored, { authoredDepth: true })
  histRows.push([id, h0.join('/'), h1.join('/'), terminatorClasses(deep).join('/'), terminatorClasses(probes).join('/'), planeContrast(last.edges), planeContrast(probes)])
}

const print = (head: string[], body: string[][]) => {
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join('  ')
  console.log(line(head))
  for (const r of body) console.log(line(r))
}
print(['scene', 'particles', 'plan tris', 'planes', 'of ground', 'runs/samples: term shadow plane crease border', 'plan ms', 'planes ms', 'edges ms', 'planes+edges ms'], rows)
console.log('')
print(['scene', 'terminator lost/soft/firm/hard at ts 0.1', 'at ts 1.0', 'at ts 0.1, authoredDepth', 'at ts 0.1, probes', 'plane contrast, planes', 'plane contrast, probes'], histRows)
console.log(`(${RUNS} runs each after a warm-up, medians; the bench's own particles are made outside the timing)`)
