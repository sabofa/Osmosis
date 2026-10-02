import { describe, expect, it, vi } from 'vitest'
import { NO_WEBGL2_MESSAGE } from '../../gl/context'
import { fakeCanvas } from '../../gl/fakeGl'
import { meshMark, scene } from '../../testing/marks'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type PaintFrame, type PaintView, type SceneColours, type StrokeBatch } from '../types'
import { encodeFloatTexel } from './gbuffer'
import { createPaintFakeGl, timeline, type PaintFakeGl } from './fakePaintGl'
import { PaintRenderer } from './PaintRenderer'
import { TEXELS_PER_STROKE } from './shaders/stroke'

const COLOURS: SceneColours = { markColour: () => [0.5, 0.1, 0.1], scaleColour: () => null }
const GL_FLOAT = 0x1406
const GL_UNSIGNED_BYTE = 0x1401
const GL_RGBA = 0x1908
const GL_RED = 0x1903
const GL_TEXTURE0 = 0x84c0

const square = (z: number, opacity = 1) =>
  meshMark([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 3], { style: { opacity } })

// Two opaque squares, a sphere stand-in on a table.
const TWO = scene([square(0), square(-1)])

function view(width = 800, height = 600, pixelRatio = 1): PaintView {
  return {
    viewProj: Float32Array.from([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 1]),
    view: Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]),
    eye: [0, 0, 10],
    viewDir: [0, 0, -1],
    lightDir: [0.3, 0.4, 0.866],
    width,
    height,
    pixelRatio,
    dragging: false,
  }
}

function batch(layers: number[], depths: number[] = layers.map((_, i) => i)): StrokeBatch {
  const n = layers.length
  const b: StrokeBatch = {
    count: n,
    role: Uint8Array.from(layers.map((l) => ROLES.indexOf(LAYER_ORDER[l]))),
    layer: Uint8Array.from(layers),
    path: new Float32Array(n * 2 * PATH_POINTS),
    width: new Float32Array(n * PATH_POINTS).fill(12),
    depth: Float32Array.from(depths),
    colour: new Float32Array(n * 3).fill(0.3),
    alpha: new Float32Array(n).fill(1),
    load: new Float32Array(n).fill(0.9),
    impasto: new Float32Array(n).fill(1),
    bristles: new Float32Array(n).fill(8),
    bristleVar: new Float32Array(n).fill(0.3),
    dry: new Float32Array(n).fill(0.2),
    wet: new Float32Array(n).fill(0.1),
    endSoft: new Float32Array(n),
    edge: new Uint8Array(n).fill(255),
    seed: Uint32Array.from(layers.map((_, i) => 1000 + i)),
    worldPath: new Float32Array(n * 3 * PATH_POINTS),
    worldNormal: new Float32Array(n * 3),
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < PATH_POINTS; k++) {
      b.path[i * 2 * PATH_POINTS + 2 * k] = 100 + 8 * k + i
      b.path[i * 2 * PATH_POINTS + 2 * k + 1] = 100 + 3 * k
    }
  }
  return b
}

function frame(layers: number[], gw = 400, gh = 300, depths?: number[]): PaintFrame {
  const n = gw * gh
  return {
    strokes: batch(layers, depths),
    underpaint: new Float32Array(0),
    debug: {
      value: new Float32Array(n).fill(0.5),
      planes: new Int32Array(n).fill(-1),
      zones: new Uint8Array(n).fill(255),
      edgeSegments: Float32Array.from([10, 10, 60, 10, 10, 20, 60, 25]),
      edgeClass: Uint8Array.from([0, 3]),
    },
    stats: { strokes: layers.length, byRole: {} as PaintFrame['stats']['byRole'], loads: 0 },
  }
}

// A frame with an underpainting: the G-buffer's size, the left half painted a warm colour and the right half empty (NaN).
function withUnder(f: PaintFrame, gw = 400, gh = 300): PaintFrame {
  const image = new Float32Array(3 * gw * gh).fill(Number.NaN)
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw / 2; x++) image.set([0.6, 0.3, 0.1], 3 * (y * gw + x))
  return { ...f, underpaint: image }
}

const PARAMS = DEFAULT_PAINT_PARAMS
const BLOCK = LAYER_ORDER.indexOf('block')
const FORM = LAYER_ORDER.indexOf('form')
const DAB = LAYER_ORDER.indexOf('dab')

function setup(options: Parameters<typeof createPaintFakeGl>[0] = {}) {
  const paint = createPaintFakeGl(options)
  const onError = vi.fn()
  const onContextLost = vi.fn()
  const onContextRestored = vi.fn()
  const renderer = new PaintRenderer(paint.canvas.canvas, { onError, onContextLost, onContextRestored })
  return { paint, renderer, onError, onContextLost, onContextRestored }
}

function balance(paint: PaintFakeGl) {
  const { created, deleted } = paint.fake
  return Object.fromEntries(Object.keys(created).map((k) => [k, created[k as keyof typeof created] - deleted[k as keyof typeof deleted]]))
}

describe('construction', () => {
  it('throws the shown WebGL2 message when there is no WebGL2', () => {
    const canvas = fakeCanvas(null)
    expect(() => new PaintRenderer(canvas.canvas)).toThrow(NO_WEBGL2_MESSAGE)
  })

  it('asks for EXT_color_buffer_float and records it', () => {
    const { paint, renderer } = setup()
    expect(paint.fake.extensionsQueried).toContain('EXT_color_buffer_float')
    expect(renderer.capabilities.colorBufferFloat).toBe(true)
    expect(setup({ colorBufferFloat: false }).renderer.capabilities.colorBufferFloat).toBe(false)
  })
})

describe('pass order', () => {
  it('runs the shadow map, then the G-buffer, then the readback, then the layers in LAYER_ORDER, then the composite', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.renderGBuffer(view(), PARAMS)
    // Strokes given out of order: a dab first, then block, form, block.
    renderer.paint(frame([DAB, BLOCK, FORM, BLOCK]), view(), PARAMS, 'none')
    const kinds = timeline(paint).map((e) => e.kind)
    expect(kinds).toEqual(['shadow', 'shadow', 'gbuffer', 'gbuffer', 'readPixels', 'stroke', 'copy', 'stroke', 'copy', 'stroke', 'composite'])
  })

  it('draws the shadow map into its own framebuffer, the G-buffer into another, and the composite to the canvas', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.renderGBuffer(view(), PARAMS)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    const events = timeline(paint)
    const shadow = events.find((e) => e.kind === 'shadow')?.draw?.framebuffer
    const gbuffer = events.find((e) => e.kind === 'gbuffer')?.draw?.framebuffer
    const composite = events.find((e) => e.kind === 'composite')?.draw?.framebuffer
    expect(shadow).toBeTruthy()
    expect(gbuffer).toBeTruthy()
    expect(shadow?.id).not.toBe(gbuffer?.id)
    expect(composite).toBeNull()
  })

  it('skips the shadow pass when shadows are off', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.renderGBuffer(view(), resolvePaintParams({ light: { shadows: 0 } }))
    expect(timeline(paint).map((e) => e.kind)).toEqual(['gbuffer', 'gbuffer', 'readPixels'])
  })

  it('draws no G-buffer for an empty scene, and no translucent mesh', () => {
    const { paint, renderer } = setup()
    renderer.setScene(scene([square(0, 0.4)]), COLOURS)
    const g = renderer.renderGBuffer(view(), PARAMS)
    expect(paint.fake.draws.length).toBe(0)
    expect(g.mark.every((m) => m === -1)).toBe(true)
    expect(g.width).toBe(400)
  })
})

describe('the stroke layers', () => {
  it('makes one instanced draw per non-empty layer, in LAYER_ORDER, with the layer start and count', () => {
    const { paint, renderer } = setup()
    renderer.paint(frame([DAB, BLOCK, FORM, BLOCK, BLOCK]), view(), PARAMS, 'none')
    const strokes = timeline(paint).filter((e) => e.kind === 'stroke')
    expect(strokes.length).toBe(3)
    expect(strokes.map((e) => e.draw?.fn)).toEqual(['drawArraysInstanced', 'drawArraysInstanced', 'drawArraysInstanced'])
    // block x3 from slot 0, form x1 from slot 3, dab x1 from slot 4
    expect(strokes.map((e) => e.uniforms.u_base)).toEqual([[0], [3], [4]])
    expect(strokes.map((e) => e.draw?.instances)).toEqual([3, 1, 1])
    expect(renderer.stats.strokeDraws).toBe(3)
    expect(renderer.stats.strokes).toBe(5)
  })

  it('draws no layer for a layer with no strokes, and nothing at all for an empty batch', () => {
    const { paint, renderer } = setup()
    renderer.paint(frame([]), view(), PARAMS, 'none')
    expect(timeline(paint).map((e) => e.kind)).toEqual(['composite'])
  })

  it('ping-pongs two targets between layers: A, B, A, with each layer copied forward before it draws', () => {
    const { paint, renderer } = setup()
    renderer.paint(frame([BLOCK, FORM, DAB]), view(), PARAMS, 'none')
    const events = timeline(paint)
    const strokes = events.filter((e) => e.kind === 'stroke')
    const targets = strokes.map((e) => e.draw?.framebuffer?.id)
    expect(targets[0]).toBeDefined()
    expect(targets[1]).toBeDefined()
    expect(targets[0]).not.toBe(targets[1])
    expect(targets[2]).toBe(targets[0])
    // The copy before the 2nd layer lands in the 2nd layer's target, and so on.
    const copies = events.filter((e) => e.kind === 'copy')
    expect(copies.map((e) => e.draw?.framebuffer?.id)).toEqual([targets[1], targets[2]])
    // The composite reads the last layer's target: it was the last one drawn into.
    expect(events[events.length - 1].kind).toBe('composite')
  })

  it('blends strokes (premultiplied: ONE, ONE_MINUS_SRC_ALPHA) and the layer copy replaces', () => {
    const { paint, renderer } = setup()
    renderer.paint(frame([BLOCK, FORM]), view(), PARAMS, 'none')
    const events = timeline(paint)
    for (const e of events.filter((x) => x.kind === 'stroke')) expect(e.draw?.blend).toBe(true)
    for (const e of events.filter((x) => x.kind === 'copy')) expect(e.draw?.blend).toBe(false)
    const blendCalls = paint.fake.calls.filter((c) => c.fn === 'blendFunc')
    expect(blendCalls.length).toBeGreaterThan(0)
    for (const c of blendCalls) expect(c.args).toEqual([1, 0x0303])
  })

  it('uploads the strokes sorted: layers in order and the farthest first within a layer', () => {
    const { paint, renderer } = setup()
    // block depths 3 and 8; form depth 5. Sorted slots: block(8), block(3), form(5).
    const b = frame([BLOCK, FORM, BLOCK], 400, 300, [3, 5, 8])
    b.strokes.path[0] = 111 // stroke 0 (block, depth 3), point 0 x
    b.strokes.path[2 * PATH_POINTS] = 222 // stroke 1 (form, depth 5)
    b.strokes.path[4 * PATH_POINTS] = 333 // stroke 2 (block, depth 8)
    renderer.paint(b, view(), PARAMS, 'none')
    const upload = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_FLOAT).pop()
    const data = upload?.args[8] as Float32Array
    const slot = (n: number) => data[n * TEXELS_PER_STROKE * 4]
    expect([slot(0), slot(1), slot(2)]).toEqual([333, 111, 222])
  })

  it('uploads identical stroke data for identical input (no time, no randomness)', () => {
    const run = () => {
      const { paint, renderer } = setup()
      renderer.paint(frame([BLOCK, FORM, BLOCK, DAB]), view(), PARAMS, 'none')
      const upload = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[7] === GL_FLOAT && c.args[6] === GL_RGBA).pop()
      return Array.from(upload?.args[8] as Float32Array)
    }
    const a = run()
    expect(a.length).toBeGreaterThan(0)
    expect(run()).toEqual(a)
  })
})

describe('the underpainting', () => {
  const uniformsOf = (events: ReturnType<typeof timeline>, kind: string) => events.find((e) => e.kind === kind)?.uniforms ?? {}

  it('is laid first, before the block-in, into the first target; the first layer then copies it forward and draws over it', () => {
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none')
    const events = timeline(paint)
    expect(events.map((e) => e.kind)).toEqual(['underpaint', 'copy', 'stroke', 'copy', 'stroke', 'composite'])
    const target = (kind: string, nth: number) => events.filter((e) => e.kind === kind)[nth].draw?.framebuffer?.id
    // underpaint in A, block in B (A copied into it first), form back in A (B copied into it)
    expect(target('underpaint', 0)).toBeDefined()
    expect(target('stroke', 0)).not.toBe(target('underpaint', 0))
    expect(target('copy', 0)).toBe(target('stroke', 0))
    expect(target('stroke', 1)).toBe(target('underpaint', 0))
    expect(target('copy', 1)).toBe(target('stroke', 1))
    // the strokes are still the strokes: a draw per layer with its own range
    expect(events.filter((e) => e.kind === 'stroke').map((e) => e.uniforms.u_base)).toEqual([[0], [1]])
    expect(renderer.stats.strokeDraws).toBe(2)
  })

  it('is laid even when there is not a stroke, and then goes straight to the composite', () => {
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([])), view(), PARAMS, 'none')
    expect(timeline(paint).map((e) => e.kind)).toEqual(['underpaint', 'composite'])
  })

  it('draws with no blending (nothing is under it) and one fullscreen triangle', () => {
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    const draw = timeline(paint)[0].draw
    expect(draw).toMatchObject({ fn: 'drawArrays', count: 3, blend: false })
  })

  it('is left out of the flat role view, where it would muddy the role colours, and of a frame without one', () => {
    const roles = setup()
    roles.renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'roles')
    expect(timeline(roles.paint).map((e) => e.kind)).toEqual(['stroke', 'composite'])
    // an image that is empty, the wrong size, or all NaN is not laid
    for (const image of [new Float32Array(0), new Float32Array(3 * 10 * 10), new Float32Array(3 * 400 * 300).fill(Number.NaN)]) {
      const { paint, renderer } = setup()
      renderer.paint({ ...frame([BLOCK]), underpaint: image }, view(), PARAMS, 'none')
      expect(timeline(paint).map((e) => e.kind), String(image.length)).toEqual(['stroke', 'composite'])
    }
  })

  it('is uploaded once for one image, however many times the frame is painted, and again for a new one', () => {
    const { paint, renderer } = setup()
    const uploads = () => paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE && c.args[4] === 400 && c.args[5] === 300).length
    const f = withUnder(frame([BLOCK]))
    renderer.paint(f, view(), PARAMS, 'none')
    renderer.paint(f, view(), PARAMS, 'none')
    expect(uploads()).toBe(1)
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    expect(uploads()).toBe(2)
  })

  it('uploads sRGB colour with coverage 255 where the form is and 0 where it is not', () => {
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    const upload = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE && c.args[4] === 400).pop()
    const rgba = upload?.args[8] as Uint8Array
    // linear (0.6, 0.3, 0.1) as sRGB bytes: 0.7977, 0.5839, 0.3492 of 255
    expect(Array.from(rgba.subarray(0, 4))).toEqual([203, 149, 89, 255])
    // the first empty texel (x = 200) is not covered, but has its neighbour's colour so the filtered edge does not go dark
    expect(Array.from(rgba.subarray(4 * 200, 4 * 200 + 4))).toEqual([203, 149, 89, 0])
    // two texels beyond the form's edge there is nothing to take
    expect(Array.from(rgba.subarray(4 * 203, 4 * 203 + 4))).toEqual([0, 0, 0, 0])
  })

  it('reads its opacity, streaks and the canvas texture from the parameters, and a seeded direction', () => {
    const params = resolvePaintParams({ underpaint: { opacity: 0.5, streak: 0.2 }, canvas: { texture: 0.7 }, seed: 7 })
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([BLOCK])), view(), params, 'none')
    const u = uniformsOf(timeline(paint), 'underpaint')
    expect(u.u_opacity).toEqual([0.5])
    expect(u.u_streak).toEqual([0.2])
    expect(u.u_texture).toEqual([0.7])
    const dir = u.u_dir as number[]
    expect(Math.hypot(dir[0], dir[1])).toBeCloseTo(1, 6)
    expect(u.u_uvScale).toEqual([1, 1])
    expect(u.u_resolution).toEqual([800, 600])
    // another seed brushes another way, the same seed the same way
    const again = setup()
    again.renderer.paint(withUnder(frame([BLOCK])), view(), params, 'none')
    expect(uniformsOf(timeline(again.paint), 'underpaint').u_dir).toEqual(dir)
    const other = setup()
    other.renderer.paint(withUnder(frame([BLOCK])), view(), resolvePaintParams({ seed: 8 }), 'none')
    expect(uniformsOf(timeline(other.paint), 'underpaint').u_dir).not.toEqual(dir)
  })

  it('draws the same uploads and uniforms for the same frame (no time, no randomness)', () => {
    const run = () => {
      const { paint, renderer } = setup()
      renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none')
      return JSON.stringify(paint.fake.calls.filter((c) => c.fn.startsWith('uniform') || c.fn === 'texSubImage2D').map((c) => [c.fn, c.args.map((a) => (ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>).slice(0, 64) : a))]))
    }
    expect(run()).toBe(run())
  })
})

describe('setScene', () => {
  it('uploads a scene once: the same scene object again re-uploads nothing, a new one replaces it', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    const vaos = paint.fake.created.vertexArray
    renderer.setScene(TWO, COLOURS)
    expect(paint.fake.created.vertexArray).toBe(vaos)
    renderer.setScene(scene([square(0), square(-1)]), COLOURS)
    expect(paint.fake.created.vertexArray).toBe(vaos + 2)
    // The replaced scene's VAOs are freed.
    expect(paint.fake.deleted.vertexArray).toBe(2)
  })
})

describe('the G-buffer readback', () => {
  // A known 2 x 2 G-buffer: the view is 4 x 4 css px, so the grid is 2 x 2.
  const texels = [
    encodeFloatTexel({ normal: [0, 0, 1], depth: 12.5, value: 0.5, shadow: false, mark: 1 }),
    [0, 0, 1e30, 0],
    encodeFloatTexel({ normal: [1, 0, 0], depth: 4, value: 1, shadow: true, mark: 0 }),
    encodeFloatTexel({ normal: [0, -1, 0], depth: 9.25, value: 0, shadow: false, mark: 1 }),
  ]

  it('packs the readback into the GBuffer arrays: one readPixels of RGBA float at 2 x 2', () => {
    const { paint, renderer } = setup()
    paint.setReadback((_a, _w, _h, dst) => (dst as Float32Array).set(texels.flat()))
    renderer.setScene(TWO, COLOURS)
    const g = renderer.renderGBuffer(view(4, 4), PARAMS)
    expect(paint.reads).toEqual([{ attachment: 0, width: 2, height: 2, type: GL_FLOAT }])
    expect([g.width, g.height, g.scale]).toEqual([2, 2, 2])
    expect(Array.from(g.mark)).toEqual([1, -1, 0, 1])
    expect(Array.from(g.depth)).toEqual([12.5, Infinity, 4, 9.25])
    expect(Array.from(g.shadow)).toEqual([0, 0, 1, 0])
    expect(Array.from(g.value).map((v) => +v.toFixed(3))).toEqual([0.5, -1, 1, 0])
    expect(Array.from(g.normal).map((v) => +v.toFixed(5))).toEqual([0, 0, 1, 0, 0, 0, 1, 0, 0, 0, -1, 0])
  })

  it('falls back to three RGBA8 targets and three byte readbacks without float targets', () => {
    const { paint, renderer } = setup({ colorBufferFloat: false })
    renderer.setScene(TWO, COLOURS)
    const g = renderer.renderGBuffer(view(4, 4), PARAMS)
    expect(renderer.stats.gbuffer).toBe('rgba8')
    expect(paint.reads.map((r) => [r.attachment, r.type])).toEqual([[0, GL_UNSIGNED_BYTE], [1, GL_UNSIGNED_BYTE], [2, GL_UNSIGNED_BYTE]])
    const drawBuffers = paint.fake.calls.filter((c) => c.fn === 'drawBuffers').map((c) => (c.args[0] as number[]).length)
    expect(drawBuffers).toContain(3)
    // All-zero readbacks are an empty G-buffer.
    expect(g.mark.every((m) => m === -1)).toBe(true)
    const gbufferProgram = timeline(paint).find((e) => e.kind === 'gbuffer')?.draw?.program
    expect(paint.fake.programSource(gbufferProgram ?? null).fragment).toContain('(rgba8)')
  })

  it('uses the float layout when float targets exist', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.renderGBuffer(view(4, 4), PARAMS)
    expect(renderer.stats.gbuffer).toBe('float')
    const gbufferProgram = timeline(paint).find((e) => e.kind === 'gbuffer')?.draw?.program
    expect(paint.fake.programSource(gbufferProgram ?? null).fragment).toContain('(float)')
  })

  it('uses 8-bit accumulation targets without float targets, and float ones with', () => {
    const a = setup()
    a.renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(a.renderer.stats.accumFloat).toBe(true)
    const b = setup({ colorBufferFloat: false })
    b.renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(b.renderer.stats.accumFloat).toBe(false)
  })
})

describe('debug views', () => {
  function uploads(paint: PaintFakeGl) {
    return paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE)
  }

  it("'value' shows the model's value (frame.debug.value), not the renderer's GBuffer.value", () => {
    const { paint, renderer } = setup()
    // The renderer's own G-buffer says u = 1 everywhere it draws.
    paint.setReadback((_a, _w, _h, dst) => {
      const t = encodeFloatTexel({ normal: [0, 0, 1], depth: 3, value: 1, shadow: false, mark: 0 })
      const f = dst as Float32Array
      for (let i = 0; i < f.length; i += 4) f.set(t, i)
    })
    renderer.setScene(TWO, COLOURS)
    renderer.renderGBuffer(view(4, 4), PARAMS)
    const f = frame([BLOCK], 2, 2)
    f.debug.value.set([0.5, -1, 0.5, 0.5])
    renderer.paint(f, view(4, 4), PARAMS, 'value')
    const image = uploads(paint).pop()?.args[8] as Uint8Array
    // u = 0.5 -> OKLab L 0.54 -> grey 111; -1 is empty -> transparent.
    expect(Array.from(image.subarray(0, 4))).toEqual([111, 111, 111, 255])
    expect(image[7]).toBe(0)
    // And no stroke pass ran: a debug image only.
    expect(timeline(paint).filter((e) => e.kind === 'stroke').length).toBe(0)
    expect(timeline(paint).filter((e) => e.kind === 'image').length).toBe(1)
  })

  it("'edges' draws the plane tint and then the segments with their classes", () => {
    const { paint, renderer } = setup()
    renderer.paint(frame([BLOCK], 400, 300), view(), PARAMS, 'edges')
    const kinds = timeline(paint).map((e) => e.kind)
    expect(kinds).toEqual(['image', 'edges'])
    const edges = timeline(paint).find((e) => e.kind === 'edges')
    expect(edges?.draw?.instances).toBe(2)
    expect(edges?.draw?.fn).toBe('drawArraysInstanced')
  })

  it("'zones' and 'planes' draw one image each", () => {
    for (const mode of ['zones', 'planes'] as const) {
      const { paint, renderer } = setup()
      renderer.paint(frame([BLOCK]), view(), PARAMS, mode)
      expect(timeline(paint).map((e) => e.kind)).toEqual(['image'])
    }
  })

  it("'roles' flat-colours the strokes over a flat tone with no relief; 'grey' and 'paint-only' set their composite flags", () => {
    const flags = (mode: 'none' | 'roles' | 'grey' | 'paint-only') => {
      const { paint, renderer } = setup()
      renderer.paint(frame([BLOCK, FORM]), view(), PARAMS, mode)
      const events = timeline(paint)
      const stroke = events.find((e) => e.kind === 'stroke')
      const composite = events.find((e) => e.kind === 'composite')
      const u = (e: typeof stroke, name: string) => e?.uniforms[name]?.[0]
      return {
        debugRoles: u(stroke, 'u_debugRoles'),
        noCanvas: u(composite, 'u_noCanvas'),
        relief: u(composite, 'u_relief'),
        grey: u(composite, 'u_grey'),
      }
    }
    expect(flags('none')).toEqual({ debugRoles: 0, noCanvas: 0, relief: 1, grey: 0 })
    expect(flags('roles')).toEqual({ debugRoles: 1, noCanvas: 1, relief: 0, grey: 0 })
    expect(flags('grey')).toEqual({ debugRoles: 0, noCanvas: 0, relief: 1, grey: 1 })
    expect(flags('paint-only')).toEqual({ debugRoles: 0, noCanvas: 1, relief: 1, grey: 0 })
  })

  it('passes the impasto strength, canvas texture and relief light to the composite', () => {
    const { paint, renderer } = setup()
    const params = resolvePaintParams({ impasto: { strength: 1.7, lightAzimuth: 90, lightElevation: 45 }, canvas: { texture: 0.6 } })
    renderer.paint(frame([BLOCK]), view(), params, 'none')
    const composite = timeline(paint).find((e) => e.kind === 'composite')
    expect(composite?.uniforms.u_impasto).toEqual([1.7])
    expect(composite?.uniforms.u_texture).toEqual([0.6])
    // Azimuth 90 (up on screen, y down in image coordinates), elevation 45.
    const light = composite?.uniforms.u_light as number[]
    expect(light[0]).toBeCloseTo(0, 6)
    expect(light[1]).toBeCloseTo(-Math.SQRT1_2, 6)
    expect(light[2]).toBeCloseTo(Math.SQRT1_2, 6)
  })
})

describe('size and paper', () => {
  it('follows the canvas client size times the pixel ratio, and rebuilds the targets on a resize', () => {
    const { paint, renderer } = setup()
    const canvas = paint.canvas.canvas as unknown as { width: number; height: number; clientWidth: number; clientHeight: number }
    renderer.paint(frame([BLOCK]), view(800, 600, 2), PARAMS, 'none')
    expect([canvas.width, canvas.height]).toEqual([1600, 1200])
    const before = paint.fake.created.framebuffer
    canvas.clientWidth = 400
    canvas.clientHeight = 300
    renderer.paint(frame([BLOCK]), view(400, 300, 2), PARAMS, 'none')
    expect([canvas.width, canvas.height]).toEqual([800, 600])
    expect(paint.fake.created.framebuffer).toBeGreaterThan(before)
    expect(paint.fake.deleted.framebuffer).toBeGreaterThan(0)
  })

  it('uploads the paper tile with its height normalised to mean 0 and standard deviation 0.2', () => {
    const { paint, renderer } = setup()
    const size = 4
    const rgba = new Uint8ClampedArray(size * size * 4).fill(200)
    const height = Float32Array.from({ length: size * size }, (_, i) => (i % 2 === 0 ? 0.25 : 0.75))
    renderer.setPaper(rgba, height, size)
    const up = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RED && c.args[7] === GL_FLOAT).pop()
    const data = up?.args[8] as Float32Array
    // Values 0.25 / 0.75 have mean 0.5 and std 0.25, so they become -0.2 and +0.2.
    expect(data[0]).toBeCloseTo(-0.2, 6)
    expect(data[1]).toBeCloseTo(0.2, 6)
  })

  it('reports a paper tile whose arrays are too short, and keeps painting', () => {
    const { paint, renderer, onError } = setup()
    renderer.setPaper(new Uint8ClampedArray(4), new Float32Array(1), 8)
    expect(onError).toHaveBeenCalledTimes(1)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(timeline(paint).some((e) => e.kind === 'composite')).toBe(true)
  })
})

describe('the canvas mottle', () => {
  it('makes a blurred copy of the tile, repeating, and gives it to the composite with the copy’s turn, scale and shift', () => {
    const { paint, renderer } = setup()
    const size = 128
    const rgba = new Uint8ClampedArray(size * size * 4).fill(200)
    renderer.setPaper(rgba, new Float32Array(size * size).fill(0.5), size)
    // three textures: the tile, its height, and the blur (MOTTLE_SIZE across)
    const uploads = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE)
    expect(uploads.map((c) => [c.args[4], c.args[5]])).toEqual([[128, 128], [64, 64]])
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    const composite = timeline(paint).filter((e) => e.kind === 'composite').pop()!
    expect(composite.uniforms.u_paperLow).toEqual([4])
    const m = composite.uniforms.u_mottle as number[]
    expect(m[0]).toBeCloseTo(Math.cos((31 * Math.PI) / 180), 6)
    expect(m[1]).toBeCloseTo(Math.sin((31 * Math.PI) / 180), 6)
    expect(m[2]).toBeCloseTo(0.73, 6)
    expect(composite.uniforms.u_mottleShift).toEqual([0.37, 0.61])
    // the blur is bound to the unit it was told (4) before the composite draws
    const draws = paint.fake.calls.map((c, i) => ({ c, i }))
    const lastComposite = draws.filter((d) => d.c.fn === 'drawArrays').pop()!.i
    const bindUnit4 = draws.filter((d) => d.i < lastComposite && d.c.fn === 'activeTexture' && d.c.args[0] === GL_TEXTURE0 + 4)
    expect(bindUnit4.length).toBeGreaterThan(0)
  })

  it('blurs the tile with an area average: a checker of 0 and 200 is 100 everywhere in the blur', () => {
    const { paint, renderer } = setup()
    const size = 128
    const rgba = new Uint8ClampedArray(size * size * 4)
    for (let i = 0; i < size * size; i++) rgba.set([(i + Math.floor(i / size)) % 2 === 0 ? 0 : 200, 100, 50, 255], 4 * i)
    renderer.setPaper(rgba, new Float32Array(size * size).fill(0.5), size)
    const blur = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE && c.args[4] === 64).pop()!
    const data = blur.args[8] as Uint8Array
    expect(data[0]).toBe(100)
    expect(data[1]).toBe(100)
    expect(data[2]).toBe(50)
    expect(data[3]).toBe(255)
    expect(data[4 * 1000]).toBe(100)
  })

  it('frees the blur with the tile when the paper is replaced and on dispose', () => {
    const { paint, renderer } = setup()
    renderer.setPaper(new Uint8ClampedArray(64 * 64 * 4).fill(200), new Float32Array(64 * 64).fill(0.5), 64)
    const made = paint.fake.created.texture
    renderer.setPaper(new Uint8ClampedArray(64 * 64 * 4).fill(180), new Float32Array(64 * 64).fill(0.5), 64)
    // the first paper's three textures are gone, a new three made
    expect(paint.fake.created.texture).toBe(made + 3)
    expect(paint.fake.deleted.texture).toBe(3)
    renderer.dispose()
    expect(paint.fake.created.texture - paint.fake.deleted.texture).toBe(0)
  })
})

describe('a re-projected frame (the orbit): the strokes are put through the new view’s depth, and the underpainting is warped', () => {
  // the G-buffer of view() (800 x 600) is 400 x 300; the old frame's depth is a flat 5
  const OLD_DEPTH = () => new Float32Array(400 * 300).fill(5)
  const reproject = (depth = OLD_DEPTH()) => ({ from: view(800, 600), depth })
  const kindsOf = (paint: PaintFakeGl) => timeline(paint).map((e) => e.kind)

  function scene2() {
    const ctx = setup()
    ctx.renderer.setScene(TWO, COLOURS)
    return ctx
  }

  it('draws the depth pass of the opaque meshes first, into a framebuffer of its own, with the depth test on, then the underpainting and the strokes', () => {
    const { paint, renderer } = scene2()
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none', reproject())
    const events = timeline(paint)
    const kinds = events.map((e) => e.kind)
    // the two meshes of the scene, then the warped underpainting, then a draw per layer (each copied forward first, the
    // first layer too: it copies the underpainting), then the composite
    expect(kinds).toEqual(['depth', 'depth', 'underpaint', 'copy', 'stroke', 'copy', 'stroke', 'composite'])
    const depth = events.filter((e) => e.kind === 'depth')
    expect(depth.every((e) => e.draw?.depthTest === true && e.draw.depthWrite === true && e.draw.blend === false)).toBe(true)
    expect(depth.every((e) => e.draw?.fn === 'drawElements')).toBe(true)
    // into a framebuffer that is neither a paint target nor the canvas
    const accum = events.filter((e) => e.kind === 'stroke' || e.kind === 'underpaint').map((e) => e.draw?.framebuffer?.id)
    expect(depth[0].draw?.framebuffer).toBeTruthy()
    expect(accum).not.toContain(depth[0].draw?.framebuffer?.id)
    expect(renderer.stats.depthTested).toBe(true)
    expect(renderer.stats.underpaintWarped).toBe(true)
  })

  it('clears the depth target to no surface (1e30) and the depth buffer, and draws with the view’s matrix, direction and base', () => {
    const { paint, renderer } = scene2()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none', reproject())
    const clear = paint.fake.calls.find((c) => c.fn === 'clearBufferfv' && (c.args[2] as Float32Array)[0] > 1e29)
    expect(clear).toBeDefined()
    const depth = timeline(paint).find((e) => e.kind === 'depth')!
    expect(depth.uniforms.u_viewDir).toEqual([0, 0, -1])
    // the matrix is the view's with the scene's origin folded in (a flat scene: origin (0, 0, -0.5))
    const m = depth.uniforms.u_viewProj![1] as Float32Array
    expect(m.length).toBe(16)
    expect(m[12]).toBeCloseTo(0, 6)
    expect(depth.uniforms.u_depthBase).toBeDefined()
  })

  it('tells the depth pass which mesh is bare table (u_ground) for the warp to leave the lit table as canvas', () => {
    const ctx = setup()
    const tilted = meshMark([-1, -1, 0, 1, -1, 0, 1, 1, 0.3, -1, 1, 0.3], [0.2, 0, 0.98, 0.2, 0, 0.98, 0.2, 0, 0.98, 0.2, 0, 0.98], [0, 1, 2, 0, 2, 3])
    ctx.renderer.setScene(scene([square(0), tilted]), COLOURS)
    ctx.renderer.paint(frame([BLOCK]), view(), PARAMS, 'none', reproject())
    const grounds = timeline(ctx.paint).filter((e) => e.kind === 'depth').map((e) => e.uniforms.u_ground)
    expect(grounds).toEqual([[1], [0]])
  })

  it('tests every stroke draw against the depth: u_depthTest on, with the view direction, eye·direction and a bias of a hundredth of the radius', () => {
    const { paint, renderer } = scene2()
    renderer.paint(frame([BLOCK, FORM, DAB]), view(), PARAMS, 'none', reproject())
    const strokes = timeline(paint).filter((e) => e.kind === 'stroke')
    expect(strokes.length).toBe(3)
    for (const s of strokes) {
      expect(s.uniforms.u_depthTest).toEqual([1])
      expect(s.uniforms.u_viewDir).toEqual([0, 0, -1])
      // eye (0, 0, 10) . viewDir (0, 0, -1) = -10
      expect(s.uniforms.u_eyeDot).toEqual([-10])
      const bias = s.uniforms.u_depthBias![0] as number
      expect(bias).toBeGreaterThan(0)
      expect(bias).toBeLessThan(0.1)
      expect(s.uniforms.u_sceneDepth).toEqual([4])
    }
  })

  it('draws neither a depth pass nor a test for a frame made for its own view, and the plain underpainting', () => {
    const { paint, renderer } = scene2()
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none')
    const events = timeline(paint)
    expect(events.some((e) => e.kind === 'depth')).toBe(false)
    for (const s of events.filter((e) => e.kind === 'stroke')) expect(s.uniforms.u_depthTest).toEqual([0])
    const under = events.find((e) => e.kind === 'underpaint')!
    expect(paint.fake.programSource(under.draw!.program).fragment).not.toContain('#define WARP')
    expect(under.uniforms.u_invVP).toBeUndefined()
    expect(renderer.stats.depthTested).toBe(false)
    expect(renderer.stats.underpaintWarped).toBe(false)
  })

  it('warps the underpainting through the new view’s depth and the old frame’s depth, with both views’ matrices and the mean colour', () => {
    const { paint, renderer } = scene2()
    const from = view(800, 600)
    // the old view is a different one: its viewProj has a different scale, so the warp's matrices differ from the new view's
    from.viewProj = Float32Array.from([0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 1])
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', { from, depth: OLD_DEPTH() })
    const under = timeline(paint).find((e) => e.kind === 'underpaint')!
    expect(paint.fake.programSource(under.draw!.program).fragment).toContain('#define WARP')
    expect(under.draw?.blend).toBe(false)
    const oldVP = under.uniforms.u_oldVP![1] as Float32Array
    expect(oldVP[0]).toBeCloseTo(0.25, 6)
    const invVP = under.uniforms.u_invVP![1] as Float32Array
    expect(invVP.length).toBe(16)
    // the inverse of the new view's diag(0.5, 0.5, -0.1, 1): diag(2, 2, -10, 1)
    expect(invVP[0]).toBeCloseTo(2, 5)
    expect(invVP[10]).toBeCloseTo(-10, 4)
    expect(under.uniforms.u_oldCss).toEqual([800, 600])
    // the image is 400 x 300 G-buffer texels of two CSS px
    expect(under.uniforms.u_gridCss).toEqual([800, 600])
    // withUnder paints the left half (0.6, 0.3, 0.1): its mean sRGB colour
    const fallback = under.uniforms.u_fallback as number[]
    expect(fallback[0]).toBeCloseTo(Math.round(255 * (1.055 * 0.6 ** (1 / 2.4) - 0.055)) / 255, 3)
    expect(under.uniforms.u_oldViewDir).toEqual([0, 0, -1])
    expect(under.uniforms.u_depthBias![0]).toBeGreaterThan(0)
  })

  it('uploads the old frame’s depth once however many times the frame is painted, and again for another one', () => {
    const { paint, renderer } = scene2()
    const uploads = () => paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RED && c.args[7] === GL_FLOAT && c.args[4] === 400 && c.args[5] === 300).length
    const depth = OLD_DEPTH()
    for (let i = 0; i < 3; i++) renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', { from: view(800, 600), depth })
    expect(uploads()).toBe(1)
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', { from: view(800, 600), depth: OLD_DEPTH() })
    expect(uploads()).toBe(2)
  })

  it('tests the strokes and lays no underpainting where the frame has none (an empty image): no warp, no error', () => {
    const { paint, renderer, onError } = scene2()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none', reproject())
    expect(kindsOf(paint)).toEqual(['depth', 'depth', 'stroke', 'composite'])
    expect(renderer.stats.depthTested).toBe(true)
    expect(renderer.stats.underpaintWarped).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('tests the flat role view too, and leaves out the underpainting there', () => {
    const { paint, renderer } = scene2()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'roles', reproject())
    expect(kindsOf(paint)).toEqual(['depth', 'depth', 'stroke', 'composite'])
    expect(timeline(paint).find((e) => e.kind === 'stroke')!.uniforms.u_depthTest).toEqual([1])
  })

  it('paints the strokes untested, without an error, when the context cannot render to float (no depth pass is possible)', () => {
    const paint = createPaintFakeGl({ colorBufferFloat: false })
    const onError = vi.fn()
    const renderer = new PaintRenderer(paint.canvas.canvas, { onError })
    renderer.setScene(TWO, COLOURS)
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', reproject())
    expect(timeline(paint).some((e) => e.kind === 'depth')).toBe(false)
    expect(timeline(paint).filter((e) => e.kind === 'stroke').every((e) => e.uniforms.u_depthTest?.[0] === 0)).toBe(true)
    expect(renderer.stats.depthTested).toBe(false)
    expect(onError).not.toHaveBeenCalled()
    renderer.dispose()
  })

  it('does not test a frame when the renderer has no scene to draw the depth of', () => {
    const { paint, renderer } = setup()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', reproject())
    expect(timeline(paint).some((e) => e.kind === 'depth')).toBe(false)
    expect(renderer.stats.depthTested).toBe(false)
  })

  it('frees the depth target and the old depth with the renderer', () => {
    const { paint, renderer } = scene2()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none', reproject())
    expect(Object.values(balance(paint)).some((n) => n > 0)).toBe(true)
    renderer.dispose()
    expect(balance(paint)).toEqual({ buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 })
  })

  it('rebuilds the depth target after the context is lost and restored, and draws the depth pass again', () => {
    const { paint, renderer } = scene2()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none', reproject())
    paint.fake.lose()
    paint.fake.restore()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none', reproject())
    expect(timeline(paint).filter((e) => e.kind === 'depth').length).toBe(4)
  })
})

describe('lifecycle', () => {
  function everything() {
    const ctx = setup()
    ctx.paint.setReadback((_a, _w, _h, dst) => (dst as Float32Array).fill(0))
    ctx.renderer.setScene(TWO, COLOURS)
    ctx.renderer.setPaper(new Uint8ClampedArray(4 * 4).fill(220), new Float32Array(4).fill(0.5), 2)
    ctx.renderer.renderGBuffer(view(), PARAMS)
    for (const mode of ['none', 'edges', 'value', 'roles'] as const) ctx.renderer.paint(withUnder(frame([BLOCK, FORM, DAB])), view(), PARAMS, mode)
    return ctx
  }

  it('dispose deletes every object it created and releases the context once', () => {
    const { paint, renderer } = everything()
    const live = balance(paint)
    expect(Object.values(live).some((n) => n > 0)).toBe(true)
    renderer.dispose()
    expect(balance(paint)).toEqual({ buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 })
    expect(paint.fake.loseContextCalls).toBe(1)
    renderer.dispose()
    expect(paint.fake.loseContextCalls).toBe(1)
  })

  it('does nothing after dispose, and does not throw', () => {
    const { paint, renderer } = everything()
    renderer.dispose()
    const draws = paint.fake.draws.length
    expect(() => {
      renderer.renderGBuffer(view(), PARAMS)
      renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
      renderer.setScene(TWO, COLOURS)
    }).not.toThrow()
    expect(paint.fake.draws.length).toBe(draws)
  })

  it('unsubscribes from the context events on dispose', () => {
    const { paint, renderer } = setup()
    expect(paint.canvas.listenerCount('webglcontextlost')).toBe(1)
    renderer.dispose()
    expect(paint.canvas.listenerCount('webglcontextlost')).toBe(0)
    expect(paint.canvas.listenerCount('webglcontextrestored')).toBe(0)
  })

  it('a lost context prevents the default, tells the host, and issues no GL call that errors; a restore rebuilds and draws again', () => {
    const { paint, renderer, onContextLost, onContextRestored } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setPaper(new Uint8ClampedArray(4 * 4).fill(220), new Float32Array(4).fill(0.5), 2)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    const event = paint.canvas.lose()
    expect(event.defaultPrevented).toBe(true)
    expect(onContextLost).toHaveBeenCalledTimes(1)
    const errorsBefore = paint.fake.errors.length
    renderer.renderGBuffer(view(), PARAMS)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    renderer.setScene(TWO, COLOURS)
    expect(paint.fake.errors.length).toBe(errorsBefore)
    paint.canvas.restore()
    expect(onContextRestored).toHaveBeenCalledTimes(1)
    const draws = paint.fake.draws.length
    renderer.renderGBuffer(view(), PARAMS)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(paint.fake.draws.length).toBeGreaterThan(draws)
    // The scene was re-uploaded: the shadow and G-buffer passes drew its two meshes.
    expect(timeline(paint).filter((e) => e.kind === 'gbuffer').length).toBe(2)
    // The extension was asked for again after the restore.
    expect(paint.fake.extensionsQueried.filter((n) => n === 'EXT_color_buffer_float').length).toBeGreaterThanOrEqual(2)
  })

  it('reports a shader failure through onError, draws nothing, and never throws', () => {
    const { paint, renderer, onError } = setup({ failCompile: true })
    renderer.setScene(TWO, COLOURS)
    expect(() => {
      renderer.renderGBuffer(view(), PARAMS)
      renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    }).not.toThrow()
    expect(onError).toHaveBeenCalled()
    expect(onError.mock.calls[0][0]).toContain('failed to compile')
    expect(paint.fake.draws.length).toBe(0)
  })
})
