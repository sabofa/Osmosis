import { describe, expect, it, vi } from 'vitest'
import { LIGHT_PALETTE } from '../../render/palette'
import { cameraMatrices } from '../camera/projection'
import { worldMap } from '../camera/world'
import type { Box3, MeshMark } from '../scene/types'
import { arrowMark, lineMark, meshMark, pointMark, scene } from '../testing/marks'
import { spaceColors } from '../theme'
import { GlBackend } from './backend'
import { createFakeGl, fakeCanvas, GL_CONSTANTS, type FakeDraw, type FakeGl, type FakeHandle } from './fakeGl'
import { MESH_POLYGON_OFFSET } from './frameLoop'
import { HIDDEN_OPACITY } from './linePipeline'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')
const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])
const CAMERA = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: [0, 0, 0] }, WORLD, { width: 800, height: 600 }, 'orthographic')

function setup(options: Parameters<typeof createFakeGl>[0] = {}) {
  const fake = createFakeGl(options)
  const canvas = fakeCanvas(fake)
  const onError = vi.fn()
  const backend = new GlBackend(canvas.canvas, { onError })
  return { fake, canvas, backend, onError }
}

function square(height: number, opacity: number): MeshMark {
  return meshMark(
    [-0.5, -0.5, height, 0.5, -0.5, height, 0.5, 0.5, height, -0.5, 0.5, height],
    [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
    [0, 1, 2, 0, 2, 3],
    { style: { opacity } },
  )
}

// Everything the order tests draw: an opaque and a translucent mesh, a curve
// drawn dashed where hidden, a curve that is not, a point, an arrow, and one
// frame line.
function drawAll(backend: GlBackend) {
  const hidden = lineMark([[[-1, 0, -0.5], [1, 0, 0.5]]], { style: { hidden: 'dashed' } })
  const plain = lineMark([[[-1, 0.5, 0], [1, 0.5, 0]]])
  backend.setScene(scene([square(0, 1), square(0.5, 0.5), hidden, plain, pointMark([[0, 0, 0]]), arrowMark([{ tail: [0, 0, 0], vector: [0, 1, 0] }], { style: { hidden: 'dashed' } })]), WORLD, LIGHT)
  backend.setFrame({ style: 'box', lines: [{ a: [-1, -1, -1], b: [1, -1, -1], role: 'wall' }], labels: [], key: 'k' }, LIGHT)
  backend.draw(CAMERA, 1)
}

const DRAWS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])

function pipeline(fake: FakeGl, d: FakeDraw): string {
  return /space: (\w+)/.exec(fake.programSource(d.program).vertex)?.[1] ?? '?'
}

// Each blit as [from, to]: the MSAA target is the one with renderbuffers
// attached, the resolve target the one with a texture at colour attachment 0
// read by a blit, the canvas null.
function blits(fake: FakeGl): [string, string][] {
  const withRenderbuffer = new Set<number>()
  let bound: FakeHandle | null = null
  let read: FakeHandle | null = null
  let draw: FakeHandle | null = null
  const out: [string, string][] = []
  const name = (f: FakeHandle | null) => (f === null ? 'canvas' : withRenderbuffer.has(f.id) ? 'msaa' : 'resolve')
  for (const c of fake.calls) {
    if (c.fn === 'bindFramebuffer') {
      const [target, fb] = c.args as [number, FakeHandle | null]
      if (target === GL_CONSTANTS.FRAMEBUFFER) bound = read = draw = fb
      if (target === GL_CONSTANTS.READ_FRAMEBUFFER) read = fb
      if (target === GL_CONSTANTS.DRAW_FRAMEBUFFER) draw = fb
    }
    if (c.fn === 'framebufferRenderbuffer' && bound) withRenderbuffer.add(bound.id)
    if (c.fn === 'blitFramebuffer') out.push([name(read), name(draw)])
  }
  return out
}

// The frame as a sequence of passes, consecutive repeats folded.
function timeline(fake: FakeGl): string[] {
  const out: string[] = []
  let drawn = 0
  let msaa: FakeHandle | null | undefined
  let meshSeen = false
  for (const c of fake.calls) {
    let label: string | null = null
    if (c.fn === 'blitFramebuffer') label = ((c.args[8] as number) & GL_CONSTANTS.DEPTH_BUFFER_BIT) !== 0 ? 'resolve' : 'blit'
    else if (DRAWS.has(c.fn)) {
      const d = fake.draws[drawn++]
      const p = pipeline(fake, d)
      if (msaa === undefined) msaa = d.framebuffer
      if (p === 'composite') label = 'composite'
      else if (p === 'mesh') {
        meshSeen = true
        label = d.framebuffer !== msaa ? 'oit' : d.polygonOffset ? 'opaque' : 'sorted'
      } else if (d.depthFunc === GL_CONSTANTS.GREATER) label = 'hidden'
      else label = meshSeen ? 'marks' : 'frame'
    }
    if (label && out[out.length - 1] !== label) out.push(label)
  }
  return out
}

describe('the frame loop, with EXT_color_buffer_float', () => {
  it('runs frame -> opaque meshes -> hidden parts -> lines, points, arrows -> resolve -> OIT -> composite', () => {
    const { fake, backend, onError } = setup()
    drawAll(backend)
    expect(onError).not.toHaveBeenCalled()
    expect(timeline(fake)).toEqual(['frame', 'opaque', 'hidden', 'marks', 'resolve', 'oit', 'composite'])
  })

  it('draws into the multisampled target, then composites into the canvas', () => {
    const { fake, backend } = setup()
    drawAll(backend)
    // One blit: the MSAA colour and depth resolved for the OIT pass.
    expect(blits(fake)).toEqual([['msaa', 'resolve']])
    const byPipeline = (p: string) => fake.draws.filter((d) => pipeline(fake, d) === p)
    const [composite] = byPipeline('composite')
    expect(composite.framebuffer).toBeNull()
    expect(composite.count).toBe(3)
    const opaque = byPipeline('mesh').find((d) => d.polygonOffset)!
    expect(opaque.framebuffer).not.toBeNull()
    // 4 samples, colour RGBA8 and depth DEPTH24.
    const storage = fake.calls.filter((c) => c.fn === 'renderbufferStorageMultisample').map((c) => c.args.slice(1, 3))
    expect(storage).toEqual([
      [4, GL_CONSTANTS.RGBA8],
      [4, GL_CONSTANTS.DEPTH_COMPONENT24],
    ])
    // Float targets for OIT: RGBA16F accumulation and an R16F weight.
    const formats = fake.calls.filter((c) => c.fn === 'texStorage2D').map((c) => c.args[2])
    expect(formats).toEqual([GL_CONSTANTS.RGBA8, GL_CONSTANTS.DEPTH_COMPONENT24, GL_CONSTANTS.RGBA16F, GL_CONSTANTS.R16F])
  })

  it('pushes opaque meshes back by polygon offset, and nothing else', () => {
    const { fake, backend } = setup()
    drawAll(backend)
    const offset = fake.calls.filter((c) => c.fn === 'polygonOffset').map((c) => c.args)
    expect(offset).toEqual([[MESH_POLYGON_OFFSET.factor, MESH_POLYGON_OFFSET.units]])
    const offsetDraws = fake.draws.filter((d) => d.polygonOffset).map((d) => pipeline(fake, d))
    expect(offsetDraws).toEqual(['mesh'])
  })

  it('draws the hidden pass only for marks marked hidden: dashed, behind (GREATER), blended, writing no depth, dashed 4/4 at 45%', () => {
    const { fake, backend } = setup()
    drawAll(backend)
    const hidden = fake.draws.filter((d) => d.depthFunc === GL_CONSTANTS.GREATER)
    // The dashed-hidden curve and the arrow's shaft (two AA passes each, one
    // line draw per mark) and the arrow's head (two AA passes): the plain
    // curve and the point are not in it.
    expect(hidden.map((d) => pipeline(fake, d))).toEqual(['line', 'line', 'arrowhead', 'line', 'line', 'arrowhead'])
    expect(hidden.every((d) => !d.depthWrite && d.blend)).toBe(true)
    // The dash uniforms in force for hidden line draws.
    let dash: unknown[] = []
    let opacity: unknown = null
    let mode: unknown = null
    const seen: unknown[][] = []
    let drawn = 0
    for (const c of fake.calls) {
      const name = (c.args[0] as { uniform?: string } | null)?.uniform
      if (name === 'u_dash') dash = c.args.slice(1)
      if (name === 'u_opacity') opacity = c.args[1]
      if (name === 'u_dashMode') mode = c.args[1]
      if (DRAWS.has(c.fn)) {
        const d = fake.draws[drawn++]
        if (d.depthFunc === GL_CONSTANTS.GREATER && pipeline(fake, d) === 'line') seen.push([...dash, opacity, mode])
      }
    }
    // The solid curve and the arrow's shaft dash on their cumulative screen
    // length (mode 1): a lengths buffer is made for the hidden pass.
    expect(seen.slice(0, 2)).toEqual([
      [4, 4, 4, 4, HIDDEN_OPACITY, 1],
      [4, 4, 4, 4, HIDDEN_OPACITY, 1],
    ])
  })

  it('reallocates every target on resize, deleting the old ones', () => {
    const { fake, canvas, backend } = setup()
    drawAll(backend)
    const live = { framebuffer: fake.live.framebuffer.size, renderbuffer: fake.live.renderbuffer.size }
    expect(live).toEqual({ framebuffer: 3, renderbuffer: 2 })
    const created = fake.created.framebuffer
    backend.draw(CAMERA, 1)
    // Same size: nothing new.
    expect(fake.created.framebuffer).toBe(created)
    ;(canvas.canvas as { width: number }).width = 400
    backend.draw(CAMERA, 1)
    expect(fake.created.framebuffer).toBe(created + 3)
    expect(fake.deleted.framebuffer).toBe(3)
    expect(fake.deleted.renderbuffer).toBe(2)
    expect({ framebuffer: fake.live.framebuffer.size, renderbuffer: fake.live.renderbuffer.size }).toEqual(live)
    const last = fake.calls.filter((c) => c.fn === 'renderbufferStorageMultisample').at(-1)!
    expect(last.args.slice(3)).toEqual([400, 600])
  })

  it('leaves zero live resources of every kind after dispose', () => {
    const { fake, backend } = setup()
    drawAll(backend)
    backend.dispose()
    for (const kind of Object.keys(fake.created) as (keyof FakeGl['created'])[]) {
      expect([kind, fake.created[kind] - fake.deleted[kind]]).toEqual([kind, 0])
    }
  })

  it('has its targets again after a context restore', () => {
    const { fake, canvas, backend } = setup()
    drawAll(backend)
    canvas.lose()
    canvas.restore()
    expect(fake.live.framebuffer.size).toBe(0)
    backend.draw(CAMERA, 1)
    expect(fake.live.framebuffer.size).toBe(3)
    expect(fake.live.renderbuffer.size).toBe(2)
    expect(timeline(fake).slice(-3)).toEqual(['resolve', 'oit', 'composite'])
  })

  it('takes MAX_SAMPLES when it is under 4', () => {
    const { fake, backend } = setup({ maxSamples: 2 })
    drawAll(backend)
    expect(fake.calls.filter((c) => c.fn === 'renderbufferStorageMultisample').map((c) => c.args[1])).toEqual([2, 2])
  })
})

describe('the frame loop, without EXT_color_buffer_float', () => {
  it('makes no float targets, blends translucent meshes sorted into the MSAA target, then resolves and blits', () => {
    const { fake, backend } = setup({ colorBufferFloat: false })
    drawAll(backend)
    expect(timeline(fake)).toEqual(['frame', 'opaque', 'hidden', 'marks', 'sorted', 'blit'])
    // The multisample resolve goes to the RGBA8 resolve target (a resolve
    // blit needs identical formats, and the canvas is RGB8); only then a
    // single-sample blit to the canvas.
    expect(blits(fake)).toEqual([
      ['msaa', 'resolve'],
      ['resolve', 'canvas'],
    ])
    const formats = fake.calls.filter((c) => c.fn === 'texStorage2D').map((c) => c.args[2])
    expect(formats).not.toContain(GL_CONSTANTS.RGBA16F)
    expect(formats).not.toContain(GL_CONSTANTS.R16F)
    const sorted = fake.draws.filter((d) => pipeline(fake, d) === 'mesh' && d.blend)
    expect(sorted.map((d) => d.cull)).toEqual(['front', 'back'])
    expect(fake.draws.some((d) => pipeline(fake, d) === 'composite')).toBe(false)
  })
})

describe('the frame loop, when its targets cannot be made', () => {
  it('draws straight into the canvas and leaks nothing', () => {
    const { fake, backend, onError } = setup({ incompleteFramebuffers: true })
    drawAll(backend)
    expect(onError).not.toHaveBeenCalled()
    expect(fake.draws.length).toBeGreaterThan(0)
    expect(fake.draws.every((d) => d.framebuffer === null)).toBe(true)
    expect(fake.live.framebuffer.size).toBe(0)
    expect(fake.live.renderbuffer.size).toBe(0)
    expect(timeline(fake)).toEqual(['frame', 'opaque', 'hidden', 'marks', 'sorted'])
  })
})
