import { describe, expect, it, vi } from 'vitest'
import { cameraMatrices } from '../camera/projection'
import { buildFigure, buildPaintView, toWorldScene } from '../../../../review/src/paintLabCamera'
import { makeSceneColours } from '../../../../review/src/paintLabColours'
import { PAINT_FIGURES } from '../../../../review/src/paintLabFigures'
import type { MeshMark } from '../scene/types'
import { buildParticles, paintFrame, recolourFrame } from './model/index'
import { sphereGBuffer } from './model/testing'
import { DEFAULT_PAINT_PARAMS, setParam } from './params'
import { ROLES, type PaintFrame, type StrokeBatch } from './types'

// The painter's whole path on a real figure: the sphere-on-table spec of the Paint
// Lab, built by the real kernel, put in world space as the lab does, painted by the
// real model from a G-buffer of the sphere and its cast shadow (the synthetic one of
// model/testing.ts, which holds the same raw lit value the renderer writes). No GL.
vi.setConfig({ testTimeout: 60_000 })

const P = DEFAULT_PAINT_PARAMS
const WIDTH = 900
const HEIGHT = 650

const figure = PAINT_FIGURES.find((f) => f.id === 'sphere')!
const built = buildFigure(figure.spec)
const world = toWorldScene(built.scene, built.world)
const colours = makeSceneColours(built.scene, 'light', null)

// The marks the spec makes: the table (a statement named `table`) and the sphere.
const meshIndex = (name: string) => world.marks.findIndex((m) => m.kind === 'mesh' && m.source.statement === name)
const table = meshIndex('table')
const sphere = meshIndex('sphere')
const sphereMesh = world.marks[sphere] as MeshMark
const tableMesh = world.marks[table] as MeshMark

// The sphere's centre and radius in world space, from its own vertices, and the table's height.
function centreAndRadius(mesh: MeshMark): { centre: [number, number, number]; radius: number } {
  const p = mesh.positions
  const n = p.length / 3
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += p[3 * i]
    cy += p[3 * i + 1]
    cz += p[3 * i + 2]
  }
  cx /= n
  cy /= n
  cz /= n
  let r = 0
  for (let i = 0; i < n; i++) r = Math.max(r, Math.hypot(p[3 * i] - cx, p[3 * i + 1] - cy, p[3 * i + 2] - cz))
  return { centre: [cx, cy, cz], radius: r }
}

function paintAt(azimuth: number, params = P): { frame: PaintFrame; view: ReturnType<typeof buildPaintView>; g: ReturnType<typeof sphereGBuffer> } {
  const camera = cameraMatrices({ ...built.authored, azimuth }, built.world, { width: WIDTH, height: HEIGHT }, built.projection)
  const view = buildPaintView(camera, params.light, 1, false)
  const { centre, radius } = centreAndRadius(sphereMesh)
  const g = sphereGBuffer(WIDTH, HEIGHT, { view, params, centre, radius, mark: sphere, table: { z: tableMesh.positions[2], mark: table } })
  return { frame: paintFrame(world, buildParticles(world, colours, params), view, g, params), view, g }
}

const same = (a: StrokeBatch, b: StrokeBatch) => {
  expect(a.count).toBe(b.count)
  for (const key of Object.keys(a) as (keyof StrokeBatch)[]) {
    if (key !== 'count') expect(Array.from(a[key] as ArrayLike<number>), String(key)).toEqual(Array.from(b[key] as ArrayLike<number>))
  }
}

describe('the sphere on a table, through the real kernel and the real model', () => {
  it('is a table and a sphere, built with no errors, in world space', () => {
    expect(built.errors).toEqual([])
    expect(table).toBeGreaterThanOrEqual(0)
    expect(sphere).toBeGreaterThanOrEqual(0)
    const { centre, radius } = centreAndRadius(sphereMesh)
    // box-normalised: nothing is further from the box's centre than the box's half extent, and the sphere sits on the table
    expect(radius).toBeGreaterThan(0.1)
    expect(radius).toBeLessThan(0.6)
    expect(centre[2] - radius).toBeCloseTo(tableMesh.positions[2], 2)
  })

  it('has the strokes a lit sphere needs: block-in, form, glaze, edges and a dab of highlight', () => {
    const { frame } = paintAt(32)
    const by = frame.stats.byRole
    for (const role of ['block', 'form', 'glaze', 'edge', 'dab'] as const) expect(by[role], role).toBeGreaterThan(0)
    // the block-in is the bulk, and the highlight is a dab or two
    expect(by.block).toBeGreaterThan(200)
    expect(by.dab).toBeLessThan(5)
    // every stroke is in a role the contract knows, in a finite place, with a colour a renderer can use
    const b = frame.strokes
    expect(b.count).toBe(Object.values(by).reduce((a, n) => a + n, 0))
    for (let i = 0; i < b.count; i++) {
      expect(ROLES[b.role[i]]).toBeDefined()
      expect(Number.isFinite(b.path[16 * i]) && Number.isFinite(b.path[16 * i + 15])).toBe(true)
      for (let c = 0; c < 3; c++) {
        expect(b.colour[3 * i + c]).toBeGreaterThanOrEqual(0)
        expect(b.colour[3 * i + c]).toBeLessThanOrEqual(1)
      }
    }
  })

  it('paints the sphere and its shadow, and leaves the lit table bare', () => {
    const { frame, g } = paintAt(32)
    const b = frame.strokes
    let onSphere = 0
    let inShadow = 0
    let litTable = 0
    for (let i = 0; i < b.count; i++) {
      if (ROLES[b.role[i]] !== 'block') continue
      // the stroke's middle point, in the G-buffer
      const x = (b.path[16 * i + 6] + b.path[16 * i + 8]) / 2
      const y = (b.path[16 * i + 7] + b.path[16 * i + 9]) / 2
      const gi = Math.floor(y / g.scale) * g.width + Math.floor(x / g.scale)
      if (g.mark[gi] === sphere) onSphere++
      else if (g.mark[gi] === table && g.shadow[gi] === 1) inShadow++
      else if (g.mark[gi] === table) litTable++
    }
    expect(onSphere).toBeGreaterThan(150)
    expect(inShadow).toBeGreaterThan(20)
    // a stroke may overrun its edge by a little, but the bare table is not painted
    expect(litTable).toBeLessThan((onSphere + inShadow) * 0.1)
  })

  it('is deterministic: the same figure, view and parameters give a byte-identical frame', () => {
    const a = paintAt(32).frame
    const b = paintAt(32).frame
    same(a.strokes, b.strokes)
    expect(Array.from(a.debug.edgeSegments)).toEqual(Array.from(b.debug.edgeSegments))
    // and another view gives another frame (the check above would pass for a model that ignored the view)
    expect(Array.from(paintAt(60).frame.strokes.path)).not.toEqual(Array.from(a.strokes.path))
  })

  it('recolours exactly: only colour parameters changed, the strokes are those of a full frame', () => {
    const { frame, view, g } = paintAt(32)
    const warm = setParam(setParam(P, 'curve.warmHue', 30), 'mix.hueMax', 40)
    const recoloured = recolourFrame(frame, warm)!
    const set = buildParticles(world, colours, warm)
    same(recoloured.strokes, paintFrame(world, set, view, g, warm).strokes)
  })
})
