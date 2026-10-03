// What the renderer does without a bake, pinned (the baked painting, Task 5): the renderer gained a baked underpainting
// pass and a hidden-dashed line pass, and a frame that uses neither (no baked surfaces set, no StrokeBatch.hidden) must
// draw exactly what it drew before. The renderer's output is its GL call stream, so this records every call a fixed
// set of frames makes (every call but the shader sources, which are text the new passes add code to), with the typed
// arrays it uploads and the uniforms it sets, and pins a hash of the stream. The hashes were taken from the renderer as
// it was before the baked passes (milestone-a/paint 1c17ac6): the same file run against that commit gives the same
// numbers. A change that moves one of them changed what a plain frame draws.

import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { meshMark, scene } from '../../testing/marks'
import { DEFAULT_PAINT_PARAMS } from '../params'
import { LAYER_ORDER, PATH_POINTS, ROLES, type PaintFrame, type PaintView, type SceneColours, type StrokeBatch } from '../types'
import { createPaintFakeGl, type PaintFakeGl } from './fakePaintGl'
import { PaintRenderer } from './PaintRenderer'

const COLOURS: SceneColours = { markColour: () => [0.5, 0.1, 0.1], scaleColour: () => null }
const PARAMS = DEFAULT_PAINT_PARAMS

const square = (z: number, opacity = 1) =>
  meshMark([-1, -1, z, 1, -1, z, 1, 1, z, -1, 1, z], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [0, 1, 2, 0, 2, 3], { style: { opacity } })
const SCENE = scene([square(0), square(-1)])

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

// A small deterministic generator: the numbers only have to be the same every run.
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

// `layers.length` strokes, each with a different path, colour and brush, and a world path at depth 1..5 in front of the
// meshes (so a re-projected frame has something to test).
function batch(layers: number[]): StrokeBatch {
  const n = layers.length
  const rnd = lcg(12345)
  const b: StrokeBatch = {
    count: n,
    role: Uint8Array.from(layers.map((l) => ROLES.indexOf(LAYER_ORDER[l]))),
    layer: Uint8Array.from(layers),
    path: new Float32Array(n * 2 * PATH_POINTS),
    width: new Float32Array(n * PATH_POINTS),
    depth: Float32Array.from(layers.map(() => rnd() * 10)),
    colour: Float32Array.from({ length: n * 3 }, () => rnd()),
    alpha: Float32Array.from({ length: n }, () => 0.5 + rnd() * 0.5),
    load: Float32Array.from({ length: n }, () => 0.5 + rnd() * 0.5),
    impasto: Float32Array.from({ length: n }, () => rnd() * 2),
    bristles: Float32Array.from({ length: n }, () => 4 + Math.floor(rnd() * 20)),
    bristleVar: Float32Array.from({ length: n }, () => rnd()),
    dry: Float32Array.from({ length: n }, () => rnd()),
    wet: Float32Array.from({ length: n }, () => rnd()),
    endSoft: Float32Array.from({ length: n }, () => rnd()),
    edge: Uint8Array.from({ length: n }, (_, i) => (i % 3 === 0 ? 255 : i % 4)),
    seed: Uint32Array.from({ length: n }, () => Math.floor(rnd() * 4294967295)),
    worldPath: new Float32Array(n * 3 * PATH_POINTS),
    worldNormal: Float32Array.from({ length: n * 3 }, () => rnd()),
  }
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < PATH_POINTS; k++) {
      const x = 80 + 11 * k + 25 * i
      const y = 90 + 7 * k + 31 * (i % 5)
      b.path[i * 2 * PATH_POINTS + 2 * k] = x
      b.path[i * 2 * PATH_POINTS + 2 * k + 1] = y
      b.width[i * PATH_POINTS + k] = 6 + 8 * rnd()
      b.worldPath[i * 3 * PATH_POINTS + 3 * k] = (x - 400) / 200
      b.worldPath[i * 3 * PATH_POINTS + 3 * k + 1] = (300 - y) / 200
      b.worldPath[i * 3 * PATH_POINTS + 3 * k + 2] = 1 + (i % 5)
    }
  }
  return b
}

function frame(layers: number[], gw = 400, gh = 300, under = false): PaintFrame {
  const n = gw * gh
  const rnd = lcg(777)
  const image = new Float32Array(under ? 3 * n : 0)
  if (under) {
    image.fill(Number.NaN)
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if ((x + y) % 7 !== 0 && x < (gw * 3) / 4) image.set([rnd(), rnd(), rnd()], 3 * (y * gw + x))
  }
  return {
    strokes: batch(layers),
    underpaint: image,
    debug: {
      value: Float32Array.from({ length: n }, () => rnd()),
      planes: Int32Array.from({ length: n }, (_, i) => (i % 11) - 1),
      zones: Uint8Array.from({ length: n }, (_, i) => (i % 6 === 5 ? 255 : i % 5)),
      edgeSegments: Float32Array.from([10, 10, 60, 10, 10, 20, 60, 25]),
      edgeClass: Uint8Array.from([0, 3]),
    },
    stats: { strokes: layers.length, byRole: {} as PaintFrame['stats']['byRole'], loads: 0 },
  }
}

// One argument of a call, as text: a handle by kind and id, a uniform location by name, a typed array by length and a hash
// of its contents.
function show(arg: unknown): string {
  if (arg === null || arg === undefined) return String(arg)
  if (typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'string') return String(arg)
  if (ArrayBuffer.isView(arg)) {
    const bytes = new Uint8Array(arg.buffer, arg.byteOffset, arg.byteLength)
    return `${arg.constructor.name}[${(arg as unknown as ArrayLike<number>).length}]:${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}`
  }
  if (Array.isArray(arg)) return `[${arg.map(show).join(',')}]`
  const o = arg as { kind?: string; id?: number; uniform?: string }
  if (o.uniform !== undefined) return `u:${o.uniform}`
  if (o.kind !== undefined) return `${o.kind}#${o.id}`
  return JSON.stringify(arg)
}

// The call stream of a session, as a list of lines.
function stream(paint: PaintFakeGl): string[] {
  return paint.fake.calls.filter((c) => c.fn !== 'shaderSource').map((c) => `${c.fn}(${c.args.map(show).join(', ')})`)
}

const digest = (lines: string[]) => createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 24)

function run(body: (renderer: PaintRenderer) => void, options: Parameters<typeof createPaintFakeGl>[0] = {}): { lines: string[]; hash: string } {
  const paint = createPaintFakeGl(options)
  const renderer = new PaintRenderer(paint.canvas.canvas, { onError: (m) => { throw new Error(m) } })
  renderer.setScene(SCENE, COLOURS)
  body(renderer)
  const lines = stream(paint)
  renderer.dispose()
  return { lines, hash: digest(lines) }
}

const BLOCK = LAYER_ORDER.indexOf('block')
const FORM = LAYER_ORDER.indexOf('form')
const SCUMBLE = LAYER_ORDER.indexOf('scumble')
const GLAZE = LAYER_ORDER.indexOf('glaze')
const EDGE = LAYER_ORDER.indexOf('edge')
const LINE = LAYER_ORDER.indexOf('line')
const DAB = LAYER_ORDER.indexOf('dab')
const ALL = [BLOCK, FORM, SCUMBLE, GLAZE, EDGE, LINE, DAB, LINE, BLOCK, FORM, DAB, EDGE]

// The pinned hashes of the call streams (taken before the baked passes existed).
const PINNED: Record<string, string> = {
  'a frame made for its own view, with an underpainting': '7d2af7151f8d10a46745a92c',
  'the same frame, re-projected through the new view’s depth and warped': '0085ef7ab4f39e8286174ecc',
  'a re-projected frame with no underpainting, at pixel ratio 2': '8b77353bbdba3ea308a69cfd',
  'the flat role view and the grey view': 'ce199d712eea9adb3abb5674',
  'a frame with no float targets': 'f554fbeb869ea4dca87bed7a',
  'the debug views and an empty batch': 'b395331debcb0ca965ac0f20',
  'two frames, the second a new image, then a resize': '07411c8438da0352c339f44a',
}

const SCENARIOS: Record<string, () => { lines: string[]; hash: string }> = {
  'a frame made for its own view, with an underpainting': () =>
    run((r) => {
      r.renderGBuffer(view(), PARAMS)
      r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'none')
    }),
  'the same frame, re-projected through the new view’s depth and warped': () =>
    run((r) => {
      r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'none', { from: { ...view(), viewProj: Float32Array.from([0.25, 0, 0, 0, 0, 0.25, 0, 0, 0, 0, -0.1, 0, 0, 0, 0, 1]) }, depth: new Float32Array(400 * 300).fill(5) })
    }),
  'a re-projected frame with no underpainting, at pixel ratio 2': () =>
    run((r) => {
      r.paint(frame(ALL, 400, 300, false), view(800, 600, 2), PARAMS, 'none', { from: view(800, 600, 2), depth: new Float32Array(400 * 300).fill(5) })
    }),
  'the flat role view and the grey view': () =>
    run((r) => {
      r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'roles')
      r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'grey')
      r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'paint-only')
    }),
  'a frame with no float targets': () =>
    run(
      (r) => {
        r.renderGBuffer(view(), PARAMS)
        r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'none')
        r.paint(frame(ALL, 400, 300, true), view(), PARAMS, 'none', { from: view(), depth: new Float32Array(400 * 300).fill(5) })
      },
      { colorBufferFloat: false },
    ),
  'the debug views and an empty batch': () =>
    run((r) => {
      for (const mode of ['value', 'zones', 'planes', 'edges'] as const) r.paint(frame(ALL, 400, 300, true), view(), PARAMS, mode)
      r.paint(frame([], 400, 300, true), view(), PARAMS, 'none')
      r.paint(frame([], 400, 300, false), view(), PARAMS, 'none')
    }),
  'two frames, the second a new image, then a resize': () =>
    run((r) => {
      const f = frame(ALL, 400, 300, true)
      r.paint(f, view(), PARAMS, 'none')
      r.paint(f, view(), PARAMS, 'none')
      r.paint(frame(ALL.slice(0, 5), 400, 300, true), view(), PARAMS, 'none')
      r.paint(frame(ALL, 200, 150, true), view(400, 300), PARAMS, 'none')
    }),
}

describe('a frame with no bake draws what it drew before the baked passes', () => {
  for (const [name, make] of Object.entries(SCENARIOS)) {
    it(`${name}: the call stream is the pinned one`, () => {
      const a = make()
      expect(a.lines.length).toBeGreaterThan(20)
      // the same session twice gives the same stream (no clock, no randomness)
      expect(make().hash).toBe(a.hash)
      if (process.env.PRINT_NOBAKE_HASHES) console.log(`  '${name}': '${a.hash}',`)
      else expect(a.hash).toBe(PINNED[name])
    })
  }
})
