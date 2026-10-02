import { describe, expect, it, vi } from 'vitest'
import { parseSpec } from '../../../parser/parseSpec'
import { cameraMatrices, project } from '../../camera/projection'
import { resolveBox } from '../../frame/bounds'
import { createSpaceKernel } from '../../kernel/index'
import type { ArrowMark, LineMark, Mark, MeshMark, PointMark, SpaceScene } from '../../scene/types'
import { prepareFigure } from '../../../../../review/src/paintLabCamera'
import { figureById, PAINT_FIGURES } from '../../../../../review/src/paintLabFigures'

// Building a figure (a res-120 surface, a marching level curve) takes a second or two,
// and longer when the machine is busy: these tests are not timing tests.
vi.setConfig({ testTimeout: 60_000 })

// The lab's figures are real space specs. Each must build with no errors (a
// figure that silently stopped drawing is a dead picker entry), and each must
// draw what its label promises, checked against the closed-form geometry.

function build(id: string) {
  const figure = figureById(id)
  if (!figure) throw new Error(`no figure "${id}"`)
  const parsed = parseSpec(figure.spec)
  const kernel = createSpaceKernel(parsed.statements, parsed.config, parsed.statementLines)
  const scene = kernel.scene()
  return { figure, parsed, scene }
}

type V = readonly [number, number, number]
const vertices = (m: MeshMark | LineMark): V[] =>
  Array.from({ length: m.positions.length / 3 }, (_, i) => [m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]] as const)
const meshes = (s: SpaceScene) => s.marks.filter((m: Mark): m is MeshMark => m.kind === 'mesh')
const lineMarks = (s: SpaceScene) => s.marks.filter((m: Mark): m is LineMark => m.kind === 'lines')
const pointMarks = (s: SpaceScene) => s.marks.filter((m: Mark): m is PointMark => m.kind === 'points')
const arrowMarks = (s: SpaceScene) => s.marks.filter((m: Mark): m is ArrowMark => m.kind === 'arrows')
const named = (s: SpaceScene, name: string) => s.marks.find((m) => m.source.statement === name)

const IDS = ['sphere', 'saddle', 'saddle-height', 'torus', 'ridges', 'tangent-plane', 'level-curves', 'helix-sheet', 'plane-hill']

describe('the figures', () => {
  it('are the nine of the spec, in order, with unique ids and labels', () => {
    expect(PAINT_FIGURES.map((f) => f.id)).toEqual(IDS)
    expect(new Set(PAINT_FIGURES.map((f) => f.label)).size).toBe(IDS.length)
    for (const f of PAINT_FIGURES) expect(f.caption.length, f.id).toBeGreaterThan(10)
  })

  for (const id of IDS) {
    it(`${id} parses and builds with no errors, and draws something`, () => {
      const { parsed, scene } = build(id)
      expect(parsed.errors).toEqual([])
      expect(scene.errors).toEqual([])
      expect(scene.marks.length).toBeGreaterThan(0)
    })
  }

  // The authored camera frames the figure: everything it draws lies inside the view, with a margin,
  // both in the Tune stage (about 1028 x 690 css px) and in a Showcase tile (4:3).
  for (const [width, height] of [[1028, 690], [431, 323]]) {
    for (const id of IDS) {
      it(`${id} fits the ${width} x ${height} view at its authored camera, with a 4% margin`, () => {
        const { built } = prepareFigure(figureById(id)!)
        const camera = cameraMatrices(built.authored, built.world, { width, height }, built.projection)
        let seen = 0
        for (const mark of built.scene.marks) {
          const arrays = mark.kind === 'mesh' || mark.kind === 'lines' || mark.kind === 'points' ? [mark.positions] : mark.kind === 'arrows' ? [mark.tails] : []
          for (const a of arrays) {
            for (let i = 0; i + 2 < a.length; i += 3) {
              const p = project(camera, built.world.toWorld([a[i], a[i + 1], a[i + 2]]))
              expect(p.x, `${id} x`).toBeGreaterThan(0.04 * width)
              expect(p.x, `${id} x`).toBeLessThan(0.96 * width)
              expect(p.y, `${id} y`).toBeGreaterThan(0.04 * height)
              expect(p.y, `${id} y`).toBeLessThan(0.96 * height)
              seen++
            }
          }
        }
        expect(seen).toBeGreaterThan(100)
      })
    }
  }

  it('sphere: a unit sphere resting on a flat table, normals outward', () => {
    const { scene } = build('sphere')
    const table = named(scene, 'table') as MeshMark
    const ball = named(scene, 'sphere') as MeshMark
    expect(table.kind).toBe('mesh')
    for (const [, , z] of vertices(table)) expect(z).toBe(0)
    const vs = vertices(ball)
    for (const [x, y, z] of vs) expect(Math.hypot(x, y, z - 1)).toBeCloseTo(1, 9)
    // It rests on the table: its lowest point is z = 0 (v = pi: 1 + cos(pi)).
    expect(Math.min(...vs.map((p) => p[2]))).toBeCloseTo(0, 9)
    let checked = 0
    vs.forEach(([x, y, z], i) => {
      const n = [ball.normals[3 * i], ball.normals[3 * i + 1], ball.normals[3 * i + 2]]
      if (n[0] === 0 && n[1] === 0 && n[2] === 0) return
      expect(n[0] * x + n[1] * y + n[2] * (z - 1)).toBeGreaterThan(0.999)
      checked++
    })
    expect(checked).toBeGreaterThan(vs.length / 2)
  })

  it('saddle: z = x^2 - y^2 at every vertex, one flat colour', () => {
    const { scene } = build('saddle')
    const [mesh] = meshes(scene)
    expect(meshes(scene)).toHaveLength(1)
    for (const [x, y, z] of vertices(mesh)) expect(z).toBeCloseTo(x * x - y * y, 9)
    expect(mesh.style.colorScale).toBeNull()
    expect(mesh.style.opacity).toBe(1)
  })

  it('saddle-height: the same surface, coloured by its height on one scale', () => {
    const { scene } = build('saddle-height')
    const [mesh] = meshes(scene)
    expect(scene.colorScales).toHaveLength(1)
    expect(mesh.style.colorScale).toBe(0)
    expect(mesh.scalars).not.toBeNull()
    vertices(mesh).forEach(([, , z], i) => expect(mesh.scalars![i]).toBeCloseTo(z, 9))
    // z = x^2 - y^2 on [-1.5, 1.5]^2 spans [-2.25, 2.25].
    expect(scene.colorScales[0].domain.min).toBeCloseTo(-2.25, 1)
    expect(scene.colorScales[0].domain.max).toBeCloseTo(2.25, 1)
  })

  it('torus: major radius 2, tube radius 0.8, normals pointing out of the tube', () => {
    const { scene } = build('torus')
    const mesh = meshes(scene)[0]
    vertices(mesh).forEach(([x, y, z], i) => {
      const rho = Math.hypot(x, y)
      expect((rho - 2) ** 2 + z * z).toBeCloseTo(0.64, 9)
      // The tube's centre circle point under this vertex.
      const cx = (2 * x) / rho
      const cy = (2 * y) / rho
      const out = (x - cx) * mesh.normals[3 * i] + (y - cy) * mesh.normals[3 * i + 1] + z * mesh.normals[3 * i + 2]
      expect(out / 0.8).toBeGreaterThan(0.999)
    })
  })

  it('ridges: z = 0.2 sin(5.4x) cos(5.4y), reaching the full amplitude', () => {
    const { scene } = build('ridges')
    const [mesh] = meshes(scene)
    const vs = vertices(mesh)
    for (const [x, y, z] of vs) expect(z).toBeCloseTo(0.2 * Math.sin(5.4 * x) * Math.cos(5.4 * y), 9)
    expect(Math.max(...vs.map((p) => p[2]))).toBeGreaterThan(0.19)
    expect(Math.min(...vs.map((p) => p[2]))).toBeLessThan(-0.19)
  })

  it('tangent-plane: P on the hill, its x and y slices through P, and the normal there', () => {
    const { scene } = build('tangent-plane')
    const f = (x: number, y: number) => 1.6 * Math.exp(-(x * x + y * y) / 1.5) + 0.3 * x
    // 1.6 exp(-0.89 / 1.5) + 0.24 = 1.6 (0.55249) + 0.24 = 1.12398
    expect(f(0.8, 0.5)).toBeCloseTo(1.12398, 4)
    const [p] = pointMarks(scene)
    expect(p.positions[0]).toBeCloseTo(0.8, 9)
    expect(p.positions[1]).toBeCloseTo(0.5, 9)
    expect(p.positions[2]).toBeCloseTo(f(0.8, 0.5), 9)
    expect(meshes(scene).length).toBeGreaterThanOrEqual(2) // the hill and the tangent plane
    const through = (m: LineMark, axis: 0 | 1, value: number) =>
      vertices(m).every((v) => Math.abs(v[axis] - value) < 1e-9) && vertices(m).some((v) => Math.hypot(v[0] - 0.8, v[1] - 0.5) < 0.1)
    expect(lineMarks(scene).some((m) => through(m, 0, 0.8))).toBe(true) // the slice x = 0.8
    expect(lineMarks(scene).some((m) => through(m, 1, 0.5))).toBe(true) // the slice y = 0.5
    // The normal is (-f_x, -f_y, 1) at P: f_x = e (-2x / 1.5) + 0.3 and f_y = e (-2y / 1.5),
    // with e = 1.6 exp(-(x^2 + y^2) / 1.5) = 0.883972.
    const e = 1.6 * Math.exp(-(0.8 * 0.8 + 0.5 * 0.5) / 1.5)
    const nx = -(e * ((-2 * 0.8) / 1.5) + 0.3)
    const ny = -(e * ((-2 * 0.5) / 1.5))
    expect(nx).toBeCloseTo(0.642904, 5)
    expect(ny).toBeCloseTo(0.589315, 5)
    const len = Math.hypot(nx, ny, 1)
    const arrow = arrowMarks(scene).find((a) => Math.abs(a.tails[0] - 0.8) < 1e-9 && Math.abs(a.tails[1] - 0.5) < 1e-9)
    expect(arrow).toBeDefined()
    const vl = Math.hypot(arrow!.vectors[0], arrow!.vectors[1], arrow!.vectors[2])
    expect(arrow!.vectors[0] / vl).toBeCloseTo(nx / len, 6)
    expect(arrow!.vectors[1] / vl).toBeCloseTo(ny / len, 6)
    expect(arrow!.vectors[2] / vl).toBeCloseTo(1 / len, 6)
  })

  it('level-curves: a translucent surface with level curves lying flat on the floor', () => {
    const { parsed, scene } = build('level-curves')
    const surface = meshes(scene)[0]
    expect(surface.style.opacity).toBeLessThan(1)
    const floor = resolveBox(parsed.config.space, scene.extent, scene.boxSpanning).z.min
    const flat = lineMarks(scene).filter((m) => vertices(m).every((v) => Math.abs(v[2] - floor) < 1e-9))
    const polylines = flat.reduce((n, m) => n + m.starts.length, 0)
    expect(polylines).toBeGreaterThanOrEqual(5)
    // The same curves on the surface sit above the floor, at their level.
    const lifted = lineMarks(scene).filter((m) => vertices(m).some((v) => Math.abs(v[2] - floor) > 1e-6))
    expect(lifted.length).toBeGreaterThan(0)
  })

  it('helix-sheet: a helix of radius 0.9 that crosses a translucent sheet', () => {
    const { scene } = build('helix-sheet')
    const sheet = meshes(scene)[0]
    expect(sheet.style.opacity).toBeLessThan(1)
    const helix = lineMarks(scene).find((m) => vertices(m).every(([x, y]) => Math.abs(Math.hypot(x, y) - 0.9) < 1e-9))
    expect(helix).toBeDefined()
    const side = vertices(helix!).map(([x, , z]) => Math.sign(z - 0.25 * x))
    expect(side.some((s) => s < 0) && side.some((s) => s > 0)).toBe(true)
    // The sheet is z = 0.25 x.
    for (const [x, , z] of vertices(sheet)) expect(z).toBeCloseTo(0.25 * x, 9)
  })

  it('plane-hill: the intersection curve lies exactly on the plane and on the hill', () => {
    const { scene } = build('plane-hill')
    const hill = (x: number, y: number) => 1.5 * Math.exp(-(x * x + y * y) / 1.2)
    const plane = meshes(scene).find((m) => m.style.opacity < 1)!
    expect(plane).toBeDefined()
    for (const [x, y] of vertices(plane)) expect(x + y).toBeCloseTo(0.5, 9)
    const curve = lineMarks(scene).find((m) => vertices(m).every(([x, y]) => Math.abs(x + y - 0.5) < 1e-9 && m.style.width >= 2))
    expect(curve).toBeDefined()
    for (const [x, y, z] of vertices(curve!)) expect(z).toBeCloseTo(hill(x, y), 9)
    expect(Math.max(...vertices(curve!).map((v) => v[2]))).toBeGreaterThan(1.3)
  })
})
