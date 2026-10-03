// A bench, not a test (never a wall-clock assert): the time of buildWorldPlan on the lab's showcase scenes, and what it made.
//
//   cd graph-engine && npx tsx src/space/paint/bake/plan.bench.mts [runs]
//
// The scenes are built as the lab builds them (review/src/paintLabCamera.ts prepareFigure: the figure's space spec through
// the kernel, then the scene in world coordinates); the light is the lab's default (azimuth and elevation against the
// authored camera, held fixed in the world); the reference world per px is the authored camera's at the Tune stage's size.
// Each scene is planned `runs` times (default 3) and the median reported, after one warm-up.

import { cameraMatrices } from '../../camera/projection'
import { prepareFigure, lightDirection } from '../../../../../review/src/paintLabCamera'
import { figureById } from '../../../../../review/src/paintLabFigures'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { buildWorldPlan, type WorldPlan } from './plan'

const IDS = ['sphere', 'torus', 'saddle', 'tangent-plane', 'helix-sheet', 'level-curves'] as const
const RUNS = Math.max(1, Number(process.argv[2]) || 3)
const VIEWPORT = { width: 1028, height: 690 } // the Tune stage

const params = DEFAULT_PAINT_PARAMS
const rows: string[][] = []
for (const id of IDS) {
  const figure = figureById(id)
  if (!figure) throw new Error(`no figure ${id}`)
  const { built, worldScene } = prepareFigure(figure)
  const camera = cameraMatrices(built.authored, built.world, VIEWPORT, built.projection)
  const perPx = camera.worldPerPixel
  const light = lightDirection(camera.basis, params.light.azimuth, params.light.elevation)
  const len = Math.hypot(light[0], light[1], light[2])
  const L: [number, number, number] = [light[0] / len, light[1] / len, light[2] / len]

  let source = 0
  let meshes = 0
  for (const m of worldScene.marks) if (m.kind === 'mesh') { meshes++; source += m.indices.length / 3 }

  let plan: WorldPlan = buildWorldPlan(worldScene, L, params, perPx) // warm-up
  const times: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    plan = buildWorldPlan(worldScene, L, params, perPx)
    times.push(performance.now() - t0)
  }
  times.sort((a, b) => a - b)
  const sides = plan.back.filter((b) => b).length + plan.front.filter((f) => f).length
  rows.push([
    id, String(meshes), String(source), String(plan.stats.triangles), String(plan.stats.vertices), String(sides),
    String(plan.stats.passes), String(plan.stats.unresolved), plan.stats.budgetHit ? 'YES' : 'no',
    (perPx * 1000).toFixed(3), times[Math.floor(times.length / 2)].toFixed(0), times[0].toFixed(0), times[times.length - 1].toFixed(0),
  ])
}

const head = ['scene', 'meshes', 'src tris', 'plan tris', 'vertices', 'side plans', 'passes', 'unresolved', 'budget hit', 'mm/px', 'median ms', 'min ms', 'max ms']
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)))
const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join('  ')
console.log(line(head))
for (const r of rows) console.log(line(r))
console.log(`(${RUNS} runs each after a warm-up; mm/px is 1000 x the world size of a CSS px at the authored framing, ${VIEWPORT.width} x ${VIEWPORT.height})`)
