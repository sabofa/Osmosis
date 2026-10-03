import { describe, expect, it, vi } from 'vitest'
import { cameraMatrices } from '../../camera/projection'
import { screenBasis } from '../../camera/turntable'
import { worldMap } from '../../camera/world'
import type { Box3, SpaceScene } from '../../scene/types'
import { buildFigure, buildPaintView, keyLightDirection, lightDirection, prepareFigure, toWorldScene, worldLightDirection } from '../../../../../review/src/paintLabCamera'
import { PAINT_FIGURES } from '../../../../../review/src/paintLabFigures'

// Building a figure (a res-120 surface, a marching level curve) takes a second or two,
// and longer when the machine is busy: these tests are not timing tests.
vi.setConfig({ testTimeout: 60_000 })

// The lab's camera: the space turntable, a PaintView per frame, a key light
// that follows the camera, and the scene normalised to world coordinates.

const near = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits))

describe('lightDirection', () => {
  // Camera at azimuth 0, elevation 0: the eye is on +x looking along -x, screen
  // right is +y and screen up is +z.
  const basis = screenBasis({ azimuth: 0, elevation: 0, zoom: 1 })

  it('at azimuth 0 and elevation 0 the light is at the eye', () => {
    near(lightDirection(basis, 0, 0), [1, 0, 0])
  })

  it('azimuth is toward the viewer\'s left, elevation is up', () => {
    near(lightDirection(basis, 90, 0), [0, -1, 0]) // left of a viewer whose right is +y
    near(lightDirection(basis, -90, 0), [0, 1, 0])
    near(lightDirection(basis, 0, 90), [0, 0, 1])
    near(lightDirection(basis, 180, 0), [-1, 0, 0]) // behind the figure: a rim light
  })

  it('the spec\'s upper left (35, 40) is cos40 (cos35 B - sin35 R) + sin40 U = (0.6275, -0.4394, 0.6428)', () => {
    near(lightDirection(basis, 35, 40), [0.627507, -0.439385, 0.642788], 5)
    expect(Math.hypot(...lightDirection(basis, 35, 40))).toBeCloseTo(1, 12)
  })

  it('follows the camera: a quarter turn of the camera turns the light with it', () => {
    // Camera at azimuth 90: the eye is on +y, screen right is -x.
    const turned = screenBasis({ azimuth: 90, elevation: 0, zoom: 1 })
    near(lightDirection(turned, 35, 40), [0.439385, 0.627507, 0.642788], 5)
  })
})

describe('worldLightDirection', () => {
  // z is up; the azimuth is about the z axis from +x toward +y; the elevation is above the xy-plane.
  it('puts the light where the angles say, in the world and not against the view', () => {
    near(worldLightDirection(0, 0), [1, 0, 0])
    near(worldLightDirection(90, 0), [0, 1, 0])
    near(worldLightDirection(180, 0), [-1, 0, 0])
    near(worldLightDirection(-90, 0), [0, -1, 0])
    near(worldLightDirection(0, 90), [0, 0, 1]) // straight down on the figure, whatever the azimuth
    near(worldLightDirection(137, 90), [0, 0, 1])
    near(worldLightDirection(0, -90), [0, 0, -1])
  })

  it('is cos(el) cos(az), cos(el) sin(az), sin(el): the default (-35, 39) is (0.6366, -0.4458, 0.6293), and (30, 60) is (0.4330, 0.25, 0.8660)', () => {
    near(worldLightDirection(-35, 39), [0.6366007, -0.4457526, 0.6293204], 6)
    near(worldLightDirection(30, 60), [0.4330127, 0.25, 0.8660254], 6)
    expect(Math.hypot(...worldLightDirection(-35, 39))).toBeCloseTo(1, 12)
  })
})

describe('keyLightDirection', () => {
  const basis = screenBasis({ azimuth: 40, elevation: 25, zoom: 1 })
  const light = { azimuth: -35, elevation: 39 }

  it('is the world direction when the light is fixed in the world (1, or half and more), and the view-relative one when it is not (0, or not said)', () => {
    near(keyLightDirection(basis, { ...light, worldFixed: 1 }), worldLightDirection(-35, 39))
    near(keyLightDirection(basis, { ...light, worldFixed: 0.5 }), worldLightDirection(-35, 39))
    near(keyLightDirection(basis, { ...light, worldFixed: 0 }), lightDirection(basis, -35, 39))
    near(keyLightDirection(basis, light), lightDirection(basis, -35, 39))
    expect(keyLightDirection(basis, { ...light, worldFixed: 1 })).not.toEqual(keyLightDirection(basis, { ...light, worldFixed: 0 }))
  })
})

describe('buildPaintView, the light', () => {
  const box: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
  const world = worldMap(box, [1, 1, 1])
  const at = (azimuth: number, elevation: number) =>
    cameraMatrices({ azimuth, elevation, zoom: 1, target: [0, 0, 0] }, world, { width: 800, height: 600 }, 'orthographic')

  it('fixed in the world (worldFixed 1): orbiting the camera never moves it, and azimuth 0, elevation 90 is straight down', () => {
    const light = { azimuth: -35, elevation: 39, worldFixed: 1 }
    for (const [az, el] of [[0, 0], [40, 25], [100, 25], [215, 60], [-70, 10]]) {
      near(buildPaintView(at(az, el), light, 1, false).lightDir, [0.6366007, -0.4457526, 0.6293204], 6)
    }
    near(buildPaintView(at(40, 25), { azimuth: 0, elevation: 90, worldFixed: 1 }, 1, false).lightDir, [0, 0, 1])
    near(buildPaintView(at(190, 25), { azimuth: 0, elevation: 90, worldFixed: 1 }, 1, false).lightDir, [0, 0, 1])
  })

  it('relative to the view (worldFixed 0): it turns with the camera, as it did', () => {
    const light = { azimuth: 35, elevation: 40, worldFixed: 0 }
    near(buildPaintView(at(0, 0), light, 1, false).lightDir, [0.627507, -0.439385, 0.642788], 5)
    near(buildPaintView(at(90, 0), light, 1, false).lightDir, [0.439385, 0.627507, 0.642788], 5)
  })
})

describe('buildPaintView', () => {
  const box: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
  const world = worldMap(box, [1, 1, 1])
  const camera = cameraMatrices({ azimuth: 0, elevation: 0, zoom: 1, target: [0, 0, 0] }, world, { width: 800, height: 600 }, 'orthographic')

  it('carries the matrices, the eye, a unit view direction toward the target, the size and the flags', () => {
    const view = buildPaintView(camera, { azimuth: 35, elevation: 40 }, 2, true)
    expect(view.viewProj).toBeInstanceOf(Float32Array)
    expect(view.view).toBeInstanceOf(Float32Array)
    expect(view.viewProj).toHaveLength(16)
    camera.viewProj.forEach((v, i) => expect(view.viewProj[i]).toBeCloseTo(v, 6))
    camera.view.forEach((v, i) => expect(view.view[i]).toBeCloseTo(v, 6))
    near(view.eye, camera.eye)
    near(view.viewDir, [-1, 0, 0]) // from the eye toward the target
    expect(view.width).toBe(800)
    expect(view.height).toBe(600)
    expect(view.pixelRatio).toBe(2)
    expect(view.dragging).toBe(true)
    expect(buildPaintView(camera, { azimuth: 0, elevation: 0 }, 1, false).dragging).toBe(false)
  })

  it('points the light from the view basis, in world space', () => {
    const view = buildPaintView(camera, { azimuth: 35, elevation: 40 }, 1, false)
    near(view.lightDir, [0.627507, -0.439385, 0.642788], 5)
  })

  it('carries how far in the camera is against the authored framing, for the brush to follow, and says nothing when told nothing', () => {
    // a camera at zoom 4.8 over an authored zoom of 1.6 is a 3x close-up
    expect(buildPaintView(camera, { azimuth: 0, elevation: 0 }, 1, false, 4.8 / 1.6).zoom).toBeCloseTo(3, 12)
    expect(buildPaintView(camera, { azimuth: 0, elevation: 0 }, 1, false, 1).zoom).toBe(1)
    expect('zoom' in buildPaintView(camera, { azimuth: 0, elevation: 0 }, 1, false)).toBe(false)
    // a zoom that is not a number is left out (the painter reads a missing one as 1)
    expect('zoom' in buildPaintView(camera, { azimuth: 0, elevation: 0 }, 1, false, Number.NaN)).toBe(false)
  })
})

describe('toWorldScene', () => {
  // Author box x [0, 10], y [0, 4], z [0, 2] in a world of half-extents (1, 1, 0.5):
  // centre (5, 2, 1) and scale k = (0.2, 0.5, 0.5).
  const box: Box3 = { x: { min: 0, max: 10 }, y: { min: 0, max: 4 }, z: { min: 0, max: 2 } }
  const world = worldMap(box, [1, 1, 0.5])
  const source = { line: 1, statement: null, object: 's1' }
  const color = { author: null, slot: 0 }
  const scene: SpaceScene = {
    marks: [
      {
        kind: 'mesh', source, positions: new Float64Array([10, 4, 2, 5, 2, 1, 0, 0, 0]),
        normals: new Float64Array([1, 0, 1, 0, 0, 0, 0, 0, 1].map((v, i) => (i < 3 ? v / Math.SQRT2 : v))),
        indices: new Uint32Array([0, 1, 2]), scalars: new Float64Array([1, 2, 3]), uv: new Float64Array([0, 0, 1, 1, 2, 2]),
        style: { color, opacity: 0.5, colorScale: null, meshLines: null }, pick: null,
      },
      { kind: 'lines', source, positions: new Float64Array([10, 4, 2, 5, 2, 1]), starts: new Uint32Array([0]), params: null, style: { color, width: 2, dash: null, hidden: 'none' }, pick: null },
      { kind: 'points', source, positions: new Float64Array([10, 4, 2]), style: { color, size: 6, shape: 'dot' } },
      { kind: 'arrows', source, tails: new Float64Array([10, 4, 2]), vectors: new Float64Array([5, 2, 1]), style: { color, shaftWidth: 2, headSize: 8, hidden: 'none' } },
      { kind: 'boxes', source, mins: new Float64Array([0, 0, 0]), maxs: new Float64Array([10, 4, 2]), style: { color, opacity: 1, edges: true } },
    ],
    labels: [], colorScales: [], extent: null, boxSpanning: { x: false, y: false, z: false }, errors: [],
  }
  const out = toWorldScene(scene, world)

  it('maps positions to (a - centre) * scale, so the box centre is the origin and a corner is the half-extent', () => {
    const mesh = out.marks[0]
    if (mesh.kind !== 'mesh') throw new Error('mesh expected')
    near(Array.from(mesh.positions), [1, 1, 0.5, 0, 0, 0, -1, -1, -0.5])
    const line = out.marks[1]
    if (line.kind !== 'lines') throw new Error('lines expected')
    near(Array.from(line.positions), [1, 1, 0.5, 0, 0, 0])
    const points = out.marks[2]
    if (points.kind !== 'points') throw new Error('points expected')
    near(Array.from(points.positions), [1, 1, 0.5])
  })

  it('maps normals by n / k, renormalised: (1, 0, 1) / (0.2, 0.5, 0.5) = (5, 0, 2) / sqrt 29', () => {
    const mesh = out.marks[0]
    if (mesh.kind !== 'mesh') throw new Error('mesh expected')
    near(Array.from(mesh.normals.slice(0, 3)), [5 / Math.sqrt(29), 0, 2 / Math.sqrt(29)])
    // An undefined (zero) normal stays zero, and (0, 0, 1) stays (0, 0, 1).
    near(Array.from(mesh.normals.slice(3, 6)), [0, 0, 0])
    near(Array.from(mesh.normals.slice(6, 9)), [0, 0, 1])
  })

  it('maps an arrow\'s tail like a point and its vector like a direction (scaled, not shifted)', () => {
    const arrow = out.marks[3]
    if (arrow.kind !== 'arrows') throw new Error('arrows expected')
    near(Array.from(arrow.tails), [1, 1, 0.5])
    near(Array.from(arrow.vectors), [1, 1, 0.5])
  })

  it('maps a box\'s corners like points', () => {
    const b = out.marks[4]
    if (b.kind !== 'boxes') throw new Error('boxes expected')
    near(Array.from(b.mins), [-1, -1, -0.5])
    near(Array.from(b.maxs), [1, 1, 0.5])
  })

  it('keeps everything that is not geometry, and never changes the scene it was given', () => {
    const mesh = out.marks[0]
    if (mesh.kind !== 'mesh') throw new Error('mesh expected')
    expect(mesh.indices).toBe((scene.marks[0] as typeof mesh).indices)
    expect(mesh.scalars).toBe((scene.marks[0] as typeof mesh).scalars)
    expect(mesh.uv).toBe((scene.marks[0] as typeof mesh).uv)
    expect(mesh.style.opacity).toBe(0.5)
    expect((scene.marks[0] as typeof mesh).positions[0]).toBe(10)
  })
})

describe('buildFigure', () => {
  it('builds a spec into the scene, its world map, the authored view and no errors', () => {
    const built = buildFigure('@frame: none\n@bounds3d: x [-2, 2], y [-2, 2], z [0, 4]\n@camera: azimuth 20, elevation 30, zoom 1.5\nz = x^2 for x in [-2, 2], y in [-2, 2]')
    expect(built.errors).toEqual([])
    expect(built.scene.marks).toHaveLength(1)
    expect(built.authored).toEqual({ azimuth: 20, elevation: 30, zoom: 1.5, target: built.world.centre })
    expect(built.world.centre).toEqual([0, 0, 2])
    expect(built.projection).toBe('orthographic')
  })

  it('reports a kernel that throws as an error, with an empty scene, instead of throwing', () => {
    const built = buildFigure('z = x^2 for x in [-2, 2], y in [-2, 2]', () => {
      throw new Error('boom')
    })
    expect(built.errors).toEqual(['space could not build this spec: boom'])
    expect(built.scene.marks).toEqual([])
    expect(built.authored.target).toEqual(built.world.centre)
  })

  it('reports a spec\'s errors with their lines instead of throwing', () => {
    const built = buildFigure('z = x^2 for x in [-2, 2], y in [-2, 2]\nthis is not a statement at all ((')
    expect(built.errors.length).toBeGreaterThan(0)
    expect(built.errors.join('\n')).toMatch(/line 2/)
  })
})

describe('prepareFigure', () => {
  it('builds a figure once and hands the same build to every caller, with its scene in world coordinates', () => {
    const sphere = PAINT_FIGURES[0]
    const a = prepareFigure(sphere)
    expect(prepareFigure(sphere)).toBe(a)
    expect(a.built.errors).toEqual([])
    // The sphere on a table: world coordinates are within the box's half-extents (<= 1).
    for (const mark of a.worldScene.marks) {
      if (mark.kind !== 'mesh') continue
      for (let i = 0; i < mark.positions.length; i++) expect(Math.abs(mark.positions[i])).toBeLessThanOrEqual(1 + 1e-9)
    }
    expect(prepareFigure(PAINT_FIGURES[1])).not.toBe(a)
  })
})
