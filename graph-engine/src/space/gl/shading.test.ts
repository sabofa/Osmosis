import { describe, expect, it, vi } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE } from '../../render/palette'
import { cameraMatrices } from '../camera/projection'
import { worldMap, type WorldMap } from '../camera/world'
import type { Box3, ColorScale, MeshMark, SpaceScene } from '../scene/types'
import { curveMark, meshMark, pointMark, scene } from '../testing/marks'
import { spaceColors } from '../theme'
import { GlBackend } from './backend'
import { createFakeGl, fakeCanvas, GL_CONSTANTS, type FakeGl, type FakeHandle } from './fakeGl'
import { SCALAR_LOCATION, UV_LOCATION } from './meshPipeline'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')
const DARK = spaceColors(DARK_PALETTE, 'dark')
const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])

function setup(options: Parameters<typeof createFakeGl>[0] = {}) {
  const fake = createFakeGl(options)
  const canvas = fakeCanvas(fake)
  const backend = new GlBackend(canvas.canvas, { onError: vi.fn() })
  return { fake, backend }
}

function camera(world: WorldMap = WORLD) {
  return cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
}

function scaleOf(id: number, map: ColorScale['map'] = 'viridis'): ColorScale {
  return { id, title: 'height', map, domain: { min: 0, max: 1 }, diverging: false }
}

// A unit square at z = h with a scalar per vertex, coloured by scale `scale`.
function coloured(h: number, scale: number | null, patch: Partial<MeshMark> = {}): MeshMark {
  const mark = meshMark(
    [-0.5, -0.5, h, 0.5, -0.5, h, 0.5, 0.5, h, -0.5, 0.5, h],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 2, 0, 2, 3],
    { style: { colorScale: scale }, scalars: Float64Array.from([0, 0.25, 0.5, 1]) },
  )
  return { ...mark, ...patch }
}

function withScales(s: SpaceScene, scales: ColorScale[]): SpaceScene {
  return { ...s, colorScales: scales }
}

// Every value set for uniform `name`, with the pipeline ("mesh", "line", ...) in use.
function uniformValues(fake: FakeGl, name: string): { program: string; values: unknown[] }[] {
  let program = ''
  const out: { program: string; values: unknown[] }[] = []
  for (const c of fake.calls) {
    if (c.fn === 'useProgram') program = /space: (\w+)/.exec(fake.programSource(c.args[0] as FakeHandle).vertex)?.[1] ?? ''
    else if (c.fn.startsWith('uniform') && (c.args[0] as { uniform?: string } | null)?.uniform === name) out.push({ program, values: c.args.slice(1) })
  }
  return out
}

const texImages = (fake: FakeGl) => fake.calls.filter((c) => c.fn === 'texImage2D')

// The colormap textures: the ones given pixels by texImage2D (the frame
// loop's targets are allocated by texStorage2D), each the texture bound just
// before its upload.
function lutTextures(fake: FakeGl): { created: number; live: number; deleted: number } {
  const handles: FakeHandle[] = []
  let bound: FakeHandle | null = null
  for (const c of fake.calls) {
    if (c.fn === 'bindTexture') bound = c.args[1] as FakeHandle | null
    if (c.fn === 'texImage2D' && bound) handles.push(bound)
  }
  const live = handles.filter((h) => fake.live.texture.has(h.id)).length
  return { created: handles.length, live, deleted: handles.length - live }
}

describe('GlBackend: colormap textures', () => {
  it('uploads one 256 x 1 RGBA8 texture per (map, theme), shared by every mesh using the map', () => {
    const { fake, backend } = setup()
    const s = withScales(scene([coloured(0, 0), coloured(0.5, 1), coloured(-0.5, 2)]), [scaleOf(0), scaleOf(1), scaleOf(2, 'magma')])
    backend.setScene(s, WORLD, LIGHT)
    backend.draw(camera(), 1)
    backend.draw(camera(), 1)
    // viridis (shared by two meshes) and magma: two textures, each uploaded once.
    expect(lutTextures(fake).created).toBe(2)
    const images = texImages(fake)
    expect(images).toHaveLength(2)
    const [target, level, internal, width, height, border, format, type, data] = images[0].args as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      Uint8Array,
    ]
    expect([target, level, internal, width, height, border, format, type]).toEqual([
      GL_CONSTANTS.TEXTURE_2D,
      0,
      GL_CONSTANTS.RGBA8,
      256,
      1,
      0,
      GL_CONSTANTS.RGBA,
      GL_CONSTANTS.UNSIGNED_BYTE,
    ])
    expect(data).toHaveLength(1024)
  })

  it('replaces the textures on a theme switch, deleting the old ones', () => {
    const { fake, backend } = setup()
    backend.setScene(withScales(scene([coloured(0, 0)]), [scaleOf(0, 'balance')]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    expect(lutTextures(fake)).toEqual({ created: 1, live: 1, deleted: 0 })
    backend.setColors(DARK)
    backend.draw(camera(), 1)
    expect(lutTextures(fake)).toEqual({ created: 2, live: 1, deleted: 1 })
    backend.dispose()
    expect(lutTextures(fake).live).toBe(0)
    expect(fake.live.texture.size).toBe(0)
  })

  it('makes no texture for a mesh with no colour scale, and deletes one no mesh uses any more', () => {
    const { fake, backend } = setup()
    backend.setScene(withScales(scene([coloured(0, 0)]), [scaleOf(0)]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    backend.setScene(scene([coloured(0, null)]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    expect(lutTextures(fake)).toEqual({ created: 1, live: 0, deleted: 1 })
  })
})

describe('GlBackend: mesh attributes', () => {
  it('makes scalars and uv vertex attributes only when the mark has them (with a scale, and mesh lines)', () => {
    const { fake, backend } = setup()
    const uv = Float64Array.from([4500.25, -1, 4501.25, -1, 4501.25, 0, 4500.25, 0])
    const full = coloured(0, 0, {
      uv,
      style: { color: { author: null, slot: 0 }, opacity: 1, colorScale: 0, meshLines: { u0: 0, du: 0.5, v0: 0, dv: 0.5 } },
    })
    const bare = coloured(0.5, null)
    backend.setScene(withScales(scene([full, bare]), [scaleOf(0)]), WORLD, LIGHT)
    backend.draw(camera(), 1)
    const draws = fake.draws.filter((d) => fake.programSource(d.program).vertex.includes('space: mesh'))
    expect(draws).toHaveLength(2)
    const [a, b] = draws
    expect(Array.from(fake.bufferContents(fake.attribBuffer(a.vao, SCALAR_LOCATION)) as Float32Array)).toEqual([0, 0.25, 0.5, 1])
    // (u, v) less a whole number of steps from the first vertex: 4500.25 - 4500 = 0.25, -1 - -1 = 0.
    expect(Array.from(fake.bufferContents(fake.attribBuffer(a.vao, UV_LOCATION)) as Float32Array)).toEqual([0.25, 0, 1.25, 0, 1.25, 1, 0.25, 1])
    expect(fake.attribBuffer(b.vao, SCALAR_LOCATION)).toBeUndefined()
    expect(fake.attribBuffer(b.vao, UV_LOCATION)).toBeUndefined()
    // The shader is told which is which.
    expect(uniformValues(fake, 'u_colormap').map((u) => u.values[0])).toEqual([1, 0])
    expect(uniformValues(fake, 'u_meshLines').map((u) => u.values[0])).toEqual([1, 0])
    expect(uniformValues(fake, 'u_meshStep')[0].values).toEqual([0.5, 0.5])
  })
})

describe('GlBackend: box clipping and the depth cue', () => {
  const BOX: Box3 = { x: { min: 0, max: 4 }, y: { min: -1, max: 3 }, z: { min: 10, max: 20 } }
  const world = worldMap(BOX, [1, 1, 0.7])

  function drawn(options: { depthcue?: boolean } = {}) {
    const { fake, backend } = setup()
    const marks = [coloured(15, null), curveMark((t) => [t, 0, 15], 0, 4, 8), pointMark([[1, 1, 12]])]
    backend.setScene(scene(marks), world, LIGHT, options)
    backend.setFrame({ style: 'box', lines: [{ a: [0, -1, 10], b: [4, -1, 10], role: 'wall' }], labels: [], key: 'k' }, LIGHT)
    backend.draw(camera(world), 1)
    return fake
  }

  it('gives every mark pipeline the box relative to its centre (2, 1, 15), and the frame none', () => {
    const fake = drawn()
    const mins = uniformValues(fake, 'u_clipMin')
    const maxs = uniformValues(fake, 'u_clipMax')
    expect(new Set(mins.map((u) => u.program))).toEqual(new Set(['mesh', 'line', 'point']))
    for (const u of mins) expect(u.values).toEqual([-2, -2, -5])
    for (const u of maxs) expect(u.values).toEqual([2, 2, 5])
    // The frame's lines draw first, unclipped; the marks' draws clip.
    const clip = uniformValues(fake, 'u_clip')
    expect(clip[0]).toEqual({ program: 'line', values: [0] })
    expect(clip.filter((u) => u.program === 'mesh').map((u) => u.values[0])).toEqual([1])
    expect(clip.filter((u) => u.program === 'point').every((u) => u.values[0] === 1)).toBe(true)
  })

  it('cues marks at 0.35 by default and the frame never; @depthcue: off sets 0', () => {
    const on = uniformValues(drawn(), 'u_cue')
    expect(on[0]).toEqual({ program: 'line', values: [0] })
    expect(on.filter((u) => u.program === 'mesh').map((u) => u.values[0])).toEqual([0.35])
    const off = uniformValues(drawn({ depthcue: false }), 'u_cue')
    expect(off.some((u) => u.program === 'mesh')).toBe(true)
    expect(off.every((u) => u.values[0] === 0)).toBe(true)
  })

  it('lifts a point toward the eye by its radius for the depth test (it reads as a small sphere, not half-buried)', () => {
    const fake = drawn()
    const cam = camera(world)
    const perPixel = uniformValues(fake, 'u_worldPerPixel').filter((u) => u.program === 'point')
    expect(perPixel.length).toBeGreaterThan(0)
    for (const u of perPixel) expect(u.values).toEqual([cam.worldPerPixel])
    const eyeDir = uniformValues(fake, 'u_eyeDir').filter((u) => u.program === 'point')
    for (const u of eyeDir) expect(u.values).toEqual([...cam.direction])
  })

  it('normalises cue depth across the box sphere: the range is the centre depth -/+ |h|', () => {
    const fake = drawn()
    const [range] = uniformValues(fake, 'u_cueRange').filter((u) => u.program === 'mesh')
    const [plane] = uniformValues(fake, 'u_depthPlane').filter((u) => u.program === 'mesh')
    const radius = Math.hypot(...world.halfExtents)
    const w = plane.values[3] as number
    expect(range.values[0]).toBeCloseTo(w - radius, 12)
    expect(range.values[1]).toBeCloseTo(w + radius, 12)
    // The box centre (the world origin) is in front of the eye, farther than the sphere's radius.
    expect(w).toBeGreaterThan(radius)
  })
})
