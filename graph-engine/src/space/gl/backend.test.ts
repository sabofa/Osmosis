import { afterEach, describe, expect, it, vi } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../render/palette'
import { cameraMatrices } from '../camera/projection'
import { worldMap, type WorldMap } from '../camera/world'
import type { Box3, MeshMark, SpaceScene } from '../scene/types'
import { meshMark, scene } from '../testing/marks'
import { spaceColors } from '../theme'
import { GlBackend } from './backend'
import { createFakeGl, fakeCanvas, GL_CONSTANTS, type FakeGl, type FakeHandle } from './fakeGl'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')
const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])
const VIEW = { azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] as const }

// A unit square in the plane z = height, two triangles, normals +z.
function square(height = 0, x0 = -0.5, opacity = 1, line = 1): MeshMark {
  return meshMark(
    [x0, -0.5, height, x0 + 1, -0.5, height, x0 + 1, 0.5, height, x0, 0.5, height],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 2, 0, 2, 3],
    { line, style: { opacity } },
  )
}

function setup(options: Parameters<typeof createFakeGl>[0] = {}) {
  const fake = createFakeGl(options)
  const canvas = fakeCanvas(fake)
  const onError = vi.fn()
  const onContextLost = vi.fn()
  const onContextRestored = vi.fn()
  const backend = new GlBackend(canvas.canvas, { onError, onContextLost, onContextRestored })
  return { fake, canvas, backend, onError, onContextLost, onContextRestored }
}

function camera(world: WorldMap = WORLD) {
  return cameraMatrices({ ...VIEW, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
}

// The data feeding attribute `location` of the VAO of the n-th mesh draw.
function attribData(fake: FakeGl, vao: FakeHandle | null, location: number) {
  return fake.bufferContents(fake.attribBuffer(vao, location))
}

function meshDraws(fake: FakeGl) {
  return fake.draws.filter((d) => fake.programSource(d.program).vertex.includes('space: mesh'))
}

function balance(fake: FakeGl) {
  return Object.fromEntries(Object.keys(fake.created).map((k) => [k, fake.created[k as keyof FakeGl['created']] - fake.deleted[k as keyof FakeGl['deleted']]]))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GlBackend: context', () => {
  it('asks for webgl2 and records EXT_color_buffer_float for S3', () => {
    const { fake, backend } = setup()
    expect(fake.extensionsQueried).toContain('EXT_color_buffer_float')
    expect(backend.capabilities?.colorBufferFloat).toBe(true)
    expect(setup({ colorBufferFloat: false }).backend.capabilities?.colorBufferFloat).toBe(false)
  })

  it('reports a missing WebGL2 legibly and never throws', () => {
    const canvas = fakeCanvas(null)
    const onError = vi.fn()
    const backend = new GlBackend(canvas.canvas, { onError })
    expect(backend.available).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('WebGL2'))
    expect(() => {
      backend.setScene(scene([square()]), WORLD, LIGHT)
      backend.draw(camera(), 1)
      backend.dispose()
    }).not.toThrow()
  })
})

describe('GlBackend: upload', () => {
  it('uploads Float32 positions relative to the box centre: x = 4500.25 with centre 4500 is 0.25 exactly', () => {
    const { fake, backend } = setup()
    const box: Box3 = { x: { min: 4499, max: 4501 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
    const world = worldMap(box, [1, 1, 1])
    const mesh = meshMark(
      [4500.25, 0, 0, 4501, 0, 0, 4501, 1, 0, 4500.25, 1, 0],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 1, 2, 0, 2, 3],
    )
    backend.setScene(scene([mesh]), world, LIGHT)
    backend.draw(camera(world), 1)
    const [draw] = meshDraws(fake)
    const positions = attribData(fake, draw.vao, 0) as Float32Array
    expect(positions).toBeInstanceOf(Float32Array)
    expect(positions).toHaveLength(12)
    expect(positions[0]).toBe(0.25)
    expect(positions[3]).toBe(1)
    // 6 indices, drawn as 6.
    const indices = fake.uploads.find((u) => u.target === GL_CONSTANTS.ELEMENT_ARRAY_BUFFER)?.data
    expect(indices).toBeInstanceOf(Uint32Array)
    expect(Array.from(indices!)).toEqual([0, 1, 2, 0, 2, 3])
    expect(draw.count).toBe(6)
  })

  it('uploads normals transformed by the inverse of k: (0, 0, 1) stays, normalise(1, 0, 1) becomes normalise(1, 0, 2)', () => {
    const { fake, backend } = setup()
    // Spans (2, 2, 2) with half-extents (1, 1, 0.5): k = (1, 1, 0.5).
    const world = worldMap(CUBE, [1, 1, 0.5])
    const s = Math.SQRT1_2
    const mesh = meshMark([0, 0, 0, 1, 0, 0, 1, 1, 0], [0, 0, 1, s, 0, s, 0, 0, 1], [0, 1, 2])
    backend.setScene(scene([mesh]), world, LIGHT)
    backend.draw(camera(world), 1)
    const normals = attribData(fake, meshDraws(fake)[0].vao, 1) as Float32Array
    expect(Array.from(normals.slice(0, 3))).toEqual([0, 0, 1])
    expect(normals[3]).toBeCloseTo(1 / Math.sqrt(5), 6)
    expect(normals[4]).toBe(0)
    expect(normals[5]).toBeCloseTo(2 / Math.sqrt(5), 6)
  })

  it('re-uploads nothing for a mark kept by identity: one new buffer set, one deleted', () => {
    const { fake, backend } = setup()
    const kept = square(0)
    const replaced = square(0.5)
    backend.setScene(scene([kept, replaced]), WORLD, LIGHT)
    const vaos = fake.created.vertexArray
    const buffers = fake.created.buffer
    const deletedVaos = fake.deleted.vertexArray
    const deletedBuffers = fake.deleted.buffer
    backend.setScene(scene([kept, square(0.7)]), WORLD, LIGHT)
    expect(fake.created.vertexArray - vaos).toBe(1)
    expect(fake.deleted.vertexArray - deletedVaos).toBe(1)
    // A mesh's set is positions, normals and indices.
    expect(fake.created.buffer - buffers).toBe(3)
    expect(fake.deleted.buffer - deletedBuffers).toBe(3)
  })

  it('re-uploads every mark when the box centre or scale changes', () => {
    const { fake, backend } = setup()
    const kept = square(0)
    backend.setScene(scene([kept]), WORLD, LIGHT)
    const vaos = fake.created.vertexArray
    backend.setScene(scene([kept]), worldMap({ ...CUBE, z: { min: -1, max: 3 } }, [1, 1, 1]), LIGHT)
    expect(fake.created.vertexArray - vaos).toBe(1)
    expect(fake.live.vertexArray.size).toBe(1)
  })

  it('dispose() deletes every program, shader, buffer, VAO and texture it created', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([square(0), square(0.5, -0.5, 0.5)]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    backend.setScene(scene([square(0.2)]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    expect(fake.created.program).toBeGreaterThan(0)
    backend.dispose()
    for (const [kind, n] of Object.entries(balance(fake))) expect([kind, n]).toEqual([kind, 0])
    for (const kind of Object.keys(fake.live)) expect(fake.live[kind as keyof FakeGl['live']].size).toBe(0)
  })
})

describe('GlBackend: drawing meshes', () => {
  it('draws translucent meshes after opaque ones, back to front, each as its nearest layer only', () => {
    const { fake, backend } = setup()
    // Scene order: near translucent, opaque, far translucent. The camera
    // looks down from +z (elevation 25), so higher z is nearer.
    const near = square(0.8, -0.5, 0.5, 1)
    const opaque = square(0, -0.5, 1, 2)
    const far = square(-0.8, -0.5, 0.5, 3)
    backend.setScene(scene([near, opaque, far]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    const draws = meshDraws(fake)
    const heightOf = (d: (typeof draws)[number]) => Math.round((attribData(fake, d.vao, 0) as Float32Array)[2] * 10) / 10
    // Each translucent mesh: a depth-only prepass (so an unsorted closed mesh
    // cannot composite its far side over its near side), then its colour,
    // blended, without writing depth.
    expect(draws.map((d) => [heightOf(d), d.colorWrite, d.depthWrite, d.blend])).toEqual([
      [0, true, true, false],
      [-0.8, false, true, false],
      [-0.8, true, false, true],
      [0.8, false, true, false],
      [0.8, true, false, true],
    ])
  })

  it('clears to the palette background', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([square()]), WORLD, spaceColors(DARK_PALETTE, 'dark'))
    backend.draw(camera(), 1)
    const clear = fake.calls.find((c) => c.fn === 'clearColor')!
    const [r, g, b] = clear.args as number[]
    expect([r, g, b]).toEqual([0x20 / 255, 0x1e / 255, 0x15 / 255])
  })
})

describe('GlBackend: context loss', () => {
  it('prevents the default on loss, draws nothing while lost, and rebuilds everything on restore', () => {
    const { fake, canvas, backend, onContextLost, onContextRestored } = setup()
    const content: SpaceScene = scene([square(0), square(0.5, -0.5, 0.5)])
    backend.setScene(content, WORLD, LIGHT)
    backend.draw(camera(), 1)
    const before = fake.draws.length
    expect(before).toBeGreaterThan(0)

    const event = canvas.lose()
    expect(event.defaultPrevented).toBe(true)
    expect(onContextLost).toHaveBeenCalledTimes(1)
    backend.draw(camera(), 1)
    expect(fake.draws.length).toBe(before)
    expect(fake.errors).toEqual([])

    const programs = fake.created.program
    canvas.restore()
    expect(onContextRestored).toHaveBeenCalledTimes(1)
    expect(fake.created.program).toBeGreaterThan(programs)
    expect(fake.live.vertexArray.size).toBe(2)
    backend.draw(camera(), 1)
    expect(fake.draws.length - before).toBe(before)
  })

  it('removes its context listeners on dispose', () => {
    const { canvas, backend } = setup()
    expect(canvas.listenerCount('webglcontextlost')).toBe(1)
    backend.dispose()
    expect(canvas.listenerCount('webglcontextlost')).toBe(0)
    expect(canvas.listenerCount('webglcontextrestored')).toBe(0)
  })
})

describe('GlBackend: shader failure', () => {
  it('surfaces a failed compile through onError with the info log, and draw becomes a no-op', () => {
    const { fake, backend, onError } = setup({ failCompile: true })
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatch(/shader failed to compile/)
    expect(onError.mock.calls[0][0]).toContain("'lighting' : undeclared identifier")
    expect(() => {
      backend.setScene(scene([square()]), WORLD, LIGHT)
      backend.draw(camera(), 1)
    }).not.toThrow()
    expect(fake.draws).toEqual([])
    backend.dispose()
    for (const [kind, n] of Object.entries(balance(fake))) expect([kind, n]).toEqual([kind, 0])
  })
})

describe('GlBackend: box marks', () => {
  it('skips box marks with one console warning per scene', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { backend } = setup()
    const box = {
      kind: 'boxes' as const,
      source: { line: 2, statement: null, object: 's2' },
      mins: new Float64Array([0, 0, 0, 1, 1, 1]),
      maxs: new Float64Array([0.5, 0.5, 0.5, 1.5, 1.5, 1.5]),
      style: { color: { author: null, slot: 1 }, opacity: 1, edges: true },
    }
    backend.setScene(scene([square(), box, { ...box }]), WORLD, LIGHT)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toMatch(/box marks/)
  })
})
