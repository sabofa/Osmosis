import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PAINT_PARAMS, setParam, type PaintParams } from '../params'
import { createPaintFakeGl, timeline } from '../gl/fakePaintGl'
import { flatColours, paintView, sceneOf, sphereMesh, tableMesh } from '../model/testing'
import type { PaintDebugMode, PaintView } from '../types'
import type { EngineEvents, FrameStats, PaintEngine } from '../../../../../review/src/paintLabEngine'

// The Paint Lab's engine: one frame at a time, newest request wins, a colour-only change is a
// colour frame, a Showcase tile is copied when it is painted. It runs here on the fake GL and on
// the page's own thread (?worker=0); a Worker that fails falls back to that.
vi.setConfig({ testTimeout: 120_000 })

let createPaintEngine: typeof import('../../../../../review/src/paintLabEngine').createPaintEngine

// paintLabState reads the page's URL when it is imported.
async function load(search: string) {
  vi.resetModules()
  vi.stubGlobal('location', { search, href: `http://lab/paint-lab.html${search}` })
  ;({ createPaintEngine } = await import('../../../../../review/src/paintLabEngine'))
}

beforeAll(async () => load('?worker=0'))
afterEach(() => vi.unstubAllGlobals())

const P = DEFAULT_PAINT_PARAMS
const SCENE = sceneOf([sphereMesh({ radius: 0.6 }), tableMesh({ z: -0.6, half: 1.5, index: 1 })])
const OTHER = sceneOf([sphereMesh({ radius: 0.5 }), tableMesh({ z: -0.5, half: 1.5, index: 1 })])
const COLOURS = flatColours({ 0: [0.56, 0.12, 0.08], 1: [0.9, 0.01, 0.02] })
const view = (opts: Parameters<typeof paintView>[0] = {}): PaintView => paintView({ width: 320, height: 240, azimuth: 30, elevation: 25, zoom: 100, ...opts })

function setup() {
  const gl = createPaintFakeGl({}, { width: 320, height: 240 })
  // the engine sizes the canvas through its style for a tile
  Object.assign(gl.canvas.canvas, { style: {} })
  const frames: FrameStats[] = []
  const errors: (string | null)[] = []
  const events: EngineEvents = { onFrame: (s) => frames.push(s), onError: (m) => errors.push(m) }
  const engine: PaintEngine = createPaintEngine(gl.canvas.canvas, events)
  engine.setScene(SCENE, COLOURS)
  // how many G-buffer passes the renderer has made
  const gbuffers = () => timeline(gl).filter((e) => e.kind === 'gbuffer').length / 2
  const done = (n: number) => vi.waitFor(() => expect(frames.length).toBeGreaterThanOrEqual(n), { timeout: 60_000, interval: 5 })
  return { gl, engine, frames, errors, gbuffers, done }
}

const kinds = (frames: FrameStats[]) => frames.map((f) => f.kind)

describe('the frames of the engine', () => {
  it('makes a full frame first (G-buffer, model, paint), and reports where its time went', async () => {
    const { engine, frames, errors, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    expect(frames[0].kind).toBe('full')
    expect(gbuffers()).toBe(1)
    expect(frames[0].ms).toBeGreaterThan(0)
    expect(frames[0].modelMs).toBeGreaterThan(0)
    expect(frames[0].paperMs).toBeGreaterThan(0) // the paper is generated with the first frame
    expect(errors).toEqual([null])
    engine.dispose()
  })

  it('makes a colour frame, with no G-buffer pass, when only colour parameters changed and the view did not', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.render(view(), setParam(P, 'curve.lSlope', 0.95), 'none')
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'colour'])
    expect(gbuffers()).toBe(1)
    expect(frames[1].gbufferMs).toBe(0)
    // and again, from the same first frame
    engine.render(view(), setParam(P, 'mix.hueMax', 40), 'none')
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'colour', 'colour'])
    expect(gbuffers()).toBe(1)
    engine.dispose()
  })

  it('paints the same strokes again, with no G-buffer and no model, when only the relief or the canvas changed', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    // the relief: strength, light azimuth and elevation
    engine.render(view(), setParam(P, 'impasto.strength', 1.6), 'none')
    await done(2)
    engine.render(view(), setParam(setParam(P, 'impasto.strength', 1.6), 'impasto.lightAzimuth', 200), 'none')
    await done(3)
    expect(kinds(frames)).toEqual(['full', 'repaint', 'repaint'])
    expect(frames[1].strokes).toBe(frames[0].strokes)
    expect(frames[1].modelMs).toBe(0)
    expect(frames[1].gbufferMs).toBe(0)
    expect(frames[1].paperMs).toBe(0) // the paper is the same
    expect(gbuffers()).toBe(1)
    // the canvas texture and weave move the paper (made by the model's thread), not a stroke
    engine.render(view(), setParam(P, 'canvas.texture', 0.5), 'none')
    await done(4)
    expect(frames[3].kind).toBe('repaint')
    expect(frames[3].paperMs).toBeGreaterThan(0)
    expect(gbuffers()).toBe(1)
    engine.render(view(), { ...P, canvas: { ...P.canvas, weave: 'linen' } }, 'none')
    await done(5)
    expect(frames[4].kind).toBe('repaint')
    expect(gbuffers()).toBe(1)
    engine.dispose()
  })

  it('goes back to colour frames after a repaint, and a colour change then its undoing is two colour frames, not a full one', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.render(view(), setParam(P, 'impasto.strength', 2), 'none')
    await done(2)
    engine.render(view(), setParam(setParam(P, 'impasto.strength', 2), 'curve.lSlope', 1.1), 'none')
    await done(3)
    engine.render(view(), P, 'none') // back to the analysed parameters
    await done(4)
    expect(kinds(frames)).toEqual(['full', 'repaint', 'colour', 'colour'])
    expect(gbuffers()).toBe(1)
    // and the strokes of the last of them are the first frame's colours again
    expect(frames[3].strokes).toBe(frames[0].strokes)
    engine.dispose()
  })

  it('makes a full frame when the view, its quality, the debug view, the light, a stroke size or the scene changed', async () => {
    const { engine, frames, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    const next = async (v: PaintView, params: PaintParams, debug: PaintDebugMode) => {
      const n = frames.length
      engine.render(v, params, debug)
      await done(n + 1)
      return frames[frames.length - 1].kind
    }
    expect(await next(view({ azimuth: 40 }), P, 'none')).toBe('full') // the camera moved
    expect(await next(view({ azimuth: 40, dragging: true }), P, 'none')).toBe('full') // the same view, at dragging quality
    expect(await next(view({ azimuth: 40 }), P, 'none')).toBe('full') // and back at full quality
    expect(await next(view({ azimuth: 40 }), P, 'edges')).toBe('full') // another debug view
    expect(await next(view({ azimuth: 40 }), setParam(P, 'light.azimuth', 20), 'edges')).toBe('full') // the light
    expect(await next(view({ azimuth: 40 }), setParam(setParam(P, 'light.azimuth', 20), 'roles.block.width', 30), 'edges')).toBe('full') // a stroke size
    expect(gbuffers()).toBe(7)
    // the new scene: even with nothing else changed, a colour request would have nothing to recolour
    engine.setScene(OTHER, COLOURS)
    expect(await next(view({ azimuth: 40 }), setParam(setParam(P, 'light.azimuth', 20), 'roles.block.width', 30), 'edges')).toBe('full')
    engine.dispose()
  })

  it('gives a scene new colours (a theme, a local colour) a full frame, never a recolour of the old one', async () => {
    const { engine, frames, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    engine.setScene(SCENE, flatColours({ 0: [0.4, 0.1, -0.1], 1: [0.9, 0.01, 0.02] }))
    engine.render(view(), setParam(P, 'curve.lSlope', 0.9), 'none')
    await done(2)
    expect(kinds(frames)).toEqual(['full', 'full'])
    engine.dispose()
  })

  it('does one frame at a time, and of the requests that came while it worked only the newest is made', async () => {
    const { engine, frames, gl, done } = setup()
    // three requests in the same task: the first starts, the second is replaced by the third
    engine.render(view({ azimuth: 10, pixelRatio: 1 }), P, 'none')
    engine.render(view({ azimuth: 20, pixelRatio: 2 }), P, 'none')
    engine.render(view({ azimuth: 30, pixelRatio: 3 }), P, 'none')
    await done(2)
    await new Promise((r) => setTimeout(r, 50))
    expect(frames.length).toBe(2)
    // the renderer sizes its canvas to the last view it painted (the client width, 320, times its pixel ratio): the newest
    expect(gl.canvas.canvas.width).toBe(960)
    engine.dispose()
  })

  it('does not paint a frame of the view over a new scene: what the model made for the old figure is dropped', async () => {
    const { engine, frames, done } = setup()
    engine.render(view(), P, 'none')
    // the figure changes in the same task, before the model's answer is taken
    engine.setScene(OTHER, COLOURS)
    await new Promise((r) => setTimeout(r, 50))
    expect(frames.filter((f) => f.strokes > 0 || f.ms > 0).length).toBe(0)
    engine.render(view(), P, 'none')
    await done(2)
    expect(frames[1].kind).toBe('full')
    engine.dispose()
  })

  it('reports a failed frame as an error to show, and carries on with the next one', async () => {
    const { engine, frames, errors, done } = setup()
    // a view the model cannot use: not a number for a matrix
    const broken = view()
    broken.viewProj = new Float32Array(16).fill(Number.NaN)
    engine.render(broken, P, 'none')
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0), { timeout: 60_000, interval: 5 })
    engine.render(view(), P, 'none')
    await done(frames.length + 1)
    expect(errors[errors.length - 1]).toBeNull()
    engine.dispose()
  })
})

describe('the graphics context', () => {
  it('shows a lost context, and paints the picture again by itself when it comes back', async () => {
    const { engine, gl, frames, errors, gbuffers, done } = setup()
    engine.render(view(), P, 'none')
    await done(1)
    gl.canvas.lose()
    expect(String(errors[errors.length - 1])).toMatch(/graphics context was lost/)
    gl.canvas.restore()
    await done(2)
    // the strokes are the engine's own: no G-buffer, no model
    expect(frames[1].kind).toBe('repaint')
    expect(gbuffers()).toBe(1)
    expect(errors[errors.length - 1]).toBeNull()
    engine.dispose()
  })
})

describe('a tile of the Showcase', () => {
  const target = () => {
    const calls: string[] = []
    return {
      calls,
      context: { canvas: { width: 80, height: 60 }, drawImage: vi.fn(() => calls.push('drawImage')) } as unknown as CanvasRenderingContext2D,
    }
  }

  it('is painted and then copied, in the order asked, each scene set before its own tile', async () => {
    const { engine, gl } = setup()
    const a = target()
    const b = target()
    engine.setScene(SCENE, COLOURS)
    const first = engine.renderTo(a.context, view(), P, 'none')
    engine.setScene(OTHER, COLOURS)
    const second = engine.renderTo(b.context, view(), P, 'none')
    const stats = await Promise.all([first, second])
    expect(stats[0].kind).toBe('full')
    expect(a.context.drawImage).toHaveBeenCalledTimes(1)
    expect(b.context.drawImage).toHaveBeenCalledTimes(1)
    // the copy is of the canvas the engine painted, scaled to the tile
    expect(vi.mocked(a.context.drawImage).mock.calls[0].slice(1, 5)).toEqual([0, 0, 80, 60])
    // each tile's composite came before its own copy (two composites, in order)
    expect(timeline(gl).filter((e) => e.kind === 'composite')).toHaveLength(2)
    engine.dispose()
  })

  it('does not rebuild a scene it has seen: alternating between two scenes costs the model no particles', async () => {
    const { engine } = setup()
    const t = target()
    const run = async (scene: typeof SCENE) => {
      engine.setScene(scene, COLOURS)
      return engine.renderTo(t.context, view(), P, 'none')
    }
    const first = await run(SCENE)
    await run(OTHER)
    const again = await run(SCENE)
    expect(first.particlesMs).toBeGreaterThan(0)
    expect(again.particlesMs).toBe(0)
    engine.dispose()
  })

  it('is refused, not hung, when the engine is disposed before its turn', async () => {
    const { engine } = setup()
    const t = target()
    const a = engine.renderTo(t.context, view(), P, 'none')
    const b = engine.renderTo(t.context, view(), P, 'none')
    engine.dispose()
    await expect(b).rejects.toThrow(/disposed/)
    void a.catch(() => {})
  })
})

describe('where the model runs', () => {
  it('falls back to this thread when the Worker cannot run, and still paints', async () => {
    class BrokenWorker {
      onmessage: unknown = null
      onerror: ((e: { message: string }) => void) | null = null
      constructor() {
        queueMicrotask(() => setTimeout(() => this.onerror?.({ message: 'no module workers here' }), 0))
      }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await load('?')
    const { engine, frames, errors, done } = setup()
    engine.render(view(), P, 'none')
    // the worker never answers and then reports its failure: the engine moves the model to this thread,
    // and the frame that was waiting for the worker is made there
    await vi.waitFor(() => expect(console.warn).toHaveBeenCalled(), { timeout: 10_000 })
    await done(1)
    expect(frames[0].kind).toBe('full')
    // and the next frame is made there too
    engine.render(view({ azimuth: 50 }), P, 'none')
    await done(2)
    expect(errors.filter((m) => m !== null)).toEqual([])
    engine.dispose()
    await load('?worker=0')
  })
})
