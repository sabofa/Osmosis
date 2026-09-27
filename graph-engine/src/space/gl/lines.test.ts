import { describe, expect, it, vi } from 'vitest'
import { LIGHT_PALETTE } from '../../render/palette'
import { cameraMatrices } from '../camera/projection'
import { worldMap } from '../camera/world'
import { defaultSpaceConfig } from '../config'
import { boxFrame } from '../frame/box'
import { axesFrame } from '../frame/axes'
import { frameAxes } from '../frame/ticks'
import type { Box3, Vec3 } from '../scene/types'
import { arrowMark, curveMark, lineMark, meshMark, pointMark, scene } from '../testing/marks'
import { spaceColors } from '../theme'
import { arrowHeadKind } from './arrowPipeline'
import { GlBackend } from './backend'
import { cumulativeScreenLength, dashUniform } from './dash'
import { createFakeGl, fakeCanvas, type FakeDraw, type FakeGl } from './fakeGl'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')
const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])
const CAMERA = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }, WORLD, { width: 800, height: 600 }, 'orthographic')
const AXES = frameAxes(defaultSpaceConfig(), CUBE)

function setup() {
  const fake = createFakeGl()
  const canvas = fakeCanvas(fake)
  const onError = vi.fn()
  const backend = new GlBackend(canvas.canvas, { onError })
  return { fake, backend, onError }
}

const pipeline = (fake: FakeGl, d: FakeDraw) => /space: (\w+)/.exec(fake.programSource(d.program).vertex)?.[1] ?? '?'

describe('cumulativeScreenLength', () => {
  const hundred = (x: number, y: number) => ({ x: x * 100, y: y * 100 })

  it('(0,0,0) -> (1,0,0) -> (1,1,0) at 100 px per unit gives [0, 100, 200]', () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0])
    expect(Array.from(cumulativeScreenLength(positions, new Uint32Array([0]), hundred))).toEqual([0, 100, 200])
  })

  it('restarts at 0 for each polyline in starts', () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 5, 5, 0, 5, 6, 0])
    expect(Array.from(cumulativeScreenLength(positions, new Uint32Array([0, 3]), hundred))).toEqual([0, 100, 200, 0, 100])
  })

  it('handles an empty polyline (a repeated start)', () => {
    const positions = new Float64Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0])
    expect(Array.from(cumulativeScreenLength(positions, new Uint32Array([0, 2, 2, 3]), hundred))).toEqual([0, 100, 0, 0])
  })
})

describe('dash patterns', () => {
  it('repeats an odd pattern and sums two on/off pairs', () => {
    expect(dashUniform([6, 4])).toEqual({ pattern: [6, 4, 6, 4], total: 20 })
    expect(dashUniform([5])).toEqual({ pattern: [5, 5, 5, 5], total: 20 })
    expect(dashUniform(null)).toBeNull()
  })
})

describe('the line pipeline', () => {
  it('uploads one instance per segment: a 513-vertex curve is 512 instances', () => {
    const { fake, backend } = setup()
    const helix = curveMark((t) => [Math.cos(t) * 0.5, Math.sin(t) * 0.5, t / 20], 0, 6 * Math.PI, 512)
    backend.setScene(scene([helix]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const lines = fake.draws.filter((d) => pipeline(fake, d) === 'line')
    // Two passes (core, then fringe) of the same 512 instances.
    expect(lines.map((d) => d.instances)).toEqual([512, 512])
    expect(lines[0].count).toBe(4)
  })

  it('never bridges polylines: 2 polylines of 3 vertices are 4 instances', () => {
    const { fake, backend } = setup()
    const a: Vec3[] = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
    ]
    const b: Vec3[] = [
      [-1, -1, 0],
      [-1, 0, 0],
      [-1, 0, 1],
    ]
    backend.setScene(scene([lineMark([a, b])]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const draw = fake.draws.find((d) => pipeline(fake, d) === 'line')!
    expect(draw.instances).toBe(4)
    const segments = fake.bufferContents(fake.attribBuffer(draw.vao, 1)) as Float32Array
    expect(segments).toHaveLength(4 * 6)
    const pairs = Array.from({ length: 4 }, (_, k) => Array.from(segments.slice(k * 6, k * 6 + 6)))
    expect(pairs).toEqual([
      [0, 0, 0, 1, 0, 0],
      [1, 0, 0, 1, 1, 0],
      [-1, -1, 0, -1, 0, 0],
      [-1, 0, 0, -1, 0, 1],
    ])
  })

  it('uploads cumulative dash lengths per instance only for dashed marks', () => {
    const { fake, backend } = setup()
    const dashed = lineMark(
      [
        [
          [-1, 0, 0],
          [0, 0, 0],
          [1, 0, 0],
        ],
      ],
      { style: { dash: [6, 4] } },
    )
    const solid = lineMark([
      [
        [0, -1, 0],
        [0, 1, 0],
      ],
    ])
    backend.setScene(scene([dashed, solid]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const vaos = [...new Set(fake.draws.filter((d) => pipeline(fake, d) === 'line').map((d) => d.vao))]
    expect(vaos).toHaveLength(2)
    const lengths = vaos.map((vao) => fake.bufferContents(fake.attribBuffer(vao, 3)))
    expect(lengths.filter(Boolean)).toHaveLength(1)
    const l = lengths.find(Boolean) as Float32Array
    // Two instances: (0, L1) and (L1, L1 + L2), where the two halves project equally.
    expect(l[0]).toBe(0)
    expect(l[1]).toBeGreaterThan(0)
    expect(l[2]).toBe(l[1])
    expect(l[3]).toBeCloseTo(2 * l[1], 3)
  })
})

describe('arrows', () => {
  it('arrowHeadKind: a ring below headSize, a triangle otherwise', () => {
    expect(arrowHeadKind(4, 10)).toBe('ring')
    expect(arrowHeadKind(9.99, 10)).toBe('ring')
    expect(arrowHeadKind(10, 10)).toBe('triangle')
    expect(arrowHeadKind(80, 10)).toBe('triangle')
  })

  it('draws a shaft through the line pipeline and a head per arrow', () => {
    const { fake, backend } = setup()
    const arrows = arrowMark([
      { tail: [0, 0, 0], vector: [1, 0, 0] },
      { tail: [0, 0, 0], vector: [0, 1, 0] },
      { tail: [0, 0, 0], vector: [0, 0, 1] },
    ])
    backend.setScene(scene([arrows]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const kinds = fake.draws.map((d) => [pipeline(fake, d), d.instances])
    expect(kinds).toEqual([
      ['line', 3],
      ['arrowhead', 3],
      ['line', 3],
      ['arrowhead', 3],
    ])
  })
})

describe('antialiased passes', () => {
  it('draws opaque cores with depth writes and no blending, then fringes blended without depth writes', () => {
    // A fringe that wrote depth hid the next segment's core wherever a curve
    // receded from the viewer: half of every helix loop looked dotted.
    const { fake, backend } = setup()
    backend.setScene(scene([curveMark((t) => [Math.cos(t), Math.sin(t), t / 10], 0, 12, 64), pointMark([[0, 0, 0]])]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const state = fake.draws.map((d) => [pipeline(fake, d), d.depthWrite, d.blend])
    expect(state).toEqual([
      ['line', true, false],
      ['point', true, false],
      ['line', false, true],
      ['point', false, true],
    ])
  })
})

describe('points', () => {
  it('draws one instance per point', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([pointMark([[0, 0, 0], [1, 1, 1]], { style: { shape: 'diamond' } })]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    expect(fake.draws.map((d) => [pipeline(fake, d), d.instances])).toEqual([
      ['point', 2],
      ['point', 2],
    ])
  })
})

describe('the frame, drawn', () => {
  it('draws every box-frame line through the line pipeline, before any mark', () => {
    const { fake, backend } = setup()
    const frame = boxFrame(WORLD, CAMERA, AXES)
    const mesh = meshMark([0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2])
    const curve = lineMark([
      [
        [0, 0, 0],
        [1, 1, 1],
      ],
    ])
    backend.setScene(scene([curve, mesh]), WORLD, LIGHT)
    backend.setFrame(frame, LIGHT)
    backend.draw(CAMERA, 1)
    const order = fake.draws.map((d) => pipeline(fake, d))
    // Grid, walls, ticks (core pass, then fringe pass), then the mesh, then the curve.
    expect(order).toEqual(['line', 'line', 'line', 'line', 'line', 'line', 'mesh', 'line', 'line'])
    const frameInstances = fake.draws.slice(0, 3).reduce((n, d) => n + d.instances, 0)
    expect(frameInstances).toBe(frame.lines.length)
    expect(frame.lines.some((l) => l.role === 'grid')).toBe(true)
  })

  it("draws the axes frame's axes through the arrow pipeline", () => {
    const { fake, backend } = setup()
    backend.setScene(scene([]), WORLD, LIGHT)
    backend.setFrame(axesFrame(WORLD, CAMERA, AXES), LIGHT)
    backend.draw(CAMERA, 1)
    const order = fake.draws.map((d) => [pipeline(fake, d), d.instances])
    const onePass = [
      ['line', expect.any(Number)],
      ['line', 3],
      ['arrowhead', 3],
    ]
    expect(order).toEqual([...onePass, ...onePass])
  })

  it('re-uploads the frame only when its line geometry changes', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([]), WORLD, LIGHT)
    backend.setFrame(boxFrame(WORLD, CAMERA, AXES), LIGHT)
    const buffers = fake.created.buffer
    // The same walls from a slightly different camera: same key, no upload.
    const nudged = cameraMatrices({ azimuth: 42, elevation: 26, zoom: 1.2, target: [0, 0, 0] }, WORLD, { width: 800, height: 600 }, 'orthographic')
    backend.setFrame(boxFrame(WORLD, nudged, AXES), LIGHT)
    expect(fake.created.buffer).toBe(buffers)
    // Orbiting past a face flips a wall: new geometry.
    const flipped = cameraMatrices({ azimuth: 130, elevation: 25, zoom: 1, target: [0, 0, 0] }, WORLD, { width: 800, height: 600 }, 'orthographic')
    backend.setFrame(boxFrame(WORLD, flipped, AXES), LIGHT)
    expect(fake.created.buffer).toBeGreaterThan(buffers)
  })

  it('frees everything, frame included, on dispose', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([curveMark((t) => [t, t, t], -1, 1, 8, { style: { dash: [4, 4] } }), arrowMark([{ tail: [0, 0, 0], vector: [1, 1, 1] }]), pointMark([[0, 0, 0]])]), WORLD, LIGHT)
    backend.setFrame(axesFrame(WORLD, CAMERA, AXES), LIGHT)
    backend.draw(CAMERA, 1)
    backend.dispose()
    for (const kind of Object.keys(fake.created) as (keyof FakeGl['created'])[]) expect([kind, fake.created[kind] - fake.deleted[kind]]).toEqual([kind, 0])
  })
})
