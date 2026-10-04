import { describe, expect, it, vi } from 'vitest'
import { NO_WEBGL2_MESSAGE } from '../../gl/context'
import { fakeCanvas } from '../../gl/fakeGl'
import { meshMark, scene } from '../../testing/marks'
import { DEFAULT_PAINT_PARAMS, resolvePaintParams } from '../params'
import { HIDDEN_DASHED, HIDDEN_NA, HIDDEN_NONE, type BakedSurface } from '../bake/types'
import { LAYER_ORDER, PATH_POINTS, ROLES, type GBuffer, type PaintFrame, type PaintFrameInput, type PaintView, type SceneColours, type StrokeBatch } from '../types'
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

  it('keeps the stroke data texture inside the device’s MAX_TEXTURE_SIZE, and draws the first strokes of a batch that still does not fit', () => {
    // a device that allows 64 texels: 3 strokes (20 texels each) to a row, 64 rows, 192 strokes at most
    const paint = createPaintFakeGl({}, { width: 800, height: 600 }, { maxTextureSize: 64 })
    const renderer = new PaintRenderer(paint.canvas.canvas, { onError: vi.fn() })
    renderer.setScene(TWO, COLOURS)
    const sizes = () => paint.fake.calls.filter((c) => c.fn === 'texStorage2D' && c.args[2] === 0x8814).map((c) => [c.args[3], c.args[4]])
    // 30 strokes fit: 10 rows of 3, allocated with a quarter more rows (13), all within 64
    renderer.paint(frame(Array(30).fill(BLOCK)), view(), PARAMS, 'none')
    expect(sizes()).toEqual([[60, 13]])
    expect(renderer.stats.strokes).toBe(30)
    // 300 do not: the rows are the limit's (not 25 % more than it), and the first 192 are drawn, in the draw's own instances
    renderer.paint(frame(Array(300).fill(BLOCK)), view(), PARAMS, 'none')
    const made = sizes()
    for (const [w, h] of made) {
      expect(w).toBeLessThanOrEqual(64)
      expect(h).toBeLessThanOrEqual(64)
    }
    expect(made[made.length - 1]).toEqual([60, 64])
    expect(renderer.stats.strokes).toBe(192)
    const draw = timeline(paint).filter((e) => e.kind === 'stroke').pop()!.draw!
    expect(draw.instances).toBe(192)
    // the upload is the texture's own size: 60 x 64 texels, not the 100 rows the 300 strokes would want
    const upload = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_FLOAT).pop()!
    expect([upload.args[4], upload.args[5]]).toEqual([60, 64])
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

describe('the G-buffer readback that does not wait', () => {
  // A known 2 x 2 G-buffer (the view is 4 x 4 css px), as in the plain readback's tests.
  const texels = [
    encodeFloatTexel({ normal: [0, 0, 1], depth: 12.5, value: 0.5, shadow: false, mark: 1 }),
    [0, 0, 1e30, 0],
    encodeFloatTexel({ normal: [1, 0, 0], depth: 4, value: 1, shadow: true, mark: 0 }),
    encodeFloatTexel({ normal: [0, -1, 0], depth: 9.25, value: 0, shadow: false, mark: 1 }),
  ]
  const asyncSetup = (limits: Parameters<typeof createPaintFakeGl>[2] = { asyncReadback: true }, options: Parameters<typeof createPaintFakeGl>[0] = {}) => {
    const paint = createPaintFakeGl(options, { width: 800, height: 600 }, limits)
    const onError = vi.fn()
    const renderer = new PaintRenderer(paint.canvas.canvas, { onError })
    paint.setReadback((_a, _w, _h, dst) => (dst as Float32Array).set(texels.flat()))
    renderer.setScene(TWO, COLOURS)
    return { paint, renderer, onError }
  }

  it('reads through a pack buffer and a fence, with no readPixels into an array, and decodes the G-buffer the plain read does', async () => {
    const plain = setup()
    plain.paint.setReadback((_a, _w, _h, dst) => (dst as Float32Array).set(texels.flat()))
    plain.renderer.setScene(TWO, COLOURS)
    const expected = plain.renderer.renderGBuffer(view(4, 4), PARAMS)
    expect(plain.renderer.stats.gbufferRead).toBe('sync')

    const { paint, renderer, onError } = asyncSetup()
    const started = renderer.startGBuffer(view(4, 4), PARAMS)
    expect(started).toBeInstanceOf(Promise) // the G-buffer comes later, when the fence has passed
    const g = await started
    if (g === null) throw new Error('a context that is there gives a G-buffer')
    expect(renderer.stats.gbufferRead).toBe('async')
    for (const key of ['width', 'height', 'scale'] as const) expect(g[key]).toBe(expected[key])
    for (const key of ['depth', 'normal', 'value', 'shadow', 'mark'] as const) expect(Array.from(g[key])).toEqual(Array.from(expected[key]))
    // the one read went to the pack buffer (readPixels given an offset), the bytes came from getBufferSubData, and the fence
    // was waited on without waiting and deleted (and the probe's, the one of whether the context gives fences at all)
    expect(paint.reads).toEqual([{ attachment: 0, width: 2, height: 2, type: GL_FLOAT, pack: true }])
    const read = paint.fake.calls.find((c) => c.fn === 'readPixels')
    expect(typeof read?.args[6]).toBe('number')
    expect(paint.fences.subDataReads).toBe(1)
    expect(paint.fences.created).toBe(2)
    expect(paint.fences.deleted).toBe(2)
    expect(paint.fences.polls).toBe(1)
    // the fence is behind the read, and the commands are flushed after it
    const names = paint.fake.calls.map((c) => c.fn)
    expect(names.lastIndexOf('fenceSync')).toBeGreaterThan(names.indexOf('readPixels'))
    expect(names.indexOf('flush', names.lastIndexOf('fenceSync'))).toBeGreaterThan(names.lastIndexOf('fenceSync'))
    expect(names.indexOf('getBufferSubData')).toBeGreaterThan(names.lastIndexOf('clientWaitSync'))
    expect(onError).not.toHaveBeenCalled()
  })

  it('polls the fence without waiting until it has passed, and the page is free in between: nothing resolves while it has not', async () => {
    const { paint, renderer } = asyncSetup({ asyncReadback: true, fenceDelayPolls: 3 })
    let resolved = false
    const pending = (renderer.startGBuffer(view(4, 4), PARAMS) as Promise<GBuffer>).then((g) => {
      resolved = true
      return g
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(resolved).toBe(false) // the call returned before the GPU was done: the page was not made to wait for it
    expect(paint.fences.subDataReads).toBe(0)
    const g = await pending
    expect(Array.from(g.mark)).toEqual([1, -1, 0, 1])
    // not signalled three times, then signalled (the probe never polls)
    expect(paint.fences.polls).toBe(4)
    expect(paint.fences.pending).toBe(3)
  })

  it('reads the plain way when the context gives no fence, and for the rgba8 layout', async () => {
    const none = asyncSetup({})
    const g = none.renderer.startGBuffer(view(4, 4), PARAMS)
    // (the G-buffer itself, in the same task, as the plain read always gave it)
    expect(g).not.toBeInstanceOf(Promise)
    if (g instanceof Promise || g === null) throw new Error('unreachable')
    expect(none.renderer.stats.gbufferRead).toBe('sync')
    expect(none.paint.fences.created).toBe(0)
    expect(none.paint.reads.every((r) => r.pack !== true)).toBe(true)
    expect(Array.from(g.mark)).toEqual([1, -1, 0, 1])

    const bytes = asyncSetup({ asyncReadback: true }, { colorBufferFloat: false })
    bytes.paint.setReadback(null) // (all-zero readbacks: an empty G-buffer)
    const g8 = bytes.renderer.startGBuffer(view(4, 4), PARAMS)
    if (g8 instanceof Promise || g8 === null) throw new Error('the rgba8 layout is read the plain way')
    expect(bytes.renderer.stats.gbuffer).toBe('rgba8')
    expect(bytes.renderer.stats.gbufferRead).toBe('sync')
    expect(bytes.paint.reads.map((r) => r.type)).toEqual([GL_UNSIGNED_BYTE, GL_UNSIGNED_BYTE, GL_UNSIGNED_BYTE])
    expect(g8.mark.every((m) => m === -1)).toBe(true)
  })

  it('asks whether the context gives fences once, and keeps one pack buffer for every read', async () => {
    const { paint, renderer } = asyncSetup()
    await renderer.startGBuffer(view(4, 4), PARAMS)
    await renderer.startGBuffer(view(4, 4), PARAMS)
    await renderer.startGBuffer(view(4, 4), PARAMS)
    // one probe and three reads' fences
    expect(paint.fences.created).toBe(4)
    expect(paint.fences.deleted).toBe(4)
    expect(paint.fake.created.buffer - paint.fake.deleted.buffer).toBeGreaterThanOrEqual(1)
    const before = paint.fake.created.buffer
    await renderer.startGBuffer(view(4, 4), PARAMS)
    expect(paint.fake.created.buffer).toBe(before)
  })

  it('gives no G-buffer at all (null), and no error, when the renderer is disposed while the GPU works, and polls no more', async () => {
    const { paint, renderer, onError } = asyncSetup({ asyncReadback: true, fenceDelayPolls: 50 })
    const pending = renderer.startGBuffer(view(4, 4), PARAMS)
    renderer.dispose()
    expect(await pending).toBeNull()
    expect(paint.fences.polls).toBe(1) // (the first, as it was begun)
    expect(onError).not.toHaveBeenCalled()
  })

  it('gives an empty G-buffer with no scene, as the plain read does', async () => {
    const paint = createPaintFakeGl({}, { width: 800, height: 600 }, { asyncReadback: true })
    const renderer = new PaintRenderer(paint.canvas.canvas, {})
    const g = await renderer.startGBuffer(view(4, 4), PARAMS)
    if (g === null) throw new Error('a scene with no meshes is an empty G-buffer, not a lost context')
    expect(g.mark.every((m) => m === -1)).toBe(true)
    expect(paint.fences.created).toBe(0)
  })

  it('gives no G-buffer (null), not an empty one, while the context is lost: the caller must not take it for a scene with nothing in it', async () => {
    const { paint, renderer, onError } = asyncSetup()
    paint.canvas.lose()
    expect(renderer.startGBuffer(view(4, 4), PARAMS)).toBeNull()
    expect(paint.reads).toEqual([])
    // and a plain read (no fence) says the same
    const plain = asyncSetup({})
    plain.paint.canvas.lose()
    expect(plain.renderer.startGBuffer(view(4, 4), PARAMS)).toBeNull()
    expect(onError).not.toHaveBeenCalled()
  })

  it('gives no G-buffer (null) when the context is lost while the GPU works on it, reads nothing, and gives the fence back', async () => {
    const { paint, renderer, onError } = asyncSetup({ asyncReadback: true, fenceDelayPolls: 6 })
    const pending = renderer.startGBuffer(view(4, 4), PARAMS)
    await Promise.resolve()
    paint.canvas.lose()
    expect(await pending).toBeNull()
    // (the fence was not polled to the end, nothing was read from the pack buffer, and nothing is left undeleted)
    expect(paint.fences.polls).toBe(1)
    expect(paint.fences.subDataReads).toBe(0)
    expect(paint.fences.deleted).toBe(paint.fences.created)
    expect(onError).not.toHaveBeenCalled()
  })

  it('takes what GL threw as the context went for a loss, not a failure: nothing is reported, and the answer is null', async () => {
    // the context goes as the fence is polled, and the call fails (a fence that broke with it)
    let lose = () => {}
    const { renderer, onError, paint } = asyncSetup({ asyncReadback: true, failFence: true, onPoll: () => lose() })
    lose = () => paint.canvas.lose()
    expect(await renderer.startGBuffer(view(4, 4), PARAMS)).toBeNull()
    expect(onError).not.toHaveBeenCalled()
    // and as the passes are drawn: the readback throws, the context is gone
    const drawn = asyncSetup()
    drawn.paint.setReadback(() => {
      drawn.paint.canvas.lose()
      throw new Error('the context went mid-read')
    })
    expect(drawn.renderer.startGBuffer(view(4, 4), PARAMS)).toBeNull()
    expect(drawn.onError).not.toHaveBeenCalled()
    // (a failure that is not a loss is reported, and the G-buffer is empty: the next test)
  })

  it('does not finish a read on a context that has come back since it began: lost and restored between two polls, it is dropped', async () => {
    const { paint, renderer, onError } = asyncSetup({ asyncReadback: true, fenceDelayPolls: 6 })
    const pending = renderer.startGBuffer(view(4, 4), PARAMS)
    // lost and restored in the one task: the next poll finds a context that is lost no more, and a fence and a buffer that are not its
    paint.canvas.lose()
    paint.canvas.restore()
    expect(await pending).toBeNull()
    expect(paint.fences.polls).toBe(1) // (not polled again: the fence is of a context that is gone)
    expect(paint.fences.subDataReads).toBe(0)
    expect(paint.fences.deleted).toBe(paint.fences.created)
    expect(onError).not.toHaveBeenCalled()
    // the next read on the restored context is its own, and finishes
    paint.setReadback((_a, _w, _h, dst) => (dst as Float32Array).set(texels.flat()))
    renderer.setScene(TWO, COLOURS)
    const g = await renderer.startGBuffer(view(4, 4), PARAMS)
    expect(g && Array.from(g.mark)).toEqual([1, -1, 0, 1])
  })

  it('gives the fence back when the read fails: a fence that broke is reported, the G-buffer is empty and nothing is left undeleted', async () => {
    const { paint, renderer, onError } = asyncSetup({ asyncReadback: true, failFence: true })
    const g = await renderer.startGBuffer(view(4, 4), PARAMS)
    if (g === null) throw new Error('a failure is not a lost context')
    expect(g.mark.every((m) => m === -1)).toBe(true)
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/readback failed/))
    expect(paint.fences.deleted).toBe(paint.fences.created)
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

  it('passes the canvas texture to every stroke draw, which scales the tooth a dry brush catches', () => {
    for (const texture of [0.1, 1]) {
      const { paint, renderer } = setup()
      renderer.paint(frame([BLOCK, FORM, DAB]), view(), resolvePaintParams({ canvas: { texture } }), 'none')
      const strokes = timeline(paint).filter((e) => e.kind === 'stroke')
      expect(strokes.length).toBe(3)
      for (const s of strokes) expect(s.uniforms.u_texture).toEqual([texture])
    }
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

  it('says whether the last paint drew a frame (stats.painted): a paint on a lost context draws nothing and leaves the numbers of the paint before, so a caller asks it first (final fix wave, M1)', () => {
    const { paint, renderer } = scene2()
    expect(renderer.stats.painted).toBe(false)
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none', reproject())
    expect(renderer.stats.painted).toBe(true)
    expect(renderer.stats.depthTested).toBe(true)
    // the context goes: nothing is drawn, whatever the stats still say of the paint before
    paint.canvas.lose()
    const before = timeline(paint).length
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none', reproject())
    expect(renderer.stats.painted).toBe(false)
    expect(timeline(paint).length).toBe(before)
    expect(renderer.stats.depthTested).toBe(true)
    // and it comes back: the paint after it draws, and says so (a debug view's paint too)
    paint.canvas.restore()
    renderer.paint(withUnder(frame([BLOCK, FORM])), view(), PARAMS, 'none', reproject())
    expect(renderer.stats.painted).toBe(true)
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'value')
    expect(renderer.stats.painted).toBe(true)
    // (a renderer that was disposed paints nothing)
    renderer.dispose()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(renderer.stats.painted).toBe(false)
  })

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

  it('tests every stroke draw against the depth: u_depthTest on, with the view direction, eye·direction and a bias of about a hundredth of the radius (0.012)', () => {
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

  it('gives the stroke shader the pixel ratio, and the size of the targets: its reach is in CSS px and the scene’s depth in backing px', () => {
    for (const ratio of [1, 2]) {
      const { paint, renderer } = scene2()
      renderer.paint(frame([BLOCK, FORM]), view(800, 600, ratio), PARAMS, 'none', reproject())
      for (const s of timeline(paint).filter((e) => e.kind === 'stroke')) {
        expect(s.uniforms.u_pixelRatio).toEqual([ratio])
        expect(s.uniforms.u_resolution).toEqual([800 * ratio, 600 * ratio])
        expect(s.uniforms.u_cssSize).toEqual([800, 600])
      }
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

  it('forgets a failure that came before the loss: a restored context draws again', () => {
    const { paint, renderer, onError } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setPaper(new Uint8ClampedArray(4 * 4).fill(220), new Float32Array(4).fill(0.5), 2)
    // an unexpected error while painting (a frame that is not one): reported, and the renderer then draws nothing
    renderer.paint({ ...frame([BLOCK]), strokes: undefined as never }, view(), PARAMS, 'none')
    expect(onError).toHaveBeenCalledTimes(1)
    const draws = paint.fake.draws.length
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(paint.fake.draws.length).toBe(draws)
    // the context goes and comes back: a good frame draws
    paint.canvas.lose()
    paint.canvas.restore()
    renderer.paint(frame([BLOCK]), view(), PARAMS, 'none')
    expect(paint.fake.draws.length).toBeGreaterThan(draws)
    expect(onError).toHaveBeenCalledTimes(1)
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

// --- the baked painting (Task 5) -------------------------------------------------------------------------------------------

describe('the baked underpainting: the surfaces drawn for the view into the image the composite reads', () => {
  // a unit-ish square of baked surface at height z over the scene's squares (which span [-1, 1]²)
  const bakedSquare = (z: number, mark: number, options: { closed?: boolean; alpha?: number; front?: [number, number, number]; back?: [number, number, number] } = {}): BakedSurface => {
    const closed = options.closed ?? false
    const alpha = options.alpha ?? 1
    const front = options.front ?? [0.2, 0.4, 0.8]
    const back = options.back ?? [0.9, 0.5, 0.1]
    const rep = (c: [number, number, number]) => Float32Array.from([...c, ...c, ...c, ...c])
    return {
      mark,
      positions: Float32Array.from([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]),
      normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
      closed,
      underFront: rep(front),
      underBack: closed ? null : rep(back),
      alphaFront: new Float32Array(4).fill(alpha),
      alphaBack: closed ? null : new Float32Array(4).fill(alpha),
      uFront: new Float32Array(4),
      uBack: closed ? null : new Float32Array(4),
      famFront: new Uint8Array(4),
      famBack: closed ? null : new Uint8Array(4),
      local: new Float32Array(12),
    }
  }
  const SURFACES = () => [bakedSquare(0, 0), bakedSquare(-1, 1, { closed: true })]

  // A baked frame: no underpainting image, and a `hidden` array (the baked frames' mark).
  function bakedFrame(layers: number[], hidden?: number[]): PaintFrameInput {
    const f = frame(layers)
    f.strokes.hidden = Uint8Array.from(hidden ?? layers.map(() => HIDDEN_NA))
    return { ...f, underpaint: null }
  }

  const kinds = (paint: PaintFakeGl) => timeline(paint).map((e) => e.kind)

  function bakedSetup(options: Parameters<typeof createPaintFakeGl>[0] = {}) {
    const ctx = setup(options)
    ctx.renderer.setScene(TWO, COLOURS)
    ctx.renderer.setBakedSurfaces(SURFACES())
    return ctx
  }

  // The texture bound to `unit` when the n-th draw (0-based) happened, by replaying the calls.
  function textureAt(paint: PaintFakeGl, drawIndex: number, unit: number): unknown {
    const draws = new Set(['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'])
    let active = 0
    const bound: Record<number, unknown> = {}
    let seen = 0
    for (const call of paint.fake.calls) {
      if (call.fn === 'activeTexture') active = (call.args[0] as number) - GL_TEXTURE0
      else if (call.fn === 'bindTexture') bound[active] = call.args[1]
      else if (draws.has(call.fn)) {
        if (seen === drawIndex) return bound[unit]
        seen++
      }
    }
    return undefined
  }

  // The texture attached to a framebuffer (COLOR_ATTACHMENT0).
  const attachedTexture = (paint: PaintFakeGl, fbo: unknown): unknown => {
    let bound: unknown = null
    let found: unknown
    for (const call of paint.fake.calls) {
      if (call.fn === 'bindFramebuffer') bound = call.args[1]
      else if (call.fn === 'framebufferTexture2D' && bound === fbo && call.args[1] === 0x8ce0) found = call.args[3]
    }
    return found
  }

  it('draws the scene’s depth for the view, then each surface, then the rim, and lays the image first: no image is uploaded', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    // the baked frame is tested against the depth (two meshes), the surfaces against the depth at the G-buffer's size (two
    // meshes again), the two surfaces, the rim, the underpainting laid, the layer, the composite
    expect(kinds(paint)).toEqual(['depth', 'depth', 'depth', 'depth', 'surfaces', 'surfaces', 'dilate', 'underpaint', 'copy', 'stroke', 'composite'])
    // no image went up: the texels came from the pass
    const uploads = paint.fake.calls.filter((c) => c.fn === 'texSubImage2D' && c.args[6] === GL_RGBA && c.args[7] === GL_UNSIGNED_BYTE && c.args[4] === 400 && c.args[5] === 300)
    expect(uploads.length).toBe(0)
    expect(renderer.stats.underpaintBaked).toBe(true)
    expect(renderer.stats.bakedSurfaces).toBe(2)
    expect(renderer.stats.underpaintWarped).toBe(false)
  })

  it('fills the very texture the composite reads: the rim pass draws into a framebuffer whose texture is the one the underpainting pass samples', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const events = timeline(paint)
    const dilate = events.find((e) => e.kind === 'dilate')!
    const fbo = dilate.draw?.framebuffer
    expect(fbo).toBeTruthy()
    const target = attachedTexture(paint, fbo)
    expect(target).toBeTruthy()
    const index = paint.fake.draws.indexOf(events.find((e) => e.kind === 'underpaint')!.draw!)
    expect(textureAt(paint, index, 0)).toBe(target)
    // it is the same kind of texture the image path makes: RGBA8, bilinear
    const storage = paint.fake.calls.filter((c) => c.fn === 'texStorage2D' && c.args[2] === 0x8058 && c.args[3] === 400 && c.args[4] === 300)
    expect(storage.length).toBeGreaterThanOrEqual(1)
  })

  it('draws every surface into a target of the G-buffer’s size with the depth test on, no blending, one draw each of its triangles', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const surfaces = timeline(paint).filter((e) => e.kind === 'surfaces')
    expect(surfaces.length).toBe(2)
    for (const e of surfaces) {
      expect(e.draw).toMatchObject({ fn: 'drawElements', count: 6, depthTest: true, depthWrite: true, blend: false, cull: 'none', depthFunc: 0x0201 })
    }
    // the first is open, the second closed
    expect(surfaces.map((e) => e.uniforms.u_closed)).toEqual([[0], [1]])
    // into one framebuffer that is neither the canvas nor a paint target
    const fbo = surfaces[0].draw?.framebuffer
    expect(fbo).toBeTruthy()
    expect(surfaces[1].draw?.framebuffer).toBe(fbo)
    // the viewport is the G-buffer's: 400 x 300 for an 800 x 600 view
    const viewports = paint.fake.calls.filter((c) => c.fn === 'viewport').map((c) => c.args)
    expect(viewports).toContainEqual([0, 0, 400, 300])
  })

  it('draws with the view’s matrix put on the G-buffer’s grid (row 0 the top), the eye and the depth base, tested against the scene’s depth', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const surface = timeline(paint).find((e) => e.kind === 'surfaces')!
    const u = surface.uniforms
    const m = u.u_viewProj![1] as Float32Array
    // view()'s diag(0.5, 0.5, -0.1, 1) on the grid of 400 x 300 texels of two CSS px for an 800 x 600 view: x kept, y flipped
    expect(m[0]).toBeCloseTo(0.5, 6)
    expect(m[5]).toBeCloseTo(-0.5, 6)
    expect(m[10]).toBeCloseTo(-0.1, 6)
    expect(u.u_viewDir).toEqual([0, 0, -1])
    expect(u.u_perspective).toEqual([0])
    expect(u.u_sceneTest).toEqual([1])
    expect((u.u_depthBias![0] as number)).toBeGreaterThan(0)
    // the origin of the surfaces is the middle of their box: (0, 0, -0.5); the eye (0, 0, 10) relative to it
    expect(u.u_relEye).toEqual([0, 0, 10.5])
    // dot(origin - eye, viewDir) = dot((0, 0, -10.5), (0, 0, -1))
    expect(u.u_depthBase).toEqual([10.5])
  })

  it('tests the surfaces against the scene’s depth drawn again at the G-buffer’s size, in its orientation (y flipped), after the strokes’ own', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const depths = timeline(paint).filter((e) => e.kind === 'depth')
    expect(depths.length).toBe(4)
    // the strokes' (backing size, GL's y up) then the surfaces' (G-buffer grid, y flipped)
    expect((depths[0].uniforms.u_viewProj![1] as Float32Array)[5]).toBeCloseTo(0.5, 6)
    expect((depths[2].uniforms.u_viewProj![1] as Float32Array)[5]).toBeCloseTo(-0.5, 6)
    expect(depths[2].draw?.framebuffer?.id).not.toBe(depths[0].draw?.framebuffer?.id)
    // the surfaces sample that depth, not the strokes'
    const surface = timeline(paint).find((e) => e.kind === 'surfaces')!
    const index = paint.fake.draws.indexOf(surface.draw!)
    expect(textureAt(paint, index, 0)).toBe(attachedTexture(paint, depths[2].draw?.framebuffer))
    // a target of each size: RG32F 800 x 600 and 400 x 300
    const rg = paint.fake.calls.filter((c) => c.fn === 'texStorage2D' && c.args[2] === 0x8230).map((c) => [c.args[3], c.args[4]])
    expect(rg).toContainEqual([800, 600])
    expect(rg).toContainEqual([400, 300])
  })

  it('does the same for a perspective view: the eye per fragment', () => {
    const { paint, renderer } = bakedSetup()
    const v = view()
    v.viewProj = Float32Array.from([0.5, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, -0.1, -1, 0, 0, 0, 10])
    renderer.paint(bakedFrame([BLOCK]), v, PARAMS, 'none')
    expect(timeline(paint).find((e) => e.kind === 'surfaces')!.uniforms.u_perspective).toEqual([1])
  })

  it('lays the image of a frame that has one, and not the surfaces', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    expect(kinds(paint)).toEqual(['underpaint', 'copy', 'stroke', 'composite'])
    expect(renderer.stats.underpaintBaked).toBe(false)
  })

  it('takes a null and an empty image alike for no image', () => {
    for (const underpaint of [null, new Float32Array(0)]) {
      const { paint, renderer } = bakedSetup()
      renderer.paint({ ...frame([BLOCK]), underpaint }, view(), PARAMS, 'none')
      expect(kinds(paint).includes('surfaces'), String(underpaint)).toBe(true)
      expect(renderer.stats.underpaintBaked).toBe(true)
    }
  })

  it('lays no underpainting when the frame has none and no surfaces are set: nothing, and no error', () => {
    const { paint, renderer, onError } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.paint({ ...frame([BLOCK]), underpaint: null }, view(), PARAMS, 'none')
    expect(kinds(paint)).toEqual(['stroke', 'composite'])
    expect(renderer.stats.underpaintBaked).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('goes back to the image path when the surfaces are taken away (null), and frees them', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const before = balance(paint)
    renderer.setBakedSurfaces(null)
    expect(balance(paint).buffer).toBeLessThan(before.buffer)
    const draws = paint.fake.draws.length
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    expect(timeline(paint).slice(-4).map((e) => e.kind)).toEqual(['underpaint', 'copy', 'stroke', 'composite'])
    expect(paint.fake.draws.length).toBeGreaterThan(draws)
    // and a frame with no image then has none
    renderer.paint({ ...frame([BLOCK]), underpaint: null }, view(), PARAMS, 'none')
    expect(renderer.stats.underpaintBaked).toBe(false)
  })

  it('frees the surface pass’s targets when the surfaces are taken away: its image, its depth and the framebuffer on the underpainting, not only the vertex buffers', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const live = balance(paint)
    const deleted = { ...paint.fake.deleted }
    renderer.setBakedSurfaces(null)
    const after = balance(paint)
    // the image of the surfaces and the scene's depth at the G-buffer's size: two textures and two renderbuffers, each with a
    // framebuffer, and the framebuffer that was on the underpainting texture (the texture stays: an image is laid through it)
    expect(paint.fake.deleted.texture - deleted.texture).toBe(2)
    expect(paint.fake.deleted.renderbuffer - deleted.renderbuffer).toBe(2)
    expect(paint.fake.deleted.framebuffer - deleted.framebuffer).toBe(3)
    expect(live.texture - after.texture).toBe(2)
    expect(live.renderbuffer - after.renderbuffer).toBe(2)
    expect(live.framebuffer - after.framebuffer).toBe(3)
    // and the vertex buffers, as before
    expect(live.buffer - after.buffer).toBe(8)
    // an image frame lays as ever, and a bake set again makes the targets again
    renderer.paint(withUnder(frame([BLOCK])), view(), PARAMS, 'none')
    expect(timeline(paint).slice(-4).map((e) => e.kind)).toEqual(['underpaint', 'copy', 'stroke', 'composite'])
    renderer.setBakedSurfaces(SURFACES())
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(renderer.stats.underpaintBaked).toBe(true)
    expect(renderer.stats.bakedSurfaces).toBe(2)
    renderer.dispose()
    expect(balance(paint)).toEqual({ buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 })
  })

  it('has nothing to free when no surfaces were ever set: setting null again makes no GL call', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    paint.fake.calls.length = 0
    renderer.setBakedSurfaces(null)
    expect(paint.fake.calls.length).toBe(0)
  })

  it('is left out of the flat role view, as the image is', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'roles')
    expect(kinds(paint).includes('surfaces')).toBe(false)
    expect(kinds(paint).includes('underpaint')).toBe(false)
  })

  it('draws no surface that has no coverage anywhere (a veil, a lit bare table)', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setBakedSurfaces([bakedSquare(0, 0), bakedSquare(-1, 1, { alpha: 0 })])
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(timeline(paint).filter((e) => e.kind === 'surfaces').length).toBe(1)
    expect(renderer.stats.bakedSurfaces).toBe(1)
    // and with none that has any, nothing is laid
    const none = setup()
    none.renderer.setScene(TWO, COLOURS)
    none.renderer.setBakedSurfaces([bakedSquare(0, 0, { alpha: 0 }), null])
    none.renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(timeline(none.paint).some((e) => e.kind === 'surfaces' || e.kind === 'dilate' || e.kind === 'underpaint')).toBe(false)
  })

  it('does not warp: a baked frame that is also re-projected has its underpainting drawn for this very view', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none', { from: view(), depth: new Float32Array(400 * 300).fill(5) })
    const under = timeline(paint).find((e) => e.kind === 'underpaint')!
    expect(paint.fake.programSource(under.draw!.program).fragment).not.toContain('#define WARP')
    expect(renderer.stats.underpaintWarped).toBe(false)
    expect(renderer.stats.underpaintBaked).toBe(true)
  })

  it('makes no scene-depth pass and does not test the surfaces against it where the context cannot render to float: they are tested against each other', () => {
    const { paint, renderer, onError } = bakedSetup({ colorBufferFloat: false })
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    const events = timeline(paint)
    expect(events.some((e) => e.kind === 'depth')).toBe(false)
    expect(events.filter((e) => e.kind === 'surfaces').map((e) => e.uniforms.u_sceneTest)).toEqual([[0], [0]])
    expect(renderer.stats.underpaintBaked).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  })

  it('draws the same calls for the same frame and surfaces (no time, no randomness)', () => {
    const run = () => {
      const { paint, renderer } = bakedSetup()
      renderer.paint(bakedFrame([BLOCK, FORM]), view(), PARAMS, 'none')
      return JSON.stringify(paint.fake.calls.filter((c) => c.fn.startsWith('uniform') || c.fn === 'bufferData').map((c) => [c.fn, c.args.map((a) => (ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>).slice(0, 64) : a))]))
    }
    expect(run()).toBe(run())
  })

  it('reports a surface it cannot draw through onError and draws the rest', () => {
    const { paint, renderer, onError } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setBakedSurfaces([bakedSquare(0, 0), { ...bakedSquare(-1, 7), normals: new Float32Array(3) }])
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toMatch(/mark 7/)
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(timeline(paint).filter((e) => e.kind === 'surfaces').length).toBe(1)
    // a surface that cannot be drawn is not a failure of the renderer: it keeps painting
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(timeline(paint).filter((e) => e.kind === 'surfaces').length).toBe(2)
  })

  it('frees every buffer, target and framebuffer it made with the renderer', () => {
    const { paint, renderer } = bakedSetup()
    renderer.paint(bakedFrame([BLOCK]), view(), PARAMS, 'none')
    expect(Object.values(balance(paint)).some((n) => n > 0)).toBe(true)
    renderer.dispose()
    expect(balance(paint)).toEqual({ buffer: 0, vertexArray: 0, program: 0, shader: 0, texture: 0, framebuffer: 0, renderbuffer: 0 })
  })
})

describe('uploading and recolouring the baked surfaces', () => {
  const GL_ARRAY_BUFFER = 0x8892
  const quad = (z: number, mark: number, fill = 0.5): BakedSurface => ({
    mark,
    positions: Float32Array.from([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    closed: false,
    underFront: new Float32Array(12).fill(fill),
    underBack: new Float32Array(12).fill(1 - fill),
    alphaFront: new Float32Array(4).fill(1),
    alphaBack: new Float32Array(4).fill(1),
    uFront: new Float32Array(4),
    uBack: new Float32Array(4),
    famFront: new Uint8Array(4),
    famBack: new Uint8Array(4),
    local: new Float32Array(12),
  })

  it('uploads once per bake: positions, normals, colours (8 floats a vertex) and the triangles, and the same arrays again uploads nothing', () => {
    const { paint, renderer } = setup()
    const surfaces = [quad(0, 0), quad(-1, 1)]
    renderer.setBakedSurfaces(surfaces)
    const uploads = paint.fake.uploads
    // per surface: 12 + 12 + 32 floats and 6 indices
    expect(uploads.filter((u) => u.target === GL_ARRAY_BUFFER).map((u) => u.data?.length)).toEqual([12, 12, 32, 12, 12, 32])
    expect(uploads.filter((u) => u.target !== GL_ARRAY_BUFFER).map((u) => u.data?.length)).toEqual([6, 6])
    renderer.setBakedSurfaces(surfaces)
    expect(paint.fake.uploads.length).toBe(uploads.length)
    // another bake replaces them, and frees the first's buffers
    const created = paint.fake.created.buffer
    renderer.setBakedSurfaces([quad(0, 0)])
    expect(paint.fake.created.buffer).toBe(created + 4)
    expect(paint.fake.deleted.buffer).toBe(8)
  })

  it('recolours by writing only the colour buffers: under front, under back and the coverage, and nothing else', () => {
    const { paint, renderer } = setup()
    renderer.setBakedSurfaces([quad(0, 0), quad(-1, 1)])
    const uploads = paint.fake.uploads.length
    const created = { ...paint.fake.created }
    paint.fake.calls.length = 0
    const recoloured = [quad(0, 0, 0.1), quad(-1, 1, 0.9)]
    recoloured[1].alphaFront.fill(0.25)
    renderer.updateBakedColours(recoloured)
    expect(paint.fake.uploads.length).toBe(uploads)
    expect(paint.fake.created).toEqual(created)
    const subs = paint.fake.calls.filter((c) => c.fn === 'bufferSubData')
    expect(subs.length).toBe(2)
    expect(subs.every((c) => c.args[0] === GL_ARRAY_BUFFER && c.args[1] === 0 && (c.args[2] as Float32Array).length === 32)).toBe(true)
    const first = subs[0].args[2] as Float32Array
    // under front 0.1 (3), under back 0.9 (3), coverage 1 and 1
    expect(Array.from(first.subarray(0, 8)).map((v) => +v.toFixed(3))).toEqual([0.1, 0.1, 0.1, 0.9, 0.9, 0.9, 1, 1])
    const second = subs[1].args[2] as Float32Array
    expect(Array.from(second.subarray(6, 8))).toEqual([0.25, 1])
    // no buffer, vertex array, framebuffer or texture was made, and no pointer set again
    expect(paint.fake.calls.filter((c) => c.fn === 'vertexAttribPointer' || c.fn === 'bufferData').length).toBe(0)
  })

  it('uploads in full surfaces that are not the ones set (another vertex count)', () => {
    const { paint, renderer } = setup()
    renderer.setBakedSurfaces([quad(0, 0)])
    const bigger = quad(0, 0)
    bigger.positions = new Float32Array(15)
    bigger.normals = new Float32Array(15)
    bigger.underFront = new Float32Array(15)
    bigger.underBack = new Float32Array(15)
    bigger.alphaFront = new Float32Array(5).fill(1)
    bigger.alphaBack = new Float32Array(5).fill(1)
    paint.fake.calls.length = 0
    renderer.updateBakedColours([bigger])
    expect(paint.fake.calls.filter((c) => c.fn === 'bufferSubData').length).toBe(0)
    expect(paint.fake.calls.filter((c) => c.fn === 'bufferData').length).toBeGreaterThan(0)
  })

  it('uploads a NaN colour or alpha as no underpainting (colour 0, coverage 0), at upload and on a recolour, and leaves out a surface that has only NaN', () => {
    const { paint, renderer } = setup()
    const nan = quad(0, 0)
    nan.underFront[4] = Number.NaN
    nan.alphaBack![2] = Number.NaN
    renderer.setBakedSurfaces([nan])
    const colours = () => paint.fake.uploads.filter((u) => u.target === GL_ARRAY_BUFFER && u.data?.length === 32).map((u) => u.data as Float32Array)
    expect(colours().length).toBe(1)
    expect(colours()[0].every((v) => Number.isFinite(v))).toBe(true)
    // vertex 1: the front is none (its green is NaN), the back is kept; vertex 2: the back's alpha is NaN, the front is kept
    expect(Array.from(colours()[0].subarray(8, 16))).toEqual([0, 0, 0, 0.5, 0.5, 0.5, 0, 1])
    expect(Array.from(colours()[0].subarray(16, 24))).toEqual([0.5, 0.5, 0.5, 0, 0, 0, 1, 0])
    // a recolour is held to the same rule
    const again = quad(0, 0, 0.3)
    again.alphaFront[0] = Number.NaN
    paint.fake.calls.length = 0
    renderer.updateBakedColours([again])
    const sub = paint.fake.calls.find((c) => c.fn === 'bufferSubData')?.args[2] as Float32Array
    expect(sub.every((v) => Number.isFinite(v))).toBe(true)
    expect(sub[6]).toBe(0)
    // a surface whose only coverage is NaN has none: nothing is uploaded for it
    const only = quad(1, 1)
    only.alphaFront.fill(Number.NaN)
    only.alphaBack!.fill(0)
    const before = paint.fake.uploads.length
    renderer.setBakedSurfaces([only])
    expect(paint.fake.uploads.length).toBe(before)
  })

  it('takes recoloured surfaces as the first when none were set', () => {
    const { paint, renderer, onError } = setup()
    renderer.updateBakedColours([quad(0, 0)])
    expect(paint.fake.uploads.filter((u) => u.target === GL_ARRAY_BUFFER).length).toBe(3)
    expect(onError).not.toHaveBeenCalled()
  })
})

describe('the baked surfaces and a lost context', () => {
  const quad = (z: number, mark: number, fill: number): BakedSurface => ({
    mark,
    positions: Float32Array.from([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z]),
    normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    closed: false,
    underFront: new Float32Array(12).fill(fill),
    underBack: new Float32Array(12).fill(1 - fill),
    alphaFront: new Float32Array(4).fill(1),
    alphaBack: new Float32Array(4).fill(1),
    uFront: new Float32Array(4),
    uBack: new Float32Array(4),
    famFront: new Uint8Array(4),
    famBack: new Uint8Array(4),
    local: new Float32Array(12),
  })
  const bakedFrame = (): PaintFrameInput => {
    const f = frame([BLOCK])
    f.strokes.hidden = Uint8Array.from([HIDDEN_NA])
    return { ...f, underpaint: null }
  }
  const surfaceDraws = (paint: PaintFakeGl) => timeline(paint).filter((e) => e.kind === 'surfaces').length
  const colourUploads = (paint: PaintFakeGl) => paint.fake.uploads.filter((u) => u.target === 0x8892 && u.data?.length === 32)

  it('uploads them again when the context comes back, and draws them: a lost context never paints the baked surfaces blank', () => {
    const { paint, renderer, onContextRestored } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setBakedSurfaces([quad(0, 0, 0.2), quad(-1, 1, 0.4)])
    renderer.paint(bakedFrame(), view(), PARAMS, 'none')
    expect(surfaceDraws(paint)).toBe(2)
    expect(colourUploads(paint).length).toBe(2)
    paint.canvas.lose()
    // while it is lost: painting issues no call that errors, and draws nothing
    const errors = paint.fake.errors.length
    const draws = paint.fake.draws.length
    renderer.paint(bakedFrame(), view(), PARAMS, 'none')
    expect(paint.fake.errors.length).toBe(errors)
    expect(paint.fake.draws.length).toBe(draws)
    paint.canvas.restore()
    expect(onContextRestored).toHaveBeenCalledTimes(1)
    // the surfaces last given are uploaded again, the same data
    const ups = colourUploads(paint)
    expect(ups.length).toBe(4)
    expect(Array.from(ups[2].data as Float32Array)).toEqual(Array.from(ups[0].data as Float32Array))
    expect(Array.from(ups[3].data as Float32Array)).toEqual(Array.from(ups[1].data as Float32Array))
    renderer.paint(bakedFrame(), view(), PARAMS, 'none')
    expect(surfaceDraws(paint)).toBe(4)
    expect(renderer.stats.underpaintBaked).toBe(true)
  })

  it('takes a recolour made while it is lost into the upload on restore, and surfaces set while it is lost the same', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setBakedSurfaces([quad(0, 0, 0.2)])
    paint.canvas.lose()
    renderer.updateBakedColours([quad(0, 0, 0.7)])
    const errors = paint.fake.errors.length
    renderer.setBakedSurfaces([quad(0, 0, 0.8), quad(-1, 1, 0.3)])
    expect(paint.fake.errors.length).toBe(errors)
    paint.canvas.restore()
    const ups = colourUploads(paint)
    // the first upload (before the loss), then the two surfaces set during it
    expect(ups.length).toBe(3)
    expect(ups[1].data?.[0]).toBeCloseTo(0.8, 6)
    expect(ups[2].data?.[0]).toBeCloseTo(0.3, 6)
    renderer.paint(bakedFrame(), view(), PARAMS, 'none')
    expect(surfaceDraws(paint)).toBe(2)
  })

  it('has nothing to upload again when none were set, and does not fail', () => {
    const { paint, renderer, onError } = setup()
    renderer.setScene(TWO, COLOURS)
    paint.canvas.lose()
    paint.canvas.restore()
    renderer.paint({ ...frame([BLOCK]), underpaint: null }, view(), PARAMS, 'none')
    expect(onError).not.toHaveBeenCalled()
    expect(surfaceDraws(paint)).toBe(0)
  })

  it('forgets nothing it was given when a failure came before the loss', () => {
    const { paint, renderer } = setup()
    renderer.setScene(TWO, COLOURS)
    renderer.setBakedSurfaces([quad(0, 0, 0.2)])
    renderer.paint({ ...bakedFrame(), strokes: undefined as never }, view(), PARAMS, 'none')
    paint.canvas.lose()
    paint.canvas.restore()
    renderer.paint(bakedFrame(), view(), PARAMS, 'none')
    expect(surfaceDraws(paint)).toBe(1)
  })
})

describe('the hidden pass: a baked frame’s dashed data lines, drawn again where a surface hides them', () => {
  const LINE = LAYER_ORDER.indexOf('line')
  const kinds = (paint: PaintFakeGl) => timeline(paint).map((e) => e.kind)
  const strokeEvents = (paint: PaintFakeGl) => timeline(paint).filter((e) => e.kind === 'stroke')

  function bakedFrame(layers: number[], hidden: number[]): PaintFrameInput {
    const f = frame(layers)
    f.strokes.hidden = Uint8Array.from(hidden)
    return { ...f, underpaint: null }
  }

  function scene2() {
    const ctx = setup()
    ctx.renderer.setScene(TWO, COLOURS)
    return ctx
  }

  it('draws them once more right after the line layer, before the layers after it, in one instanced draw from the slots after the planned ones', () => {
    const { paint, renderer } = scene2()
    renderer.paint(bakedFrame([BLOCK, LINE, DAB], [HIDDEN_NA, HIDDEN_DASHED, HIDDEN_NA]), view(), PARAMS, 'none')
    // the depth of the two meshes; block; the line layer (copied forward) and its hidden pass (copied forward); the dab layer; composite
    expect(kinds(paint)).toEqual(['depth', 'depth', 'stroke', 'copy', 'stroke', 'copy', 'stroke', 'copy', 'stroke', 'composite'])
    const strokes = strokeEvents(paint)
    // u_base: the block 0, the line 1, the hidden pass after the 3 planned slots, the dab 2
    expect(strokes.map((e) => e.uniforms.u_base)).toEqual([[0], [1], [3], [2]])
    expect(strokes.map((e) => e.draw?.instances)).toEqual([1, 1, 1, 1])
    // the uniform is set for the hidden draw alone: the other draws never set it, and the dab after it has it back at 0
    expect(strokes.map((e) => e.uniforms.u_hiddenPass)).toEqual([undefined, undefined, [1], [0]])
    expect(renderer.stats.strokeDraws).toBe(4)
    // the strokes planned are three: the hidden pass draws copies, not more strokes
    expect(renderer.stats.strokes).toBe(3)
  })

  it('draws every dashed stroke of the frame in that one draw, and only the dashed', () => {
    const { paint, renderer } = scene2()
    renderer.paint(bakedFrame([LINE, LINE, LINE, FORM], [HIDDEN_DASHED, HIDDEN_NONE, HIDDEN_DASHED, HIDDEN_NA]), view(), PARAMS, 'none')
    const strokes = strokeEvents(paint)
    // the form layer first (one stroke), then the line layer (three), then the hidden pass (two, after the four planned)
    expect(strokes.map((e) => e.uniforms.u_base)).toEqual([[0], [1], [4]])
    // the instances of each draw are its strokes: one, three, and the two dashed
    expect(strokes.map((e) => e.draw?.instances)).toEqual([1, 3, 2])
    expect(strokes[2].uniforms.u_hiddenPass).toEqual([1])
  })

  it('tests every stroke against the scene’s depth, a baked frame being one: with no re-projection given', () => {
    const { paint, renderer } = scene2()
    renderer.paint(bakedFrame([BLOCK, LINE], [HIDDEN_NA, HIDDEN_DASHED]), view(), PARAMS, 'none')
    for (const e of strokeEvents(paint)) expect(e.uniforms.u_depthTest).toEqual([1])
    expect(renderer.stats.depthTested).toBe(true)
  })

  it('draws no hidden pass for a frame with nothing dashed, nor for a frame with no hidden array (the per-frame model’s)', () => {
    const none = scene2()
    none.renderer.paint(bakedFrame([BLOCK, LINE], [HIDDEN_NA, HIDDEN_NONE]), view(), PARAMS, 'none')
    expect(strokeEvents(none.paint).map((e) => e.uniforms.u_base)).toEqual([[0], [1]])
    expect(strokeEvents(none.paint).some((e) => e.uniforms.u_hiddenPass !== undefined)).toBe(false)
    const model = scene2()
    model.renderer.paint(frame([BLOCK, LINE]), view(), PARAMS, 'none')
    expect(strokeEvents(model.paint).length).toBe(2)
    expect(model.renderer.stats.depthTested).toBe(false)
  })

  it('draws no hidden pass where there is no depth to say where a surface is nearer: no float targets, or no scene', () => {
    const noFloat = setup({ colorBufferFloat: false })
    noFloat.renderer.setScene(TWO, COLOURS)
    noFloat.renderer.paint(bakedFrame([BLOCK, LINE], [HIDDEN_NA, HIDDEN_DASHED]), view(), PARAMS, 'none')
    expect(strokeEvents(noFloat.paint).length).toBe(2)
    const noScene = setup()
    noScene.renderer.paint(bakedFrame([BLOCK, LINE], [HIDDEN_NA, HIDDEN_DASHED]), view(), PARAMS, 'none')
    expect(strokeEvents(noScene.paint).length).toBe(2)
    expect(noScene.onError).not.toHaveBeenCalled()
  })

  it('packs the dashed strokes again into the data texture, after the planned ones', () => {
    const { paint, renderer } = scene2()
    renderer.paint(bakedFrame([BLOCK, LINE, DAB], [HIDDEN_NA, HIDDEN_DASHED, HIDDEN_NA]), view(), PARAMS, 'none')
    const upload = paint.fake.calls.find((c) => c.fn === 'texSubImage2D' && c.args[7] === GL_FLOAT && c.args[6] === GL_RGBA && c.args[4] !== 400)
    const texels = upload?.args[8] as Float32Array
    expect(texels).toBeDefined()
    const at = (slot: number) => Array.from(texels.subarray(slot * TEXELS_PER_STROKE * 4, (slot + 1) * TEXELS_PER_STROKE * 4))
    // planned: block (slot 0), line (slot 1), dab (slot 2); the hidden copy of the line is slot 3
    expect(at(3)).toEqual(at(1))
    expect(at(3).some((v) => v !== 0)).toBe(true)
    expect(at(3)).not.toEqual(at(0))
  })

  it('draws the same calls for the same frame (no time, no randomness)', () => {
    const run = () => {
      const { paint, renderer } = scene2()
      renderer.paint(bakedFrame([BLOCK, LINE, DAB], [HIDDEN_NA, HIDDEN_DASHED, HIDDEN_NA]), view(), PARAMS, 'none')
      return JSON.stringify(paint.fake.calls.filter((c) => c.fn.startsWith('uniform') || c.fn === 'texSubImage2D').map((c) => [c.fn, c.args.map((a) => (ArrayBuffer.isView(a) ? Array.from(a as unknown as ArrayLike<number>).slice(0, 64) : a))]))
    }
    expect(run()).toBe(run())
  })

  it('draws them in the flat role view too', () => {
    const { paint, renderer } = scene2()
    renderer.paint(bakedFrame([LINE], [HIDDEN_DASHED]), view(), PARAMS, 'roles')
    expect(strokeEvents(paint).map((e) => e.uniforms.u_hiddenPass)).toEqual([undefined, [1]])
  })
})
