import { describe, expect, it } from 'vitest'
import { LIGHT_PALETTE } from '../../render/palette'
import { cameraMatrices } from '../camera/projection'
import { worldMap } from '../camera/world'
import type { Box3, BoxMark } from '../scene/types'
import { meshMark, scene } from '../testing/marks'
import { spaceColors } from '../theme'
import { GlBackend } from './backend'
import { BOX_PROGRAM, boxEdges, drawBoxesOit, drawOpaqueBoxes, drawTranslucentBoxes, UNIT_CUBE, uploadBoxes, type BoxDraw } from './boxPipeline'
import { markLook } from './look'
import { createSharedQuads } from './linePipeline'
import { ProgramCache } from './program'
import { createFakeGl, fakeCanvas, GL_CONSTANTS, type FakeGl } from './fakeGl'

const LIGHT = spaceColors(LIGHT_PALETTE, 'light')
const CUBE: Box3 = { x: { min: -1, max: 1 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }
const WORLD = worldMap(CUBE, [1, 1, 1])
const CAMERA = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: WORLD.centre }, WORLD, { width: 800, height: 600 }, 'orthographic')

function boxMark(boxes: readonly [number[], number[]][], opacity = 0.6, edges = true, line = 2): BoxMark {
  return {
    kind: 'boxes',
    source: { line, statement: null, object: `s${line}` },
    mins: Float64Array.from(boxes.flatMap(([lo]) => lo)),
    maxs: Float64Array.from(boxes.flatMap(([, hi]) => hi)),
    style: { color: { author: null, slot: 1 }, opacity, edges },
  }
}

const TWO: [number[], number[]][] = [
  [
    [0, 0, 0.5],
    [0.5, 0.5, 0.9],
  ],
  [
    [0, 0, -0.9],
    [0.5, 0.5, -0.5],
  ],
]

function setup(options: Parameters<typeof createFakeGl>[0] = {}) {
  const fake = createFakeGl(options)
  const backend = new GlBackend(fakeCanvas(fake).canvas, { onError: (m) => { throw new Error(m) } })
  return { fake, backend }
}

function boxDraws(fake: FakeGl) {
  return fake.draws.filter((d) => fake.programSource(d.program).vertex.includes('space: box'))
}

function lineDraws(fake: FakeGl) {
  return fake.draws.filter((d) => fake.programSource(d.program).vertex.includes('space: line'))
}

function balance(fake: FakeGl) {
  return Object.keys(fake.created).map((k) => [k, fake.created[k as keyof FakeGl['created']] - fake.deleted[k as keyof FakeGl['deleted']]])
}

describe('the unit cube', () => {
  it('is 36 vertices in [0, 1]^3, every triangle counter-clockwise about its outward normal', () => {
    expect(UNIT_CUBE.length).toBe(36 * 6)
    for (let t = 0; t < 12; t++) {
      const v = (k: number) => Array.from(UNIT_CUBE.subarray((3 * t + k) * 6, (3 * t + k) * 6 + 6))
      const [a, b, c] = [v(0), v(1), v(2)]
      for (const p of [a, b, c]) for (let i = 0; i < 3; i++) expect([0, 1]).toContain(p[i])
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
      const normal = a.slice(3)
      // outward: the normal points away from the cube's centre
      const out = normal[0] * (a[0] - 0.5) + normal[1] * (a[1] - 0.5) + normal[2] * (a[2] - 0.5)
      expect(out).toBeGreaterThan(0)
      expect(cross[0] * normal[0] + cross[1] * normal[1] + cross[2] * normal[2]).toBeGreaterThan(0)
    }
  })
})

describe('boxEdges', () => {
  it('gives each box its 12 edges, each along one axis from the min corner’s plane to the max corner’s', () => {
    const { positions, starts } = boxEdges(Float64Array.from([0, 0, 0]), Float64Array.from([1, 2, 3]))
    expect(Array.from(starts)).toEqual(Array.from({ length: 12 }, (_, i) => 2 * i))
    const lengths: number[] = []
    for (let e = 0; e < 12; e++) {
      const d = [0, 1, 2].map((c) => positions[e * 6 + 3 + c] - positions[e * 6 + c])
      expect(d.filter((x) => x !== 0)).toHaveLength(1)
      lengths.push(Math.max(...d))
    }
    expect(lengths.sort()).toEqual([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3])
  })
})

describe('GlBackend draws box marks through the box pipeline', () => {
  it('one instanced draw per BoxMark: the 36-vertex cube, one instance per box', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([boxMark(TWO), boxMark(TWO.slice(0, 1), 0.6, true, 3)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const draws = boxDraws(fake)
    expect(draws.map((d) => [d.fn, d.mode, d.count, d.instances])).toEqual([
      ['drawArraysInstanced', GL_CONSTANTS.TRIANGLES, 36, 2],
      ['drawArraysInstanced', GL_CONSTANTS.TRIANGLES, 36, 1],
    ])
  })

  it('translucent boxes blend without writing depth; opaque ones write depth; back faces culled for both', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([boxMark(TWO, 0.6), boxMark(TWO, 1, true, 3)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    expect(boxDraws(fake).map((d) => [d.instances, d.blend, d.depthWrite, d.cull])).toEqual([
      [2, false, true, 'back'],
      [2, true, false, 'back'],
    ])
    // and leaves the defaults behind it: in S3's frame loop the opaque boxes
    // may be the frame's first draw, so check the first draw after the boxes
    // (the edges, through the line pipeline) instead of the frame's first.
    const before = fake.draws.length
    backend.draw(CAMERA, 1)
    const next = fake.draws.slice(before)
    const firstOpaqueBox = next.findIndex((d) => fake.programSource(d.program).vertex.includes('space: box'))
    const after = next.slice(firstOpaqueBox + 1).find((d) => !fake.programSource(d.program).vertex.includes('space: box'))
    expect(after).toMatchObject({ cull: 'none', depthWrite: true })
  })

  it('draws the edges through the line pipeline, 12 segments per box; none when edges are off', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([boxMark(TWO)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    expect(lineDraws(fake).some((d) => d.instances === 24)).toBe(true)
    const off = setup()
    off.backend.setScene(scene([boxMark(TWO, 0.6, false)]), WORLD, LIGHT)
    off.backend.draw(CAMERA, 1)
    expect(lineDraws(off.fake)).toEqual([])
  })

  it('uploads each box’s min and max relative to the box centre; the sorted fallback puts translucent ones farthest first', () => {
    // Without EXT_color_buffer_float: under OIT the order does not matter and
    // the instances keep the mark's order (see the J4 block below).
    const { fake, backend } = setup({ colorBufferFloat: false })
    const world = worldMap({ x: { min: 99, max: 101 }, y: { min: -1, max: 1 }, z: { min: -1, max: 1 } }, [1, 1, 1])
    const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
    const shifted = TWO.map(([lo, hi]) => [
      [lo[0] + 100, lo[1], lo[2]],
      [hi[0] + 100, hi[1], hi[2]],
    ]) as [number[], number[]][]
    backend.setScene(scene([boxMark(shifted)]), world, LIGHT)
    backend.draw(camera, 1)
    const data = fake.bufferContents(fake.attribBuffer(boxDraws(fake)[0].vao, 2)) as Float32Array
    // The camera looks down (elevation 25): the lower box is farther, and drawn first.
    expect(Array.from(data)).toEqual([0, 0, -0.9, 0.5, 0.5, -0.5, 0, 0, 0.5, 0.5, 0.5, 0.9].map(Math.fround))
    expect(fake.attribBuffer(boxDraws(fake)[0].vao, 3)).toBe(fake.attribBuffer(boxDraws(fake)[0].vao, 2))
  })

  it('frees everything it created on a scene swap and on dispose', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([boxMark(TWO), meshMark([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2])]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const vaos = fake.live.vertexArray.size
    backend.setScene(scene([]), WORLD, LIGHT)
    // the box VAO, its edges' VAO and the mesh's VAO are gone
    expect(vaos - fake.live.vertexArray.size).toBe(3)
    backend.setScene(scene([boxMark(TWO)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    backend.dispose()
    for (const [kind, n] of balance(fake)) expect([kind, n]).toEqual([kind, 0])
  })
})

describe('the box pipeline’s entry points (for the frame loop’s opaque, OIT and sorted translucent passes)', () => {
  const DRAW: BoxDraw = { camera: CAMERA, world: WORLD, colors: LIGHT, look: markLook(CAMERA, WORLD, LIGHT, true) }
  function uploaded(marks: BoxMark[]) {
    const fake = createFakeGl()
    const shared = createSharedQuads(fake.gl)!
    const program = new ProgramCache().get(fake.gl, BOX_PROGRAM.name, BOX_PROGRAM.vertex, BOX_PROGRAM.fragment)
    const gpus = marks.map((m) => uploadBoxes(fake.gl, shared, m, WORLD)!)
    return { fake, program, gpus }
  }
  const mixed = () => [boxMark(TWO, 1, false, 2), boxMark(TWO, 0.6, false, 3), boxMark(TWO.slice(0, 1), 1, false, 4)]

  it('drawOpaqueBoxes draws only the opaque marks, writing depth, unblended, back faces culled', () => {
    const { fake, program, gpus } = uploaded(mixed())
    drawOpaqueBoxes(fake.gl, program, gpus, DRAW)
    expect(fake.draws.map((d) => [d.instances, d.depthWrite, d.blend, d.cull])).toEqual([
      [2, true, false, 'back'],
      [1, true, false, 'back'],
    ])
    expect(fake.draws.map((d) => d.vao)).toEqual([gpus[0].vao, gpus[2].vao])
  })

  it('drawTranslucentBoxes draws only the translucent marks, blended, not writing depth, back faces culled', () => {
    const { fake, program, gpus } = uploaded(mixed())
    drawTranslucentBoxes(fake.gl, program, gpus, DRAW, 'k')
    expect(fake.draws.map((d) => [d.vao, d.instances, d.depthWrite, d.blend, d.cull])).toEqual([[gpus[1].vao, 2, false, true, 'back']])
  })

  it('drawBoxesOit draws only the translucent marks, back faces culled, leaving the blend and depth state to the frame loop', () => {
    const { fake, program, gpus } = uploaded(mixed())
    fake.gl.enable(fake.gl.BLEND)
    fake.gl.depthMask(false)
    drawBoxesOit(fake.gl, program, gpus, DRAW)
    expect(fake.draws.map((d) => [d.vao, d.instances, d.depthWrite, d.blend, d.cull])).toEqual([[gpus[1].vao, 2, false, true, 'back']])
    // u_oit on for the draw, off again after it; culling off again
    const oit = fake.calls.filter((c) => (c.args[0] as { uniform?: string } | null)?.uniform === 'u_oit').map((c) => c.args[1])
    expect(oit).toEqual([1, 0])
    fake.gl.drawArrays(fake.gl.TRIANGLES, 0, 3)
    expect(fake.draws[fake.draws.length - 1]).toMatchObject({ depthWrite: false, blend: true, cull: 'none' })
  })

  it('each leaves the frame loop’s defaults behind, and draws nothing when it has nothing to draw', () => {
    const { fake, program, gpus } = uploaded(mixed())
    drawTranslucentBoxes(fake.gl, program, gpus, DRAW, 'k')
    drawOpaqueBoxes(fake.gl, program, gpus, DRAW)
    fake.gl.drawArrays(fake.gl.TRIANGLES, 0, 3)
    expect(fake.draws[fake.draws.length - 1]).toMatchObject({ depthWrite: true, blend: false, cull: 'none' })
    const empty = uploaded([boxMark(TWO, 1, false)])
    drawTranslucentBoxes(empty.fake.gl, empty.program, empty.gpus, DRAW, 'k')
    drawBoxesOit(empty.fake.gl, empty.program, empty.gpus, DRAW)
    expect(empty.fake.draws).toEqual([])
  })
})

// Integration J4: boxes join S3's frame loop. Opaque boxes draw in the opaque
// pass (polygon offset, as meshes); translucent ones accumulate through
// order-independent transparency, or, without EXT_color_buffer_float, blend
// sorted with the translucent meshes, farthest first.
describe('boxes in the frame loop (integration J4)', () => {
  const DRAW_FNS = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
  const pipelineOf = (fake: FakeGl, d: FakeGl['draws'][number]) => /space: (\w+)/.exec(fake.programSource(d.program).vertex)?.[1] ?? '?'

  // Per draw (in fake.draws order): the uniforms in force on its program, and
  // the blend function in force.
  function stateAtDraws(fake: FakeGl): { uniforms: Record<string, unknown[]>; blendFunc: unknown[] }[] {
    const perProgram = new Map<number, Record<string, unknown[]>>()
    let program = -1
    let blendFunc: unknown[] = []
    const out: { uniforms: Record<string, unknown[]>; blendFunc: unknown[] }[] = []
    for (const c of fake.calls) {
      if (c.fn === 'useProgram') program = (c.args[0] as { id: number } | null)?.id ?? -1
      else if (c.fn === 'blendFunc' || c.fn === 'blendFuncSeparate') blendFunc = c.args
      else if (c.fn.startsWith('uniform')) {
        const name = (c.args[0] as { uniform?: string } | null)?.uniform
        if (!name) continue
        const own = perProgram.get(program) ?? {}
        own[name] = c.args.slice(1)
        perProgram.set(program, own)
      } else if (DRAW_FNS.has(c.fn)) out.push({ uniforms: { ...(perProgram.get(program) ?? {}) }, blendFunc })
    }
    return out
  }

  function square(height: number, opacity: number) {
    return meshMark(
      [-0.5, -0.5, height, 0.5, -0.5, height, 0.5, 0.5, height, -0.5, 0.5, height],
      [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
      [0, 1, 2, 0, 2, 3],
      { style: { opacity } },
    )
  }
  const LOWER: [number[], number[]][] = [[[-0.5, -0.5, -0.9], [0.5, 0.5, -0.5]]]
  const UPPER: [number[], number[]][] = [[[-0.5, -0.5, 0.5], [0.5, 0.5, 0.9]]]

  it('an opaque box draws in the opaque pass, pushed back by polygon offset as meshes are, before a translucent mesh', () => {
    const { fake, backend } = setup()
    // The translucent mesh comes first in the scene; the opaque box still draws first.
    backend.setScene(scene([square(0.2, 0.5), boxMark(UPPER, 1, false)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    const msaa = fake.draws[0].framebuffer
    const box = fake.draws.findIndex((d) => pipelineOf(fake, d) === 'box')
    const mesh = fake.draws.findIndex((d) => pipelineOf(fake, d) === 'mesh')
    expect(box).toBeGreaterThanOrEqual(0)
    expect(box).toBeLessThan(mesh)
    expect(fake.draws[box]).toMatchObject({ polygonOffset: true, depthWrite: true, blend: false, cull: 'back', framebuffer: msaa })
    // the mesh accumulates for OIT, in its own target
    expect(fake.draws[mesh].framebuffer).not.toBe(msaa)
  })

  it('a translucent box goes through the OIT accumulate pass: the OIT target, u_oit on, additive blend, no depth writes, unsorted', () => {
    const { fake, backend } = setup()
    // A translucent box alone makes the OIT target.
    backend.setScene(scene([boxMark(TWO, 0.6, false)]), WORLD, LIGHT)
    // one frame line: the first draw, into the MSAA target
    backend.setFrame({ style: 'box', lines: [{ a: [-1, -1, -1], b: [1, -1, -1], role: 'wall' }], labels: [], key: 'k' }, LIGHT)
    backend.draw(CAMERA, 1)
    const floats = fake.calls.filter((c) => c.fn === 'texStorage2D' && (c.args[2] === GL_CONSTANTS.RGBA16F || c.args[2] === GL_CONSTANTS.R16F))
    expect(floats).toHaveLength(2)
    const msaa = fake.draws[0].framebuffer
    const states = stateAtDraws(fake)
    const i = fake.draws.findIndex((d) => pipelineOf(fake, d) === 'box')
    const draw = fake.draws[i]
    expect(draw.framebuffer).not.toBeNull()
    expect(draw.framebuffer).not.toBe(msaa)
    expect(draw).toMatchObject({ blend: true, depthWrite: false, cull: 'back', polygonOffset: false })
    expect(states[i].uniforms.u_oit).toEqual([1])
    expect(states[i].blendFunc).toEqual([GL_CONSTANTS.ONE, GL_CONSTANTS.ONE, GL_CONSTANTS.ZERO, GL_CONSTANTS.ONE_MINUS_SRC_ALPHA])
    // then the composite, into the canvas
    expect(fake.draws.slice(i + 1).map((d) => pipelineOf(fake, d))).toContain('composite')
    // Order does not matter under OIT: the instances stay in the mark's order.
    const data = fake.bufferContents(fake.attribBuffer(draw.vao, 2)) as Float32Array
    expect(Array.from(data)).toEqual([0, 0, 0.5, 0.5, 0.5, 0.9, 0, 0, -0.9, 0.5, 0.5, -0.5].map(Math.fround))
  })

  it('without EXT_color_buffer_float, translucent boxes and meshes blend together farthest first, after the marks', () => {
    // The camera looks down (elevation 25): the lower thing is the farther.
    const order = (marks: Parameters<typeof scene>[0]) => {
      const { fake, backend } = setup({ colorBufferFloat: false })
      backend.setScene(scene(marks), WORLD, LIGHT)
      backend.draw(CAMERA, 1)
      return fake.draws.filter((d) => d.blend && (pipelineOf(fake, d) === 'box' || pipelineOf(fake, d) === 'mesh')).map((d) => [pipelineOf(fake, d), d.depthWrite])
    }
    // Each mesh draws its back faces, then its front faces.
    expect(order([square(0.7, 0.5), boxMark(LOWER, 0.6, false)])).toEqual([
      ['box', false],
      ['mesh', false],
      ['mesh', false],
    ])
    expect(order([square(-0.7, 0.5), boxMark(UPPER, 0.6, false)])).toEqual([
      ['mesh', false],
      ['mesh', false],
      ['box', false],
    ])
  })

  it('the box shader clips at the box and takes the depth cue, as the mesh shader does', () => {
    const draw = (depthcue: boolean) => {
      const { fake, backend } = setup()
      const world = worldMap({ x: { min: 0, max: 4 }, y: { min: -1, max: 3 }, z: { min: 10, max: 20 } }, [1, 1, 0.7])
      const camera = cameraMatrices({ azimuth: 40, elevation: 25, zoom: 1, target: world.centre }, world, { width: 800, height: 600 }, 'orthographic')
      backend.setScene(scene([boxMark([[[1, 0, 12], [2, 1, 14]]], 1, false), boxMark([[[1, 0, 15], [2, 1, 18]]], 0.5, false, 3)]), world, LIGHT, { depthcue })
      backend.draw(camera, 1)
      const states = stateAtDraws(fake)
      return fake.draws.flatMap((d, i) => (pipelineOf(fake, d) === 'box' ? [states[i].uniforms] : []))
    }
    const on = draw(true)
    expect(on).toHaveLength(2)
    for (const u of on) {
      expect(u.u_clip).toEqual([1])
      // the box (0..4, -1..3, 10..20) relative to its centre (2, 1, 15)
      expect(u.u_clipMin).toEqual([-2, -2, -5])
      expect(u.u_clipMax).toEqual([2, 2, 5])
      expect(u.u_cue).toEqual([0.35])
    }
    for (const u of draw(false)) expect(u.u_cue).toEqual([0])
    for (const glsl of ['outsideBox(v_rel)', 'depthCue(', 'oitWeight(', 'fragWeight']) expect(BOX_PROGRAM.fragment).toContain(glsl)
  })

  it('dispose leaves nothing, with opaque and translucent boxes drawn through OIT', () => {
    const { fake, backend } = setup()
    backend.setScene(scene([boxMark(TWO, 1), boxMark(TWO, 0.6, true, 3), square(0, 0.5)]), WORLD, LIGHT)
    backend.draw(CAMERA, 1)
    expect(fake.draws.some((d) => pipelineOf(fake, d) === 'composite')).toBe(true)
    backend.dispose()
    for (const [kind, n] of balance(fake)) expect([kind, n]).toEqual([kind, 0])
  })
})
